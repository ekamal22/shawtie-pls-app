import assert from "node:assert/strict";
import test from "node:test";
import {
  C1_REALTIME_SUBPROTOCOL,
  C1_SIGNALING_SUBPROTOCOL,
  c1PushPayloadSchema,
  c1RealtimeServerFrameSchema,
  c1SignalClientFrameSchema,
  callCreateSchema,
  callProjectionSchema,
  m2RealtimeServerFrameSchema,
} from "../src/index.ts";

test("C1 call contracts keep voice creation strict and projections privacy-safe", () => {
  assert.equal(C1_SIGNALING_SUBPROTOCOL, "shawtie.call.v1");
  assert.equal(C1_REALTIME_SUBPROTOCOL, "shawtie.realtime.v2");
  assert.equal(
    callCreateSchema.parse({
      expectedPartnershipId: "10000000-0000-4000-8000-000000000001",
      kind: "voice",
    }).kind,
    "voice",
  );

  const projection = callProjectionSchema.parse({
    id: "20000000-0000-4000-8000-000000000001",
    partnershipId: "10000000-0000-4000-8000-000000000001",
    kind: "voice",
    direction: "incoming",
    state: "ringing",
    version: 1,
    initiatedAt: "2026-09-24T00:00:00.000Z",
    ringExpiresAt: "2026-09-24T00:01:00.000Z",
    acceptedAt: null,
    connectedAt: null,
    endedAt: null,
    outcome: null,
    isThisDeviceSelectedEndpoint: false,
  });
  assert.equal("terminalReason" in projection, false);
});

test("C1 realtime v2 accepts call.changed without changing M2 v1 schema", () => {
  const frame = {
    v: 1,
    type: "call.changed",
    payload: {
      eventId: "30000000-0000-4000-8000-000000000001",
      callId: "20000000-0000-4000-8000-000000000001",
      version: 2,
    },
  };
  assert.equal(c1RealtimeServerFrameSchema.safeParse(frame).success, true);
  assert.equal(m2RealtimeServerFrameSchema.safeParse(frame).success, false);
});

test("C1 signaling frames are strict and push payload is generic", () => {
  const offer = c1SignalClientFrameSchema.safeParse({
    v: 1,
    type: "signal.description",
    generation: 1,
    payload: { descriptionType: "offer", sdp: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n" },
  });
  assert.equal(offer.success, true);

  assert.equal(
    c1PushPayloadSchema.safeParse({ v: 1, type: "call_state_changed" }).success,
    true,
  );
  assert.equal(
    c1PushPayloadSchema.safeParse({
      v: 1,
      type: "call_state_changed",
      callerName: "private",
    }).success,
    false,
  );
});
