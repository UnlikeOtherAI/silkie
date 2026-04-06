# Deep research on macOS Screen Recording TCC, live fMP4 demux in Go, browser MSE live playback, and idb_companion on Apple Silicon

## Cross-cutting findings and risk map

On macOS, "screen content capture" is governed by Transparency, Consent, and Control (TCC) and is **not** a simple entitlement you can assume will be prompted for or granted when your capture code runs in a background context. entity["company","Apple","technology company"] explicitly called out in its WWDC 2019 macOS security session that key capture APIs will *fail* without user approval and that the authorisation dialogue is only shown under specific conditions, not reliably for repeated failures or for all calling contexts. citeturn8search6

On the streaming side, out-of-process capture via `simctl io … recordVideo --type=fmp4 -` is attractive because it gives you a containerised stream that is already "browser-adjacent" (CMAF-ish fragmented MP4). However, it shifts complexity to **incremental ISO-BMFF parsing** server-side and **careful MSE append orchestration** client-side. Even small timestamp gaps can break playback—WebKit's own documentation and bug history show that its MSE pipeline is sensitive to gaps, and that tolerances have had to be tuned because real-world encoders drift. citeturn17view0turn19search2turn19search20

Finally, `idb_companion` appears to be in a problematic maintenance state for modern Apple Silicon simulator realities: the last upstream release is August 2022 (per the repository release metadata), and open issues document architecture mis-detection that blocks arm64 simulator usage on M-series Macs. citeturn20search1turn20search7turn23view0turn23view1

## macOS TCC Screen Recording permission for background daemons

### Which APIs trigger Screen Recording TCC checks

The most authoritative public description in the open web corpus comes from Apple's WWDC 2019 session on macOS security changes. In that talk, Apple states that on macOS Catalina and later, a call that creates a `CGDisplayStream` can return `nil` and prompt the user to approve **Screen Recording**, and that reading another app's window contents via `CGWindowListCreateImage` similarly fails without approval (with the authorisation prompt only showing the first time the failure happens due to missing approval). citeturn8search6

That WWDC session also draws an important distinction between:

* **Content capture** APIs that can trigger authorisation UI when they fail (for example `CGDisplayStream` creation and `CGWindowListCreateImage` calls), and  
* **Window metadata** APIs like `CGWindowListCopyWindowInfo`, which (per Apple) *do not trigger a prompt* but instead **filter** sensitive fields such as window titles unless the app is already authorised for Screen Recording. citeturn8search6turn9search20

This maps directly onto your concern: `CGWindowListCreateImageFromArray` is in the same family as `CGWindowListCreateImage` (it is effectively a variant for composing images from multiple windows). While Apple's WWDC transcript names `CGWindowListCreateImage`, it is the same CoreGraphics "window-image capture" pathway that Apple is describing as being TCC-gated for screen content capture. citeturn8search6

Separately, Apple's WWDC 2022 ScreenCaptureKit introduction states that the framework "requires consent" before it can capture, and that the user's choice is stored in the Screen Recording privacy setting. citeturn6search25 This matters because if you switch to ScreenCaptureKit (or end up forced to), you are still in the same Screen Recording/TCC permission world.

### Why daemons and some CLI contexts don't reliably prompt

Apple's WWDC 2019 description already hints at one failure mode: the authorisation dialogue is only displayed the *first* time certain capture calls fail due to missing approval. citeturn8search6 In practice, developers run into an even harsher issue for background services:

* Launch daemons run outside an interactive user GUI session, so even if the OS *wanted* to show a prompt, there may be no user session to host it.
* Even when your code is executed by `launchd`, you may end up capturing the "wrong" session (a blank login window / default desktop), not the currently logged-in user's desktop, because you're not running in that user's WindowServer context.

Both behaviours are widely observed by macOS developers building background screenshot tools; for example, an Apple Stack Exchange question about a launch daemon taking periodic screenshots reports getting a "blank home screen" rather than the actual current session. citeturn8search10

