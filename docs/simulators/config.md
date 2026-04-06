# Simulator Streaming — Configuration Reference

The simulator manager is configured in the selkie agent config file under the
`simulators` key. All fields are optional unless marked required.

## Full Configuration Example

```yaml
simulators:
  enabled: true

  # Global cap across all platforms and device types combined.
  # The manager will never exceed this regardless of per-type limits.
  max_total_instances: 8

  # Port ranges allocated to stream capture services on this host.
  stream_port_range:
    start: 8421
    end: 8499

  # Where to cache pulled APK/IPA binaries.
  apk_cache_dir: "/var/cache/selkie/sim-apks"

  # Pre-warm all pool slots at agent startup (boot simulators before any
  # session request arrives). Set to false for lazy (on-demand) boot.
  prewarm: true

  # After a session ends, wait this many seconds before reclaiming the slot.
  # Allows rapid reconnect without a full reboot cycle.
  idle_timeout_seconds: 300

  # Whether to reset app data between sessions (pm clear / app reinstall).
  # Set to false only for persistent demo environments.
  reset_data_on_reclaim: true

  # Whether to allow input injection by default. Can be overridden per entry.
  allow_input: true

  ios:
    - name: "iphone15-myapp"
      device_type: "com.apple.CoreSimulator.SimDeviceType.iPhone-15"
      runtime: "com.apple.CoreSimulator.SimRuntime.iOS-17-4"

      # REQUIRED: UDID of the pre-configured source simulator.
      # Must be booted and have the app already installed.
      # The manager copies the app binary from this simulator to clones.
      source_udid: "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"

      # REQUIRED: App bundle identifier to install in each slot.
      bundle_id: "com.example.myapp"

      # Maximum number of simulator instances of this type.
      max_instances: 4

      # Override global idle_timeout for this type.
      idle_timeout_seconds: 300

      # Stream settings for this type.
      stream:
        # mjpeg | websocket | both (both serves both endpoints simultaneously)
        protocol: "both"
        fps: 30
        # Pixel scale factor. 2 for Retina, 3 for ProMotion.
        # Used by the web client to convert logical point coordinates
        # for touch injection.
        scale_factor: 2

      # Input injection. Requires idb_companion installed on the host.
      input:
        enabled: true
        # Path to idb_companion binary. Defaults to PATH lookup.
        idb_companion_path: "/usr/local/bin/idb_companion"

  android:
    - name: "pixel6-myapp"
      # REQUIRED: Name of the AVD to use as the template for cloning.
      avd_template: "selkie-pixel6-template"

      # REQUIRED: Package name to install in each slot.
      package_name: "com.example.myapp"

      max_instances: 2
      idle_timeout_seconds: 300

      # Emulator launch flags appended to the base set.
      # Base set always includes: -no-snapshot -no-audio -no-boot-anim -no-window
      extra_emulator_flags: ["-gpu", "swiftshader_indirect"]

      # Port allocation. First slot gets these ports, subsequent slots
      # increment by 2 (console/adb) and 1 (grpc) per slot.
      ports:
        console_base: 5554
        adb_base: 5555
        grpc_base: 8554

      stream:
        protocol: "both"
        fps: 30
        # Use emulator gRPC stream instead of adb screenrecord.
        # Requires the emulator to be started with -grpc.
        use_grpc: true

      input:
        enabled: true
        # If use_grpc is true, input is also routed via gRPC.
        # Otherwise, adb shell input is used.
        use_grpc: true
```

---

## Field Reference

### Top-level `simulators`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Enable the simulator manager |
| `max_total_instances` | int | `4` | Hard cap on total running instances across all types |
| `stream_port_range.start` | int | `8421` | First port available for capture service HTTP endpoints |
| `stream_port_range.end` | int | `8499` | Last port in the range (inclusive) |
| `apk_cache_dir` | string | `/tmp/selkie-sim-apks` | Local disk path for cached APK/app binaries |
| `prewarm` | bool | `true` | Boot all pool slots at agent startup |
| `idle_timeout_seconds` | int | `300` | Seconds to wait before reclaiming an idle slot |
| `reset_data_on_reclaim` | bool | `true` | Clear app data when a slot is returned to the pool |
| `allow_input` | bool | `true` | Global default for input injection |

