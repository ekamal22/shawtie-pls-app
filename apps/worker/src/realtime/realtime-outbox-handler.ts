import {
  M2_REALTIME_PROTOCOL_VERSION,
  type M2InternalRealtimeNotification,
} from "@shawtie/contracts";
import type { OutboxEvent } from "@shawtie/db";
import type { RealtimeInvalidationPublisher } from "./realtime-publisher.ts";
import { PermanentWorkerError } from "../runtime/errors.ts";
import type { OutboxHandler } from "../outbox/outbox-handler.ts";

const EVENT_TYPES = [
  "m2.conversation.receipt_changed",
  "m2.conversation.nickname_changed",
  "m2.partnership.changed",
  "m2.relationship.changed",
  "m2.account.security_changed",
] as const;

type RealtimeEventType = (typeof EVENT_TYPES)[number];

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new PermanentWorkerError("INVALID_M2_REALTIME_OUTBOX_PAYLOAD");
  }
  return value as Record<string, unknown>;
}

function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new PermanentWorkerError("INVALID_M2_REALTIME_OUTBOX_PAYLOAD");
  }
  return value;
}

function nonNegative(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new PermanentWorkerError("INVALID_M2_REALTIME_OUTBOX_PAYLOAD");
  }
  return value;
}

function positive(value: unknown): number {
  const number = nonNegative(value);
  if (number === 0) {
    throw new PermanentWorkerError("INVALID_M2_REALTIME_OUTBOX_PAYLOAD");
  }
  return number;
}

function accountIds(value: unknown): [string, string] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new PermanentWorkerError("INVALID_M2_REALTIME_OUTBOX_PAYLOAD");
  }
  const parsed: [string, string] = [uuid(value[0]), uuid(value[1])];
  if (parsed[0] === parsed[1]) {
    throw new PermanentWorkerError("INVALID_M2_REALTIME_OUTBOX_PAYLOAD");
  }
  return parsed.sort() as [string, string];
}

function exactKeys(
  payload: Record<string, unknown>,
  keys: readonly string[],
): void {
  const expected = [...keys].sort();
  const actual = Object.keys(payload).sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new PermanentWorkerError("INVALID_M2_REALTIME_OUTBOX_PAYLOAD");
  }
}

function notification(event: OutboxEvent): M2InternalRealtimeNotification {
  const payload = record(event.payload);

  if (event.eventType === "m2.conversation.receipt_changed") {
    exactKeys(payload, [
      "conversationId",
      "deliveredThrough",
      "readThrough",
    ]);
    const conversationId = uuid(payload.conversationId);
    if (
      event.aggregateType !== "conversation" ||
      event.aggregateId !== conversationId
    ) {
      throw new PermanentWorkerError("INVALID_M2_REALTIME_OUTBOX_PAYLOAD");
    }
    return {
      v: M2_REALTIME_PROTOCOL_VERSION,
      kind: "conversation.receipt_changed",
      scope: { conversationId },
      data: {
        eventId: event.id,
        conversationId,
        deliveredThrough: nonNegative(payload.deliveredThrough),
        readThrough: nonNegative(payload.readThrough),
      },
    };
  }

  if (event.eventType === "m2.conversation.nickname_changed") {
    exactKeys(payload, ["partnershipId", "subjectAccountId", "version"]);
    const partnershipId = uuid(payload.partnershipId);
    if (
      event.aggregateType !== "partnership" ||
      event.aggregateId !== partnershipId
    ) {
      throw new PermanentWorkerError("INVALID_M2_REALTIME_OUTBOX_PAYLOAD");
    }
    return {
      v: M2_REALTIME_PROTOCOL_VERSION,
      kind: "conversation.nickname_changed",
      scope: { partnershipId },
      data: {
        eventId: event.id,
        partnershipId,
        subjectAccountId: uuid(payload.subjectAccountId),
        version: positive(payload.version),
      },
    };
  }

  if (event.eventType === "m2.partnership.changed") {
    exactKeys(payload, [
      "partnershipId",
      "accountIds",
      "generation",
      "metadataVersion",
    ]);
    const partnershipId = uuid(payload.partnershipId);
    const routedAccountIds = accountIds(payload.accountIds);
    if (
      event.aggregateType !== "partnership" ||
      event.aggregateId !== partnershipId
    ) {
      throw new PermanentWorkerError("INVALID_M2_REALTIME_OUTBOX_PAYLOAD");
    }
    return {
      v: M2_REALTIME_PROTOCOL_VERSION,
      kind: "partnership.changed",
      scope: { partnershipId, accountIds: routedAccountIds },
      data: {
        eventId: event.id,
        partnershipId,
        generation: nonNegative(payload.generation),
        metadataVersion: positive(payload.metadataVersion),
      },
    };
  }

  if (event.eventType === "m2.relationship.changed") {
    exactKeys(payload, ["partnershipId", "itemId", "itemVersion"]);
    const partnershipId = uuid(payload.partnershipId);
    if (
      event.aggregateType !== "partnership" ||
      event.aggregateId !== partnershipId
    ) {
      throw new PermanentWorkerError("INVALID_M2_REALTIME_OUTBOX_PAYLOAD");
    }
    return {
      v: M2_REALTIME_PROTOCOL_VERSION,
      kind: "relationship.changed",
      scope: { partnershipId },
      data: {
        eventId: event.id,
        partnershipId,
        itemId: payload.itemId === null ? null : uuid(payload.itemId),
        itemVersion:
          payload.itemVersion === null ? null : positive(payload.itemVersion),
      },
    };
  }

  exactKeys(payload, ["accountId"]);
  const accountId = uuid(payload.accountId);
  if (event.aggregateType !== "account" || event.aggregateId !== accountId) {
    throw new PermanentWorkerError("INVALID_M2_REALTIME_OUTBOX_PAYLOAD");
  }
  return {
    v: M2_REALTIME_PROTOCOL_VERSION,
    kind: "account.security_changed",
    scope: { accountId },
    data: { eventId: event.id },
  };
}

export function createM2RealtimeOutboxHandlers(
  publisher?: RealtimeInvalidationPublisher,
): readonly OutboxHandler[] {
  return EVENT_TYPES.map(
    (eventType: RealtimeEventType): OutboxHandler => ({
      eventType,
      payloadVersion: 1,
      async deliver({ event }) {
        const mapped = notification(event);
        if (publisher) await publisher.publish(mapped);
      },
    }),
  );
}
