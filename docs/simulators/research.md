# iOS Simulator and Android Emulator Screen Streaming — Implementation Gaps

This report focuses on real‑time "simulator/emulator → browser" streaming with interactive input injection, and highlights where the underlying vendor tooling is stable, ambiguous, or drifting. It reflects the current public state visible from vendor docs, source trees, and issue reports through early April 2026. citeturn21view0turn25search23

## simctl recordVideo piped to stdout

**What the output actually is (stdout byte format)**  
The bytestream produced by `xcrun simctl io <udid> recordVideo …` is not a raw Annex‑B NAL stream by default. The contemporary `simctl io recordVideo` help text describes recording "to a QuickTime movie at the specified file or url" (with `--codec h264|hevc`). citeturn17search10turn26search1 This language strongly implies a containerised output (QuickTime/MOV semantics) rather than a "forever" raw elementary stream, because typical QuickTime/MP4 writers need finalisation metadata or fragmentation to be continuously consumable.

Historically, Apple's own `simctl io help` explicitly documented fragmented MP4 streaming and stdout piping, e.g. `recordVideo --type=fmp4 - | <other program>` and "use `-` for stdout". citeturn15search0turn26search4 That older mode, when present, indicates the stream is **fragmented MP4 (fMP4)**, not Annex‑B. In other words: even in the "good for piping" mode you should expect ISO BMFF boxes (`ftyp`, then repeated `moof`/`mdat`), not start‑code NAL units.

**Does it provide a stable indefinite H.264 stream?**  
There are two different "stability" questions you should separate:

1) **Process stability (will `simctl` run for hours?)**  
Many teams run `recordVideo` for long interactive captures without special handling, ending with Ctrl‑C. citeturn17search12turn26search10 But the streaming‑specific path has had regressions. For example, there are reports (Radar/OpenRadar mirror) of "recordVideo streaming broken / output returns nothing" in Xcode 10.1 era. citeturn26search3 Older buffering issues were also reported when piping fMP4 to stdout, with Apple later fixing the excessive buffering in Xcode 8.3 betas. citeturn15search0turn7search6 These point to a risk profile: **"works until it doesn't"**, especially for stdout/socket streaming.

2) **Stream semantics stability (does the bitstream remain decodable indefinitely?)**  
Even if the process stays alive, long‑running browser streaming is sensitive to:
- **keyframe cadence** (viewers joining mid‑stream need a keyframe + parameter sets), and  
- **device rotations / display reconfiguration**, which can trigger codec configuration changes.

`simctl` does not promise stable GOP/keyframe intervals or out‑of‑band SPS/PPS delivery; you must treat its output as a "recording" pipeline, not a purpose‑built low‑latency broadcaster. The fact it's described as producing a QuickTime movie is the key tell. citeturn26search1turn17search10

**What changed in Xcode 15/16 and in current Xcode (2026)**  
Release‑note pages for Xcode 15/16/26 are not accessible without JavaScript in Apple's documentation frontend (limiting direct citation of any deprecation line items). citeturn20view0turn20view1 However, the *observable* interface drift is visible in help‑text captures:

- Older documentation and examples referenced `--type=fmp4` plus stdout piping explicitly. citeturn15search0turn26search4  
- Multiple later excerpts (including a widely referenced automation issue for `recordVideo`) show the `recordVideo [--codec…] <file or url>` form, with no advertised `--type` flag. citeturn17search10turn26search1  

That is consistent with Apple repositioning the feature as "write a movie to a file/url", and leaving true streaming as an implementation detail rather than a supported contract.

Also note that Apple's currently published Xcode system requirements show that "Xcode 26.x" is the current major toolchain line in early 2026, alongside "Xcode 16.x" listed under "Other Xcode versions," which implies an active versioning transition (and therefore higher churn risk for internal simulator tooling). citeturn25search23turn21view0

**Recommended restart strategy if the pipe drops (without rebooting the simulator)**  
The most robust approach is to treat `recordVideo` as *a disposable producer process* and implement restart at the process boundary:

