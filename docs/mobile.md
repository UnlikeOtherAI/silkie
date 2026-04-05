# Mobile Apps

Native iOS and Android apps that authenticate the user, establish the WireGuard
VPN overlay, and present a minimal device list for connecting to registered
servers.

## Scope

The mobile app is a **client-only** interface. It:

- Authenticates via UOA SSO.
- Enrolls the phone as a device and establishes the WireGuard tunnel.
- Shows only devices that act as servers (devices that expose at least one
  service), filtered from the full device registry.
- Lets the user tap a server to copy its overlay IP to the clipboard.
- Shows online/offline status and platform for each server.
- Provides a single Disconnect button that tears down the VPN and returns to
  the login screen.

Everything else (device management, sessions, relay, system health) stays in
the web admin.

---

## Authentication

Both apps use the UOA OAuth 2.0 authorization-code flow, identical to the web
login, with one difference: the redirect URL targets the app via a registered
custom URL scheme or universal/app link.

### iOS

- Use `ASWebAuthenticationSession` to open the UOA authorize URL in a secure
  in-app browser. No SFSafariViewController; `ASWebAuth` handles the redirect
  and returns the code to the app without exposing it to the system clipboard
  or other apps.
- Registered URL scheme: `silkie://auth/callback`
- After the code is returned, the app performs the token exchange directly with
  the silkie control server (`POST /v1/auth/mobile/token`), not with UOA
  directly — the server proxies the exchange and issues an internal device
  session token.

### Android

- Use `Custom Tabs` with `AppAuth for Android`
  (`net.openid:appauth`) for the authorize redirect. Register an app link
  (`https://<domain>/auth/mobile/callback`) so Android routes the redirect
  back to the app without a chooser dialog.
- Same token exchange as iOS against the silkie control server.

### Token storage

- **iOS**: Store the device session token and WireGuard private key in the
  Keychain (`kSecClassGenericPassword`, `kSecAttrAccessible =
  kSecAttrAccessibleAfterFirstUnlock`). Never in `UserDefaults`.
- **Android**: Store in the `EncryptedSharedPreferences` (Jetpack Security
  library, AES-256-GCM, key in Android Keystore). Never in plain
  `SharedPreferences`.

---

## WireGuard VPN

The phone joins the overlay network as a WireGuard peer. Connection is
established after enrollment and maintained for the duration of the session.

### iOS — NetworkExtension

- Use **WireGuardKit** (Swift package, `com.wireguard.ios.WireGuardKit`) from
  the official WireGuard project. This wraps `NEPacketTunnelProvider` and the
  userspace WireGuard Go implementation.
- The main app target and the Network Extension target are separate bundle IDs.
  The extension runs in a sandboxed process; IPC between the app and extension
  uses `NETunnelProviderSession`.
- Required entitlements:
  - `com.apple.developer.networking.networkextension` (Packet Tunnel Provider)
  - `com.apple.security.network.client`
- The WireGuard private key is generated in the extension process and stored in
  the Keychain with the group accessor shared between the app and extension.
- Tunnel configuration is built from the `wg_config` payload returned by the
  control server after enrollment and applied via
  `NETunnelProviderManager.saveToPreferences`.
- iOS will prompt the user once to allow VPN configuration. After approval,
  the app calls `manager.connection.startVPNTunnel()` to connect.

### Android — VpnService

- Use the official **WireGuard Android tunnel library**
  (`com.wireguard.android:tunnel`) from the WireGuard Android project. This
  provides the `GoBackend` (userspace WireGuard in Go, compiled as a JNI
  library) and the `Tunnel` / `Backend` abstraction.
- Declare `BIND_VPN_SERVICE` permission in the manifest. The service runs in
  the foreground with a persistent notification (required by Android).
- Android will prompt the user once to allow VPN setup via
  `VpnService.prepare()`.
- The WireGuard keypair is generated on-device; only the public key is sent to
  the server.

### Enrollment flow

```
App                          Control Server
 │                                │
 │── POST /v1/auth/mobile/enroll ─►│   (device session token + WG public key)
 │◄─ { device_id, wg_config,      │
 │     overlay_ip, credential } ──│
 │                                │
 │  (apply wg_config to NE / VpnService, start tunnel)
 │                                │
 │── POST /v1/devices/{id}/heartbeat every 30s
```

`wg_config` is a complete WireGuard configuration block (Interface + all
Peer entries the phone is allowed to reach). The server returns it in the
standard `wg-quick` format for easy application via WireGuardKit / GoBackend.

---

## Device list

After the tunnel is up, the app fetches `GET /v1/devices?role=server` — a
filtered list that returns only devices where:

- `status = active`
- at least one entry exists in the service catalog for that device

The server adds `role=server` filtering rather than having the app filter
client-side, so the response is minimal.

Each row shows:

| Field | Source |
|---|---|
| Hostname | `device.hostname` |
| Platform | `device.os_platform` + `device.os_arch` (e.g. `linux / amd64`) |
| Status | `active` → green dot, anything else → grey |
| Overlay IP | `device.overlay_ip` — tapping the row copies this to the clipboard |

