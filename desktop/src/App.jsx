
import { useEffect, useRef, useState } from "react";
import "./App.css";

const apiBase = `http://${window.location.hostname || "localhost"}:3000`;

const menuItems = [
  { name: "Dashboard", icon: "⌂" },
  { name: "Devices", icon: "▣" },
  { name: "Media Library", icon: "▤" },
  { name: "Cast Studio", icon: "▷" },
  { name: "Broadcast", icon: "◉" },
  { name: "Settings", icon: "⚙" },
];

function App() {
  const [activePage, setActivePage] = useState("Dashboard");
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
          `${apiBase}/api/health`
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
      const response = await fetch(`${apiBase}/api/discovery/scan`, {
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
        const response = await fetch(`${apiBase}/api/devices`);
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

        {activePage === "Dashboard" ? (
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
  const [codeInput, setCodeInput] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("Choose a role to start a local Mac-to-Mac test.");
  const [busy, setBusy] = useState(false);
  const [remoteStream, setRemoteStream] = useState(null);
  const videoRef = useRef(null);
  const sessionRef = useRef(null);
  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const stoppedRef = useRef(false);

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
    setRemoteStream(null);
    if (removeSession && sessionRef.current?.code) {
      await fetch(`${apiBase}/api/mirror/sessions/${sessionRef.current.code}`, { method: "DELETE" }).catch(() => {});
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
  }, []);

  const sendSignal = async (message) => {
    const current = sessionRef.current;
    if (!current) return;
    await fetch(`${apiBase}/api/mirror/sessions/${current.code}/messages?role=${current.role}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(message),
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
        const response = await fetch(`${apiBase}/api/mirror/sessions/${session.code}/messages?role=${role}`);
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
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Screen sharing is unavailable. Open this page on the sending Mac at http://localhost:5173.");
      const response = await fetch(`${apiBase}/api/mirror/sessions`, { method: "POST" });
      const session = await response.json();
      if (!response.ok) throw new Error(session.error || "Could not create a pairing code.");
      sessionRef.current = { code: session.code, role: "sender" }; setCode(session.code);
      setStatus("Choose the screen to share in the macOS picker.");
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      localStreamRef.current = stream;
      stream.getVideoTracks()[0].addEventListener("ended", () => stop());
      const peer = setupPeer();
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      const offer = await peer.createOffer(); await peer.setLocalDescription(offer);
      await sendSignal({ type: "offer", description: peer.localDescription });
      startPolling(sessionRef.current, peer, "sender");
      setStatus("Waiting for the other Mac to join. Keep this window open.");
    } catch (error) {
      setStatus(error.message || "Could not start screen sharing.");
      await stop();
    } finally { setBusy(false); }
  };

  const joinReceiver = async (event) => {
    event.preventDefault(); setBusy(true); setMode("receiver"); stoppedRef.current = false;
    const cleanCode = codeInput.replace(/\D/g, "").slice(0, 6);
    try {
      const response = await fetch(`${apiBase}/api/mirror/sessions/${cleanCode}/join`, { method: "POST" });
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
    <span className="eyebrow">LOCAL WEBRTC PROOF OF CONCEPT</span>
    <h2>Mac to Mac screen mirroring</h2>
    <p className="cast-intro">Video goes directly between Macs on your Wi-Fi. The local backend only passes a temporary pairing code and connection setup messages.</p>
    <div className="cast-panel">
      {remoteStream ? <video className="mirror-video" ref={videoRef} autoPlay playsInline /> : <div className="mirror-placeholder">◉<span>{mode === "receiver" ? "Waiting for a screen" : "Your shared screen will appear on the other Mac"}</span></div>}
      <p className="mirror-status">{status}</p>
      {code && <div className="pair-code"><span>PAIRING CODE</span><strong>{code}</strong><small>Expires after 10 minutes. Share only with the Mac you want to connect.</small></div>}
      {!code ? <div className="cast-actions"><button className="discover-button" disabled={busy} onClick={startSender}>{busy ? "Starting…" : "Share this Mac’s screen"}</button><form onSubmit={joinReceiver}><label htmlFor="pair-code-input">Or join from this Mac</label><div><input id="pair-code-input" value={codeInput} onChange={(event) => setCodeInput(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="6-digit code" maxLength={6} /><button className="discover-button" disabled={busy || codeInput.length !== 6}>Join</button></div></form></div> : <button className="stop-button" onClick={async () => { if (sessionRef.current) { await sendSignal({ type: "stop" }); await new Promise((resolve) => setTimeout(resolve, 500)); } await stop(); setStatus("Session stopped."); }}>Stop sharing / disconnect</button>}
    </div>
    <p className="cast-help">On the sending Mac, open the dashboard at <code>http://localhost:5173</code> and allow screen sharing in the macOS picker. On the receiving Mac, open the sender’s LAN address on port 5173 and enter the code. Start the backend and Vite dashboard on the sending Mac with both listening on the local network.</p>
  </section>;
}

function Dashboard({ deviceData, devicesLoading, devicesError, scanLoading, scanError, onScan }) {
  const devices = deviceData?.devices ?? [];
  const discovery = deviceData?.discovery;

  return (
    <div className="dashboard">
      <section className="welcome">
        <div>
          <span className="eyebrow">YOUR BROADCASTING STATION</span>
          <h2>All your screens.<br />One control center.</h2>
          <p>Manage and broadcast content across up to six displays.</p>
        </div>
        <div className="welcome-graphic">M6</div>
      </section>

      <section className="stats">
        <Stat label="TOTAL SCREENS" value="06" detail="Maximum capacity" />
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
          {scanLoading ? <><span className="scan-spinner" /> Scanning local network…</> : "◉  Scan for TVs"}
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
