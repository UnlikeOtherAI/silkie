# iOS Simulator Streaming

## Screen Recording TCC — What Applies to iOS Simulator Capture

**`xcrun simctl io screenshot` and `xcrun simctl io recordVideo`** operate on
the simulator's internal framebuffer. They are **not** Screen Recording TCC
gated. The selkie agent can call these from a background process without
requesting or holding Screen Recording permission.

**`CGWindowListCreateImageFromArray` (CoreGraphics helper)** IS Screen
Recording gated. Without prior user approval the call returns a black image
silently. The TCC prompt appears at most once; repeated failures are silent.
This path cannot be used from a launch daemon — daemons run outside the
interactive GUI session and cannot trigger TCC prompts.

**Cannot pre-grant via MDM:** Apple's PPPC schema explicitly states Screen
Recording access cannot be granted in a configuration profile — only
`AllowStandardUserToSetSystemService`, which still requires an interactive user
toggle. On unmanaged machines, a user must approve it once in System Settings.

**Bottom line:** prefer the `simctl` paths (MJPEG poll or fMP4 pipe). The
CoreGraphics helper is an opt-in fallback requiring a one-time interactive
approval.

---

## Prerequisites

- macOS 13+ with Xcode 15+ installed
- `xcrun simctl` available (`xcode-select -p` points to Xcode)
- `ffmpeg` installed (`brew install ffmpeg`)
- Optional but required for input injection: `idb_companion`
  (`brew install facebook/fb/idb-companion`)

## Simulator Management Commands

### List available device types and runtimes

```bash
xcrun simctl list devicetypes
xcrun simctl list runtimes
```

Device type identifier format: `com.apple.CoreSimulator.SimDeviceType.iPhone-15`
Runtime identifier format: `com.apple.CoreSimulator.SimRuntime.iOS-17-4`

### List all simulators

```bash
xcrun simctl list devices available --json
```

JSON output includes `udid`, `name`, `state`, `deviceTypeIdentifier`,
`runtimeIdentifier` for each device.

### Create a simulator

```bash
xcrun simctl create \
  "Selkie-Slot-0" \
  "com.apple.CoreSimulator.SimDeviceType.iPhone-15" \
  "com.apple.CoreSimulator.SimRuntime.iOS-17-4"
# Returns: <udid>
```

### Boot and shutdown

```bash
xcrun simctl boot <udid>
xcrun simctl shutdown <udid>
xcrun simctl delete <udid>   # permanent removal
```

### Check boot state

```bash
xcrun simctl list devices --json | jq -r \
  '.devices[][] | select(.udid=="<udid>") | .state'
# Returns: Booted | Shutdown | Booting
```

---

## App Binary Cloning

### Get the installed app bundle path from source simulator

```bash
xcrun simctl get_app_container <source_udid> <bundle_id> app
# Returns: /Users/…/CoreSimulator/Devices/<udid>/data/Containers/Bundle/…/MyApp.app
```

### Install app into target simulator

```bash
xcrun simctl install <target_udid> \
  "/Users/…/CoreSimulator/Devices/<source_udid>/data/Containers/Bundle/…/MyApp.app"
```

Note: the source .app bundle is a directory. The install command works directly
on it — no need to repackage as .ipa.

### Reset app data (before assigning a simulator to a new session)

```bash
xcrun simctl terminate <udid> <bundle_id>
xcrun simctl uninstall <udid> <bundle_id>
xcrun simctl install <udid> <path_to_app>
# App data container is fresh after reinstall
```

Alternatively, just delete and recreate the data container:

```bash
xcrun simctl get_app_container <udid> <bundle_id> data
# Then rm -rf the data container path and relaunch the app
```

---

## Screen Capture

### Single screenshot (for MJPEG loop)

```bash
xcrun simctl io <udid> screenshot --type=png /tmp/frame.png
# Or to stdout:
xcrun simctl io <udid> screenshot --type=png -
```

MJPEG implementation: run this in a tight loop (target 30fps), pipe PNG bytes
to the HTTP response as multipart frames. Typical latency: 50–150ms per frame
on a fast Mac.

### H.264 video pipe via simctl (for WebSocket stream — fMP4, not raw Annex-B)

```bash
xcrun simctl io <udid> recordVideo \
  --codec=h264 \
  --display=internal \
  --force \
  - 2>/dev/null
```

**Important: the output is fragmented MP4 (fMP4), not a raw H.264/Annex-B
bytestream.** Expect ISO BMFF boxes (`ftyp` then repeated `moof`/`mdat`). You
must demux with an fMP4 parser (ffmpeg, or a Go MP4 library) before forwarding
H.264 access units to the browser. Do not pipe these bytes directly to a
WebCodecs `VideoDecoder` expecting Annex-B NAL units.

`--display=internal` captures the simulator's virtual screen only. `--force`
overwrites an existing recording session if one is running.

Treat this process as disposable. Use the restart wrapper below to recover from
pipe drops without rebooting the simulator:

```js
// see research.md for the full Node.js restart wrapper
startSimctlRecorder({ udid, codec: "h264", onChunk: (buf) => fmp4Demuxer.push(buf) });
```

Known failure modes: "returns nothing / black" regressions exist in some Xcode
versions; frame pacing is non-deterministic; `--type=fmp4` (explicit fragmented
mode) is documented in older Xcode releases and may not appear in current help
text. See [research.md](research.md) for full history.

