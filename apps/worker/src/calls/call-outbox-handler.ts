import {
  C1_PUSH_PAYLOAD_VERSION,
  M2_REALTIME_PROTOCOL_VERSION,
  type M2InternalRealtimeNotification,
} from "@shawtie/contracts";
import {
  getClockTimestamp,
  listActivePushSubscriptionsForAccounts,
  markPushDeliveryFailure,
  markPushDeliverySuccess,
  type DatabasePool,
  type OutboxEvent,
} from "@shawtie/db";
import { PermanentWorkerError } from "../runtime/errors.ts";
import type { OutboxHandler } from "../outbox/outbox-handler.ts";
import type { RealtimeInvalidationPublisher } from "../realtime/realtime-publisher.ts";
import { sendWebPush, type WebPushConfig } from "./web-push.ts";

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new PermanentWorkerError("INVALID_C1_CALL_OUTBOX_PAYLOAD");
  }
  return value as Record<string, unknown>;
}

function uuid(value: unknown): string {
  if (
    typeof value !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new PermanentWorkerError("INVALID_C1_CALL_OUTBOX_PAYLOAD");
  }
  return value;
}

function positive(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new PermanentWorkerError("INVALID_C1_CALL_OUTBOX_PAYLOAD");
  }
  return value;
}

function changedNotification(event: OutboxEvent): M2InternalRealtimeNotification {
  const value = record(event.payload);
  const keys = Object.keys(value).sort().join(",");
  if (keys !== "callId,partnershipId,version") {
    throw new PermanentWorkerError("INVALID_C1_CALL_OUTBOX_PAYLOAD");
  }
  const callId = uuid(value.callId);
  const partnershipId = uuid(value.partnershipId);
  if (event.aggregateType !== "call" || event.aggregateId !== callId) {
    throw new PermanentWorkerError("INVALID_C1_CALL_OUTBOX_PAYLOAD");
  }
  return {
    v: M2_REALTIME_PROTOCOL_VERSION,
    kind: "call.changed",
    scope: { partnershipId },
    data: {
      eventId: event.id,
      callId,
      version: positive(value.version),
    },
  };
}

function pushAccounts(event: OutboxEvent): readonly string[] {
  const value = record(event.payload);
  if (
    Object.keys(value).join(",") !== "accountIds"
    || !Array.isArray(value.accountIds)
    || value.accountIds.length < 1
    || value.accountIds.length > 2
  ) {
    throw new PermanentWorkerError("INVALID_C1_CALL_OUTBOX_PAYLOAD");
  }
  const accounts = value.accountIds.map(uuid);
  if (new Set(accounts).size !== accounts.length) {
    throw new PermanentWorkerError("INVALID_C1_CALL_OUTBOX_PAYLOAD");
  }
  return accounts;
}

export function createC1CallOutboxHandlers(
  database: DatabasePool,
  publisher: RealtimeInvalidationPublisher,
  pushConfig: WebPushConfig | null,
): readonly OutboxHandler[] {
  return [
    {
      eventType: "c1.call.changed",
      payloadVersion: 1,
      async deliver({ event }) {
        await publisher.publish(changedNotification(event));
      },
    },
    {
      eventType: "c1.call.push",
      payloadVersion: 1,
      async deliver({ event, signal }) {
        const accountIds = pushAccounts(event);
        if (!pushConfig) return;
        const subscriptions = await listActivePushSubscriptionsForAccounts(
          database.pool,
          accountIds,
        );
        const now = await getClockTimestamp(database.pool);
        for (const subscription of subscriptions) {
          try {
            const result = await sendWebPush(
              subscription,
              { v: C1_PUSH_PAYLOAD_VERSION, type: "call_state_changed" },
              pushConfig,
              signal,
              now,
            );
            if (result.gone) {
              await markPushDeliveryFailure(
                database.pool,
                subscription.deviceId,
                now,
                true,
              );
            } else if (result.delivered) {
              await markPushDeliverySuccess(database.pool, subscription.deviceId, now);
            }
          } catch (error) {
            await markPushDeliveryFailure(
              database.pool,
              subscription.deviceId,
              now,
              false,
            );
            throw error;
          }
        }
      },
    },
  ];
}
