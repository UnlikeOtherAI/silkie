# Android Emulator Streaming

## Prerequisites

- macOS 13+ or Linux with Android SDK installed
- `ANDROID_HOME` set (typically `~/Library/Android/sdk` on macOS)
- `avdmanager`, `emulator`, and `adb` on `$PATH`
- System image installed for the target API level
- `ffmpeg` installed (`brew install ffmpeg` or package manager)

```bash
# Check tooling
avdmanager list avd
emulator -list-avds
adb devices
```

---

## Emulator Management Commands

### List installed system images

```bash
sdkmanager --list | grep "system-images"
# Common choices:
# system-images;android-34;google_apis;arm64-v8a   (Apple Silicon)
# system-images;android-34;google_apis;x86_64      (Intel / CI)
```

### List available device profiles

```bash
avdmanager list device
# Key profiles: pixel_6, pixel_7, Nexus 5X, medium_phone
```

### Create an AVD (template)

```bash
avdmanager create avd \
  --name "selkie-pixel6-template" \
  --package "system-images;android-34;google_apis;arm64-v8a" \
  --device "pixel_6" \
  --force
```

The AVD files are stored in `~/.android/avd/selkie-pixel6-template.avd/` and
`~/.android/avd/selkie-pixel6-template.ini`.

### Clone an AVD for a new slot

`avdmanager` has no native clone command. Clone manually by copying and
rewriting paths.

Files that contain absolute paths and **must** be updated after copy:
- `~/.android/avd/<name>.ini` — contains the `path=` pointer to the `.avd`
  directory.
- `~/.android/avd/<name>.avd/config.ini` — may contain `image.sysdir.1` and
  other absolute paths. An incorrect `image.sysdir.1` causes "AVD shows as
  broken" in avdmanager.
- `~/.android/avd/<name>.avd/hardware-qemu.ini` — generated QEMU config,
  may embed absolute paths on some SDK versions.

Because the exact set of affected files varies across emulator versions, the
safe strategy is:

1. Copy directories.
2. **Delete all snapshot/quickboot state** (`<name>.avd/snapshots/` and
   `<name>.avd/quickboot-*`). Snapshots carry environment-specific assumptions
   and will cause boot failures if moved.
3. Recursively scan all text files under the new `.avd` directory for the old
   absolute base path and rewrite. Binary files (disk images) do not embed
   these paths and should not be touched.

```bash
src="$HOME/.android/avd/selkie-pixel6-template"
dst="$HOME/.android/avd/selkie-pixel6-slot-0"

cp -r "${src}.avd" "${dst}.avd"
cp "${src}.ini" "${dst}.ini"

# Remove snapshots before rewriting paths
rm -rf "${dst}.avd/snapshots" "${dst}.avd/quickboot-choice.ini"

# Rewrite the source name in all text files
OLD="selkie-pixel6-template"
NEW="selkie-pixel6-slot-0"

# .ini sibling file
sed -i '' "s|${OLD}|${NEW}|g" "${dst}.ini"

# All text files inside the .avd directory
find "${dst}.avd" -type f | while read f; do
  if file "$f" | grep -q text; then
    sed -i '' "s|${OLD}|${NEW}|g" "$f"
  fi
done
```

Each slot needs its own AVD directory. Sharing AVD state between running
emulators is not supported.

### Start an emulator

```bash
emulator \
  -avd selkie-pixel6-slot-0 \
  -no-snapshot \
  -no-audio \
  -no-boot-anim \
  -wipe-data \
  -grpc 8554 \
  -ports 5554,5555 &

# Wait for boot
adb -s emulator-5554 wait-for-device
adb -s emulator-5554 shell getprop sys.boot_completed
# Returns 1 when ready
```

Port assignment: `-ports <console_port>,<adb_port>`. Use non-overlapping port
pairs for each slot (5554/5555, 5556/5557, 5558/5559, …). The `-grpc` port is
the emulator's gRPC control interface.

### Headless mode

```bash
emulator -avd selkie-pixel6-slot-0 -no-window -gpu swiftshader_indirect ...
```

`-no-window` suppresses the desktop UI. `-gpu swiftshader_indirect` uses CPU
rendering, which works on CI machines without a GPU. For machines with GPUs,
use `-gpu host` for better frame rates.

### Shut down an emulator

```bash
adb -s emulator-5554 emu kill
# Or send SIGTERM to the emulator process PID
```

### Delete an AVD (permanent)

```bash
avdmanager delete avd --name selkie-pixel6-slot-0
```

---

## App Binary Cloning

### Get the installed APK path from the source emulator

```bash
adb -s emulator-5554 shell pm path com.example.myapp
# → package:/data/app/~~randomhash==/com.example.myapp-hashsuffix==/base.apk
```

### Pull the APK to host disk

```bash
adb -s emulator-5554 pull \
  /data/app/~~randomhash==/com.example.myapp-hashsuffix==/base.apk \
  /tmp/selkie-cache/com.example.myapp.apk
```

Cache the APK on disk. Re-pull only when the source emulator has a newer
version installed (compare version code via `adb shell pm dump <package> |
grep versionCode`).

