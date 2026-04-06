package auth_test

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/golang-jwt/jwt/v5"

	"github.com/unlikeotherai/selkie/internal/auth"
	"github.com/unlikeotherai/selkie/internal/config"
)

func TestServeUOAConfig(t *testing.T) {
	h := auth.NewCallbackHandler(nil, config.Config{
		UOADomain:       "admin.selkie.live",
		UOARedirectURL:  "https://admin.selkie.live/auth/callback",
		UOAAudience:     "auth.unlikeotherai.com",
		UOASharedSecret: "shared-secret",
	}, nil, nil)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/auth/uoa-config", nil)
	h.ServeUOAConfig(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	if got := rr.Header().Get("Content-Type"); got != "application/jwt" {
		t.Fatalf("content-type = %q, want application/jwt", got)
	}

	tokenString := strings.TrimSpace(rr.Body.String())
	claims := jwt.MapClaims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(_ *jwt.Token) (any, error) {
		return []byte("shared-secret"), nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))
	if err != nil {
		t.Fatalf("parse token: %v", err)
	}
	if !token.Valid {
		t.Fatal("token is invalid")
	}
	if got := claims["domain"]; got != "admin.selkie.live" {
		t.Fatalf("domain = %#v", got)
	}
	redirectURLs, ok := claims["redirect_urls"].([]any)
	if !ok || len(redirectURLs) != 1 || redirectURLs[0] != "https://admin.selkie.live/auth/callback" {
		t.Fatalf("redirect_urls = %#v", claims["redirect_urls"])
	}
	methods, ok := claims["enabled_auth_methods"].([]any)
	if !ok || len(methods) != 3 {
		t.Fatalf("enabled_auth_methods = %#v", claims["enabled_auth_methods"])
	}
	audience, ok := claims["aud"].([]any)
	if !ok || len(audience) != 1 || audience[0] != "auth.unlikeotherai.com" {
		t.Fatalf("audience = %#v", claims["aud"])
	}
}

func TestServeUOAConfigIncomplete(t *testing.T) {
	h := auth.NewCallbackHandler(nil, config.Config{}, nil, nil)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/auth/uoa-config", nil)
	h.ServeUOAConfig(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusInternalServerError)
	}
}

func TestBuildAuthURLUsesConfigURL(t *testing.T) {
	t.Setenv("UOA_BASE_URL", "https://authentication.unlikeotherai.com")
	t.Setenv("UOA_CONFIG_URL", "https://admin.selkie.live/auth/uoa-config")
	t.Setenv("UOA_REDIRECT_URL", "https://admin.selkie.live/auth/callback")

	got := auth.BuildAuthURL()
	if !strings.Contains(got, "config_url=https%3A%2F%2Fadmin.selkie.live%2Fauth%2Fuoa-config") {
		t.Fatalf("auth url missing config_url: %s", got)
	}
	if !strings.Contains(got, "redirect_uri=https%3A%2F%2Fadmin.selkie.live%2Fauth%2Fcallback") {
		t.Fatalf("auth url missing redirect_uri: %s", got)
	}
}

func TestServeUOAConfigPayloadShape(t *testing.T) {
	h := auth.NewCallbackHandler(nil, config.Config{
		UOADomain:       "admin.selkie.live",
		UOARedirectURL:  "https://admin.selkie.live/auth/callback",
		UOAAudience:     "auth.unlikeotherai.com",
		UOASharedSecret: "shared-secret",
	}, nil, nil)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/auth/uoa-config", nil)
	h.ServeUOAConfig(rr, req)

	parts := strings.Split(strings.TrimSpace(rr.Body.String()), ".")
	if len(parts) != 3 {
		t.Fatalf("jwt parts = %d, want 3", len(parts))
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	var body map[string]any
	if err := json.Unmarshal(payload, &body); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if body["user_scope"] != "global" {
		t.Fatalf("user_scope = %#v", body["user_scope"])
	}
}