The list polls every 30 seconds while the app is in the foreground to keep
online/offline status fresh. No WebSocket required.

**Tap behaviour**: tap anywhere on a row to copy `device.overlay_ip` to the
system clipboard. Show a brief inline confirmation ("Copied"). Do not navigate
away.

---

## Disconnect

A single **Disconnect** button is visible at all times (top-right or as a
prominent button at the bottom of the device list).

Tapping it:

1. Calls `POST /v1/sessions/disconnect` to revoke the active device session.
2. Stops the WireGuard tunnel (`NETunnelProviderSession.stopTunnel()` on iOS,
   `Backend.stopTunnel()` on Android).
3. Clears the in-memory session token (does not delete the Keychain/Keystore
   entry — credential is reused on next login without re-enrolling).
4. Returns the user to the login screen.

Closing the app does **not** disconnect the VPN. The tunnel remains active in
the background so the user can use other apps (SSH clients, browsers, etc.) to
reach overlay IPs.

---

## AppReveal (debug builds only)

AppReveal is a UI automation and inspection framework by UnlikeOtherAI,
analogous to Playwright for mobile. It enables click-through automation,
element inspection, and UI testing during development.

**Repository:** https://github.com/UnlikeOtherAI/AppReveal

AppReveal uses private APIs and **must never be included in release builds**.
It will be rejected by App Store review if present in production.

### iOS — Swift Package Manager

Add AppReveal only to the Debug configuration:

```swift
// Package.swift or via Xcode SPM UI
// Add as a package dependency from https://github.com/UnlikeOtherAI/AppReveal

// In your App entry point or a debug-only file:
#if DEBUG
import AppReveal
#endif

@main
struct SilkieApp: App {
    init() {
        #if DEBUG
        AppReveal.start()
        #endif
    }
    var body: some Scene { ... }
}
```

In Xcode, set the SPM dependency's **Linking** to the **Debug** configuration
only (Product → Scheme → Edit Scheme, or via target membership). Do not add
AppReveal to the Release scheme or the Network Extension target.

Add `DEBUG` to **Swift Active Compilation Conditions** for the Debug
configuration if not already present (Xcode does this by default).

### Android — Gradle debug dependency

```kotlin
// app/build.gradle.kts
dependencies {
    debugImplementation("com.unlikeotherai:appreveal:<version>")
}
```

Initialise in a debug-only `Application` subclass:

```kotlin
// src/debug/kotlin/com/silkie/app/DebugApplication.kt
import com.unlikeotherai.appreveal.AppReveal

class DebugApplication : SilkieApplication() {
    override fun onCreate() {
        super.onCreate()
        AppReveal.start(this)
    }
}
```

Register it in `src/debug/AndroidManifest.xml`:

```xml
<application android:name=".DebugApplication" />
```

The `release` source set has no `DebugApplication`, so AppReveal is compiled
out entirely from release APKs and AABs.

---

## Build configurations

### iOS

| Configuration | AppReveal | WireGuard | Signing |
|---|---|---|---|
| Debug | included | userspace (GoBackend) | development cert |
| Release | excluded | userspace (GoBackend) | distribution cert |

The Network Extension target follows the same Debug/Release split.

### Android

| Build type | AppReveal | Minification | Signing |
|---|---|---|---|
| debug | `debugImplementation` | off | debug keystore |
| release | excluded | R8 enabled | upload keystore |

---

## Project structure

### iOS (`App/ios/`)

```
Silkie/                        # Main app target
  SilkieApp.swift
  Auth/
    UOAAuthSession.swift        # ASWebAuthenticationSession wrapper
    TokenStore.swift            # Keychain helpers
  VPN/
    TunnelManager.swift         # NETunnelProviderManager wrapper
    WireGuardConfig.swift       # wg_config parser → TunnelConfiguration
  Devices/
    DeviceListView.swift
    DeviceRow.swift
    DeviceService.swift         # GET /v1/devices?role=server + polling
  Debug/
    AppRevealBootstrap.swift    # #if DEBUG only
SilkieExtension/               # Network Extension target
  PacketTunnelProvider.swift
```

### Android (`App/android/`)

```
app/src/
  main/kotlin/com/silkie/app/
    auth/
      UOAAuthActivity.kt        # Custom Tabs + AppAuth
      TokenStore.kt             # EncryptedSharedPreferences
    vpn/
      SilkieVpnService.kt       # VpnService + GoBackend
      WireGuardConfig.kt        # wg_config parser
    devices/
      DeviceListFragment.kt
      DeviceViewModel.kt
      DeviceRepository.kt       # GET /v1/devices?role=server
  debug/kotlin/com/silkie/app/
    DebugApplication.kt         # AppReveal init
```

---

## API endpoints used by the mobile app

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/auth/mobile/token` | Exchange OAuth code for device session |
| `POST` | `/v1/auth/mobile/enroll` | Register device + upload WG public key |
| `GET` | `/v1/devices?role=server` | Fetch server device list |
| `POST` | `/v1/devices/{id}/heartbeat` | Keep device alive |
| `POST` | `/v1/sessions/disconnect` | Revoke session on disconnect |