### Install the cached APK into a target emulator

```bash
adb -s emulator-5556 install -r /tmp/selkie-cache/com.example.myapp.apk
```

### Reset app data before a new session

```bash
adb -s emulator-5554 shell pm clear com.example.myapp
```

This wipes the app's data directory without reinstalling. Faster than
reinstall and sufficient for session isolation.

---

## Screen Capture

### Single screenshot (for MJPEG loop)

```bash
adb -s emulator-5554 exec-out screencap -p > /tmp/frame.png
# Or pipe directly to stdout consumer
```

MJPEG implementation: poll at up to 30fps, pipe each PNG as a multipart frame.
Expected throughput: ~10–20fps on a fast machine over loopback adb.

### H.264 video pipe (for WebSocket stream)

```bash
adb -s emulator-5554 shell screenrecord \
  --output-format=h264 \
  --size 540x1170 \
  --time-limit 3600 \
  - 2>/dev/null
```

This streams H.264 to stdout until the emulator shell is closed or
`--time-limit` is reached. Restart the pipe if the adb connection drops.

`--size` must match the emulator's display resolution or a supported downscale.
Use `adb shell wm size` to query the real resolution.

### Alternative: emulator gRPC stream

The Android emulator exposes a gRPC API (`-grpc <port>`) for screen capture.
The canonical proto source is:
`platform/external/qemu/.../android/android-grpc/` (AOSP QEMU tree).
Prebuilt proto files are also shipped alongside emulator binaries at
`platform/prebuilts/android-emulator/.../lib/emulator_controller.proto`.

**The API is tightly coupled to emulator builds.** The protos in tools/base are
explicitly described as "copied from the emulator code base" and updated by
extracting them from new builds. Treat as semi-internal; expect drift across SDK
versions.

The streaming RPC present in the prebuilt proto is:

```protobuf
rpc streamScreenshot(ImageFormat) returns (stream Image) {}
```

This is a **screenshot stream** (RGB/PNG/JPEG frames), not a native H.264 video
stream. It can generate significant data volume. PNG encoding is CPU-intensive.
Empty `Image` messages are delivered when the display is inactive; frames resume
when active again.

There is no documented stable H.264 video stream RPC in the prebuilt proto.
Teams needing H.264 either use `adb screenrecord` or WebRTC-based tooling.

Use `streamScreenshot` only if you can pin to a specific emulator SDK version
and accept that the API may change on upgrade. For the first implementation,
`adb screenrecord` is the more stable path.

---

## Input Injection

### Touch events via adb

```bash
# Tap
adb -s emulator-5554 shell input tap <x> <y>

# Swipe
adb -s emulator-5554 shell input swipe <x1> <y1> <x2> <y2> <duration_ms>

# Long press
adb -s emulator-5554 shell input swipe <x> <y> <x> <y> 1000

# Scroll (touch drag)
adb -s emulator-5554 shell input swipe <x> 800 <x> 300 500
```

Coordinates are in display pixels (not logical density-independent pixels).
The web client must multiply logical coordinates by the device pixel ratio
before sending.

### Key events via adb

```bash
adb -s emulator-5554 shell input keyevent <keycode>

# Common keycodes
# 3  = HOME
# 4  = BACK
# 26 = POWER
# 82 = MENU
# 66 = ENTER
# 67 = BACKSPACE
```

Full list: https://developer.android.com/reference/android/view/KeyEvent

### Text input via adb

```bash
adb -s emulator-5554 shell input text "Hello%sWorld"
# Spaces must be escaped as %s
```

### Via emulator gRPC (fast path — version-sensitive)

Input RPCs are present in the emulator gRPC API alongside the screen stream,
but the proto surface is tightly coupled to emulator builds (same caveat as
screen streaming above). Use only when pinned to a specific SDK version.

`adb shell input` (~50ms round-trip) is the stable baseline; gRPC input is
the optional fast path for latency-sensitive interactive sessions.

---

## Port Allocation

Each emulator slot needs two ports (console + adb) and one gRPC port:

| Slot | Console | ADB  | gRPC |
|------|---------|------|------|
| 0    | 5554    | 5555 | 8554 |
| 1    | 5556    | 5557 | 8555 |
| 2    | 5558    | 5559 | 8556 |
| 3    | 5560    | 5561 | 8557 |
| …    | …       | …    | …    |

The Simulator Manager allocates ports from these ranges and tracks which ports
are in use.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `emulator: ERROR: ABI x86_64 is not supported on this host` | Wrong system image for host arch | Use `arm64-v8a` on Apple Silicon, `x86_64` on Intel |
| `screenrecord` exits after 3 minutes | Default time limit | Pass `--time-limit 3600` |
| `adb: error: no devices/emulators found` | Emulator not yet booted | Poll `getprop sys.boot_completed` before first use |
| Blank screen in H.264 stream | GPU init delay | Add 5s sleep after boot_completed before starting capture |
| `input tap` coordinates off | Device has different display size | Query `adb shell wm size` and adjust scaling |
| gRPC stream not available | Emulator started without `-grpc` | Restart with `-grpc <port>` flag |
