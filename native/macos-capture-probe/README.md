# macOS ScreenCaptureKit probe

This small command-line target verifies that the running Mac app can enumerate shareable displays through Apple's ScreenCaptureKit. It does not start a capture stream or send screen content over the network.

## Build and run

From the repository root:

```sh
swiftc -parse-as-library -module-cache-path /tmp/multicast-swift-module-cache -framework ScreenCaptureKit -framework Foundation native/macos-capture-probe/main.swift -o /tmp/multicast-capture-probe
/tmp/multicast-capture-probe
```

The first run may require Screen Recording permission. Grant access to the executable in **System Settings → Privacy & Security → Screen Recording**, then run it again. macOS may require restarting the executable after permission changes.

Successful JSON output includes display IDs and dimensions and always reports `captureStarted: false`. An error is emitted as JSON with a suggested permission step.

This probe is a prerequisite check, not the eventual capture implementation. The desktop app should later bundle a signed native helper or implement the ScreenCaptureKit bridge directly, request permission through the normal macOS flow, and encode selected frames for a local WebRTC session.
