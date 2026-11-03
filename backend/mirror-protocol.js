const PROTOCOL_VERSION = 1;
const MAX_MESSAGE_BYTES = 100_000;
const MAX_QUEUE_LENGTH = 100;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateSignalMessage(message, role) {
  if (!isRecord(message) || message.protocolVersion !== PROTOCOL_VERSION) {
    return "Unsupported or missing signaling protocol version.";
  }

  if (message.type === "stop") return null;

  if (message.type === "candidate") {
    const candidate = message.candidate;
    if (!isRecord(candidate) || typeof candidate.candidate !== "string" || candidate.candidate.length > 4096) {
      return "Invalid ICE candidate.";
    }
    if (candidate.sdpMid !== null && candidate.sdpMid !== undefined && typeof candidate.sdpMid !== "string") {
      return "Invalid ICE media identifier.";
    }
    if (candidate.sdpMLineIndex !== null && candidate.sdpMLineIndex !== undefined && !Number.isInteger(candidate.sdpMLineIndex)) {
      return "Invalid ICE media line index.";
    }
    return null;
  }

  const expectedType = role === "sender" ? "offer" : "answer";
  if (message.type !== expectedType) return `The ${role} cannot send this signaling message.`;
  if (!isRecord(message.description) || message.description.type !== expectedType ||
      typeof message.description.sdp !== "string" || message.description.sdp.length > 75_000) {
    return `Invalid WebRTC ${expectedType}.`;
  }
  return null;
}

module.exports = { PROTOCOL_VERSION, MAX_MESSAGE_BYTES, MAX_QUEUE_LENGTH, validateSignalMessage };
