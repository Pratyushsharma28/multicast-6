const test = require("node:test");
const assert = require("node:assert/strict");
const { PROTOCOL_VERSION, validateSignalMessage } = require("../mirror-protocol");

test("accepts versioned sender offer, receiver answer, ICE, and stop messages", () => {
  assert.equal(validateSignalMessage({ protocolVersion: PROTOCOL_VERSION, type: "offer", description: { type: "offer", sdp: "v=0" } }, "sender"), null);
  assert.equal(validateSignalMessage({ protocolVersion: PROTOCOL_VERSION, type: "answer", description: { type: "answer", sdp: "v=0" } }, "receiver"), null);
  assert.equal(validateSignalMessage({ protocolVersion: PROTOCOL_VERSION, type: "candidate", candidate: { candidate: "candidate:1" } }, "sender"), null);
  assert.equal(validateSignalMessage({ protocolVersion: PROTOCOL_VERSION, type: "stop" }, "receiver"), null);
});

test("rejects unversioned messages and offers or answers from the wrong role", () => {
  assert.match(validateSignalMessage({ type: "stop" }, "sender"), /version/);
  assert.match(validateSignalMessage({ protocolVersion: 1, type: "answer", description: { type: "answer", sdp: "v=0" } }, "sender"), /cannot send/);
  assert.match(validateSignalMessage({ protocolVersion: 1, type: "offer", description: { type: "offer", sdp: "v=0" } }, "receiver"), /cannot send/);
});

test("rejects malformed and oversized SDP and ICE candidates", () => {
  assert.match(validateSignalMessage({ protocolVersion: 1, type: "offer", description: { type: "answer", sdp: "v=0" } }, "sender"), /Invalid WebRTC offer/);
  assert.match(validateSignalMessage({ protocolVersion: 1, type: "answer", description: { type: "answer", sdp: "x".repeat(75_001) } }, "receiver"), /Invalid WebRTC answer/);
  assert.match(validateSignalMessage({ protocolVersion: 1, type: "candidate", candidate: { candidate: "x".repeat(4097) } }, "sender"), /Invalid ICE candidate/);
});
