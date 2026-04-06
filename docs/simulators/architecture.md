# Simulator Streaming — Architecture

## Goal

Allow a machine running iOS simulators or Android emulators to expose a
controlled, authenticated remote-desktop view of a specific app to a web
browser. The stream URL is generated on the host machine and protected by
selkie's zero-trust access layer. Viewers need only a browser — no native
client required.

## Scope

- Screen streaming (read and interactive)
- Simulator/emulator lifecycle: spawn, pool, clone, reclaim
- App binary propagation across cloned simulators
- Device type configuration and concurrency caps
- Integration with selkie's service catalog and session broker

Out of scope for this document: the selkie control-plane itself, WireGuard
overlay, TURN relay, or any persistent user data stored inside the simulator.

---

## System Overview

```
                           ┌────────────────────────────────────────┐
                           │           Host Machine (macOS)         │
                           │                                        │
  Browser ◄──── HTTPS ────►│  selkie agent  ◄──── HTTP ────►  Sim  │
                           │  (stream proxy)      (:8421+)   Manager│
                           │       │                            │   │
                           │       │ selkie service catalog     │   │
                           │       └────────────────────────────┘   │
                           │                                        │
                           │  iOS Simulators   Android Emulators    │
                           │  (xcrun simctl)   (avdmanager/adb)     │
                           └────────────────────────────────────────┘
                                      │
                               selkie control plane
                               (auth, policy, audit)
```

The **Simulator Manager** is a new subsystem of the selkie device agent. It
runs on any macOS host that has Xcode or Android SDK installed. It registers
itself with the selkie service catalog as a set of `simulator-stream` services,
one per active simulator slot. The selkie agent reverse-proxies authenticated
browser sessions to the per-simulator HTTP stream endpoints.

---

## Components

### 1. Simulator Manager

Owns the full lifecycle of simulators and emulators on the host. Responsibilities:

- Maintain a **pool** of pre-booted simulators per configured device type.
- Enforce **max concurrency** per device type and globally.
- **Spawn** new simulators up to the configured max when demand arrives.
- **Clone app binaries** from a source simulator to any newly spawned one.
- **Reclaim** idle simulators back to the pool (or shut them down if over-provisioned).
- Report simulator availability to the selkie service catalog via heartbeat.

The manager runs as a goroutine inside the selkie agent process (same binary,
new `internal/simmanager` package). It is activated by configuration — hosts
without simulator config do not start it.

### 2. Capture Service (per simulator)

Each booted simulator has one Capture Service process, started by the manager
when the simulator is assigned to a session. The Capture Service:

- Pulls screen frames from the simulator using platform-specific mechanisms.
- Encodes and serves them over a local HTTP endpoint.
- Accepts input events (touch, swipe, key) via a local HTTP endpoint and
  injects them into the simulator.
- Exits when the session ends or the simulator is reclaimed.

See [ios.md](ios.md) and [android.md](android.md) for per-platform capture
and input injection details.

### 3. Stream Proxy (selkie agent)

The selkie agent already reverse-proxies services exposed by the device. The
stream proxy extends this with:

- WebSocket pass-through for real-time frame delivery.
- MJPEG pass-through for fallback streaming.
- Input event forwarding from authenticated browser sessions to the Capture
  Service's local input endpoint.
- Session binding: only the user who holds the active connect session can send
  input; others with viewer policy can only read the stream.

### 4. URL Generation

When a browser session is established, the selkie control plane issues a
connect-session URL of the form:

```
https://{host}.devices.{domain}/stream/sim/{session_id}
```

Or, if the machine is directly reachable (no relay needed):

```
https://{device_overlay_ip}:{port}/stream/sim/{session_id}
```

The URL is short-lived (TTL set by policy, default 8 hours). It embeds a
signed token that the selkie agent validates on every request. The domain and
TLS certificate are managed by the selkie control plane; the host machine does
not need its own certificate.

---

## Simulator Lifecycle

### Pool States

```
  available ──► assigned ──► idle ──► available
                    │                    ▲
                    └──── reclaimed ─────┘
                              │
                           shutdown (if over-provisioned)
```

- **available** — booted, app installed, waiting for a session.
- **assigned** — a user session is active; stream is live.
- **idle** — session ended; simulator is still booted but not in use.
  Transitions back to available after a configurable grace period (default
  5 min) or immediately if another session arrives.