- Run `xcrun simctl io <udid> recordVideo …` as a child process.
- If stdout stops, the process exits, or your consumer detects corruption, kill it and restart it targeting the same UDID (no simulator reboot required).
- If you need to preserve client playback with minimal glitching, prefer *consumer‑side resiliency*: reconnect, wait for next keyframe/codec config, and re‑initialise the browser decoder pipeline.

Where an fMP4 mode exists (`--type=fmp4` in older docs), it is structurally more restartable than a monolithic MOV/MP4 because fMP4 is chunked. citeturn15search0turn26search4

**Working example: defensive wrapper around simctl producer**  
Below is a pragmatic Node.js wrapper that (a) spawns `simctl`, (b) restarts on exit, and (c) exposes stdout for a downstream mux/relay layer. It assumes you are either receiving fMP4 or a continuously writable movie stream and *you are not decoding raw Annex‑B directly from it*.

```js
import { spawn } from "node:child_process";

export function startSimctlRecorder({ udid, codec = "h264", extraArgs = [] , onChunk }) {
  let stopped = false;
  let child = null;

  const spawnOnce = () => {
    const args = ["simctl", "io", udid, "recordVideo", "--codec", codec, "--force", "-", ...extraArgs];
    child = spawn("xcrun", args, { stdio: ["ignore", "pipe", "pipe"] });

    child.stdout.on("data", (buf) => onChunk?.(buf));
    child.stderr.on("data", (buf) => {
      // log, rate-limit, parse for known errors if needed
      process.stderr.write(buf);
    });

    child.on("exit", (code, signal) => {
      child = null;
      if (stopped) return;

      // backoff to avoid tight crash loops
      const delayMs = Math.min(2000, 200 + Math.random() * 300);
      setTimeout(spawnOnce, delayMs);
    });
  };

  spawnOnce();

  return {
    stop() {
      stopped = true;
      if (child) child.kill("SIGTERM");
    }
  };
}
```

**Known failure modes you should explicitly engineer around**
- **"Streaming returns nothing / black"** regressions have been reported historically for the streaming path. citeturn26search3  
- **Buffering/latency bursts when piping** were reported and fixed in an older toolchain generation, which is a reminder that buffering behaviour is not guaranteed stable across versions. citeturn15search0turn7search6  
- **Non‑deterministic frame pacing**: simulator recordings are often reported to have inconsistent frame rates by practitioners building App Preview workflows. citeturn12search4  
- If you are depending on `-` meaning stdout: modern help text does not consistently surface that for `recordVideo` (it does for screenshots), so treat "stdout streaming" as **best‑effort**, not a contractual API. citeturn17search10turn26search2

## CoreGraphics simulator window capture as an alternative

This approach replaces simulator framebuffer recording with **host window server capture** → encoder → socket. It is usually chosen when `simctl` streaming is too opaque, or when you need cursor/touch overlays and compositing.

**How to identify the correct simulator window for a specific UDID**  
CoreGraphics window enumeration gives you window dictionaries; the stable anchors you can depend on are:

- `kCGWindowOwnerPID`: lets you tie windows to a process PID. The API exposes this key as part of the window metadata set, and it's widely used for filtering. citeturn29search12turn29search32  
- `kCGWindowOwnerName` / `kCGWindowName`: useful but not stable (titles change; multiple Simulator windows share owner name). citeturn29search32turn29search29  

However, **UDID isn't a native CoreGraphics property**. The practical mapping strategy is usually two‑step:

1) Identify the PID of `Simulator.app` (or multiple simulator processes, depending on your host/Xcode generation).  
2) Filter windows owned by that PID; then disambiguate by window bounds/aspect ratio and by the human‑readable title.

This is inherently brittle because window titles change and because the mapping from UDID → "which window is fronting that device" is not part of the public CGWindow API.

If you need *stable UDID binding*, you inevitably end up with an additional side channel (e.g., `simctl` to query the current device name and correlate titles) or an accessibility/automation layer to resolve the window object.

