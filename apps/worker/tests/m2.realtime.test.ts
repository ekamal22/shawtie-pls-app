import assert from "node:assert/strict";
import test from "node:test";
import type { M2InternalRealtimeNotification } from "@shawtie/contracts";
import type { OutboxEvent } from "@shawtie/db";
import { createMessagingInvalidationHandler } from "../src/messages/messaging-invalidation-handler.ts";
import { createM2RealtimeOutboxHandlers } from "../src/realtime/realtime-outbox-handler.ts";
import type { RealtimeInvalidationPublisher } from "../src/realtime/realtime-publisher.ts";

const CONVERSATION = "10000000-0000-4000-8000-000000000001";
const MESSAGE = "20000000-0000-4000-8000-000000000001";
const EVENT = "30000000-0000-4000-8000-000000000001";

function event(payload: unknown): OutboxEvent {
  return {
    id: EVENT,
    eventType: "message.created",
    aggregateType: "conversation",
    aggregateId: CONVERSATION,
    deduplicationKey: "m2-test",
    payload,
    payloadVersion: 1,
    status: "processing",
    attemptCount: 1,
    maxAttempts: 12,
    availableAt: new Date(),
    claimedAt: new Date(),
    claimedBy: "test",
    leaseExpiresAt: new Date(Date.now() + 60_000),
    claimVersion: 1n,
    lastErrorCode: null,
  };
}

test("M2 worker publishes validated M1 invalidation without message content", async () => {
  const published: M2InternalRealtimeNotification[] = [];
  const publisher: RealtimeInvalidationPublisher = {
    async publish(notification) {
      published.push(notification);
    },
  };
  const handler = createMessagingInvalidationHandler("message.created", publisher);
  await handler.deliver({
    event: event({
      conversationId: CONVERSATION,
      messageId: MESSAGE,
      serverSequence: 1,
      changeSequence: 1,
      contentVersion: 1,
    }),
    signal: new AbortController().signal,
    async renewLease() {
      return true;
    },
  });

  assert.equal(published.length, 1);
  assert.deepEqual(published[0], {
    v: 1,
    kind: "message.changed",
    scope: { conversationId: CONVERSATION },
    data: {
      eventId: EVENT,
      conversationId: CONVERSATION,
      messageId: MESSAGE,
      mutation: "created",
      serverSequence: 1,
      changeSequence: 1,
      contentVersion: 1,
    },
  });
});

test("M2 worker rejects private fields before realtime publication", async () => {
  let published = false;
  const publisher: RealtimeInvalidationPublisher = {
    async publish() {
      published = true;
    },
  };
  const handler = createMessagingInvalidationHandler("message.created", publisher);

  await assert.rejects(
    () =>
      handler.deliver({
        event: event({
          conversationId: CONVERSATION,
          messageId: MESSAGE,
          serverSequence: 1,
          changeSequence: 1,
          contentVersion: 1,
          body: "private",
        }),
        signal: new AbortController().signal,
        async renewLease() {
          return true;
        },
      }),
    /INVALID_M1_OUTBOX_PAYLOAD/,
  );
  assert.equal(published, false);
});

function genericEvent(input: {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
}): OutboxEvent {
  return {
    id: EVENT,
    eventType: input.eventType,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    deduplicationKey: "m2-generic-test",
    payload: input.payload,
    payloadVersion: 1,
    status: "processing",
    attemptCount: 1,
    maxAttempts: 12,
    availableAt: new Date(),
    claimedAt: new Date(),
    claimedBy: "test",
    leaseExpiresAt: new Date(Date.now() + 60_000),
    claimVersion: 1n,
    lastErrorCode: null,
  };
}

test("M2 generic relationship invalidation stays content-free", async () => {
  const PARTNERSHIP = "40000000-0000-4000-8000-000000000001";
  const ITEM = "50000000-0000-4000-8000-000000000001";
  const published: M2InternalRealtimeNotification[] = [];
  const publisher: RealtimeInvalidationPublisher = {
    async publish(notification) {
      published.push(notification);
    },
  };
  const handler = createM2RealtimeOutboxHandlers(publisher).find(
    (candidate) => candidate.eventType === "m2.relationship.changed",
  );
  assert.ok(handler);

  await handler.deliver({
    event: genericEvent({
      eventType: "m2.relationship.changed",
      aggregateType: "partnership",
      aggregateId: PARTNERSHIP,
      payload: {
        partnershipId: PARTNERSHIP,
        itemId: ITEM,
        itemVersion: 4,
      },
    }),
    signal: new AbortController().signal,
    async renewLease() {
      return true;
    },
  });

  assert.deepEqual(published, [
    {
      v: 1,
      kind: "relationship.changed",
      scope: { partnershipId: PARTNERSHIP },
      data: {
        eventId: EVENT,
        partnershipId: PARTNERSHIP,
        itemId: ITEM,
        itemVersion: 4,
      },
    },
  ]);
});

test("M2 partnership invalidation forwards distinct account routing IDs", async () => {
  const PARTNERSHIP = "40000000-0000-4000-8000-000000000001";
  const ACCOUNT_A = "60000000-0000-4000-8000-000000000001";
  const ACCOUNT_B = "60000000-0000-4000-8000-000000000002";
  const published: M2InternalRealtimeNotification[] = [];
  const publisher: RealtimeInvalidationPublisher = {
    async publish(notification) {
      published.push(notification);
    },
  };
  const handler = createM2RealtimeOutboxHandlers(publisher).find(
    (candidate) => candidate.eventType === "m2.partnership.changed",
  );
  assert.ok(handler);

  await handler.deliver({
    event: genericEvent({
      eventType: "m2.partnership.changed",
      aggregateType: "partnership",
      aggregateId: PARTNERSHIP,
      payload: {
        partnershipId: PARTNERSHIP,
        accountIds: [ACCOUNT_B, ACCOUNT_A],
        generation: 1,
        metadataVersion: 1,
      },
    }),
    signal: new AbortController().signal,
    async renewLease() {
      return true;
    },
  });

  assert.deepEqual(published, [
    {
      v: 1,
      kind: "partnership.changed",
      scope: {
        partnershipId: PARTNERSHIP,
        accountIds: [ACCOUNT_A, ACCOUNT_B],
      },
      data: {
        eventId: EVENT,
        partnershipId: PARTNERSHIP,
        generation: 1,
        metadataVersion: 1,
      },
    },
  ]);
});

test("M2 generic realtime handler rejects extra private fields", async () => {
  const PARTNERSHIP = "40000000-0000-4000-8000-000000000001";
  let published = false;
  const publisher: RealtimeInvalidationPublisher = {
    async publish() {
      published = true;
    },
  };
  const handler = createM2RealtimeOutboxHandlers(publisher).find(
    (candidate) => candidate.eventType === "m2.partnership.changed",
  );
  assert.ok(handler);

  await assert.rejects(
    () =>
      handler.deliver({
        event: genericEvent({
          eventType: "m2.partnership.changed",
          aggregateType: "partnership",
          aggregateId: PARTNERSHIP,
          payload: {
            partnershipId: PARTNERSHIP,
            accountIds: [
              "60000000-0000-4000-8000-000000000001",
              "60000000-0000-4000-8000-000000000002",
            ],
            generation: 2,
            metadataVersion: 1,
            privateNote: "must not leave PostgreSQL",
          },
        }),
        signal: new AbortController().signal,
        async renewLease() {
          return true;
        },
      }),
    /INVALID_M2_REALTIME_OUTBOX_PAYLOAD/,
  );
  assert.equal(published, false);
});
