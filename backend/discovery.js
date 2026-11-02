const crypto = require("node:crypto");

function parseHeaders(message) {
  const headers = {};
  for (const line of message.toString("utf8").split(/\r?\n/).slice(1)) {
    const separator = line.indexOf(":");
    if (separator > 0) {
      headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
    }
  }
  return headers;
}

function stableIdentity(usn) {
  if (!usn) return null;
  const match = usn.match(/(?:^|:)uuid:([^:]+)(?::|$)/i);
  if (match) return `uuid:${match[1].toLowerCase()}`;
  return usn.includes("::") ? usn.split("::", 1)[0].toLowerCase() : usn.toLowerCase();
}

function describeReceiver(headers) {
  const target = headers.st || headers.nt || "";
  const identity = `${target} ${headers.server || ""} ${headers.usn || ""}`.toLowerCase();
  const isDial = identity.includes("dial-multiscreen-org:service:dial");
  const isCast = identity.includes("googlecast") || identity.includes("chromecast");
  return {
    type: isCast ? "google_cast_ssdp" : isDial ? "dial_receiver" : "upnp_device",
    label: isCast ? "Google Cast compatible responder" : isDial ? "DIAL receiver" : "UPnP responder",
  };
}

function groupAdvertisements(advertisements) {
  const candidates = new Map();
  for (const ad of advertisements) {
    const headers = ad.headers || {};
    const protocol = headers.st || headers.nt || "";
    const usn = headers.usn || "";
    const stableId = stableIdentity(usn);
    const location = headers.location || "";
    const receiver = describeReceiver(headers);
    // Without a stable identity, only collapse exact duplicate advertisements. Never group by IP.
    const candidateKey = stableId ? `identity:${stableId}` : `ambiguous:${ad.address}|${protocol.toLowerCase()}|${location.toLowerCase()}|${usn.toLowerCase()}`;
    let candidate = candidates.get(candidateKey);
    if (!candidate) {
      const deviceId = crypto.createHash("sha256").update(candidateKey).digest("hex").slice(0, 16);
      candidate = {
        deviceId,
        name: headers.server || receiver.label,
        type: receiver.type,
        source: "ssdp",
        address: ad.address,
        identity: stableId,
        identityConfidence: stableId ? "identified" : "ambiguous",
        status: "discovered",
        paired: false,
        discoveredAt: ad.discoveredAt || new Date().toISOString(),
        services: [],
      };
      candidates.set(candidateKey, candidate);
    }
    const serviceKey = `${protocol.toLowerCase()}|${usn.toLowerCase()}`;
    if (!candidate.services.some((service) => service.key === serviceKey)) {
      candidate.services.push({
        key: serviceKey,
        protocol,
        type: receiver.type,
        location,
        usn: usn || null,
      });
    }
    if (candidate.address !== ad.address) candidate.identityConfidence = "ambiguous";
  }
  return Array.from(candidates.values()).map((candidate) => ({
    ...candidate,
    protocols: [...new Set(candidate.services.map((service) => service.protocol))],
    services: candidate.services.map(({ key, ...service }) => service),
  }));
}

module.exports = { parseHeaders, stableIdentity, groupAdvertisements };
