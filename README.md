# MultiCast 6

## Local network discovery prototype

The backend provides `POST /api/discovery/scan` and `GET /api/devices`. A scan sends SSDP `M-SEARCH` requests for DIAL receivers, UPnP media renderers, and general SSDP responders, then reports only responders that return an SSDP reply with a usable `LOCATION` header. Advertisements with a shared UUID/USN identity become one discovered candidate with all distinct services preserved. Different identities remain separate even at the same IP. If identity is missing, only exact duplicate advertisements are collapsed and the candidate is marked ambiguous. IP address alone is never used to merge devices. API counts distinguish `discoveredCandidates` from `pairedTVs`; pairing is not implemented.

SSDP/DIAL discovery is an initial compatibility probe, not a claim that every Google TV or Android TV will respond or support casting through MultiCast 6. A generic UPnP response is labeled as a UPnP responder; it is not presented as a Google TV. The six-candidate limit applies to displayed discovery results. Candidate identity is discovery evidence, not verified physical-TV identity. Do not pair or cast based on an ambiguous candidate.

### Prerequisites and limitations

- Run the desktop app and backend on a Mac connected to the same local network as the receiver.
- The Wi-Fi access point/router and host firewall must allow multicast SSDP traffic (UDP port 1900 to `239.255.255.250`) and replies between clients. Guest networks, client/AP isolation, VLANs, VPN routing, or multicast filtering can prevent discovery.
- macOS may require granting MultiCast 6/backend local network access and allowing network traffic in the firewall.
- The TV or receiver must be awake and advertise a supported SSDP/DIAL/UPnP service. Google TV branding alone does not make a device discoverable through SSDP.
- This prototype does not use Google Cast mDNS discovery, establish a pairing session, validate receiver capabilities, or verify end-to-end playback. Those require separate protocol work and physical receiver testing.
- An empty scan means no qualifying SSDP replies were observed during the scan window; it does not prove that no compatible TV is present.

Start the backend from `backend/` with `node server.js` and the desktop UI from `desktop/` using its Vite development command. The backend listens on port 3000.

## Android TV receiver scaffold

`receiver-android/` is an early Android TV app shell. Open that folder in Android Studio, allow Gradle sync to finish, then select **Build > Build Bundle(s) / APK(s) > Build APK(s)**. Android Studio needs a compatible JDK and Android SDK Platform 35; Gradle plugin/dependency downloads require internet access on first sync. The debug APK is written to `app/build/outputs/apk/debug/app-debug.apk`.

To try it on a Haier Google TV, enable Developer options and USB debugging (or network debugging if the TV exposes it), connect with Android Debug Bridge, and install the debug APK with `adb install -r app/build/outputs/apk/debug/app-debug.apk`. You can also copy the APK to USB and open it with a file manager; allow installation from that source if Android prompts. Menu wording varies by Haier model and Google TV version. The app should appear as **MultiCast Receiver** in the TV app launcher. Physical installation, launcher behavior, and device compatibility still need testing on the target TV.

The screen shows a locally generated receiver identity and an unpaired state. Pairing and playback are not implemented. The network package is only an interface boundary for future authenticated pairing and media-session commands; it has no transport, routes, credentials, or exposed remote-control endpoint. The manifest requests no network permission. Media3 libraries are included as groundwork, but no player or media session is active.

## Mac-to-Mac local screen mirroring proof of concept

The Cast Studio page now has an early WebRTC screen-sharing flow. Start the backend from `backend/` with `node server.js`; start Vite from `desktop/` with `npm run dev -- --host 0.0.0.0`. On the sending Mac, open `http://localhost:5173`, choose **Cast Studio**, and select a display in the macOS screen-sharing picker. On the receiving Mac on the same Wi-Fi, open `http://<sender-mac-LAN-address>:5173`, choose **Cast Studio**, and enter the six-digit code.

The backend holds pairing and signaling messages in memory for up to ten minutes. WebRTC sends the video directly between the Macs and is configured without public STUN/TURN servers or a cloud account. Both Macs must be able to reach the sender Mac on ports 3000 and 5173. Guest Wi-Fi/client isolation, host firewall rules, VPNs, or router restrictions can block the connection. This is a development proof of concept: it has no encryption beyond browser WebRTC, durable pairing, audio, reconnect, or TV receiver support. Test with trusted devices on a private network.

The sender must use `localhost` so the browser can invoke macOS display capture. A receiver can open the sender's LAN address because it does not request capture permission. The ScreenCaptureKit enumeration probe compiled, but its run did not complete in this environment; display enumeration and the actual two-Mac stream still require manual verification. No Haier TV playback is implemented or tested.