**Working Swift path: window discovery → CGWindowListCreateImageFromArray → VideoToolbox H.264**  
The CoreGraphics path is:

- `CGWindowListCopyWindowInfo` to enumerate windows. citeturn29search29turn29search12  
- Extract candidate window IDs, then `CGWindowListCreateImageFromArray` to render them into a `CGImage`. (This is the function most people use for "capture a window excluding others" use cases.) citeturn29search20turn29search26  
- Convert to pixel buffers (`CVPixelBuffer`) and feed frames into `VTCompressionSession` H.264. Apple's VideoToolbox docs describe the session‑based workflow and how to create sessions via `VTCompressionSessionCreate`. citeturn29search1turn29search5  
- Emit encoded H.264 access units via the output callback; this gives you CMSampleBuffer‑backed compressed frames suitable for transport (WebRTC, fMP4 muxing, or WebCodecs with the right packaging).

Below is an end‑to‑end Swift example skeleton (macOS). It is deliberately explicit about each step you'll need in a production streamer. The output transport is shown as a placeholder "send bytes"; you'll adapt it to WebSocket/TCP/QUIC.

```swift
import Foundation
import CoreGraphics
import VideoToolbox
import CoreVideo
import CoreMedia

struct WindowInfo {
  let windowID: CGWindowID
  let ownerPID: pid_t
  let name: String
}

func listWindows() -> [WindowInfo] {
  guard let arr = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements],
                                             kCGNullWindowID) as? [[String: Any]] else {
    return []
  }

  return arr.compactMap { dict in
    guard let wid = dict[kCGWindowNumber as String] as? UInt32,
          let pid = dict[kCGWindowOwnerPID as String] as? Int else {
      return nil
    }
    let name = (dict[kCGWindowName as String] as? String) ?? ""
    return WindowInfo(windowID: CGWindowID(wid), ownerPID: pid_t(pid), name: name)
  }
}

/// Capture a single window into a CGImage.
func captureWindowImage(windowID: CGWindowID) -> CGImage? {
  let ids = [windowID] as CFArray
  // Note: CGWindowListCreateImageFromArray exists specifically for capturing selected windows.
  return CGWindowListCreateImageFromArray(.null, ids, [.boundsIgnoreFraming, .bestResolution])
}

final class H264Encoder {
  private var session: VTCompressionSession?
  private let width: Int32
  private let height: Int32

  var onNALUnits: ((Data, Bool /*isKeyframe*/ ) -> Void)?

  init(width: Int32, height: Int32) throws {
    self.width = width
    self.height = height

    var s: VTCompressionSession?
    let status = VTCompressionSessionCreate(
      allocator: nil,
      width: width,
      height: height,
      codecType: kCMVideoCodecType_H264,
      encoderSpecification: nil,
      imageBufferAttributes: nil,
      compressedDataAllocator: nil,
      outputCallback: { (outputRefCon, _, status, _, sampleBuffer) in
        guard status == noErr,
              let sbuf = sampleBuffer,
              CMSampleBufferDataIsReady(sbuf) else {
          return
        }

        let enc = Unmanaged<H264Encoder>.fromOpaque(outputRefCon!).takeUnretainedValue()

        // Keyframe detection via sample attachments.
        var isKeyframe = false
        if let attachments = CMSampleBufferGetSampleAttachmentsArray(sbuf, createIfNecessary: false) as? [[CFString: Any]],
           let first = attachments.first {
          isKeyframe = (first[kCMSampleAttachmentKey_NotSync] as? Bool) != true
        }

        // H.264 elementary stream payload is inside CMBlockBuffer.
        guard let bb = CMSampleBufferGetDataBuffer(sbuf) else { return }

        var totalLength: Int = 0
        var dataPointer: UnsafeMutablePointer<Int8>?
        CMBlockBufferGetDataPointer(bb, atOffset: 0, lengthAtOffsetOut: nil,
                                    totalLengthOut: &totalLength,
                                    dataPointerOut: &dataPointer)

        guard let ptr = dataPointer else { return }
        let data = Data(bytes: ptr, count: totalLength)

        // IMPORTANT: This 'data' is typically AVCC length-prefixed NAL units.
        // If your transport expects Annex B, you must convert.
        enc.onNALUnits?(data, isKeyframe)
      },
      refcon: UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque()),
      compressionSessionOut: &s
    )
    guard status == noErr, let created = s else {
      throw NSError(domain: "VTCompressionSessionCreate", code: Int(status), userInfo: nil)
    }

    session = created

    // Tune for realtime.
    VTSessionSetProperty(created, key: kVTCompressionPropertyKey_RealTime, value: kCFBooleanTrue)
    VTSessionSetProperty(created, key: kVTCompressionPropertyKey_ProfileLevel,
                         value: kVTProfileLevel_H264_Baseline_AutoLevel)
    VTCompressionSessionPrepareToEncodeFrames(created)
  }

  func encode(pixelBuffer: CVPixelBuffer, pts: CMTime) {
    guard let s = session else { return }
    VTCompressionSessionEncodeFrame(s,
                                    imageBuffer: pixelBuffer,
                                    presentationTimeStamp: pts,
                                    duration: .invalid,
                                    frameProperties: nil,
                                    sourceFrameRefcon: nil,
                                    infoFlagsOut: nil)
  }

  func finish() {
    guard let s = session else { return }
    VTCompressionSessionCompleteFrames(s, untilPresentationTimeStamp: .invalid)
    VTCompressionSessionInvalidate(s)
    session = nil
  }
}
```