A practical engineering summary (not Apple-official, but consistent with Apple's behavioural model) is: you cannot depend on a root/system daemon to successfully trigger TCC prompts, and you often need a user-space companion agent to request/obtain consent in the correct login session. citeturn8search7

### Can you "pre-grant" Screen Recording for a daemon via MDM / PPPC

This is the crux: for most TCC services, enterprises can deploy a Privacy Preferences Policy Control (PPPC) configuration profile that sets "Allow" for an app (bundle ID) or binary (path). Screen Recording is different.

Apple's Platform Deployment documentation for PPPC indicates Screen Recording is a managed service, but its "device management payload settings" text frames it as a way to **deny** specified apps access to capture, not to silently grant capture. citeturn3view0

The Apple-provided PPPC "custom payload examples" include an example titled "Allow screen recording for an app", but the mechanism shown is *not* an unconditional allow. Instead, it sets the `Authorization` value to `AllowStandardUserToSetSystemService` for the `ScreenCapture` service—i.e., it allows a standard (non-admin) user to manage the Screen Recording toggle in System Settings for that app, but it still requires an interactive user choice. citeturn4view0

Apple's open device-management schema is even more explicit for the `ScreenCapture` service: it notes that access to screen contents **cannot be granted** in a configuration profile; it can only be denied (and, in macOS 11+, the profile can allow a standard user to make the choice in System Settings). citeturn2view0

This aligns with what macOS admins communicate in practice: "Screen Recording can only be enabled by a physical user on a Mac" (Jamf community discussion). citeturn9search9

**Implication for unmanaged machines:** there is no enterprise knob you can rely on to silently grant Screen Recording to your capture daemon. On unmanaged Macs, you must expect an interactive user step at least once per code identity (and potentially repeatedly on newer macOS versions; see below). citeturn2view0turn9search9

### What the PPPC profile looks like for a daemon binary

Even though you cannot "Allow" ScreenCapture outright, PPPC still matters for two reasons:

1. You may want to **deny** ScreenCapture to specific binaries (hardening / defence-in-depth).
2. You may want to set `AllowStandardUserToSetSystemService` so standard users can approve your tool without admin elevation. citeturn4view0turn2view0

Apple's PPPC payload is `com.apple.TCC.configuration-profile-policy`, with a `Services` dictionary whose keys include `ScreenCapture`. Apps can be identified by `bundleID`; non-bundled binaries can be identified by `path`. Apple also notes that helper tools embedded in an app bundle inherit the enclosing bundle's permissions, which is relevant if you wrap your daemon as an embedded helper inside a signed GUI app. citeturn2view0turn3view0

A minimal, representative PPPC snippet (illustrative, not a fully deployable profile) that enables the *standard-user-manageable* behaviour for Screen Recording looks like this (Apple's example uses Terminal, but the pattern is the same): citeturn4view0

```xml
<dict>
  <key>PayloadType</key>
  <string>com.apple.TCC.configuration-profile-policy</string>
  <key>Services</key>
  <dict>
    <key>ScreenCapture</key>
    <array>
      <dict>
        <key>IdentifierType</key>
        <string>path</string>
        <key>Identifier</key>
        <string>/Library/PrivilegedHelperTools/com.yourcompany.yourdaemon</string>
        <key>CodeRequirement</key>
        <string>identifier "com.yourcompany.yourdaemon" and anchor apple generic</string>
        <key>Authorization</key>
        <string>AllowStandardUserToSetSystemService</string>
      </dict>
    </array>
  </dict>
</dict>
```

Two practical cautions fall directly out of Apple's PPPC material:

* Your `CodeRequirement` must match the signed code identity you deploy, otherwise permissions can "disappear" or fail to apply as the code requirement changes. citeturn4view0turn2view0  
* PPPC identification differs for app bundles vs non-bundled tools (bundle ID vs path). citeturn2view0

### Does `xcrun` inherit the caller's Screen Recording permission

In TCC terms, permission evaluation is tied to the **requesting client identity**, but the user-facing prompt may attribute the action to a "responsible" app in the process chain.

Apple's PPPC payload documentation includes a concrete debugging hook: you can stream logs with `log stream --info --debug --predicate 'subsystem == "com.apple.TCC" …'` and inspect the `AttributionChain` to see which app/binary is being treated as responsible for a TCC request. citeturn3view0

This matters because it's common to see prompts attributed to `Terminal.app` when you run a CLI tool under it: the prompt's "client" from the user's perspective is the UI host, even if the syscall originates from a child. Apple's PPPC schema also states that helper tools embedded in an app bundle inherit the enclosing app's permissions, but it does *not* claim that arbitrary child processes inherit TCC rights just because they were launched by an authorised process. citeturn2view0turn3view0

So, for your question framed as "does `xcrun` inherit the caller's permissions?" the most accurate *operational* answer from available public material is:

*The TCC decision applies to the client identity that macOS associates with the request, which may be your app, the enclosing GUI app, or another process in the attribution chain. You should empirically determine attribution using the `com.apple.TCC` log stream and not assume simple inheritance.* citeturn3view0turn2view0

### What this means for your two capture paths

* **CoreGraphics path (`CGWindowListCreateImageFromArray`)**: Apple explicitly categorises the CGWindowList image capture family as Screen Recording gated; without pre-approval, calls fail (and prompts are not reliably repeated). This can absolutely yield "black/empty" capture results in production if you run in a context that cannot prompt. citeturn8search6  
* **`simctl io screenshot` / `simctl io recordVideo`**: these are simulator framebuffer operations, not host desktop capture. They are not named by Apple as Screen Recording gated in the WWDC macOS security talk, and practical failure reports when called from a sandboxed Mac app show developers trying Screen Recording permission without fixing the issue—suggesting the failure mode is not simply "missing ScreenCapture TCC". citeturn25view0turn13view0

## Server-side incremental fMP4 live-stream demux in Go

### What `simctl io recordVideo --type=fmp4` actually outputs

Apple's `simctl io` help (as surfaced in a long-standing Stack Overflow thread) documents that you can record the simulator's main framebuffer to a file, and that using `-` writes to stdout. It also explicitly gives an example for *fragmented mp4* piping:

`simctl io booted recordVideo --type=fmp4 - | <other program>` citeturn13view0

This establishes that, at least by interface contract, the bytestream is intended to be an fMP4 stream suitable for piping.

### Box order and the "moov might arrive late/absent" hazard

For browser-oriented fragmented MP4, the canonical structure is:

* **initialisation segment**: `ftyp` + `moov`
* **media**: repeated `moof`/`mdat` pairs (sometimes with `styp`/`sidx` in segment structures)

Mozilla's MSE guidance states that "properly fragmented mp4" used with MSE has `ftyp` followed immediately by `moov`, then `moof`/`mdat` pairs. citeturn15search14

The practical streaming implication:

* If your pipeline ever needs to support "mid-stream join" (a WebSocket client connects after the stream started), you must cache the init segment and resend it before sending the next fragment, otherwise MSE clients cannot initialise decoders. citeturn15search14turn17view0

If an encoder truly emits `moov` late (or only at end-of-file), then it is *not* a normal MSE-friendly fMP4 stream, and you cannot decode correctly without either buffering until `moov` appears or obtaining codec config out-of-band. That general constraint is inherent to the MP4 structure: `moov` carries the track/sample description including codec configuration. citeturn15search14turn14search0

### Go libraries suited for *streaming* fMP4 demux

There are two Go ecosystems that show up consistently for fragmented MP4:

The most directly aligned with your needs is `mp4ff` from entity["company","Eyevinn Technology","video streaming consultancy"]. Its README states it is focused on fragmented MP4 "as used for streaming" (DASH, MSS, HLS fMP4), and it models a fragment as exactly one `moof` followed by one `mdat`, with the metadata for samples living in `trun` boxes. citeturn12view0

`mp4ff` also discusses "lazy" handling of `mdat` (decode metadata first, defer reading media bytes) and exposes APIs to read/copy byte ranges from `mdat` if you have an `io.ReadSeeker`. citeturn12view0  
This is not a perfect API match for a pure socket stream (which is an `io.Reader`, not a seeker), but it indicates the library is designed around the idea that **you parse box headers and interpret `trun` sample sizes** rather than decoding an entire file at once. citeturn12view0

By contrast, `abema/go-mp4` positions itself as a low-level MP4 box library and highlights "extract those boxes via `io.ReadSeeker`" when you want selective reads. citeturn11search1turn11search5  
That's often convenient for files, but less ideal for true incremental network demux unless you build your own buffering and (optionally) seek emulation.

### The correct incremental parsing loop

At a high level, you need a state machine that:

1. Reads an MP4 box header (size + type; plus "largesize" handling).
2. Buffers exactly the bytes for small metadata boxes (`ftyp`, `moov`, `moof`, etc.).
3. For `moof`, parses `traf`/`trun` to obtain sample sizes (and timing if you need timestamps).
4. For `mdat`, streams out exactly the sample-sized chunks without buffering the entire `mdat`.

`mp4ff`'s structural description supports this mental model directly: fragments are `moof` + `mdat`, and `trun` carries sample metadata. citeturn12view0

A practical architecture that minimises buffering:

* Read `ftyp` and `moov` fully into memory once (they are small compared to video).
* For each `moof`, parse it fully (usually small).
* For each `mdat`, stream-read from the underlying connection and slice it according to the `trun` sample sizes.

If your end goal is "H.264 access units over WebSocket" (not fMP4 to the browser), remember that H.264 in MP4 is typically stored as length-prefixed NAL units ("AVCC" format), and you may need the `avcC` box (from `moov`) to know the NAL length size and codec parameter sets. This is precisely why lossy/late `moov` makes life hard: without codec config, you either guess the length field size or try to recover SPS/PPS from in-band IDR samples if the stream is packaged accordingly. The "init segment first" guidance for fragmented streams is meant to avoid that ambiguity. citeturn15search14turn12view0

### Handling "moov absent" in a live system

If you truly encounter streams where:

* clients connect after init has already gone by, or
* the producer doesn't send `moov` at start,

the best-supported pattern (also used in other live fMP4 piping systems) is to keep a cached init segment in your server process and prepend it when a new client joins. That same strategy is discussed in fragmented live MP4 contexts generally: store `ftyp`+`moov`, and replay it to late joiners. citeturn18search0turn15search14

## Browser MSE plus fMP4 live push

### Non-negotiable container ordering

Across MSE guidance, the consistent requirement is:

*Append an initialisation segment (containing `ftyp` and `moov`) before appending any media fragments (`moof`/`mdat`).* Mozilla's MSE article makes this explicit for "properly fragmented mp4". citeturn15search14

WebKit's MSE documentation describes the same conceptual model: clients fetch init segments and media segments (often subsets of a fragmented MP4 file) and append them into a `SourceBuffer`, which parses them into tracks and samples. citeturn17view0

### Correct append queue pattern

The web platform contract is that `SourceBuffer.appendBuffer()` is asynchronous: it sets `sourceBuffer.updating = true`, and completion is signalled via `updateend` (even if the operation ultimately fails). citeturn17view0turn15search18turn15search4

The practical, robust pattern is therefore:

* Maintain an explicit FIFO queue of "appendable units" (usually: init segment once, then whole `moof+mdat` fragments).
* Only call `appendBuffer()` when `sourceBuffer.updating` is `false`.
* In the `updateend` event handler, pop the next chunk and append again.

MDN's `appendBuffer()` and `updateend` docs, plus the W3C MSE spec's event model, support this approach directly. citeturn15search9turn15search18turn15search4

### Safari and WebKit: what "stricter" usually means in practice

Your note that Safari can be stricter than Chromium aligns with WebKit's own internal emphasis on timeline contiguity:

* WebKit docs state that MSE algorithms are "very sensitive to small gaps between samples" and describe why rational time representation is important for avoiding rounding drift that creates gaps. citeturn17view0
* A WebKit bug explicitly discusses "small gaps in the media timeline" caused by sloppy timescale math in encoding pipelines, and notes that WebKit's allowable gap threshold had to be increased over time because real content was encoded with more drift than the original tolerance. citeturn19search2
* WebKit source commentary (in `SourceBufferPrivate.cpp`) shows that WebKit avoids enqueuing samples that span a "significant unbuffered gap" and references a ~350ms monitoring cadence as part of that reasoning. citeturn19search20

Taken together, these sources support a design rule for Safari/WebKit success:

**Your fragments must be timestamp-contiguous at the sample level, and you must avoid cumulative timescale rounding error that produces tiny gaps.** citeturn17view0turn19search2turn19search20

Practical mitigations that follow from that:

* Choose a timescale that represents frame durations exactly (or at least consistently), and ensure `tfdt`/`trun` timing is coherent across fragments.
* Ensure fragments begin on random access points (IDR/keyframes) so the decoder can start cleanly after any eviction or seek.
* Avoid switching between "sequence" and "segments" mode unless you fully understand the implications; the default "segments" mode places media according to timestamps, which means drift shows up as gaps rather than being silently papered over. citeturn17view0turn19search21

A useful cautionary datapoint from Chromium's MSE MP4 parsing bug tracker is that missing structural elements like `tfdt` in the `traf` box can be enough to prevent MSE playback. (Chromium's issue notes missing `tfdt` and other metadata problems as causes of failure to play via MSE.) This reinforces that "close enough" MP4 fragments may work in a file but fail in MSE. citeturn18search7turn15search14

### Avoiding unbounded buffer growth and eventual crashes

Long-lived MSE sessions will hit buffering quotas if you only append and never evict.

* Chrome's developer guidance on `QuotaExceededError` explains that appending too much data into a `SourceBuffer` leads to this exception, and that applications should manage buffer size rather than treating it as infinite. citeturn15search23
* MDN documents `SourceBuffer.remove(start, end)` and notes it can only be called when `sourceBuffer.updating` is `false` (otherwise you must abort or wait). citeturn15search11
* The MSE spec and discussions clarify that `remove()` may remove more than the exact byte range you request because decoders require random-access-point dependencies; removal can cascade to preserve decode validity. citeturn15search3turn16search11

A WebKit-friendly buffer management pattern (consistent with the above constraints) is:

* Keep a fixed "back buffer" window (for example 10–30 seconds behind `video.currentTime` for live).
* Periodically (or after each successful append) compute a safe removal end time and call `sourceBuffer.remove(0, removeEnd)` once `updating` is false.
* Prefer removing only on keyframe boundaries if you are tracking them; otherwise, accept that the browser may remove to the next random access point. citeturn15search11turn16search11turn15search23

## idb_companion on Apple Silicon with mixed simulator runtimes

### Maintenance state and what that implies

The `facebook/idb` repository shows its latest release as August 2022. citeturn20search1turn20search7  
Yet open issues as recent as 2025–2026 indicate ongoing breakage on modern macOS and iOS versions (for example "video-stream not working on macOS 26 Tahoe"). citeturn22view0

This combination—**old last release, new platform breakage reports**—strongly suggests you should treat idb as "best-effort community-maintained" rather than a tool that tracks the fast-moving simulator/runtime/toolchain surface area.

### Architecture mismatch on M-series Macs

Two open upstream issues are directly on point:

* Issue #807 reports that idb-companion hard-codes simulator architecture as `x86_64`, blocking arm64 simulator usage on M1 because idb's architecture checks reject arm64 bundles when the target is reported as x86_64. citeturn23view0
* Issue #814 reports idb misrecognising an arm64 simulator as x86_64 and refusing to install an arm64 app bundle, even though `simctl install` works for the same simulator. citeturn23view1

These issues answer two of your research questions fairly directly:

* A single "ARM-native idb_companion binary" is not sufficient on its own if idb's logic reports targets as x86_64 and enforces architecture compatibility against that value—your arm64 simulator workflow will still fail at the idb layer. citeturn23view0turn23view1
* The failure mode is not hypothetical; it is concretely "targets architecture x86_64 not in the bundle's supported architectures (arm64)", which is exactly the kind of breakage you described for "mixed" worlds. citeturn23view0turn23view1

### The simulator runtime reality (why "mixed" exists)

idb's own documentation about Simulator runtimes notes that a simulator runtime includes binaries compiled for the host architecture: x86_64 for Intel Macs and arm64 for ARM-based Macs. citeturn20search12  
That means as soon as your tooling assumes "simulators are x86_64", it is inherently out of step with modern Apple Silicon defaults.

In CI and automation contexts, a common mitigation is to run simulators under Rosetta when you need Intel-only tooling. For example, CircleCI's support guidance says that if your tooling requires Intel architecture, you may need to start the iOS simulator "in Rosetta mode" (their example references a Fastlane option to run the simulator under Rosetta). citeturn20search21

This gives you a practical decision fork:

* If you must use idb as-is and it enforces x86_64 assumptions, you may be pushed toward **Rosetta simulators** as a compatibility mode. citeturn23view0turn20search21
* If you must use modern arm64-only simulator runtimes (typical for current iOS versions), idb's open issues suggest you should expect failures unless you patch/fork. citeturn23view1turn23view0

### Are there maintained forks that fix the Apple Silicon gap

Within the evidence gathered here, the strongest signal is that the upstream issues remain open and show "no branches or pull requests" attached, at least for the two architecture issues. citeturn23view0turn23view1  
I did not find (in the accessible sources) a widely cited, clearly maintained fork that resolves these architecture mis-detection problems while also tracking recent Xcode/simulator releases. Given the continued appearance of "modern macOS version breakage" issues in 2025–2026, you should assume that adopting idb in 2026 will require either:

* carrying a patch set internally (fork), or  
* switching to alternative control planes (`simctl`/CoreSimulator APIs directly, or other automation frameworks) depending on which idb features you need.

### Practical compatibility conclusion for mixed simulator runtimes

Given the above:

*If you have a fleet mixing arm64-native simulators (modern iOS runtimes on Apple Silicon) and x86_64 Rosetta simulators (legacy runtimes or forced-Rosetta mode), current upstream idb behaviour is likely to be inconsistent across that fleet, with arm64 simulators specifically at risk of being reported/treated as x86_64 and then rejected for arm64 app/test installation.* citeturn23view0turn23view1turn20search12