### `ios[]` entries

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Unique name used in service catalog registration |
| `device_type` | string | yes | Full `com.apple.CoreSimulator.SimDeviceType.*` identifier |
| `runtime` | string | yes | Full `com.apple.CoreSimulator.SimRuntime.*` identifier |
| `source_udid` | string | yes | UDID of the source simulator containing the installed app |
| `bundle_id` | string | yes | App bundle ID to clone into each slot |
| `max_instances` | int | no | Max instances of this type (default: 2) |
| `idle_timeout_seconds` | int | no | Overrides global `idle_timeout_seconds` |
| `stream.protocol` | string | no | `mjpeg`, `websocket`, or `both` (default: `both`) |
| `stream.fps` | int | no | Max frames per second (default: 30) |
| `stream.scale_factor` | int | no | Retina scale factor (default: 2) |
| `input.enabled` | bool | no | Enable touch/key injection (default: global `allow_input`) |
| `input.idb_companion_path` | string | no | Path to `idb_companion` binary |

### `android[]` entries

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Unique name used in service catalog registration |
| `avd_template` | string | yes | Name of the source AVD to clone for each slot |
| `package_name` | string | yes | Android package name to install in each slot |
| `max_instances` | int | no | Max instances of this type (default: 1) |
| `idle_timeout_seconds` | int | no | Overrides global `idle_timeout_seconds` |
| `extra_emulator_flags` | []string | no | Additional flags passed to `emulator` at launch |
| `ports.console_base` | int | no | First emulator console port (default: 5554) |
| `ports.adb_base` | int | no | First ADB port (default: 5555) |
| `ports.grpc_base` | int | no | First gRPC port (default: 8554) |
| `stream.protocol` | string | no | `mjpeg`, `websocket`, or `both` (default: `both`) |
| `stream.fps` | int | no | Max frames per second (default: 30) |
| `stream.use_grpc` | bool | no | Use emulator gRPC stream API (default: `true` if grpc port set) |
| `input.enabled` | bool | no | Enable touch/key injection (default: global `allow_input`) |
| `input.use_grpc` | bool | no | Route input via gRPC (default: follows `stream.use_grpc`) |

---

## Selkie Policy for Simulator Services

Simulator services are registered in the service catalog with the
`exposure_type: simulator-stream` field and the following tags:

- Platform: `ios` or `android`
- Device type name (slugified): e.g. `iphone-15`, `pixel-6`
- Bundle/package: `bundle:com.example.myapp`
- Availability: `available`, `busy`, or `full`

Policy rules can target these tags. Example:

```rego
# Allow any authenticated user in the "qa" group to view any iOS simulator
allow if {
  input.action == "stream:view"
  input.service.exposure_type == "simulator-stream"
  "ios" in input.service.tags
  "qa" in input.subject.groups
}

# Only the owner can interact (send input)
allow if {
  input.action == "stream:interact"
  input.subject.sub == data.owner_sub
}
```

---

## Service Catalog Entry Shape

Each active simulator slot appears as a distinct service. The manager
registers/deregisters entries on each heartbeat based on actual pool state.

```json
{
  "name": "iphone15-myapp-slot-0",
  "protocol": "http",
  "local_bind": "127.0.0.1:8421",
  "exposure_type": "simulator-stream",
  "tags": [
    "ios",
    "iphone-15",
    "ios-17.4",
    "bundle:com.example.myapp",
    "available"
  ],
  "auth_mode": "session-token",
  "health_status": "available",
  "metadata": {
    "platform": "ios",
    "device_type": "iPhone 15",
    "runtime": "iOS 17.4",
    "bundle_id": "com.example.myapp",
    "stream_endpoints": {
      "mjpeg": "/stream/mjpeg",
      "websocket": "/stream/ws",
      "input": "/input"
    },
    "screen_width_px": 1179,
    "screen_height_px": 2556,
    "scale_factor": 3
  }
}
```
