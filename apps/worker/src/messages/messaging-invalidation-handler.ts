import type { OutboxEvent } from "@shawtie/db";
import { PermanentWorkerError } from "../runtime/errors.ts";
import type { OutboxHandler } from "../outbox/outbox-handler.ts";

const M1_EVENT_TYPES = [
  "message.created",
  "message.updated",
  "message.deleted",
  "message.reaction_changed",
] as const;

type M1EventType = (typeof M1_EVENT_TYPES)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function uuid(value: unknown): value is string {
  return (
    typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function assertContentFreeInvalidation(event: OutboxEvent): void {
  if (event.aggregateType !== "conversation") {
    throw new PermanentWorkerError("INVALID_M1_OUTBOX_PAYLOAD");
  }

  if (!isRecord(event.payload)) {
    throw new PermanentWorkerError("INVALID_M1_OUTBOX_PAYLOAD");
  }

  const allowedKeys = new Set([
    "conversationId",
    "messageId",
    "serverSequence",
    "changeSequence",
    "contentVersion",
  ]);
  for (const key of Object.keys(event.payload)) {
    if (!allowedKeys.has(key)) {
      throw new PermanentWorkerError("INVALID_M1_OUTBOX_PAYLOAD");
    }
  }

  const conversationId = event.payload.conversationId;
  const messageId = event.payload.messageId;
  const changeSequence = event.payload.changeSequence;
  const contentVersion = event.payload.contentVersion;
  const serverSequence = event.payload.serverSequence;

  if (
    !uuid(conversationId)
    || !uuid(messageId)
    || conversationId !== event.aggregateId
    || !positiveSafeInteger(changeSequence)
    || !(
      contentVersion === null
      || positiveSafeInteger(contentVersion)
    )
  ) {
    throw new PermanentWorkerError("INVALID_M1_OUTBOX_PAYLOAD");
  }

  if (event.eventType === "message.created") {
    if (!positiveSafeInteger(serverSequence)) {
      throw new PermanentWorkerError("INVALID_M1_OUTBOX_PAYLOAD");
    }
  } else if (serverSequence !== undefined) {
    throw new PermanentWorkerError("INVALID_M1_OUTBOX_PAYLOAD");
  }
}

export function createMessagingInvalidationHandler(eventType: M1EventType): OutboxHandler {
  return {
    eventType,
    payloadVersion: 1,
    async deliver({ event }): Promise<void> {
      assertContentFreeInvalidation(event);
    },
  };
}

export function createM1MessagingInvalidationHandlers(): readonly OutboxHandler[] {
  return M1_EVENT_TYPES.map((eventType) => createMessagingInvalidationHandler(eventType));
}
