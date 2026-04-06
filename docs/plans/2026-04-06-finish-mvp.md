# Selkie MVP Finish Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all blocking bugs and wire remaining disconnected components so Selkie can be deployed and tested end-to-end with real devices.

**Architecture:** The server is a Go chi-based control plane with PostgreSQL, Redis, and coturn. The admin UI is a single-page HTML/JS app served by the Go server. All API routes are at `/api/v1/...`. The policy engine is an OPA HTTP client that needs to be wired into session creation.

**Tech Stack:** Go 1.23+, chi v5, pgx/v5, go-redis/v9, OPA, coturn, Tailwind CSS

---

## Critical Bugs (Block All Testing)

### Task 1: Fix admin UI route paths

The admin UI calls `/v1/...` but all server routes are mounted at `/api/v1/...`. Every API call from the frontend is 404.

**Files:**
- Modify: `admin/index.html`

**Step 1: Fix all API paths**

In `admin/index.html`, replace every `/v1/` API call with `/api/v1/`:

- Line 400: `apiFetch('/v1/devices')` → `apiFetch('/api/v1/devices')`
- Line 469: `apiFetch('/v1/devices/' + id, ...)` → `apiFetch('/api/v1/devices/' + id, ...)`
- Line 517: `apiFetch('/v1/auth/pair/start', ...)` → `apiFetch('/api/v1/auth/pair/start', ...)`
- Line 538: `apiFetch('/v1/auth/pair/status?...')` → `apiFetch('/api/v1/auth/pair/status?...')`
- Line 573: `apiFetch('/v1/sessions')` → `apiFetch('/api/v1/sessions')`

**Step 2: Verify no remaining `/v1/` paths**

Search for `'/v1/` in the file — should find zero matches.

**Step 3: Commit**

---

### Task 2: Fix device revocation CHECK constraint violation

`handleDeleteDevice` sets `overlay_ip_reclaim_after` but not `revoked_at`. The DB has:
```sql
CONSTRAINT devices_overlay_reclaim_check
    CHECK (overlay_ip_reclaim_after IS NULL OR revoked_at IS NOT NULL)
```
So every revocation fails with a constraint error.

**Files:**
- Modify: `internal/devices/handler.go:290-297`

**Step 1: Add revoked_at to the UPDATE**

```go
`update devices
set status = 'revoked',
    revoked_at = now(),
    overlay_ip_reclaim_after = now() + interval '24 hours',
    updated_at = now()
where id = $1 and owner_user_id = $2`
```

**Step 2: Commit**

---

### Task 3: Fix pair/status polling in admin UI

The admin UI polls `pair/status?device_id=...` but `handlePairStatus` reads `r.URL.Query().Get("code")`. Also, `pair/start` returns `{"code": "ABCDEF"}` — no device_id. The admin UI tries to read `data.device_id` which is undefined.

The fix: store the code from pair/start, poll pair/status with `?code=` instead.

**Files:**
- Modify: `admin/index.html` (submitAddDevice function, ~lines 495-560)

**Step 1: Fix the polling logic**

Change `submitAddDevice()` to:
1. Store the pair code from the response
2. Poll `/api/v1/auth/pair/status?code=<CODE>` instead of using device_id
3. Check for `statusData.status === 'claimed'`

**Step 2: Commit**

---

## Wiring Disconnected Components

### Task 4: Wire policy engine into session creation

The policy engine is created in `main.go:89` but assigned to `_`. It needs to be passed to the sessions handler and called in `handleCreateSession`.

**Files:**
- Modify: `internal/sessions/handler.go:22-49,63-115`
- Modify: `cmd/control-server/main.go:89-90,144`

**Step 1: Add policy engine to sessions.Handler**

In `internal/sessions/handler.go`:
- Add `policy *policy.Engine` field to Handler struct
- Update `New()` to accept `*policy.Engine`
- In `handleCreateSession`, call `h.policy.Evaluate()` before the INSERT
- If denied, insert with `status='denied'` and `denial_reason`

**Step 2: Update main.go to pass the policy engine**

In `cmd/control-server/main.go`:
- Remove `_ = policyEngine` (line 90)
- Change `sessions.New(db, rdb, logger, cfg)` to `sessions.New(db, rdb, logger, cfg, policyEngine)` (line 144)

**Step 3: Commit**

---

### Task 5: Add system info API endpoint

The admin UI system tab shows overlay CIDR and token info from JWT claims only. Add a `/api/v1/system/info` endpoint so the admin can see server-side state.

**Files:**
- Modify: `internal/admin/handler.go`
- Modify: `admin/index.html`

**Step 1: Add handleSystemInfo to admin handler**

Returns: server version, overlay CIDR, TURN host/port configured, OPA configured, Redis connected, device count, session count.

**Step 2: Wire into admin UI system tab**

**Step 3: Commit**

---

### Task 6: Add audit log viewer to admin UI

The `/api/v1/audit` endpoint exists and works. Add a tab or section in the system panel to display audit events.

**Files:**
- Modify: `admin/index.html`

**Step 1: Add audit events section to system tab**

Table showing recent audit events with action, actor, outcome, timestamp. Only visible to super users.

**Step 2: Commit**

---

### Task 7: Lint and build verification

**Step 1: Run golangci-lint**

```bash
golangci-lint run ./...
```

**Step 2: Run go build**

```bash
go build ./cmd/control-server/
```

**Step 3: Run existing tests**

```bash
go test ./...
```

**Step 4: Fix any issues, commit**

---

### Task 8: Docker compose stack validation

**Step 1: Verify Dockerfile builds**

```bash
docker build -t selkie-server .
```

**Step 2: Verify docker-compose.yml is valid**

```bash
docker compose config
```

**Step 3: Fix any issues found, commit**