### CoreGraphics + VideoToolbox (preferred for WebSocket stream)

For stable long-running H.264 streaming, prefer a thin Swift helper that
captures the simulator window via `CGWindowListCreateImageFromArray` and encodes
frames with `VTCompressionSession`. This bypasses `simctl` output format
ambiguity and gives you direct access unit output.

Window identification: use `kCGWindowOwnerPID` to filter to Simulator.app
processes, then match by window title (correlate simulator name from
`xcrun simctl list devices`). UDID is not a native CGWindow property.

VideoToolbox output is **AVCC (length-prefixed NAL units)**. For WebCodecs you
must also supply `VideoDecoderConfig.description` containing an `avcC` blob
built from the SPS and PPS NAL units captured from the encoder output.

See [research.md](research.md) for the full Swift `H264Encoder` implementation
with `VTCompressionSessionCreate`, frame encoding, and AVCC output handling.

### Frame dimensions

Query the simulator's screen size to send to the browser client for coordinate
scaling:

```bash
xcrun simctl io <udid> screenshot --type=png - | \
  python3 -c "import sys,struct; d=sys.stdin.buffer.read(); \
  print(struct.unpack('>II', d[16:24]))"
# Prints: (width, height) in pixels
```

Or use `sips`:
```bash
sips -g pixelWidth -g pixelHeight /tmp/frame.png
```

The logical point size (for touch coordinates) is `pixel_size / scale_factor`.
Scale factor is 2x for Retina simulators, 3x for ProMotion.

---

## Input Injection

### idb_companion setup

**Stability note:** last tagged release is v1.1.8 (August 2022). Treat as an
unstable dependency — validate tap/swipe/text injection against your Xcode and
simulator runtime before each deployment.

**Apple Silicon / arm64 simulators:** idb upstream issues #807 and #814
document that idb hard-codes simulator architecture as `x86_64`, causing it to
reject arm64 app bundles even when the simulator is an arm64-native runtime on
M-series Macs. There is no upstream fix and no maintained fork that resolves
this. Options:

- **Rosetta mode:** boot the simulator under Rosetta 2 so it presents as
  x86_64. Your app must also be built for x86_64 (or fat binary). This is the
  only currently working idb path on Apple Silicon for modern iOS runtimes.
- **Fork and patch:** maintain your own idb_companion build with the
  architecture check removed. Requires tracking upstream Xcode/CoreSimulator
  API changes manually.
- **Accept read-only on arm64:** if you cannot use Rosetta, skip idb and
  serve the simulator as a read-only stream. Input injection fails gracefully
  (probe tap returns non-zero, session downgrades to `stream:view`).

One companion per UDID; each must bind to a distinct port. The manager assigns
ports from the configured idb port range and passes `--grpc-port <port>` to
each companion.

```bash
# Start companion for a specific simulator on a specific port
idb_companion --udid <udid> --grpc-port 10882 &

# Verify it is running and connected
idb list-targets
```

On simulator shutdown or restart, kill the companion for that UDID and restart
it after the simulator reaches `Booted` state.

### Touch events via idb

```bash
idb ui --udid <udid> tap <x> <y>
idb ui --udid <udid> swipe <x1> <y1> <x2> <y2> --duration <seconds>
idb ui --udid <udid> key-sequence <key>
```

Coordinates are in logical points (not raw pixels). The web client must divide
screen pixel coordinates by the scale factor before sending them.

### Supported key names

`home`, `lock`, `siri`, `left`, `right`, `up`, `down`, `return`, `backspace`,
`delete`, `escape`, `tab`, `space`, plus any Unicode character for text input.

### Text input

```bash
idb ui --udid <udid> text "Hello, World!"
```

This injects each character as a key event. Use for form filling.

### Probing idb health at session start

Before marking a session as interactive, send a probe tap to a safe coordinate
(e.g. centre of screen) and check for a non-error exit code. If the probe
fails, downgrade the session to read-only and return `allow_input: false` in
the session metadata so the browser client hides the interaction controls.

### If idb is not available

Input injection is disabled. The stream is read-only. The Capture Service
returns 501 on `POST /input/{udid}`.

---

## Headless Operation

On CI machines or dedicated stream servers where Simulator.app should not be
visible:

```bash
# Suppress Simulator.app window (simulator still runs and responds to simctl)
defaults write com.apple.iphonesimulator StartLastDeviceOnLaunch -bool NO
defaults write com.apple.iphonesimulator DetachOnWindowClose -bool YES

# Boot without opening Simulator.app UI window (Xcode 15+)
xcrun simctl boot --no-ui <udid>
```

`xcrun simctl io … recordVideo` works with a headless simulator as long as
the simulator state is `Booted`.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `recordVideo` pipe exits immediately | Simulator not fully booted | Poll `simctl list devices` until state is `Booted` before starting capture |
| Black frames in screenshot | Simulator locked / display sleep | Run `xcrun simctl io <udid> screenshot` once to wake; or disable display sleep via `xcrun simctl spawn <udid> notifyd` |
| `idb ui tap` returns error | idb_companion not connected | Restart idb_companion; check `idb list-targets` |
| High CPU from capture loop | Screenshot poll rate too high | Cap at 20fps; use `recordVideo` H.264 pipe instead of screenshot loop |
| App not found after clone | Bundle path changed after Xcode update | Re-query `get_app_container` from source simulator before each clone |
