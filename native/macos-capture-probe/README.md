# macOS ScreenCaptureKit helper

This Swift command-line helper has two modes. `--list-displays` asks ScreenCaptureKit for displays currently available to the user. `--capture DISPLAY_ID` captures only the selected display and writes JPEG frame records to stdout. It does not save frames or send network messages.

## Build and use from the desktop app

From `desktop/`, run:

```sh
npm run build:capture
npm run dev:electron
```

The second command rebuilds the helper and starts Vite plus Electron. In Cast Studio, use **Choose a display**, select one of the returned displays, and start sharing. macOS controls Screen Recording permission. If the display list or capture fails, allow MultiCast 6 or the helper identity shown by macOS in **System Settings → Privacy & Security → Screen Recording**, restart the app, and refresh the display list. The responsible permission identity depends on signing and launch method; use a signed app bundle for a stable release identity.

## Standalone compile

```sh
swiftc -O -parse-as-library -module-cache-path /tmp/multicast-swift-module-cache \
  -framework ScreenCaptureKit -framework CoreImage -framework ImageIO \
  -framework UniformTypeIdentifiers -framework Foundation \
  native/macos-capture-probe/main.swift -o /tmp/multicast-capture
```

Run `/tmp/multicast-capture --list-displays` to inspect displays accessible under the current Screen Recording authorization. Starting `--capture DISPLAY_ID` continuously writes binary records; run it only when you intend to share that selected display, and stop it with EOF on stdin or by terminating the process.

The stdout wire format is a one-byte type (`1` for JPEG frame, `2` for JSON status), a four-byte big-endian payload length, and that many payload bytes. Stderr is reserved for diagnostics. Capture is capped at 15 fps and 1920×1080 per dimension. Frames are JPEG-compressed in the helper and decoded into the Electron renderer canvas, which supplies the WebRTC video track. This is a functional starting point with extra CPU, copies, and latency; it is not the final optimized encoder path. Verify permission attribution, selected-display output, stop/restart, and the full two-Mac session on physical hardware.

## Capture diagnostics and physical Mac check

In Cast Studio, **Choose a display** is an explicit action that checks whether the helper can list displays; simply opening the app does not check or request Screen Recording access. Select a display, then click **Share selected display** to explicitly start capture. The Native Capture Check panel reports helper/capture errors, the number of JPEG frames delivered to the renderer, and their recent rolling frame rate. These counters confirm delivery to the renderer; they do not by themselves confirm that the remote WebRTC peer rendered video.

To verify on a Mac:

1. From `desktop/`, run `npm run dev:electron` and open **Cast Studio**.
2. Before selecting a display, confirm the panel says **Not checked** and no permission prompt appears.
3. Click **Choose a display**. If macOS prompts for Screen Recording, allow the app identity named in the dialog. If it does not prompt and no display is listed, open **System Settings → Privacy & Security → Screen Recording**, enable the identity shown by macOS, fully quit MultiCast 6, reopen it, and click **Refresh displays**.
4. Select the intended display and click **Share selected display**. Move a window on that display. Expected result: the panel changes to **Receiving native frames**, the frame count increases, and FPS becomes nonzero (normally up to 15). The sender status shows a pairing code.
5. On a second Mac, open the sender Mac’s LAN address on port 5173 and join with the code. Expected result: the receiving Mac shows moving video. This is the end-to-end WebRTC check; the local frame counters alone do not prove it.
6. Click **Stop sharing / disconnect**. Expected result: the code/session closes and the selected display is no longer captured. Repeat the start/stop cycle to check restart behavior.
7. For denial handling, disable the app identity in Screen Recording settings, quit/reopen, then choose a display/start capture. Expected result: an actionable permission error appears, no frames arrive, and re-enabling permission followed by a full app restart allows a retry.

Permission prompt behavior and which app identity macOS attributes access to depend on the launch/signing setup. Record the identity shown on the physical Mac; a successful compile or a nonzero counter from a synthetic test is not evidence that ScreenCaptureKit ran successfully.
