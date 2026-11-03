# MultiCast 6 screen mirroring architecture

## Current implementation and evidence

- **Desktop:** React/Vite dashboard plus a Node signaling/discovery backend. Cast Studio can run in a minimal Electron shell on macOS. In that mode, a user explicitly loads and selects a display; a separate Swift helper uses ScreenCaptureKit and passes JPEG frames through Electron IPC to a canvas-backed WebRTC video track. The frame bridge is capped at 15 fps and 1920×1080 per dimension and has JPEG/IPC overhead; it is an initial proof path, not an optimized encoder. Running the Vite page directly in a browser still uses `getDisplayMedia` and is a separate prototype path. Both use a six-digit in-memory pairing code, long-poll signaling, and peer-to-peer WebRTC. ICE has no STUN/TURN, so direct LAN connectivity is required. Neither path has been verified between two physical Macs.
- **Signaling:** version 1 now defines sender offer / ICE / stop and receiver answer / ICE / stop messages. The backend checks role, message shape, SDP/candidate limits, and queue length. Pairing is temporary, in memory, and unauthenticated beyond possession of the code. Do not use on an untrusted network.
- **Android:** `receiver-android/` now includes a phone/TV UI, MediaProjection sender, projection foreground service with an ongoing Stop notification, WebRTC offer/answer/ICE client, and `SurfaceViewRenderer` receiver. It uses the backend's existing HTTP long-poll v1 signaling; this repository does not have a WebSocket service. The APK and unit tests build, but neither direction has been physically verified. Android lifecycle and TV input still require device testing.
- **macOS native:** `native/macos-capture-probe/main.swift` supports explicit display enumeration and capture. ScreenCaptureKit permission is controlled by macOS; the app does not bypass or emulate it. The helper emits JPEG frames to the local Electron process only; it does not write frames to disk or send them through signaling. The bridge carries video only.
- **Windows:** no Windows app or capture path exists. A browser receiver is architecturally feasible because it only needs WebRTC and signaling; it has not been packaged or verified on Windows.

SSDP/DIAL discovery is a separate compatibility probe. It does not identify a mirroring-capable receiver, establish a session, or imply Google Cast support.

## Shared session protocol

Keep control and media separate. A local signaling service creates a short-lived session and relays only JSON setup messages. The selected sender captures and encodes locally; the video/audio tracks travel over WebRTC directly to one receiver. The server must never claim a device is compatible solely because it was discovered.

Protocol v1 envelope and roles:

| Message | Sender | Receiver | Fields |
| --- | --- | --- | --- |
| `offer` | yes | no | `protocolVersion: 1`, WebRTC offer description |
| `answer` | no | yes | `protocolVersion: 1`, WebRTC answer description |
| `candidate` | yes | yes | `protocolVersion: 1`, ICE candidate |
| `stop` | yes | yes | `protocolVersion: 1` |

Keep session IDs/codes short-lived and single-receiver, validate role and message size, cap queues, and stop capture tracks on either side's disconnect. Before product use, add per-session bearer credentials, rate limits, explicit receiver acceptance, expiry cleanup, HTTPS/WSS or a documented trusted-LAN threat model, and structured reconnect/error states. Do not put screen frames in signaling. Negotiate codecs based on actual sender/receiver support; H.264 is a sensible baseline, but must be verified on target hardware.

## Platform-specific paths

### Mac → Android / Android TV

The Android receiver is implemented with the WebRTC Android SDK and `SurfaceViewRenderer`; it joins the Mac sender's session code, applies the offer, exchanges ICE, and tears down on stop/session end. The Mac's native sender remains the existing ScreenCaptureKit-to-WebRTC bridge. Neither direction has yet been verified on physical devices. Android TV text entry, focus navigation, codec, latency, reconnect, sleep/wake and thermals require testing on the specific device; Google TV branding alone is not compatibility evidence.

### Android → Mac

