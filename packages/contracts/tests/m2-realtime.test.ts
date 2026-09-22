import assert from "node:assert/strict";
import test from "node:test";
import {
  M2_CLIENT_COMPATIBILITY_VERSION,
  M2_CLIENT_PROTOCOL_HEADER,
  M2_INTERNAL_NOTIFY_MAX_BYTES,
  M2_LOCAL_SCHEMA_HEADER,
  M2_LOCAL_SCHEMA_VERSION,
  M2_PRE_S1_CONTENT_CONTEXT,
  M2_REALTIME_MAX_FRAME_BYTES,
  M2_REALTIME_PROTOCOL_VERSION,
  M2_REALTIME_SUBPROTOCOL,
  assertM2RealtimeFrameSize,
  m2InternalRealtimeNotificationSchema,
  m2RealtimeClientFrameSchema,
  m2RealtimeServerFrameSchema,
  safeParseAtBoundary,
} from "../src/index.ts";

const ACCOUNT = "10000000-0000-4000-8000-000000000001";
const PARTNERSHIP = "20000000-0000-4000-8000-000000000001";
const CONVERSATION = "30000000-0000-4000-8000-000000000001";
const MESSAGE = "40000000-0000-4000-8000-000000000001";
const EVENT = "50000000-0000-4000-8000-000000000001";
const CONNECTION = "60000000-0000-4000-8000-000000000001";

test("M2 protocol and local-schema constants are frozen at v1", () => {
  assert.equal(M2_REALTIME_PROTOCOL_VERSION, 1);
  assert.equal(M2_CLIENT_COMPATIBILITY_VERSION, 1);
  assert.equal(
    M2_CLIENT_PROTOCOL_HEADER,
    "x-shawtie-client-protocol-version",
  );
  assert.equal(M2_LOCAL_SCHEMA_HEADER, "x-shawtie-local-schema-version");
  assert.equal(M2_REALTIME_SUBPROTOCOL, "shawtie.realtime.v1");
  assert.equal(M2_REALTIME_MAX_FRAME_BYTES, 4096);
  assert.equal(M2_INTERNAL_NOTIFY_MAX_BYTES, 2048);
  assert.equal(M2_LOCAL_SCHEMA_VERSION, 1);
  assert.equal(M2_PRE_S1_CONTENT_CONTEXT, "pre-s1");
});

test("M2 ready frame is strict and content-free", () => {
  const ready = {
    v: 1,
    type: "control.ready",
    payload: {
      connectionId: CONNECTION,
      serverTime: "2026-09-22T12:00:00.000Z",
      accountId: ACCOUNT,
      partnershipId: PARTNERSHIP,
      conversationId: CONVERSATION,
      partnershipGeneration: 7,
      latestServerSequence: 12,
      latestChangeSequence: 18,
    },
  };
  assert.equal(safeParseAtBoundary(m2RealtimeServerFrameSchema, ready).success, true);
  assert.equal(
    safeParseAtBoundary(m2RealtimeServerFrameSchema, {
      ...ready,
      payload: { ...ready.payload, body: "private" },
    }).success,
    false,
  );
});

test("M2 message changed requires server sequence only for creation", () => {
  const created = {
    v: 1,
    type: "message.changed",
    payload: {
      eventId: EVENT,
      conversationId: CONVERSATION,
      messageId: MESSAGE,
      mutation: "created",
      changeSequence: 2,
      serverSequence: 1,
      contentVersion: 1,
    },
  };
  assert.equal(safeParseAtBoundary(m2RealtimeServerFrameSchema, created).success, true);
  assert.equal(
    safeParseAtBoundary(m2RealtimeServerFrameSchema, {
      ...created,
      payload: { ...created.payload, serverSequence: undefined },
    }).success,
    false,
  );

  const updated = {
    v: 1,
    type: "message.changed",
    payload: {
      eventId: EVENT,
      conversationId: CONVERSATION,
      messageId: MESSAGE,
      mutation: "updated",
      changeSequence: 3,
      contentVersion: 2,
    },
  };
  assert.equal(safeParseAtBoundary(m2RealtimeServerFrameSchema, updated).success, true);
  assert.equal(
    safeParseAtBoundary(m2RealtimeServerFrameSchema, {
      ...updated,
      payload: { ...updated.payload, serverSequence: 1 },
    }).success,
    false,
  );
});

test("M2 client protocol exposes only transient commands", () => {
  assert.equal(
    safeParseAtBoundary(m2RealtimeClientFrameSchema, {
      v: 1,
      type: "typing.set",
      payload: { typing: true },
    }).success,
    true,
  );
  assert.equal(
    safeParseAtBoundary(m2RealtimeClientFrameSchema, {
      v: 1,
      type: "message.send",
      payload: { body: "nope" },
    }).success,
    false,
  );
  assert.equal(
    safeParseAtBoundary(m2RealtimeClientFrameSchema, {
      v: 2,
      type: "presence.heartbeat",
      payload: {},
    }).success,
    false,
  );
});

test("M2 internal notification requires routing metadata without protected content", () => {
  const notification = {
    v: 1,
    kind: "message.changed",
    scope: { conversationId: CONVERSATION },
    data: {
      eventId: EVENT,
      conversationId: CONVERSATION,
      messageId: MESSAGE,
      mutation: "reaction_changed",
      changeSequence: 10,
      contentVersion: 3,
    },
  };
  assert.equal(safeParseAtBoundary(m2InternalRealtimeNotificationSchema, notification).success, true);
  assert.equal(
    safeParseAtBoundary(m2InternalRealtimeNotificationSchema, {
      ...notification,
      data: { ...notification.data, emoji: "❤️" },
    }).success,
    false,
  );
});

test("M2 internal partnership invalidation carries only distinct account routing IDs", () => {
  const notification = {
    v: 1,
    kind: "partnership.changed",
    scope: {
      partnershipId: PARTNERSHIP,
      accountIds: [
        ACCOUNT,
        "10000000-0000-4000-8000-000000000002",
      ],
    },
    data: {
      eventId: EVENT,
      partnershipId: PARTNERSHIP,
      generation: 1,
      metadataVersion: 1,
    },
  };
  assert.equal(
    safeParseAtBoundary(m2InternalRealtimeNotificationSchema, notification).success,
    true,
  );
  assert.equal(
    safeParseAtBoundary(m2InternalRealtimeNotificationSchema, {
      ...notification,
      scope: { partnershipId: PARTNERSHIP, accountIds: [ACCOUNT, ACCOUNT] },
    }).success,
    false,
  );
});

test("M2 frame ceiling rejects oversized serialized frames", () => {
  assert.doesNotThrow(() =>
    assertM2RealtimeFrameSize({
      v: 1,
      type: "typing.set",
      payload: { typing: true },
    }),
  );
  assert.throws(
    () => assertM2RealtimeFrameSize({ payload: "x".repeat(M2_REALTIME_MAX_FRAME_BYTES) }),
    /M2_REALTIME_FRAME_TOO_LARGE/,
  );
});
