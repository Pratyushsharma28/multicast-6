# MultiCast 6

## Local network discovery prototype

The backend provides `POST /api/discovery/scan` and `GET /api/devices`. A scan sends SSDP `M-SEARCH` requests for DIAL receivers, UPnP media renderers, and general SSDP responders, then reports only responders that return an SSDP reply with a usable `LOCATION` header. Advertisements with a shared UUID/USN identity become one discovered candidate with all distinct services preserved. Different identities remain separate even at the same IP. If identity is missing, only exact duplicate advertisements are collapsed and the candidate is marked ambiguous. IP address alone is never used to merge devices. API counts distinguish `discoveredCandidates` from `pairedTVs`; pairing is not implemented.

SSDP/DIAL discovery is an initial compatibility probe, not a claim that every Google TV or Android TV will respond or support casting through MultiCast 6. A generic UPnP response is labeled as a UPnP responder; it is not presented as a Google TV. The six-candidate limit applies to displayed discovery results. Candidate identity is discovery evidence, not verified physical-TV identity. Discovery is separate from the Android pairing flow below.

### Prerequisites and limitations

- Run the desktop app and backend on a Mac connected to the same local network as the receiver.
- The Wi-Fi access point/router and host firewall must allow multicast SSDP traffic (UDP port 1900 to `239.255.255.250`) and replies between clients. Guest networks, client/AP isolation, VLANs, VPN routing, or multicast filtering can prevent discovery.
- macOS may require granting MultiCast 6/backend local network access and allowing network traffic in the firewall.
- The TV or receiver must be awake and advertise a supported SSDP/DIAL/UPnP service. Google TV branding alone does not make a device discoverable through SSDP.
- This prototype does not use Google Cast mDNS discovery, establish a pairing session, validate receiver capabilities, or verify end-to-end playback. Those require separate protocol work and physical receiver testing.
- An empty scan means no qualifying SSDP replies were observed during the scan window; it does not prove that no compatible TV is present.

Start the backend from `backend/` with `node server.js` and the desktop UI from `desktop/` using its Vite development command. The backend listens on port 3000.

## Android ↔ Mac mirroring foundation

`receiver-android/` now contains a two-way WebRTC client for Android phones and Android TV devices with a usable input method. It uses Android MediaProjection after explicit system consent to send Android screen video, and it joins the Mac sender's WebRTC session to receive and render Mac video. For sending, Android uses a `mediaProjection` foreground service and a persistent Stop notification/action. Permission revocation, peer disconnect, explicit stop, service shutdown, and orientation changes have cleanup/resize handling in code. Android v1 signaling uses the existing HTTP long-poll API (offer/answer, ICE and stop); this repository does not currently implement WebSocket signaling. Video remains peer-to-peer and is never sent through the backend.

### Build and install Android

Requirements: Android Studio or its bundled Java runtime, Android SDK Platform 35, and internet access for the first Gradle dependency download. From the repository root:

```sh
cd receiver-android
./gradlew testDebugUnitTest assembleDebug assembleDebugAndroidTest
```

The debug APK is `receiver-android/app/build/outputs/apk/debug/app-debug.apk`. Install on a phone with `adb install -r app/build/outputs/apk/debug/app-debug.apk`, or use Android Studio's device/TV deployment tools. The app includes both the phone launcher and Android TV launcher categories. TV usability depends on the device's keyboard/remote and still needs hardware verification.

With a booted emulator or attached Android device, run `./gradlew connectedDebugAndroidTest` to execute the service bind/idle teardown instrumentation check. That check does not grant MediaProjection consent or verify screen pixels.

### Run the Mac services

1. On the Mac, start the signaling backend from `backend/` with `node server.js` (port 3000).
2. Start the desktop Cast Studio from `desktop/` with `npm run dev:electron`. The Mac screen sender requires the Electron app and Screen Recording consent. Android ↔ Mac tests require both devices on the same non-isolated Wi-Fi; allow local connections through the Mac firewall. No cloud, STUN, or TURN service is configured.
3. Find the Mac's LAN IP address. Enter `<Mac-LAN-IP>:3000` in the Android **Mac signaling address** field. Android sends cleartext HTTP only to this manually entered development endpoint; keep the test on a trusted private network. WebRTC encrypts the direct media transport, while the current pairing/signaling service has no session credentials or TLS.

### Test Android → Mac