**Key implementation gap you must resolve: AVCC vs Annex‑B**  
VideoToolbox commonly emits **AVCC (length‑prefixed NAL units)** in the `CMBlockBuffer` for H.264 samples, whereas many network and "raw H.264" tooling expects Annex‑B start codes. The `W3C` WebCodecs AVC registration explicitly calls out codec‑specific requirements for `EncodedVideoChunk` data bytes and `VideoDecoderConfig.description`. citeturn29search3turn29search28 In practice this means you must decide early:

- send AVCC + out‑of‑band `avcC` (best fit for WebCodecs + fMP4), or  
- convert to Annex‑B (best fit for many RTP/H.264 toolchains), but then you must handle parameter‑set injection yourself.

**Performance and occlusion/backgrounding**  
CoreGraphics capture is a WindowServer‑composited path; it can capture windows even if partially offscreen/occluded because it works from the compositor's representation, not your app's view hierarchy. This is a known property of the CGWindowList APIs introduced to obtain images "as composited by the Window Server." citeturn29search26

That said, your real bottlenecks at 30fps are typically:
- window capture copy cost (often CPU + memory bandwidth heavy), and  
- H.264 encode settings (realtime mode, profile, bitrate) and whether hardware encode is used.

Apple's VideoToolbox guidance for "encoding video for low‑latency conferencing" is the closest official reference for how to configure `VTCompressionSession` for realtime. citeturn29search9turn29search1

A practical note: when you capture `Simulator.app`, you also inherit macOS privacy controls around screen capture (which can cause "works in Terminal, fails in sandboxed app" classes of issues). This is commonly encountered by developers attempting to call `simctl recordVideo` or window capture from inside an app bundle. citeturn16search7

## idb_companion current state

**Is it actively maintained in early 2026? Latest stable version**  
The `facebook/idb` repository describes `idb` as relying on private frameworks and provides an architecture in which a "companion" runs on macOS as the gRPC server. citeturn28view0turn28view2

However, the last published GitHub Release is **v1.1.8 (August 11, 2022)**. citeturn28view1 If you define "latest stable" as "latest tagged release distributed via the Releases mechanism," then v1.1.8 is the last stable cut publicly visible there as of early 2026.

