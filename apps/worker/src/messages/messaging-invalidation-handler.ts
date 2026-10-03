import {
  M2_REALTIME_PROTOCOL_VERSION,
  type M2InternalRealtimeNotification,
} from "@shawtie/contracts";
import {
  loadConversationParticipants,
  loadMessageProjection,
  loadNotificationPreferences,
  type DatabasePool,
  type OutboxEvent,
} from "@shawtie/db";
import type { RealtimeInvalidationPublisher } from "../realtime/realtime-publisher.ts";
import { PermanentWorkerError } from "../runtime/errors.ts";
import type { OutboxHandler } from "../outbox/outbox-handler.ts";
import { deliverAccountPush } from "../notifications/generic-push-handler.ts";
import type { WebPushConfig } from "../calls/web-push.ts";

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
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function assertContentFreeInvalidation(event: OutboxEvent): asserts event is OutboxEvent & {
  payload: Record<string, unknown>;
} {
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
    if (!allowedKeys.has(key)) throw new PermanentWorkerError("INVALID_M1_OUTBOX_PAYLOAD");
  }

  const { conversationId, messageId, changeSequence, contentVersion, serverSequence } =
    event.payload;
  if (
    !uuid(conversationId) ||
    !uuid(messageId) ||
    conversationId !== event.aggregateId ||
    !positiveSafeInteger(changeSequence) ||
    !(contentVersion === null || positiveSafeInteger(contentVersion))
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

function toNotification(
  event: OutboxEvent & { payload: Record<string, unknown> },
): M2InternalRealtimeNotification {
  const conversationId = String(event.payload.conversationId);
  const base = {
    eventId: event.id,
    conversationId,
    messageId: String(event.payload.messageId),
    changeSequence: Number(event.payload.changeSequence),
    contentVersion:
      event.payload.contentVersion === null ? null : Number(event.payload.contentVersion),
  };

  if (event.eventType === "message.created") {
    return {
      v: M2_REALTIME_PROTOCOL_VERSION,
      kind: "message.changed",
      scope: { conversationId },
      data: {
        ...base,
        mutation: "created",
        serverSequence: Number(event.payload.serverSequence),
        contentVersion: Number(event.payload.contentVersion),
      },
    };
  }

  const mutation =
    event.eventType === "message.updated"
      ? "updated"
      : event.eventType === "message.deleted"
        ? "deleted"
        : "reaction_changed";

  return {
    v: M2_REALTIME_PROTOCOL_VERSION,
    kind: "message.changed",
    scope: { conversationId },
    data: { ...base, mutation },
  };
}

export function createMessagingInvalidationHandler(
  eventType: M1EventType,
  publisher?: RealtimeInvalidationPublisher,
  database?: DatabasePool,
  pushConfig: WebPushConfig | null = null,
): OutboxHandler {
  return {
    eventType,
    payloadVersion: 1,
    async deliver({ event, signal }): Promise<void> {
      assertContentFreeInvalidation(event);
      if (publisher) await publisher.publish(toNotification(event));

      if (event.eventType !== "message.created" || !database || !pushConfig) return;
      const conversationId = String(event.payload.conversationId);
      const messageId = String(event.payload.messageId);
      const [participants, message] = await Promise.all([
        loadConversationParticipants(database.pool, conversationId),
        loadMessageProjection(database.pool, conversationId, messageId),
      ]);
      if (!participants || !message) return;
      const recipients = participants.memberIds.filter(
        (accountId) => accountId !== message.senderAccountId,
      );
      const previewByAccount = new Map<string, boolean>();
      await Promise.all(
        recipients.map(async (accountId) => {
          const preference = await loadNotificationPreferences(database.pool, accountId);
          previewByAccount.set(accountId, preference.messagePreviewEnabled);
        }),
      );
      await deliverAccountPush(
        database,
        pushConfig,
        recipients,
        (accountId) => ({
          v: 1,
          type: previewByAccount.get(accountId) ? "message_changed" : "notification_changed",
        }),
        signal,
      );
    },
  };
}

export function createM1MessagingInvalidationHandlers(
  publisher?: RealtimeInvalidationPublisher,
  database?: DatabasePool,
  pushConfig: WebPushConfig | null = null,
): readonly OutboxHandler[] {
  return M1_EVENT_TYPES.map((eventType) =>
    createMessagingInvalidationHandler(eventType, publisher, database, pushConfig),
  );
}
