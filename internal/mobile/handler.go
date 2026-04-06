package mobile

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/unlikeotherai/selkie/internal/audit"
	"github.com/unlikeotherai/selkie/internal/auth"
	"github.com/unlikeotherai/selkie/internal/config"
	"github.com/unlikeotherai/selkie/internal/overlay"
	"github.com/unlikeotherai/selkie/internal/store"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
)

type HubSyncer interface {
	SyncAll(ctx context.Context) error
	SyncDevice(ctx context.Context, deviceID string) error
}

type Handler struct {
	db      *store.DB
	logger  *zap.Logger
	cfg     config.Config
	overlay *overlay.Allocator
	audit   *audit.Logger
	hub     HubSyncer
}

type enrollRequest struct {
	Hostname    string `json:"hostname"`
	OSPlatform  string `json:"os_platform"`
	OSArch      string `json:"os_arch"`
	AppVersion  string `json:"app_version"`
	WGPublicKey string `json:"wg_public_key"`
}

type enrollResponse struct {
	DeviceID  string  `json:"device_id"`
	OverlayIP *string `json:"overlay_ip"`
	WGConfig  string  `json:"wg_config"`
}

type mobileServer struct {
	DeviceID   string  `json:"device_id"`
	Hostname   string  `json:"hostname"`
	Status     string  `json:"status"`
	OverlayIP  *string `json:"overlay_ip"`
	OSPlatform string  `json:"os_platform"`
	OSArch     string  `json:"os_arch"`
}

func New(db *store.DB, logger *zap.Logger, cfg config.Config, alloc *overlay.Allocator, auditor *audit.Logger, hub HubSyncer) *Handler {
	if logger == nil {
		logger = zap.NewNop()
	}
	return &Handler{db: db, logger: logger, cfg: cfg, overlay: alloc, audit: auditor, hub: hub}
}

func (h *Handler) Mount(r chi.Router) {
	r.Group(func(r chi.Router) {
		r.Use(auth.Middleware(h.cfg))
		r.Post("/api/v1/mobile/enroll", h.handleEnroll)
		r.Get("/api/v1/mobile/servers", h.handleListServers)
		r.Post("/api/v1/mobile/disconnect", h.handleDisconnect)
	})
}