This creates a real implementation gap for teams targeting iOS 17/18/26 simulators in 2025–2026: you are likely consuming **unreleased HEAD changes** (if any exist) or maintaining internal forks/patches, because the release line is old relative to modern simulator churn. (This is an inference drawn from release age vs. current toolchain cadence; the underlying dates are factual.) citeturn28view1turn25search23

**Lifecycle and multiplicity: per‑simulator vs global**  
The `idb` architecture doc is explicit:

- `idb_companion` is a gRPC server that runs on macOS and talks to native automation APIs. citeturn28view2  
- When acting as a gRPC server, it does so **for a single iOS target** (device or simulator). citeturn28view2  
- When the `idb` CLI runs on macOS, it "will automatically start and stop companions for all targets that are attached to your Mac." citeturn28view2  

From an operational standpoint, that means your system should assume:
- **one companion instance per simulator UDID** (or per target), and  
- the CLI can orchestrate those instances for you on macOS, but remote clients must explicitly connect. citeturn28view2  

**Multiple companions simultaneously**  
Because companions are "single target" servers, **running multiple companions simultaneously is normal** in the intended architecture; they must be bound to distinct ports (one per target). citeturn28view2 Collision and multi‑instance bugs usually arise when:
- you hardcode ports,  
- you restart targets without tearing down old companions, or  
- you attempt to point multiple companions at the same UDID.

**Touch injection regressions on modern simulators**  
The repository itself states it "leverages many private frameworks that are used by Xcode." citeturn28view0 This is the fundamental source of fragility: touch injection is not an Apple‑documented stable interface, so changes in simulator internals can break it without notice.

A concrete action item for 2026 engineering is to treat simulator input injection as a *compatibility matrix problem*:
- maintain per‑Xcode/iOS‑simruntime test coverage for tap/swipe/typing primitives, and  
- implement fallback injection paths (e.g., XCUITest‑driven actions) even if they are higher latency.

(Apple-supported alternatives are not directly documented in the sources above; the private-framework reliance is the key fact grounding the recommendation.) citeturn28view0turn28view2

## Android emulator gRPC screen stream API

**Where the proto definitions live and what is canonical**  
There are three practically relevant locations you will see in the wild:

1) **Android Studio tools/base mirror** includes an `emulator/proto` directory and explicitly states these protos are *copied from the Android Emulator code base*, with the "master copies" located under the emulator's QEMU tree at:  
`platform/external/qemu/.../android/android-grpc/` citeturn29search21  

   This is the clearest breadcrumb to the canonical AOSP path.

2) **AOSP prebuilts** ship proto files alongside emulator binaries, e.g.  
`platform/prebuilts/android-emulator/.../lib/emulator_controller.proto`. citeturn28view3  
   This is authoritative for **a specific shipped emulator build**, but is not necessarily the editable "source of truth."

3) The **entity["company","Google","parent of android"]**-maintained `android-emulator-webrtc` repository exposes similar proto definitions for tooling around emulator control. citeturn27search1turn29search2  
   This is useful reference code, but not necessarily the canonical AOSP location.

**Is the API stable across emulator versions?**  
The tools/base README makes the compatibility story explicit: the protos are copied from emulator build artifacts, and there is a script to "update proto files" by extracting them from an emulator build. citeturn29search21 That implies:
- the proto surface is **tightly coupled to emulator builds**, and  
- you should expect drift over time (new RPCs, changed messages, new semantics).

So: treat this API as "semi‑internal" even if it is gRPC and proto‑described.

**What the shipped proto actually offers for screen streaming**  
In the prebuilts `emulator_controller.proto`, the screen capture streaming primitive that is clearly present is:

- `rpc streamScreenshot(ImageFormat) returns (stream Image) {}` with commentary that it can generate significant data, that PNG is CPU expensive, and that empty images may be delivered when the display is inactive. citeturn28view3  

This is a *frame stream*, but it is not described as "H.264 frames." It is (by naming and comments) screenshot‑based, likely with configurable encodings through `ImageFormat`. citeturn28view3