- **reclaimed** — marked for shutdown when the pool is over the configured
  idle max.
- **shutdown** — `xcrun simctl shutdown <udid>` / `emulator` process killed.

### Spawn Flow

1. Session request arrives (from selkie control plane via the device's SSE
   channel).
2. Manager checks pool for an available simulator of the requested device type.
3. If one exists: move it to **assigned**, return its stream endpoint.
4. If none exists and total active count < `max_instances`: create and boot a
   new simulator, install the app binary, move to **assigned**.
5. If at max: return a 503 with `Retry-After` and queue the request.

### App Binary Cloning

The manager maintains a **source simulator** per app — the canonical simulator
that has the app already installed and potentially pre-seeded with data.
Cloning steps:

**iOS:**
```
source_app_path=$(xcrun simctl get_app_container <source_udid> <bundle_id> app)
xcrun simctl install <target_udid> "$source_app_path"
```
The app container (user data) is not copied — each new simulator starts with
a fresh app data directory. This is intentional: sessions are isolated.

**Android:**
```
adb -s <source_emulator> shell pm path <package_name>
# → package:/data/app/<hash>/base.apk

adb -s <source_emulator> pull <path_to_base.apk> /tmp/app.apk
adb -s <target_emulator> install /tmp/app.apk
```

The manager caches the pulled APK on disk so subsequent clones skip the `pull`
step.

### Max Instances and Device Types

Configuration (see [config.md](config.md)) specifies per-device-type limits:

```yaml
simulators:
  ios:
    - device_type: "iPhone 15"
      runtime: "iOS 17.4"
      source_udid: "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
      bundle_id: "com.example.myapp"
      max_instances: 4
      idle_timeout_seconds: 300
  android:
    - avd_template: "pixel_6_api34"
      package_name: "com.example.myapp"
      max_instances: 2
      idle_timeout_seconds: 300
global:
  max_total_instances: 6
```

`max_instances` per device type is enforced independently. `max_total_instances`
is a hard cap across all types combined. Both limits are checked before any
spawn attempt.

---

## Streaming Protocols

Two protocols are supported. The Capture Service exposes both on the same port.

### MJPEG (default, most reliable)

- Endpoint: `GET /stream/{udid}/mjpeg`
- Content-Type: `multipart/x-mixed-replace; boundary=frame`
- Frame rate: up to 30fps, configurable per session.
- Suitable for: monitoring, demos, viewing-only sessions.
- Browser support: universal (img tag or native MJPEG support).

Implementation:
- **iOS**: `xcrun simctl io <udid> screenshot --type=png` polled in a tight
  loop. PNG is decoded and re-encoded as JPEG before transmission if JPEG
  frames are configured for lower bandwidth.
- **Android**: `adb -s <serial> exec-out screencap -p` polled in a loop.

This is the recommended first implementation path. It has no container format
ambiguity, no browser decoder dependencies, and degrades gracefully.

### WebSocket + H.264 (interactive, low-latency)

- Endpoint: `GET /stream/{udid}/ws` (upgrade to WebSocket)
- Input endpoint: `POST /input/{udid}` (JSON body, described below)
- Latency: ~80–300ms end-to-end over LAN.
- Suitable for: interactive sessions, QA, testing.

**iOS capture:** `xcrun simctl io <udid> recordVideo` outputs **fragmented
MP4 (fMP4)**, not raw Annex-B NAL units. Use `--type=fmp4` where available
(older Xcode) or treat the pipe as an fMP4 bytestream and demux with ffmpeg or
a Go MP4 library before sending frames to the client. Do not attempt to forward
the raw pipe bytes as H.264 — the container wrapper will confuse browser
decoders. Treat the `simctl` process as disposable: restart it on exit without
rebooting the simulator; see [ios.md](ios.md) for the restart wrapper pattern.

**Preferred iOS alternative:** a thin Swift helper using
`CGWindowListCreateImageFromArray` + VideoToolbox `VTCompressionSession`
captures the simulator window frame-by-frame and emits true H.264 access units.
This is more stable than piping `simctl` output for long-running sessions. See
[ios.md](ios.md) for the full Swift implementation.

