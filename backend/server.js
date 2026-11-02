const dgram = require("node:dgram");
const { randomInt } = require("node:crypto");
const express = require("express");
const cors = require("cors");
const { parseHeaders, groupAdvertisements } = require("./discovery");

const app = express();
app.use(cors());
app.use(express.json());

// Short-lived in-memory signaling sessions. Screen media travels peer-to-peer
// over WebRTC; these queues carry only session setup messages.
const mirrorSessions = new Map();
const SESSION_TTL_MS = 10 * 60 * 1000;

function makePairingCode() {
  return String(randomInt(100000, 1000000));
}

function getMirrorSession(code) {
  const session = mirrorSessions.get(code);
  if (!session || session.expiresAt < Date.now()) {
    mirrorSessions.delete(code);
    return null;
  }
  return session;
}

app.post("/api/mirror/sessions", (req, res) => {
  let code;
  do { code = makePairingCode(); } while (mirrorSessions.has(code));
  mirrorSessions.set(code, { expiresAt: Date.now() + SESSION_TTL_MS, joined: false, sender: [], receiver: [] });
  res.status(201).json({ success: true, code, expiresInSeconds: SESSION_TTL_MS / 1000 });
});

app.post("/api/mirror/sessions/:code/join", (req, res) => {
  const session = getMirrorSession(req.params.code);
  if (!session) return res.status(404).json({ success: false, error: "Pairing code expired or not found." });
  if (session.joined) return res.status(409).json({ success: false, error: "A receiver already joined this code." });
  session.joined = true;
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  res.json({ success: true });
});

app.get("/api/mirror/sessions/:code/messages", (req, res) => {
  const session = getMirrorSession(req.params.code);
  const role = req.query.role;
  if (!session) return res.status(404).json({ success: false, error: "Pairing code expired or session stopped." });
  if (role !== "sender" && role !== "receiver") return res.status(400).json({ success: false, error: "Invalid session role." });
  const messages = session[role].splice(0, 50);
  res.json({ success: true, joined: session.joined, messages });
});

app.post("/api/mirror/sessions/:code/messages", (req, res) => {
  const session = getMirrorSession(req.params.code);
  const role = req.query.role;
  if (!session) return res.status(404).json({ success: false, error: "Pairing code expired or session stopped." });
  if (role !== "sender" && role !== "receiver") return res.status(400).json({ success: false, error: "Invalid session role." });
  if (role === "receiver" && !session.joined) return res.status(409).json({ success: false, error: "Join the session before signaling." });
  if (!req.body || typeof req.body !== "object" || JSON.stringify(req.body).length > 100_000) {
    return res.status(400).json({ success: false, error: "Invalid signaling message." });
  }
  const recipient = role === "sender" ? "receiver" : "sender";
  session[recipient].push(req.body);
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  res.status(202).json({ success: true });
});

app.delete("/api/mirror/sessions/:code", (req, res) => {
  mirrorSessions.delete(req.params.code);
  res.json({ success: true });
});

const MAX_TVS = 6;
const PORT = Number(process.env.PORT || 3000);
const SSDP_ADDRESS = "239.255.255.250";
const SSDP_PORT = 1900;
const SCAN_DURATION_MS = 3500;
const SEARCH_TARGETS = [
  "urn:dial-multiscreen-org:service:dial:1",
  "urn:schemas-upnp-org:device:MediaRenderer:1",
  "ssdp:all",
];

let discoveredTVs = [];
let lastScan = { status: "never_scanned", startedAt: null, completedAt: null, error: null };
let activeScan = null;

function scanNetwork() {
  if (activeScan) return activeScan;

  const startedAt = new Date().toISOString();
  lastScan = { status: "scanning", startedAt, completedAt: null, error: null };

  activeScan = new Promise((resolve) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const advertisements = [];
    let finished = false;
    const timer = setTimeout(finish, SCAN_DURATION_MS);

    function finish(error = null) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.close(() => {
        discoveredTVs = groupAdvertisements(advertisements).slice(0, MAX_TVS).map((device, index) => ({
          ...device,
          slot: index + 1,
        }));
        lastScan = {
          status: error ? "error" : "complete",
          startedAt,
          completedAt: new Date().toISOString(),
          error: error ? "SSDP scan could not complete. Check local network and multicast permissions." : null,
        };
        activeScan = null;
        resolve(lastScan);
      });
    }

    socket.on("error", (error) => finish(error));
    socket.on("message", (message, remote) => {
      const headers = parseHeaders(message);
      const target = headers.st || headers.nt || "";
      const location = headers.location || "";
      if (!target || !location || !/^https?:\/\//i.test(location)) return;
      advertisements.push({ headers, address: remote.address, discoveredAt: new Date().toISOString() });
    });

    socket.bind(() => {
      try {
        socket.setBroadcast(true);
        for (const target of SEARCH_TARGETS) {
          const request = Buffer.from(
            `M-SEARCH * HTTP/1.1\r\nHOST: ${SSDP_ADDRESS}:${SSDP_PORT}\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${target}\r\n\r\n`,
          );
          socket.send(request, SSDP_PORT, SSDP_ADDRESS);
        }
      } catch (error) {
        finish(error);
      }
    });
  });

  return activeScan;
}

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "MultiCast 6 backend is running",
    discoveredCandidates: discoveredTVs.length,
    pairedTVs: 0,
    maximumTVs: MAX_TVS,
    discovery: lastScan,
  });
});

app.get("/api/devices", (req, res) => {
  res.json({
    success: true,
    maximumTVs: MAX_TVS,
    discoveredCandidates: discoveredTVs.length,
    pairedTVs: 0,
    devices: discoveredTVs,
    discovery: lastScan,
  });
});

app.post("/api/discovery/scan", async (req, res) => {
  const result = await scanNetwork();
  res.status(result.status === "error" ? 503 : 200).json({
    success: result.status === "complete",
    discovery: result,
    maximumTVs: MAX_TVS,
    discoveredCandidates: discoveredTVs.length,
    pairedTVs: 0,
    devices: discoveredTVs,
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`MultiCast 6 backend running on port ${PORT}`);
});
