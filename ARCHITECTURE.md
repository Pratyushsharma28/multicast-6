# MultiCast 6 screen mirroring architecture

## Current state

- The React/Vite desktop UI and Node backend provide SSDP/DIAL discovery and an early Mac-to-Mac WebRTC proof of concept.
- Discovery candidates are not paired devices. SSDP/DIAL does not establish mirroring support.
- The Android TV project is a launcher scaffold with Media3 dependencies; it has no receiver network service, player, or pairing flow.
- Mac-to-Mac capture and streaming are implemented as a local proof of concept but have not been verified between two physical Macs. Mac-to-TV streaming is not implemented.

## Recommended local-network design

Use WebRTC for screen media and a small local signaling service for session setup. Keep signaling and media on the LAN; do not require a paid cloud relay or account. Start with direct host candidates on the same Wi-Fi. A STUN/TURN service should not be assumed available; supporting clients on isolated subnets would require an independently hosted relay and is outside the initial scope.

Capture Mac displays with ScreenCaptureKit after macOS Screen Recording permission is granted. Keep capture selection and permission in a native macOS component, and encode frames as H.264 for broad hardware decoder support. Electron's renderer can handle WebRTC session setup and display a received stream in a dedicated receiver window. Use short-lived pairing codes and explicit accept/stop controls before opening a receiver session.

For a Haier Google TV, the dependable product path is a MultiCast receiver app installed on the TV, with a native WebRTC video decoder/rendering surface and a narrowly scoped local-network signaling/media service. The existing Media3 scaffold does not provide screen-stream reception. A Google Cast sender/receiver integration is a separate option for media playback, but Google Cast is not a general Mac desktop mirroring transport and generic SSDP/DIAL replies do not establish compatibility. Do not advertise built-in Haier compatibility until the exact TV model has passed end-to-end testing.

## Milestones

1. **Capture prerequisite (implemented here):** compile and run the ScreenCaptureKit probe; confirm permission and enumerate available displays without starting capture.
2. **Mac-to-Mac local proof (prototype added):** the dashboard has a six-digit pairing flow, short-lived local signaling queues, display capture, and a WebRTC receiver view. Verify on two Macs on the same Wi-Fi, including permission denial and stop/reconnect behavior; move signaling into a hardened service and add a dedicated Electron receiver window before treating it as a product feature.
3. **Android receiver proof:** add authenticated local pairing and WebRTC receive/render support to the Android app; prove reception on an Android emulator or compatible Android device before TV claims.
4. **Haier validation:** install on the target Haier Google TV, verify decoder performance, orientation, sleep/reconnect, Wi-Fi isolation behavior, and document supported model/OS combinations.
5. **Discovery and polish:** add mDNS receiver discovery and connect it to the existing SSDP candidates without conflating discovery with verified playback capability.

## Acceptance boundary

The probe only tests compilation and shareable-display enumeration after the user grants permission. The new browser proof of concept requires real Mac-to-Mac testing; local builds or API checks do not demonstrate live screen capture or physical-TV compatibility.