**Android capture:** `adb -s <serial> shell screenrecord --output-format=h264
--time-limit=3600 -` produces a raw H.264 bytestream (Annex-B). Restart the
adb shell process on disconnect without rebooting the emulator.

**Browser decoder:** VideoToolbox (iOS capture path) and the Android H.264
pipe both ultimately deliver H.264 access units, but they arrive in different
formats:
- VideoToolbox emits **AVCC (length-prefixed NAL units)**. For WebCodecs you
  must also supply a `VideoDecoderConfig.description` containing the `avcC`
  (AVCDecoderConfigurationRecord) built from the SPS and PPS NAL units.
- Android `screenrecord` emits **Annex-B (start-code NAL units)**. For
  WebCodecs you must parse SPS/PPS from the stream, build an `avcC` blob, and
  convert each access unit to AVCC length-prefix format before passing it as an
  `EncodedVideoChunk`.

Use `VideoDecoder.isConfigSupported()` at session start to verify the browser
can decode the chosen profile/level. Mark `EncodedVideoChunk.type = "key"` only
for IDR NAL units (type 5), not merely I-slices. New viewers must receive
SPS + PPS + next IDR before decoding can begin — maintain a parameter-set
cache and send it on WebSocket connect.

**Browser compatibility (early 2026):** WebCodecs `VideoDecoder` ships in
Chrome 94+, Edge 94+, and Safari 26.4+. MSE + fMP4 (CMAF fragments) is the
most compatible fallback — it uses the platform media pipeline and avoids
manual NAL parsing in JavaScript. WASM decoders (Broadway.js, ffmpeg.wasm) are
last resort: high CPU, lower fps, not suitable for interactive use at retina
resolutions.

---

## Input Injection

Input events from the browser are sent as JSON to the Capture Service's local
input endpoint. The stream proxy forwards them after verifying the session
token grants `input` permission.

### Event Schema

```json
{
  "type": "tap",
  "x": 195,
  "y": 422,
  "timestamp_ms": 1712345678901
}
```

```json
{
  "type": "swipe",
  "start_x": 195, "start_y": 600,
  "end_x": 195, "end_y": 200,
  "duration_ms": 300
}
```

```json
{
  "type": "key",
  "key_code": "home"
}
```

Coordinates are in simulator logical pixels (not host display pixels). The
web client scales mouse/touch coordinates from the rendered viewport to logical
pixels using the simulator's reported screen resolution.

### iOS Input Injection

Public APIs do not support programmatic touch injection into a running
simulator. Two options, in order of preference:

1. **idb_companion (Facebook iOS Debug Bridge):** `idb tap <udid> <x> <y>`.
   idb uses private CoreSimulator APIs. Last tagged release: **v1.1.8 (Aug
   2022)**. For iOS 17/18/26 simulators you are likely running HEAD, not a
   release. Treat as an unstable dependency: pin to a known-good commit,
   maintain per-Xcode-version compatibility tests for tap/swipe/text, and
   implement the read-only fallback below.
   - Install: `brew install facebook/fb/idb-companion`
   - One companion instance per simulator UDID; each must bind to a distinct
     port. The manager starts `idb_companion --udid <udid>` when it boots a
     simulator and keeps it running for the session lifetime.
   - On simulator restart, tear down and re-start the companion for that UDID.

2. **Fallback — read-only session:** There is no `simctl io … tap` command and
   no Apple-supported touch injection API for simulators. If idb is absent or
   fails a probe tap at session start, the session is read-only. The Capture
   Service returns 501 on `POST /input/{udid}`.

### Android Input Injection

```bash
adb -s <serial> shell input tap <x> <y>
adb -s <serial> shell input swipe <x1> <y1> <x2> <y2> <duration_ms>
adb -s <serial> shell input keyevent <keycode>
```

These are reliable and require no third-party tooling. All Android sessions
support input injection.

---

## Integration with Selkie

### Service Registration

The Simulator Manager registers one service entry per available simulator slot
with the selkie service catalog on each heartbeat:

```json
{
  "name": "sim-iphone15-slot-0",
  "protocol": "http",
  "local_bind": "127.0.0.1:8421",
  "exposure_type": "simulator-stream",
  "tags": ["ios", "iphone-15", "ios-17.4", "bundle:com.example.myapp"],
  "auth_mode": "session-token",
  "health_status": "available"
}
```