func (h *Handler) handleEnroll(w http.ResponseWriter, r *http.Request) {
	claims, ok := auth.ClaimsFromContext(r.Context())
	if !ok || claims.Sub == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if h.db == nil || h.db.Pool == nil {
		writeError(w, http.StatusInternalServerError, "database unavailable")
		return
	}
	if h.cfg.WGServerPublicKey == "" || h.cfg.WGServerEndpoint == "" || h.cfg.WGOverlayCIDR == "" {
		writeError(w, http.StatusServiceUnavailable, "wireguard server not configured")
		return
	}

	var req enrollRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if strings.TrimSpace(req.Hostname) == "" || strings.TrimSpace(req.OSPlatform) == "" || strings.TrimSpace(req.OSArch) == "" || strings.TrimSpace(req.AppVersion) == "" || strings.TrimSpace(req.WGPublicKey) == "" {
		writeError(w, http.StatusBadRequest, "missing required fields")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	tx, err := h.db.Pool.Begin(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start transaction")
		return
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback is best-effort after commit

	deviceID, overlayIP, err := h.upsertMobileDevice(ctx, tx, claims.Sub, req)
	if err != nil {
		h.logger.Error("upsert mobile device", zap.Error(err), zap.String("user_id", claims.Sub))
		writeError(w, http.StatusInternalServerError, "failed to enroll mobile device")
		return
	}

	if err := h.upsertMobileDeviceKey(ctx, tx, deviceID, req.WGPublicKey); err != nil {
		h.logger.Error("upsert mobile device key", zap.Error(err), zap.String("device_id", deviceID))
		writeError(w, http.StatusInternalServerError, "failed to bind wireguard key")
		return
	}

	if overlayIP == nil && h.overlay != nil {
		ip, allocErr := h.overlay.AllocateTx(ctx, tx, deviceID)
		if allocErr != nil {
			h.logger.Error("allocate mobile overlay ip", zap.Error(allocErr), zap.String("device_id", deviceID))
			writeError(w, http.StatusInternalServerError, "failed to allocate overlay ip")
			return
		}
		value := ip.String()
		overlayIP = &value
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to finalize mobile enrollment")
		return
	}

	if h.hub != nil {
		if syncErr := h.hub.SyncDevice(ctx, deviceID); syncErr != nil {
			h.logger.Error("sync mobile wireguard peer", zap.Error(syncErr), zap.String("device_id", deviceID))
		}
	}

	if h.audit != nil {
		if auditErr := h.audit.Log(ctx, audit.Event{
			ActorUserID: &claims.Sub,
			Action:      "device.mobile_enroll",
			Outcome:     "success",
			TargetTable: "devices",
			TargetID:    &deviceID,
			RemoteIP:    audit.RemoteAddr(r),
			UserAgent:   r.UserAgent(),
		}); auditErr != nil {
			h.logger.Error("audit mobile enroll", zap.Error(auditErr))
		}
	}

	wgConfig, err := h.renderMobileWGConfig(*overlayIP)
	if err != nil {
		h.logger.Error("render mobile wireguard config", zap.Error(err), zap.String("device_id", deviceID))
		writeError(w, http.StatusInternalServerError, "failed to build wireguard config")
		return
	}

	writeJSON(w, http.StatusOK, enrollResponse{
		DeviceID:  deviceID,
		OverlayIP: overlayIP,
		WGConfig:  wgConfig,
	})
}

func (h *Handler) handleListServers(w http.ResponseWriter, r *http.Request) {
	claims, ok := auth.ClaimsFromContext(r.Context())
	if !ok || claims.Sub == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	rows, err := h.db.Pool.Query(r.Context(), `
SELECT d.id,
       d.hostname,
       'active' AS status,
       host(d.overlay_ip),
       d.os_platform,
       d.os_arch
FROM devices d
WHERE d.owner_user_id = $1
  AND d.status = 'active'
  AND EXISTS (SELECT 1 FROM services s WHERE s.device_id = d.id)
ORDER BY d.hostname ASC
`, claims.Sub)
	if err != nil {
		h.logger.Error("list mobile servers", zap.Error(err), zap.String("user_id", claims.Sub))
		writeError(w, http.StatusInternalServerError, "failed to list mobile servers")
		return
	}
	defer rows.Close()

	result := make([]mobileServer, 0)
	for rows.Next() {
		var item mobileServer
		if err := rows.Scan(&item.DeviceID, &item.Hostname, &item.Status, &item.OverlayIP, &item.OSPlatform, &item.OSArch); err != nil {
			h.logger.Error("scan mobile server", zap.Error(err), zap.String("user_id", claims.Sub))
			writeError(w, http.StatusInternalServerError, "failed to list mobile servers")
			return
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		h.logger.Error("iterate mobile servers", zap.Error(err), zap.String("user_id", claims.Sub))
		writeError(w, http.StatusInternalServerError, "failed to list mobile servers")
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) handleDisconnect(w http.ResponseWriter, r *http.Request) {
	claims, ok := auth.ClaimsFromContext(r.Context())
	if !ok || claims.Sub == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	if h.audit != nil {
		if auditErr := h.audit.Log(r.Context(), audit.Event{
			ActorUserID: &claims.Sub,
			Action:      "mobile.disconnect",
			Outcome:     "info",
			TargetTable: "users",
			TargetID:    nil,
			RemoteIP:    audit.RemoteAddr(r),
			UserAgent:   r.UserAgent(),
		}); auditErr != nil {
			h.logger.Error("audit mobile disconnect", zap.Error(auditErr))
		}
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) upsertMobileDevice(ctx context.Context, tx pgx.Tx, userID string, req enrollRequest) (string, *string, error) {
	var deviceID string
	var overlayIP *string
	err := tx.QueryRow(ctx, `
SELECT id, host(overlay_ip)
FROM devices
WHERE owner_user_id = $1 AND hostname = $2
LIMIT 1
`, userID, req.Hostname).Scan(&deviceID, &overlayIP)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", nil, err
	}

	if errors.Is(err, pgx.ErrNoRows) {
		credential, credErr := randomCredential()
		if credErr != nil {
			return "", nil, credErr
		}
		credentialHash, hashErr := bcrypt.GenerateFromPassword([]byte(credential), bcrypt.DefaultCost)
		if hashErr != nil {
			return "", nil, hashErr
		}

		err = tx.QueryRow(ctx, `
INSERT INTO devices (
    owner_user_id,
    hostname,
    status,
    credential_hash,
    agent_version,
    os_platform,
    os_arch,
    os_version,
    kernel_version,
    cpu_model,
    cpu_cores,
    total_memory_bytes,
    disk_total_bytes,
    disk_free_bytes,
    last_seen_at,
    updated_at
) VALUES ($1, $2, 'active', $3, $4, $5, $6, '', '', '', 1, 0, 0, 0, now(), now())
RETURNING id, host(overlay_ip)
`, userID, req.Hostname, string(credentialHash), req.AppVersion, req.OSPlatform, req.OSArch).Scan(&deviceID, &overlayIP)
		return deviceID, overlayIP, err
	}

	err = tx.QueryRow(ctx, `
UPDATE devices
SET status = 'active',
    hostname = $2,
    agent_version = $3,
    os_platform = $4,
    os_arch = $5,
    last_seen_at = now(),
    updated_at = now(),
    revoked_at = NULL,
    overlay_ip_reclaim_after = NULL
WHERE id = $1
RETURNING host(overlay_ip)
`, deviceID, req.Hostname, req.AppVersion, req.OSPlatform, req.OSArch).Scan(&overlayIP)
	return deviceID, overlayIP, err
}

func (h *Handler) upsertMobileDeviceKey(ctx context.Context, tx pgx.Tx, deviceID, publicKey string) error {
	var keyID string
	var currentKey string
	var version int
	err := tx.QueryRow(ctx, `
SELECT id, wg_public_key, key_version
FROM device_keys
WHERE device_id = $1 AND state = 'active'
LIMIT 1
`, deviceID).Scan(&keyID, &currentKey, &version)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			_, err = tx.Exec(ctx, `
INSERT INTO device_keys (device_id, key_version, wg_public_key, state)
VALUES ($1, 1, $2, 'active')
`, deviceID, publicKey)
			return err
		}
		return err
	}

	if currentKey == publicKey {
		return nil
	}

	if _, err := tx.Exec(ctx, `
UPDATE device_keys
SET state = 'retired', retired_at = now()
WHERE id = $1
`, keyID); err != nil {
		return err
	}

	_, err = tx.Exec(ctx, `
INSERT INTO device_keys (device_id, key_version, wg_public_key, state, rotated_from_key_id)
VALUES ($1, $2, $3, 'active', $4)
`, deviceID, version+1, publicKey, keyID)
	return err
}

func (h *Handler) renderMobileWGConfig(deviceOverlayIP string) (string, error) {
	serverOverlayIP, err := overlay.ServerOverlayIP(h.cfg.WGOverlayCIDR)
	if err != nil {
		return "", err
	}

	peerConfig := overlay.GeneratePeerConfig(
		h.cfg.WGServerPublicKey,
		h.cfg.WGServerEndpoint,
		h.cfg.WGServerPort,
		serverOverlayIP,
		"mobile-device",
		deviceOverlayIP,
	)

	return fmt.Sprintf("[Interface]\nAddress = %s/32\n\n%s", deviceOverlayIP, peerConfig.DeviceSide), nil
}

func randomCredential() (string, error) {
	credBytes := make([]byte, 32)
	if _, err := rand.Read(credBytes); err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(credBytes), nil
}

func decodeJSON(r *http.Request, dst any) error {
	defer r.Body.Close()

	decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return err
	}

	var extra json.RawMessage
	if err := decoder.Decode(&extra); err != io.EOF {
		return errors.New("request body must contain a single JSON object")
	}

	return nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value) //nolint:errcheck // best-effort write to HTTP response
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