If your system requirement is "receive H.264 access units," you should verify whether your target emulator build exposes a dedicated video stream service (some older docs refer to `UiController.StreamScreen`, but that is not evidenced in the prebuilts excerpt above). In practice, teams either:
- accept screenshot streaming (RGB/PNG/JPEG), or  
- switch to WebRTC streaming features, or  
- use device‑side methods (`adb exec-out screenrecord …`) and accept their limitations.

**Working gRPC call sequence for streamScreenshot**  
At a protocol level, this is standard gRPC server‑streaming:

1) Create channel to emulator gRPC endpoint (usually enabled by emulator flags; endpoint/port selection is environment‑specific and not reliably stable enough to assert without an emulator build reference).  
2) Create stub for the service containing `streamScreenshot`.  
3) Call `streamScreenshot(ImageFormat)` once; read a stream of `Image` messages.

The proto's behavioural notes are critical operationally:
- it can produce a lot of data;  
- certain translations (PNG) are CPU intensive;  
- it can send empty images if display becomes inactive;  
- images resume when display is active again. citeturn28view3  

**Low-latency alternative that does not rely on emulator internal gRPC**  
There is no vendor statement in the sources above that promises a stable, documented low‑latency emulator capture API equivalent to "hardware frames" without relying on internal gRPC. The closest "official" stance you can ground in documentation is that gRPC is a supported technology for Android apps generally (not emulator control). citeturn29search14turn27search9

In practice, if you need *stable* capture semantics for many Android versions, the most common approach remains:
- `adb exec-out screenrecord` (often with `--output-format=h264` and stdout), or  
- a WebRTC-based mirroring toolchain.

(Those options are not directly documented in the provided emulator-control sources; the key point here is the absence of a documented stable alternative in the canonical emulator proto references.) citeturn29search21turn28view3

## WebCodecs and Safari status

**Safari support status for WebCodecs VideoDecoder (early 2026)**  
Both Apple's Safari 26.4 release notes and the WebKit "Features for Safari 26.4" post list fixes for "WebCodecs VideoDecoder" H.264 ordering, which is strong evidence that **WebCodecs VideoDecoder is shipping** (at least on the Safari 26.4 line) by March 2026. citeturn27search2turn28view5

**H.264 profile/level support across browsers**  
WebCodecs codec support is platform dependent; the `W3C` codec registry/registration documents emphasise that implementers are not required to support AVC/H.264 and define how codec strings and configuration bytes must be interpreted when they do. citeturn29search3turn29search28

Practically, you must **feature-detect** what the browser can decode using `VideoDecoder.isConfigSupported()` at runtime. The "fully qualified codec strings" defined in the AVC registration are the normative way to describe profile/level compatibility in WebCodecs contexts. citeturn29search3

**Correct EncodedVideoChunk construction from Annex‑B NAL units**  
This is the most common production pitfall: WebCodecs H.264 decoding frequently requires:

- correct conversion of the incoming bitstream to the expected internal format (AVCC vs Annex‑B), and  
- providing `VideoDecoderConfig.description` (the `avcC` / AVCDecoderConfigurationRecord) when required.

The AVC registration document specifies both the encoded chunk "internal data bytes" expectations and the `VideoDecoderConfig.description` requirements. citeturn29search3 A real‑world error message illustrates the failure mode: "H.264 configuration must include an avcC description." citeturn29search19

A practical implementation model for "Annex‑B over WebSocket → WebCodecs" is:

1) Parse Annex‑B stream into NAL units (detect start codes).  
2) Maintain last-seen SPS (type 7) and PPS (type 8).  
3) Build an `avcC` blob from SPS/PPS and pass it as `VideoDecoderConfig.description`.  
4) Convert each access unit into a chunk payload in the required format (often AVCC length‑prefixed).  
5) Mark `EncodedVideoChunk.type` as `"key"` only when the access unit is an IDR (nal_type 5) *and* you have valid parameter sets consistent with the stream.