When a slot is assigned `health_status` becomes `"busy"`. When at max capacity
it becomes `"full"`.

### Policy

Two actions are defined for simulator-stream services:

- `stream:view` — read-only stream access.
- `stream:interact` — view + input injection.

The owner is granted both by default. Shared access can be granted via group
policy on `stream:view`. Input access should be restricted to one user at a
time (the selkie policy engine enforces mutual exclusivity of `stream:interact`
per active session).

### Session URL Flow

1. User authenticates with selkie.
2. User requests a connect session targeting `service_id=sim-iphone15-slot-0`.
3. Selkie policy evaluates `user → device → service → stream:interact`.
4. If allowed: session created, connect URL returned to the user.
5. Browser opens `https://{device}.{domain}/stream/sim/{session_id}`.
6. Selkie agent validates the session token, proxies to
   `http://127.0.0.1:8421/stream/{udid}/ws`.
7. On session close (user disconnects or TTL expires): agent signals the
   Simulator Manager; slot returns to available.

---

## Security

- Simulator stream URLs are session-scoped and signed. They cannot be reused
  after session expiry.
- Only the assigned user can send input events. Viewers with `stream:view` see
  the same stream but their input POST requests are rejected with 403.
- Simulators are ephemeral: user data written during a session does not persist
  to the next session (app data directory is reset on reclaim unless `persist`
  is explicitly enabled in config).
- The Capture Service binds only to loopback — it is never exposed directly,
  only through the selkie agent proxy.
- App binaries are pulled from the source simulator and cached locally. They
  are not transmitted off-host.
- Input injection is opt-in per service: `allow_input: false` in config
  disables the input endpoint entirely regardless of policy.

---

## macOS Screen Recording TCC

### Which capture paths require Screen Recording permission

- **`xcrun simctl io screenshot` and `xcrun simctl io recordVideo`** — these
  operate on the simulator's internal framebuffer, not the host window server.
  They are **not** Screen Recording TCC gated. You do not need Screen Recording
  permission to use MJPEG polling or fMP4 piping via simctl.

- **`CGWindowListCreateImageFromArray` (CoreGraphics window capture)** — this
  IS Screen Recording gated. Without prior user approval, calls return black/
  empty images. The TCC prompt is only shown the first time it fails; repeated
  failures are silent.

- **`CGWindowListCopyWindowInfo` (metadata only)** — does NOT trigger a TCC
  prompt, but silently filters sensitive fields (window titles) unless Screen
  Recording is already granted.

### Why daemons can't reliably get the permission prompt

Launch daemons run outside the interactive user GUI session. macOS either
cannot show the TCC prompt at all (no user session to host it) or the process
captures the wrong session (blank login window). Screen Recording permission
cannot be reliably obtained by a root/system daemon. You need a user-space
companion process running in the logged-in user's session to trigger the
initial consent dialog.

### MDM / PPPC cannot pre-grant Screen Recording

PPPC configuration profiles can set `AllowStandardUserToSetSystemService` for
the `ScreenCapture` service, which lets a non-admin user approve the toggle in
System Settings. They cannot grant Screen Recording silently — Apple's
device-management schema explicitly states that access to screen contents
**cannot be granted** in a configuration profile; it can only be denied.
Screen Recording must always be approved by a physical user.

### Practical decision

Given that `simctl io screenshot` and `simctl io recordVideo` are not TCC
gated, the preferred implementation path is:

1. **MJPEG**: simctl screenshot loop — no TCC required.
2. **fMP4 WebSocket**: simctl recordVideo pipe — no TCC required.
3. **CoreGraphics helper**: requires Screen Recording, cannot be pre-granted
   via MDM, must be approved interactively. Use only as an opt-in fallback
   on managed machines where a user can grant it once.

### Debugging TCC attribution

To identify which binary macOS treats as the TCC client:

```bash
log stream --info --debug \
  --predicate 'subsystem == "com.apple.TCC"' 2>&1 | grep ScreenCapture
```

The `AttributionChain` in the log output shows the responsible process. Child
processes do not automatically inherit TCC rights from their parent.

---

## Server-side fMP4 Demux