Android has a video-only WebRTC sender based on MediaProjection/`ScreenCapturerAndroid`. It requests Android's system consent each time, starts a `mediaProjection` foreground service with a notification Stop action, creates a pairing session and sends v1 offer/ICE messages. Projection stop/revocation triggers cleanup; Activity orientation changes request a capture-format resize. The Mac receiver is the existing Cast Studio WebRTC view and requires no screen-capture permission. Verify this path on physical Android and Mac devices.

### Mac → Windows

1. Use the Mac ScreenCaptureKit sender above.
2. A Windows browser receiver can use the existing WebRTC receiver view when it can reach the sender's backend and frontend on the LAN. A packaged Electron receiver is an optional later delivery form, not a prerequisite for a browser proof.
3. If Windows capture is added for reverse mirroring, use **Windows.Graphics.Capture** with its system picker/user consent and frame-pool lifecycle, or a documented supported Desktop Duplication API implementation where its constraints fit. Do not promise Windows sender support until implemented and tested.
4. Document firewall prompts and ports, same-network requirements, private-network recommendations, and client/AP isolation. Validate on supported Windows versions and real hardware.

## Implementation sequence and acceptance gates

1. **Shared signaling foundation (this branch):** version the offer/answer/ICE/stop contract and validate messages/queues in the existing backend. Unit tests cover the contract. This is not a complete secure pairing system.
2. **Hardened sessions:** pairing credentials, explicit receiver acceptance, throttling, expiry and cancellation behavior, and clear trusted-LAN/TLS policy.
3. **Mac native sender (capture bridge implemented):** build the Electron shell and Swift helper, grant Screen Recording in macOS Settings, select a display, and validate frame delivery, stop/restart, denial/regrant, and a two-Mac WebRTC session on supported macOS releases. Optimize the JPEG-to-canvas bridge or replace it with a native WebRTC video source before product use.
4. **Android two-way client (implemented, build-tested):** WebRTC sender/receiver, pairing, projection foreground service, preview and stop controls compile and have local signaling-boundary unit tests. Test on an emulator, then physical Android phone/TV and Mac; record model, Android version, codec, resolution, latency, reconnect and sleep/wake behavior.
5. **Physical acceptance (pending):** verify both directions, consent denial/regrant, system projection revocation, orientation change, notification stop, peer disconnect, and repeat sessions on real devices.
6. **Windows receiver:** test browser receive first on physical Windows. Package Electron only if product requirements need it. Add Windows sender only as a separately scoped WGC/Desktop Duplication milestone.
7. **Release claims:** publish a platform/OS/device compatibility matrix only after end-to-end physical tests. Discovery results remain separate from verified playback support.

## Security and permission boundary

The operating system must present capture consent. The user selects the display and can stop at any time. Never work around DRM, protected video surfaces, privacy controls, permission prompts, or platform capture restrictions. This product is screen mirroring, not a mechanism for recording protected content. Local-only signaling does not itself make a session secure; pairing-code secrecy, LAN trust, WebRTC encryption, and network exposure all matter.

## macOS capture bridge development

On a Mac with Swift Command Line Tools installed, run `cd desktop && npm run dev:electron`. The command compiles the helper and starts Vite plus Electron. In Cast Studio, choose **Choose a display** to ask ScreenCaptureKit for the currently shareable displays, select one, then start sharing. If macOS blocks enumeration or capture, enable **MultiCast 6** (or the helper identity shown by macOS) under **System Settings → Privacy & Security → Screen Recording**, then restart the app and refresh the list. The exact identity shown depends on how the Electron app/helper is launched and signed; a signed, packaged application is still needed for a stable release permission identity.

The helper uses a bounded binary record protocol: JPEG frame records and small JSON status records. Electron forwards frames only to its isolated renderer; the renderer draws them to a canvas and captures that canvas as the existing WebRTC track. The helper caps capture at 15 fps and 1920×1080, but JPEG conversion, inter-process copies, and canvas drawing add CPU use and latency. There is no native hardware video encoder in this milestone. Physical testing must confirm macOS TCC attribution/prompt behavior for the distributed app identity, permission denial and recovery, monitor selection, stop/restart cleanup, frame quality/latency, and end-to-end WebRTC on two Macs.