1. Open Android MultiCast 6, enter the Mac LAN address and tap **Send Screen to Mac**.
2. Grant notification access if prompted, then accept Android's system screen-sharing consent. Capture must not start before this approval. Android shows a six-digit pairing code and an ongoing notification with **Stop sharing**.
3. In Mac Cast Studio, select **Or join from this Mac**, enter the Android code, and join. Expected result: after ICE connects, the Mac preview displays the moving Android screen. Verify both the app Stop button and Android's system screen-sharing control stop capture.
4. Rotate the Android device during capture, then use Android's system screen-sharing chip/notification to revoke projection. Expected result: the stream stops, the app reports the session ended, and the notification is removed. Start another session to confirm the OS requires a fresh consent prompt.

### Test Mac → Android

1. In Mac Cast Studio, explicitly load/select a display and click **Share selected display**; allow Screen Recording access if macOS asks.
2. On Android, enter the same Mac LAN address, type the code shown by Cast Studio, and tap **Receive Screen from Mac**.
3. Expected result: Android status changes to connected/receiving and its preview displays the moving Mac screen. Tap **Stop sharing / disconnect** on Android, then repeat using the Mac Stop button to verify teardown from either side.

The repository has compile/unit-test coverage but these flows have not been verified on a physical Android device and Mac pair. Local ICE only means routers with client isolation, VPNs, separate VLANs, or host firewall rules can prevent direct media. Do not treat a successful APK build or signaling exchange as proof of playback.

## Browser-based Mac-to-Mac local mirroring proof of concept

The Cast Studio page has an early WebRTC screen-sharing flow. Start the backend from `backend/` with `node server.js`. For native ScreenCaptureKit sending on macOS, start the desktop app from `desktop/` with `npm run dev:electron`. In Cast Studio, choose **Choose a display**, grant Screen Recording access in **System Settings → Privacy & Security → Screen Recording** if requested, select a display, and start sharing. On the receiving Mac on the same Wi-Fi, open `http://<sender-mac-LAN-address>:5173` in a browser, choose **Cast Studio**, and enter the six-digit code. To use the older browser capture prototype, run `npm run dev -- --host 0.0.0.0` and open the sender at `http://localhost:5173`; that path uses Chromium `getDisplayMedia`, not ScreenCaptureKit.

The backend holds pairing and signaling messages in memory for up to ten minutes. WebRTC sends the video directly between the Macs and is configured without public STUN/TURN servers or a cloud account. Both Macs must be able to reach the sender Mac on ports 3000 and 5173. Guest Wi-Fi/client isolation, host firewall rules, VPNs, or router restrictions can block the connection. This is a development proof of concept: it has no encryption beyond browser WebRTC, durable pairing, audio, reconnect, or TV receiver support. Test with trusted devices on a private network.

The Electron sender captures only the display selected by the user through ScreenCaptureKit. Its Swift helper encodes frames as JPEG at up to 15 fps and 1920×1080, then Electron passes them to a renderer canvas which supplies the WebRTC video track. This is a straightforward proof bridge with extra CPU, copying, and latency; it is not the final optimized encoder path. The helper compiles on the current Mac, but Screen Recording permission, live frame delivery, and the actual two-Mac stream still require physical verification. A signed, packaged app is needed to establish a stable macOS permission identity for release. No Haier TV playback is implemented or tested.

## Cross-platform mirroring scope and status

The current implementation includes a native macOS sender bridge and an Android two-way WebRTC client, in addition to the browser-based Mac-to-Mac proof of concept above. Android builds, but Android ↔ Mac live playback has not been verified on physical devices. Mac → Windows remains a planned path.

The backend validates a versioned v1 signaling message contract (offer/answer, ICE candidates, and stop) with role checks and bounded message/queue sizes. Transport is HTTP long polling, not WebSocket. This is a small protocol foundation, not end-to-end authentication or a secure pairing release. The Android app now sends and receives WebRTC video in code and builds; physical playback remains unverified. Windows has no dedicated app yet; browser reception is a plausible first step but still requires implementation and physical testing.

Platform work requires native capture consent and receiver support: Android sending uses MediaProjection with explicit system consent and a foreground service; the existing Mac sender uses ScreenCaptureKit. Windows.Graphics.Capture with the system picker remains future work if Windows sending is added. No DRM bypass or capture permission workaround is supported. See [ARCHITECTURE.md](ARCHITECTURE.md) for the protocol, staged requirements, and acceptance gates. Do not describe any cross-platform combination as supported until it is physically verified.

### Verification commands

From the repository root, run the relevant checks:

```sh
cd backend && npm test
cd ../desktop && npm test && npm run lint && npm run build && npm run build:capture
cd ../receiver-android && ./gradlew testDebugUnitTest assembleDebug
```

The Android Gradle build requires Android SDK Platform 35, a compatible Java runtime, and internet access for first-time Gradle/Maven downloads. Physical Android and Mac hardware is required for capture consent, projection revocation, rotation, and both playback directions.
