# Silkie CLI

The Silkie CLI is a Node.js daemon published on npm. It runs as a system
service on each enrolled device, maintains the WireGuard peer connection, and
reports the device's service manifest to the control server.

## Install

```sh
npm install -g silkie
```

Requires Node.js 20+. The package ships a native WireGuard binding and
pre-built coturn credentials helper for macOS (arm64/amd64) and Linux
(amd64/arm64).

## Run as a service

After enrollment, install the system service so the daemon starts on boot:

```sh
silkie service install   # launchd on macOS, systemd on Linux
silkie service start
silkie service status
silkie service stop
silkie service uninstall
```

The service runs as the current user. It does not require root except to
configure the WireGuard interface (handled once during install via a privileged
helper).

## Enrollment

Two authentication paths are available. Both result in the CLI holding a
device credential on disk (`~/.silkie/credential`) and the server registering
the device's WireGuard public key.

The CLI generates the WireGuard keypair locally on first run. The private key
never leaves the device.

### Option 1 — Pairing code (any machine)

Use this when enrolling a headless server or any machine where opening a
browser is inconvenient.

```sh
silkie enroll
```

The CLI:

1. Generates a local WireGuard keypair if one does not exist.
2. Requests a pairing code from the server (`POST /v1/auth/pair/start`).
3. Prints a **6-character code** (e.g. `A3X9KF`).
4. Polls `GET /v1/auth/pair/status` every 5 seconds.

While the CLI is waiting, open the Silkie admin UI, go to
**Devices → Enrol Device**, and enter the 6-character code. Once submitted,
the CLI receives its credential and WireGuard config automatically.

Codes expire after **10 minutes** and are single-use.

### Option 2 — SSO (machine with a browser)

Use this when you are sitting at the machine being enrolled.

```sh
silkie enroll --sso
```

The CLI:

1. Generates a local WireGuard keypair if one does not exist.
2. Requests a device authorization code from the server.
3. Opens the SSO login URL in the default browser.
4. Polls `GET /v1/auth/device/status` every 5 seconds.

Complete the login in the browser. The CLI will receive its credential
automatically once the SSO flow completes. No manual code entry required.

## Commands

| Command | Description |
|---|---|
| `silkie enroll` | Enrol this device using a pairing code |
| `silkie enroll --sso` | Enrol this device via SSO browser login |
| `silkie status` | Show device status, overlay IP, and active connections |
| `silkie service install` | Install the system service |
| `silkie service start` | Start the service |
| `silkie service stop` | Stop the service |
| `silkie service status` | Show service health |
| `silkie service uninstall` | Remove the system service |
| `silkie logout` | Revoke credential and remove device registration |
| `silkie logs` | Stream daemon logs |

## Configuration

Config lives at `~/.silkie/config.json`. Most values are written during
enrollment and should not be edited manually.

| Key | Description |
|---|---|
| `server_url` | Control server base URL |
| `device_id` | Assigned device ID |
| `credential` | Long-lived device credential token |
| `wg_public_key` | WireGuard public key (informational) |
| `overlay_ip` | Assigned overlay IP |

The WireGuard private key is stored separately at `~/.silkie/wg.key` with
mode `0600`.

## How it works

Once running, the daemon:

1. **Heartbeat** — POSTs to `/v1/devices/{id}/heartbeat` every 30 seconds,
   sending current external endpoint and service manifest.
2. **Service manifest** — Scans listening ports and reports them as the
   device's service catalog. The server exposes this in the admin UI.
3. **Session handling** — Subscribes to session events. When a remote peer
   requests a connection, the daemon participates in ICE candidate exchange
   via the session broker, preferring a direct WireGuard path and falling back
   to TURN relay.
4. **Key rotation** — Responds to server-initiated key rotation requests,
   generating a new keypair and uploading the new public key.

## Device fingerprint

At enrollment, and refreshed on every heartbeat, the CLI collects the
following information and sends it to the control server. All fields are
read from the OS — nothing is estimated or inferred.

| Field | Source |
|---|---|
| `hostname` | `os.hostname()` |
| `os_platform` | `os.platform()` — `darwin` / `linux` / `win32` |
| `os_version` | `os.version()` + `os.release()` combined into a readable string |
| `os_arch` | `os.arch()` |
| `kernel_version` | `os.version()` raw value |
| `cpu_model` | `os.cpus()[0].model` |
| `cpu_cores` | `os.cpus().length` |
| `cpu_speed_mhz` | `os.cpus()[0].speed` |
| `total_memory_bytes` | `os.totalmem()` |
| `disk_total_bytes` | `fs.statfs('/')` (or `C:\` on Windows) |
| `disk_free_bytes` | `fs.statfs('/')` — refreshed on every heartbeat |
| `network_interfaces` | `os.networkInterfaces()` — name, MAC, all assigned addresses |
| `agent_version` | package `version` field from `package.json` |

**What is and is not collected:**

- CPU and memory figures are point-in-time snapshots, not continuous monitoring.
- `disk_free_bytes` and `network_interfaces` are the only fields that change
  frequently; they are updated on every heartbeat so the server always has a
  current picture.
- No process list, no file system contents, no browser data, no user activity.
- The user can inspect exactly what will be sent before enrollment by running
  `silkie enroll --dry-run`.

## Security notes

- The WireGuard private key is generated locally and never transmitted.
- The device credential is an opaque token stored at rest in `~/.silkie/`.
  Treat it like a private key.
- Running `silkie logout` revokes the credential server-side and removes all
  local state.
- The daemon communicates with the server over HTTPS only. Self-signed certs
  are not accepted unless `--insecure` is passed explicitly (development only).
