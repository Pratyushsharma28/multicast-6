const test = require("node:test");
const assert = require("node:assert/strict");
const { groupAdvertisements, stableIdentity } = require("../discovery");

const response = (protocol, usn, address = "192.168.1.96") => ({
  address,
  headers: {
    st: protocol,
    usn,
    location: "http://192.168.1.96:8008/ssdp/device-desc.xml",
    server: "Android/14 UPnP/1.0 Google TV",
  },
});

test("groups multiple service advertisements by UUID and deduplicates repeated services", () => {
  const uuid = "uuid:abc-123";
  const candidates = groupAdvertisements([
    response("urn:dial-multiscreen-org:service:dial:1", `${uuid}::urn:dial-multiscreen-org:service:dial:1`),
    response("urn:schemas-upnp-org:device:MediaRenderer:1", `${uuid}::urn:schemas-upnp-org:device:MediaRenderer:1`),
    response("urn:dial-multiscreen-org:service:dial:1", `${uuid}::urn:dial-multiscreen-org:service:dial:1`),
  ]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].identity, "uuid:abc-123");
  assert.equal(candidates[0].identityConfidence, "identified");
  assert.equal(candidates[0].services.length, 2);
  assert.equal(candidates[0].protocols.length, 2);
});

test("keeps different UUID identities distinct even when they share an IP", () => {
  const candidates = groupAdvertisements([
    response("urn:dial-multiscreen-org:service:dial:1", "uuid:tv-one::urn:dial-multiscreen-org:service:dial:1"),
    response("urn:dial-multiscreen-org:service:dial:1", "uuid:tv-two::urn:dial-multiscreen-org:service:dial:1"),
  ]);
  assert.equal(candidates.length, 2);
  assert.notEqual(candidates[0].deviceId, candidates[1].deviceId);
});

test("marks missing identities ambiguous and does not merge services by IP", () => {
  const candidates = groupAdvertisements([
    response("urn:dial-multiscreen-org:service:dial:1", ""),
    response("urn:schemas-upnp-org:device:MediaRenderer:1", ""),
    response("urn:dial-multiscreen-org:service:dial:1", ""),
  ]);
  assert.equal(candidates.length, 2);
  assert.ok(candidates.every((candidate) => candidate.identityConfidence === "ambiguous"));
  assert.equal(stableIdentity("uuid:ABC::urn:test"), "uuid:abc");
});