When using `simctl io recordVideo --type=fmp4 -`, the server receives an ISO
BMFF bytestream. Structure:

```
[ftyp box] [moov box]          ← init segment (send once; cache for late joiners)
[moof box] [mdat box]          ← fragment (repeated)
[moof box] [mdat box]
...
```

### Go library: mp4ff

Use `github.com/Eyevinn/mp4ff` — designed for streaming fragmented MP4 (DASH,
HLS, MSS). It models each fragment as one `moof` + one `mdat`, with per-sample
metadata in `trun` boxes.

Incremental parse loop:

1. Read box header (8 bytes: 4-byte size + 4-byte type; handle `largesize`).
2. `ftyp`, `moov`, `moof` — buffer fully in memory (small).
3. `mdat` — stream-read from the pipe, sliced into samples using the sizes in
   the preceding `moof`/`traf`/`trun`. Do not buffer the full `mdat`.
4. Cache `ftyp`+`moov` as the init segment. Prepend it to every new WebSocket
   client connection so late joiners can initialise their decoders.

### AVCC and codec config

H.264 samples in fMP4 are stored as **AVCC (length-prefixed NAL units)**, not
Annex-B. The `avcC` box inside `moov` contains the NAL length field size and
the SPS/PPS parameter sets. Extract it from `moov` on startup; include it in
the `VideoDecoderConfig.description` when configuring a WebCodecs decoder, or
embed it in the fMP4 init segment when using MSE.

---

## Browser MSE Live Playback

### Init segment ordering (non-negotiable)

MSE requires `ftyp`+`moov` to be appended before any `moof`/`mdat` fragments.
New WebSocket clients must receive the cached init segment first, then the next
fragment. Never append a media fragment to a `SourceBuffer` that has not
received its init segment.

### Append queue pattern

`SourceBuffer.appendBuffer()` is asynchronous. The correct pattern:

```js
const queue = [];
let appending = false;

function enqueue(chunk) {
  queue.push(chunk);
  pump();
}

function pump() {
  if (appending || queue.length === 0 || sourceBuffer.updating) return;
  appending = true;
  sourceBuffer.appendBuffer(queue.shift());
}

sourceBuffer.addEventListener("updateend", () => {
  appending = false;
  evictOldBuffer();
  pump();
});
```

Never call `appendBuffer()` while `sourceBuffer.updating` is `true`. Queue
init segment first, then media fragments.

### Safari / WebKit timestamp requirements

WebKit is sensitive to gaps between samples. Rules to follow:

- Choose a timescale that represents frame durations exactly (e.g. 90000 for
  H.264) and carry it consistently in `tfdt`/`trun` across all fragments.
- Every fragment must include `tfdt` in its `traf` box. Missing `tfdt` causes
  MSE playback failure in both Chrome and WebKit.
- Fragments must begin on IDR (keyframe) boundaries so decoders can start
  cleanly after eviction.
- Do not mix "segments" and "sequence" append modes mid-stream.

### Buffer eviction (prevent QuotaExceededError)

MSE `SourceBuffer` quota is finite. For long-lived sessions:

```js
function evictOldBuffer() {
  if (sourceBuffer.updating) return;
  const removeEnd = video.currentTime - 30; // keep 30s back buffer
  if (removeEnd > 0) {
    sourceBuffer.remove(0, removeEnd);
  }
}
```

Call after each `updateend`. `remove()` may remove more than the exact range
to preserve decoder dependency boundaries — this is expected behaviour.

---

## Operational Notes

- Booting an iOS simulator takes 10–30s. Pre-warming the pool at startup is
  recommended. The manager boots all configured slots at agent start unless
  `lazy_boot: true` is set.
- Android emulators use 2–4GB RAM each. Set `max_instances` conservatively on
  machines with less than 16GB of available RAM.
- `xcrun simctl io … recordVideo` requires the simulator to be booted and
  visible (but not necessarily in the foreground). Set the simulator window to
  background-safe mode via `xcrun simctl ui <udid> appearance dark` to prevent
  screen-saver-style dimming.
- For headless operation on macOS (CI machines, servers), use
  `xcrun simctl boot --no-ui` where supported, or suppress the Simulator.app
  window with `defaults write com.apple.iphonesimulator StartLastDeviceOnLaunch
  -bool NO` before launch.
