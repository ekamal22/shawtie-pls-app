import {
  getClockTimestamp,
  listActivePushSubscriptionsForAccounts,
  markPushDeliveryFailure,
  markPushDeliverySuccess,
  type DatabasePool,
  type OutboxEvent,
} from "@shawtie/db";
import type { OutboxHandler } from "../outbox/outbox-handler.ts";
import { PermanentWorkerError } from "../runtime/errors.ts";
import { sendWebPush, type WebPushConfig } from "../calls/web-push.ts";

const GENERIC_PUSH_TYPES = ["account.notification.push", "partner_request.push"] as const;
type GenericPushEventType = (typeof GENERIC_PUSH_TYPES)[number];

function accountId(event: OutboxEvent): string {
  if (
    event.aggregateType !== "account" ||
    typeof event.aggregateId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      event.aggregateId,
    ) ||
    event.payload === null ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    throw new PermanentWorkerError("INVALID_GENERIC_PUSH_PAYLOAD");
  }
  const payload = event.payload as Record<string, unknown>;
  if (Object.keys(payload).join(",") !== "accountId" || payload.accountId !== event.aggregateId) {
    throw new PermanentWorkerError("INVALID_GENERIC_PUSH_PAYLOAD");
  }
  return event.aggregateId;
}

async function deliverGenericPush(
  database: DatabasePool,
  pushConfig: WebPushConfig | null,
  event: OutboxEvent,
  signal: AbortSignal,
): Promise<void> {
  const recipientAccountId = accountId(event);
  if (!pushConfig) return;

  const subscriptions = await listActivePushSubscriptionsForAccounts(database.pool, [
    recipientAccountId,
  ]);
  const now = await getClockTimestamp(database.pool);

  for (const subscription of subscriptions) {
    try {
      const result = await sendWebPush(
        subscription,
        { v: 1, type: "notification_changed" },
        pushConfig,
        signal,
        now,
      );
      if (result.gone) {
        await markPushDeliveryFailure(database.pool, subscription.deviceId, now, true);
      } else if (result.delivered) {
        await markPushDeliverySuccess(database.pool, subscription.deviceId, now);
      }
    } catch (error) {
      await markPushDeliveryFailure(database.pool, subscription.deviceId, now, false);
      throw error;
    }
  }
}

export function createGenericPushHandlers(
  database: DatabasePool,
  pushConfig: WebPushConfig | null,
): readonly OutboxHandler[] {
  return GENERIC_PUSH_TYPES.map(
    (eventType: GenericPushEventType): OutboxHandler => ({
      eventType,
      payloadVersion: 1,
      async deliver({ event, signal }) {
        await deliverGenericPush(database, pushConfig, event, signal);
      },
    }),
  );
}
