
import { useEffect, useRef, useState } from "react";
import { createFrameDiagnostics, describeCaptureError } from "../electron/capture-diagnostics.js";
import "./App.css";

const defaultApiBase = `http://${window.location.hostname || "localhost"}:3000`;
const getApiBase = () => localStorage.getItem("multicast-signaling-server") || defaultApiBase;

const menuItems = [
  { name: "Overview", icon: "⌂" },
  { name: "Cast Studio", icon: "▷" },
  { name: "Devices", icon: "▣" },
  { name: "Activity", icon: "◷" },
  { name: "Settings", icon: "⚙" },
];

function App() {
  const [activePage, setActivePage] = useState("Overview");
  const [backendOnline, setBackendOnline] = useState(false);
  const [deviceData, setDeviceData] = useState(null);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [devicesError, setDevicesError] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState("");

  // Check backend connection
  useEffect(() => {
    const checkBackend = async () => {
      try {
        const response = await fetch(
          `${getApiBase()}/api/health`
        );

        const data = await response.json();
        setBackendOnline(data.success);
      } catch {
        setBackendOnline(false);
      }
    };

    checkBackend();

    const interval = setInterval(checkBackend, 5000);

    return () => clearInterval(interval);
  }, []);

  const scanForDevices = async () => {
    setScanLoading(true);
    setScanError("");
    try {
      const response = await fetch(`${getApiBase()}/api/discovery/scan`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.devices)) {
        throw new Error(data.discovery?.error || "The local network scan could not complete.");
      }
      setDeviceData(data);
      setDevicesError(false);
    } catch (error) {
      setScanError(error.message || "The local network scan could not complete.");
    } finally {
      setScanLoading(false);
    }
  };

  useEffect(() => {
    let active = true;

    const fetchDevices = async () => {
      try {
        const response = await fetch(`${getApiBase()}/api/devices`);
        if (!response.ok) throw new Error("Devices request failed");

        const data = await response.json();
        if (!data.success || !Array.isArray(data.devices)) {
          throw new Error("Invalid devices response");
        }

        if (active) {
          setDeviceData(data);
          setDevicesError(false);
          setDevicesLoading(false);
        }
      } catch {
        if (active) {
          setDevicesError(true);
          setDevicesLoading(false);
        }
      }
    };

    fetchDevices();
    const interval = setInterval(fetchDevices, 3000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">M6</div>
          <div>
            <h2>MultiCast 6</h2>
            <span>CONTROL CENTER</span>
          </div>
        </div>

        <div className="menu-label">WORKSPACE</div>

        <nav>
          {menuItems.map((item) => (
            <button
              key={item.name}
              className={
                activePage === item.name ? "nav-item active" : "nav-item"
              }
              onClick={() => setActivePage(item.name)}
            >
              <span>{item.icon}</span>
              {item.name}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="connection-box">
            <div className={backendOnline ? "status-dot online" : "status-dot"} />
            <div>
              <strong>Backend</strong>
              <p>{backendOnline ? "System online" : "Disconnected"}</p>
            </div>
          </div>
          <p className="version">MultiCast 6 · Version 1.0.0</p>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="breadcrumb">WORKSPACE / {activePage.toUpperCase()}</p>
            <h1>{activePage}</h1>
          </div>

          <div className="top-right">
            <span className="local-badge">LOCAL NETWORK</span>
            <div className="avatar">M6</div>
          </div>
        </header>

        {activePage === "Overview" ? (
          <Dashboard
            deviceData={deviceData}
            devicesLoading={devicesLoading}
            devicesError={devicesError}
            scanLoading={scanLoading}
            scanError={scanError}
            onScan={scanForDevices}
          />
        ) : activePage === "Cast Studio" ? (
          <CastStudio />
        ) : (
          <section className="placeholder">
            <div className="placeholder-icon">◈</div>
            <h2>{activePage}</h2>
            <p>This module is part of the MultiCast 6 development roadmap.</p>
            <span>Coming in upcoming development phases</span>
          </section>
        )}
      </main>
    </div>
  );
}

function CastStudio() {
  const [mode, setMode] = useState("sender");
  const [serverAddress, setServerAddress] = useState(getApiBase());
  const [serverDraft, setServerDraft] = useState(getApiBase());
  const [codeInput, setCodeInput] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("Choose a role to start a local Mac-to-Mac test.");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [remoteStream, setRemoteStream] = useState(null);
  const [nativeDisplays, setNativeDisplays] = useState([]);
  const [selectedDisplay, setSelectedDisplay] = useState("");
  const [nativeDisplayError, setNativeDisplayError] = useState("");
  const [loadingDisplays, setLoadingDisplays] = useState(false);
  const [captureDiagnostics, setCaptureDiagnostics] = useState({ state: "Not checked", count: 0, fps: 0, error: "" });
  const frameDiagnosticsRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const sessionRef = useRef(null);
  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const removeFrameListenerRef = useRef(null);
  const removeStatusListenerRef = useRef(null);
  const stoppedRef = useRef(false);

  const saveServerAddress = () => {
    const raw = serverDraft.trim().replace(/\/$/, "");
    const normalized = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    try {
      const parsed = new URL(normalized);
      if (!parsed.hostname || parsed.pathname !== "/") throw new Error("Enter a server host and optional port only.");
      localStorage.setItem("multicast-signaling-server", normalized);
      setServerAddress(normalized);
      setServerDraft(normalized);
      setStatus(`Signaling server set to ${normalized}.`);
    } catch (error) { setStatus(error.message || "Enter a valid signaling server address."); }
  };

  useEffect(() => {
    if (videoRef.current && remoteStream) videoRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  const stop = async (removeSession = true) => {
    stoppedRef.current = true;
    if (sessionRef.current) clearInterval(sessionRef.current.poller);
    peerRef.current?.close();
    peerRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    removeFrameListenerRef.current?.();
    removeFrameListenerRef.current = null;
    removeStatusListenerRef.current?.();
    removeStatusListenerRef.current = null;
    await window.captureBridge?.stop().catch(() => {});
    setRemoteStream(null);
    if (removeSession && sessionRef.current?.code) {
      await fetch(`${getApiBase()}/api/mirror/sessions/${sessionRef.current.code}`, { method: "DELETE" }).catch(() => {});
    }
    sessionRef.current = null;
    setCode("");
    setBusy(false);
  };

  useEffect(() => () => {
    stoppedRef.current = true;
    if (sessionRef.current) clearInterval(sessionRef.current.poller);
    peerRef.current?.close();
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    removeFrameListenerRef.current?.();
    removeStatusListenerRef.current?.();
    window.captureBridge?.stop().catch(() => {});
  }, []);

  const loadNativeDisplays = async () => {
    if (!window.captureBridge) return;
    setLoadingDisplays(true);
    setNativeDisplayError("");
    setCaptureDiagnostics({ state: "Checking helper and Screen Recording access…", count: 0, fps: 0, error: "" });
    try {
      const displays = await window.captureBridge.listDisplays();
      setNativeDisplays(displays);
      setCaptureDiagnostics({ state: `Ready · ${displays.length} display${displays.length === 1 ? "" : "s"} available`, count: 0, fps: 0, error: "" });
      if (displays.length) setSelectedDisplay(String(displays[0].id));
      else {
        const message = "macOS did not return any shareable displays. Check Screen Recording access, then refresh displays.";
        setNativeDisplayError(message);
        setCaptureDiagnostics({ state: "No displays available", count: 0, fps: 0, error: message });
      }
    } catch (error) {
      const message = describeCaptureError(error);
      setNativeDisplayError(message);
      setCaptureDiagnostics({ state: "Could not check capture", count: 0, fps: 0, error: message });
    } finally {
      setLoadingDisplays(false);
    }
  };

  const sendSignal = async (message) => {
    const current = sessionRef.current;
    if (!current) return;
    await fetch(`${getApiBase()}/api/mirror/sessions/${current.code}/messages?role=${current.role}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ protocolVersion: 1, ...message }),
    });
  };

  const setupPeer = () => {
    const peer = new RTCPeerConnection({ iceServers: [] });
    peer.pendingCandidates = [];
    peerRef.current = peer;
    peer.onicecandidate = ({ candidate }) => { if (candidate) sendSignal({ type: "candidate", candidate }); };
    peer.ontrack = ({ streams }) => setRemoteStream(streams[0]);
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "connected") setStatus("Connected directly over the local network.");
      if (peer.connectionState === "failed") setStatus("Direct connection failed. Check that both Macs are on the same Wi-Fi and client isolation is off.");
      if (peer.connectionState === "disconnected") setStatus("Connection interrupted. Reconnect or stop the session.");
    };
    return peer;
  };

  const startPolling = (session, peer, role) => {
    let polling = false;
    const poll = async () => {
      if (polling || stoppedRef.current) return;
      polling = true;
      try {
        const response = await fetch(`${getApiBase()}/api/mirror/sessions/${session.code}/messages?role=${role}`);
        if (!response.ok) throw new Error("The session expired or was stopped.");
        const data = await response.json();
        if (role === "sender" && data.joined) setStatus("Receiver joined. Starting direct video connection…");
        for (const message of data.messages) {
          if (message.type === "offer" && role === "receiver") {
            await peer.setRemoteDescription(message.description);
            for (const candidate of peer.pendingCandidates.splice(0)) await peer.addIceCandidate(candidate);
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            await sendSignal({ type: "answer", description: peer.localDescription });
          } else if (message.type === "answer" && role === "sender") {
            await peer.setRemoteDescription(message.description);
          } else if (message.type === "candidate" && message.candidate) {
            if (peer.remoteDescription) await peer.addIceCandidate(message.candidate);
            else peer.pendingCandidates.push(message.candidate);
          } else if (message.type === "stop") {
            setStatus("The other Mac stopped the session.");
            await stop(false);
          }
        }
      } catch (error) {
        setStatus(error.message || "Signaling connection was lost.");
        clearInterval(session.poller);
        setBusy(false);
      } finally { polling = false; }
    };
    session.poller = setInterval(poll, 350);
    poll();
  };

  const startSender = async () => {
    setBusy(true); setMode("sender"); stoppedRef.current = false;
    try {
      const response = await fetch(`${getApiBase()}/api/mirror/sessions`, { method: "POST" });
      const session = await response.json();
      if (!response.ok) throw new Error(session.error || "Could not create a pairing code.");
      sessionRef.current = { code: session.code, role: "sender" }; setCode(session.code);
      let stream;
      if (window.captureBridge) {
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d", { alpha: false });
        if (!canvas || !context) throw new Error("The native capture preview surface is unavailable.");
        canvas.width = 1280;
        canvas.height = 720;
        stream = canvas.captureStream(15);
        localStreamRef.current = stream;
        frameDiagnosticsRef.current = createFrameDiagnostics();
        setCaptureDiagnostics({ state: "Starting native helper…", count: 0, fps: 0, error: "" });
        removeFrameListenerRef.current = window.captureBridge.onFrame(async (bytes) => {
          const stats = frameDiagnosticsRef.current?.record();
          if (stats) setCaptureDiagnostics((previous) => ({ ...previous, state: "Receiving native frames", ...stats, error: "" }));
          try {
            const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
            if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
              canvas.width = bitmap.width;
              canvas.height = bitmap.height;
            }
            context.drawImage(bitmap, 0, 0);
            bitmap.close();
          } catch (error) {
            console.error("Could not render a ScreenCaptureKit frame", error);
          }
        });
        removeStatusListenerRef.current = window.captureBridge.onStatus((captureStatus) => {
          if (captureStatus.type === "error") {
            const message = describeCaptureError(captureStatus.message || "ScreenCaptureKit stopped.");
            setStatus(message);
            setCaptureDiagnostics((previous) => ({ ...previous, state: "Capture error", error: message }));
            stop();
          } else if (captureStatus.type === "started") {
            setCaptureDiagnostics((previous) => ({ ...previous, state: "Capture started · waiting for first frame" }));
          } else if (captureStatus.type === "stopped") {
            setCaptureDiagnostics((previous) => ({ ...previous, state: "Capture stopped" }));
          }
        });
        await window.captureBridge.start(Number(selectedDisplay));
        setCaptureDiagnostics((previous) => ({ ...previous, state: "Capture started · waiting for first frame" }));
      } else {
        if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Screen sharing is unavailable. Run the MultiCast desktop app on the sending Mac.");
        setStatus("Choose the screen to share in the macOS picker.");
        stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      }
      localStreamRef.current = stream;
      stream.getVideoTracks()[0].addEventListener("ended", () => stop());
      const peer = setupPeer();
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      const offer = await peer.createOffer(); await peer.setLocalDescription(offer);
      await sendSignal({ type: "offer", description: peer.localDescription });
      startPolling(sessionRef.current, peer, "sender");
      setStatus("Waiting for the other Mac to join. Keep this window open.");
    } catch (error) {
      const message = window.captureBridge ? describeCaptureError(error) : (error.message || "Could not start screen sharing.");
      setStatus(message);
      if (window.captureBridge) setCaptureDiagnostics((previous) => ({ ...previous, state: "Capture failed", error: message }));
      await stop();
    } finally { setBusy(false); }
  };

  const joinReceiver = async (event) => {
    event.preventDefault(); setBusy(true); setMode("receiver"); stoppedRef.current = false;
    const cleanCode = codeInput.replace(/\D/g, "").slice(0, 6);
    try {
      const response = await fetch(`${getApiBase()}/api/mirror/sessions/${cleanCode}/join`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not join this session.");
      sessionRef.current = { code: cleanCode, role: "receiver" }; setCode(cleanCode);
      const peer = setupPeer();
      startPolling(sessionRef.current, peer, "receiver");
      setStatus("Joining. Waiting for the sender’s video…");
    } catch (error) { setStatus(error.message || "Could not join the session."); await stop(false); }
    finally { setBusy(false); }
  };

  return <section className="cast-studio">
    <span className="eyebrow">WEBRTC SCREEN SHARING</span>
    <h2>Mac to Mac screen mirroring</h2>
    <p className="cast-intro">Video goes directly between Macs on your Wi-Fi. The local backend only passes a temporary pairing code and connection setup messages.</p>
    <div className="cast-panel">
      <canvas ref={canvasRef} className="native-capture-canvas" aria-hidden="true" />
      {remoteStream ? <video className="mirror-video" ref={videoRef} autoPlay playsInline /> : <div className="mirror-placeholder">◉<span>{mode === "receiver" ? "Waiting for a screen" : "Your shared screen will appear on the other Mac"}</span></div>}
      <p className="mirror-status">{status}</p>
      {window.captureBridge && <section className="capture-diagnostics" aria-live="polite">
        <div><span className="eyebrow">NATIVE CAPTURE CHECK</span><strong>{captureDiagnostics.state}</strong></div>
        <div className="capture-metrics"><span><strong>{captureDiagnostics.count}</strong> frames received</span><span><strong>{captureDiagnostics.fps.toFixed(1)}</strong> FPS</span><span>Display <strong>{selectedDisplay || "—"}</strong></span></div>
        <p className={captureDiagnostics.error ? "error" : ""}>{captureDiagnostics.error || "Permission is checked only when you choose a display or start sharing. No screen is captured until you start sharing."}</p>
      </section>}
      {code && <div className="pair-code"><div className="pair-code-heading"><span>PAIRING CODE</span><button type="button" className="copy-button" onClick={() => { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1800); }}>{copied ? "Copied" : "Copy code"}</button></div><strong>{code}</strong><small>Expires after 10 minutes. Share only with the Mac you want to connect.</small></div>}
      <div className="server-address"><label htmlFor="signaling-server">Signaling server</label><div><input id="signaling-server" value={serverDraft} onChange={(event) => setServerDraft(event.target.value)} placeholder="192.168.1.20:3000" disabled={Boolean(code)} /><button type="button" className="discover-button" onClick={saveServerAddress} disabled={Boolean(code) || serverDraft.trim() === serverAddress}>{code ? "In use" : "Save"}</button></div><small>Set this to the sender Mac’s reachable server address on both Macs.</small></div>
      {!code ? <div className="cast-actions">{window.captureBridge && <div className="native-display-picker"><button className="discover-button" disabled={busy || loadingDisplays} onClick={loadNativeDisplays}>{loadingDisplays ? "Checking permission…" : nativeDisplays.length ? "Refresh displays" : "Choose a display"}</button>{nativeDisplays.length > 0 && <><label htmlFor="native-display-select">ScreenCaptureKit display</label><select id="native-display-select" value={selectedDisplay} onChange={(event) => setSelectedDisplay(event.target.value)}>{nativeDisplays.map((display) => <option key={display.id} value={display.id}>Display {display.id} · {display.width} × {display.height}</option>)}</select><button className="discover-button" disabled={busy || !selectedDisplay} onClick={startSender}>{busy ? "Starting…" : "Share selected display"}</button></>}{nativeDisplayError && <p className="device-message error">{nativeDisplayError}</p>}</div>}{!window.captureBridge && <button className="discover-button" disabled={busy} onClick={startSender}>{busy ? "Starting…" : "Share this Mac’s screen"}</button>}<form onSubmit={joinReceiver}><label htmlFor="pair-code-input">Or join from this Mac</label><div><input id="pair-code-input" value={codeInput} onChange={(event) => setCodeInput(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="6-digit code" maxLength={6} /><button className="discover-button" disabled={busy || codeInput.length !== 6}>Join</button></div></form></div> : <button className="stop-button" onClick={async () => { if (sessionRef.current) { await sendSignal({ type: "stop" }); await new Promise((resolve) => setTimeout(resolve, 500)); } await stop(); setStatus("Session stopped."); }}>Stop sharing / disconnect</button>}
    </div>
    <p className="cast-help">{window.captureBridge ? <>In the desktop app, choose a display and allow <strong>Screen Recording</strong> in macOS Privacy &amp; Security settings if needed. On the receiving Mac, open the sender’s LAN address on port 5173 and enter the code.</> : <>The browser sender uses macOS’s system screen-sharing picker. Open the sender at <code>http://localhost:5173</code>; on the receiving Mac, open the sender’s LAN address on port 5173 and enter the code.</>} Start the backend and desktop dashboard on the sending Mac with both listening on the local network.</p>
  </section>;
}

function Dashboard({ deviceData, devicesLoading, devicesError, scanLoading, scanError, onScan }) {
  const devices = deviceData?.devices ?? [];
  const discovery = deviceData?.discovery;

  return (
    <div className="dashboard">
      <section className="welcome">
        <div>
          <span className="eyebrow">MULTICAST 6 · CONTROL CENTER</span>
          <h2>Every screen.<br /><em>In perfect sync.</em></h2>
          <p>Discover, connect, and mirror your local displays from one calm workspace.</p>
        </div>
        <div className="welcome-graphic">M6</div>
      </section>

      <section className="stats">
        <Stat label="SCREEN SLOTS" value="06" detail="Maximum capacity" />
        <Stat
          label="DISCOVERED CANDIDATES"
          value={String(deviceData?.discoveredCandidates ?? devices.length).padStart(2, "0")}
          detail="Grouped receiver identities"
        />
        <Stat label="PAIRED TVs" value={String(deviceData?.pairedTVs ?? 0).padStart(2, "0")} detail="Not paired yet" />
        <Stat label="ACTIVE STREAMS" value="00" detail="No active sessions" />
        <Stat label="SYSTEM STATUS" value="READY" detail="Backend monitoring" />
      </section>

      <section className="section-heading">
        <div>
          <span className="eyebrow">DEVICE MANAGEMENT</span>
          <h2>Your screens</h2>
          <p>Find receiver candidates from SSDP advertisements on your local network.</p>
        </div>
        <button className="discover-button" onClick={onScan} disabled={scanLoading || devicesLoading}>
          {scanLoading ? <><span className="scan-spinner" /> Scanning network…</> : "Scan network"}
        </button>
      </section>

      <p className="discovery-note">
        SSDP / DIAL discovery groups services only when a stable device identity is advertised. Ambiguous responders stay separate; shared IP addresses alone do not establish one device.
      </p>

      {scanError && <p className="device-message error scan-error">{scanError} Check that multicast is allowed on this network.</p>}
      {discovery?.completedAt && !scanError && (
        <p className="scan-meta">Last scan: {new Date(discovery.completedAt).toLocaleTimeString()} · {discovery.status === "complete" ? `${devices.length} candidate${devices.length === 1 ? "" : "s"} found` : "scan failed"}</p>
      )}

      <section className="device-grid">
        {devicesLoading && <p className="device-message">Loading screens…</p>}
        {devicesError && (
          <p className="device-message error">
            Unable to refresh screens. Showing the latest available data.
          </p>
        )}
        {!devicesLoading && !devicesError && devices.length === 0 && (
          <p className="device-message">No receivers have been discovered yet. Scan your local network to look for SSDP / DIAL responders.</p>
        )}
        {devices.map((device) => (
          <div className="device-card" key={device.deviceId}>
            <div className="device-top">
              <span className="device-number">{device.source.toUpperCase()} · {device.address}</span>
              <span className="offline-tag discovered">
                DISCOVERED
              </span>
            </div>

            <div className="tv-illustration">
              <div className="tv-screen">
                <span>M6</span>
              </div>
              <div className="tv-stand" />
            </div>

            <h3>{device.name}</h3>
            {device.identityConfidence === "ambiguous" && <p className="device-status">Identity is unclear. This may be another service or device; it is not grouped by IP.</p>}
            <p className="device-status">{device.type.replaceAll("_", " ")} · {device.services?.length ?? 0} service{device.services?.length === 1 ? "" : "s"}</p>
            <ul className="service-list">
              {(device.services ?? []).map((service, index) => <li key={`${service.protocol}-${index}`}>{service.protocol}</li>)}
            </ul>

            <button className="connect-button" disabled>
              Discovery only · not paired
            </button>
          </div>
        ))}
      </section>

      <footer>
        <span>MultiCast 6</span>
        <span>Built for six screens · Local first</span>
      </footer>
    </div>
  );
}

function Stat({ label, value, detail }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <h2>{value}</h2>
      <p>{detail}</p>
    </div>
  );
}

export default App;