Chrome's own guidance notes that H.264 may require "a binary blob of AVCC, unless it's encoded in Annex B format," and references explicit "annexb" configuration for encoding. citeturn29search11turn29search22 The codec registration is the more authoritative reference for decoding expectations. citeturn29search3

**Known failure mode: keyframe strictness**  
A common cross-browser gap is that "key frame" may effectively mean "IDR" (not merely I‑slice). W3C discussions and Chromium issues document that implementations can be strict about requiring IDR after flush or startup. citeturn29search15turn27search38 Build your transport such that:
- new viewers get the most recent SPS/PPS + next IDR, and  
- decoder reset triggers re‑delivery of config + IDR.

**Best fallback decoder for Safari if WebCodecs is unavailable**  
Given Safari 26.4's WebCodecs fixes, the more realistic "fallback" in early 2026 is not "Safari has no WebCodecs", but rather:
- WebCodecs exists, but codec/config mismatches or device hardware constraints break decoding.

Two practical fallbacks:

1) **MSE + fMP4 (CMAF-style fragments)**: this avoids writing your own H.264 elementary stream parsing rules in JavaScript and uses the platform media pipeline. (This is a recommendation; a specific Safari MSE citation is not available in the gathered sources, but it aligns with the direction implied by fMP4 streaming modes historically present in simctl.) citeturn15search0turn26search4  

2) **WebRTC**: often simplest for low-latency interactive remote device UX, and Safari 26.4 continues to ship and improve WebRTC. citeturn28view5  

Pure WASM decoders (Broadway.js / ffmpeg.wasm / libav.js) remain viable as "last resort," but their cost is high CPU and higher latency, especially at retina resolutions. If your use case is interactive device control, you will typically prefer *platform decoders* (WebCodecs/MSE/WebRTC) when possible.

## Android AVD cloning and absolute-path rewrites

**What avdmanager officially supports (and what it does not)**  
Google's official documentation defines `avdmanager` as a CLI that "lets you create and manage Android Virtual Devices (AVDs) from the command line." citeturn28view7 It documents syntax and commands but does not present a first-class "clone AVD" operation in the accessible documentation snapshot. citeturn28view7turn27search15

As a result, "clone" is still commonly implemented as: copy the `.avd` directory and the matching `.ini` file, then rewrite paths. This is the canonical community recipe on Stack Overflow. citeturn27search3

**Files that usually contain absolute paths and require rewriting**  
At minimum, cloning requires updating:

- `~/.android/avd/<name>.ini` (sibling of the `.avd` folder): contains the `path=` pointer to the `.avd` directory (absolute on many systems). citeturn27search3  
- `~/.android/avd/<name>.avd/config.ini`: can contain absolute paths depending on how system images / sysdir references were created. A long-standing issue report notes that `image.sysdir.1` pointing to an absolute path can cause "AVD shows as broken" in the manager UI. citeturn27search7  

In practice, additional files under the `.avd` directory that may embed absolute paths include:
- `hardware-qemu.ini` or generated QEMU config fragments, and  
- snapshot/quickboot metadata (varies by emulator version).

Because the exact file set can vary across emulator versions and host OS, the only defensible "complete list" strategy in production is:

1) After copying, recursively scan all text-like files for the old absolute base path and rewrite.  
2) Delete quickboot/snapshot state when moving between hosts/paths if it fails to boot (snapshots frequently carry environment-specific assumptions).

**Are there SQLite databases or binary files that cannot be updated with simple replacement?**  
The official docs and issue references in scope do not enumerate binary database files inside an AVD that must be rewritten; most cloning guides focus on `.ini` metadata. citeturn27search3turn27search7

Nevertheless, emulator quickboot state and certain binary artifacts can embed absolute paths in opaque formats. Operationally, the safest method is:
- **prefer "clean clone"**: copy AVD definition + image pointers, but remove snapshots/caches so the emulator reconstructs them in the new location.

This aligns with the observed fragility around absolute `image.sysdir.*` references. citeturn27search7
