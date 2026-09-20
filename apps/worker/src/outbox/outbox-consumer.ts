import {
  claimOutboxEvents,
  deliverOutboxEvent,
  failOutboxEvent,
  renewOutboxLease,
  retryOutboxEvent,
  type DatabasePool,
  type DurableClaim,
  type OutboxEvent,
} from "@shawtie/db";
import { mapWithConcurrency } from "../runtime/concurrency-limit.ts";
import { PermanentWorkerError, workerErrorCode } from "../runtime/errors.ts";
import { retryDelayMs, type RetryPolicy } from "../runtime/retry-policy.ts";
import type { OutboxHandlerRegistry } from "./outbox-handler-registry.ts";

export interface OutboxConsumerOptions {
  readonly batchSize: number;
  readonly concurrency: number;
  readonly leaseMs: number;
  readonly retryPolicy: RetryPolicy;
}

function claimFrom(event: OutboxEvent, workerId: string): DurableClaim {
  return {
    id: event.id,
    claimedBy: workerId,
    claimVersion: event.claimVersion,
  };
}

async function deliver(
  database: DatabasePool,
  workerId: string,
  event: OutboxEvent,
  registry: OutboxHandlerRegistry,
  signal: AbortSignal,
  options: OutboxConsumerOptions,
): Promise<void> {
  const claim = claimFrom(event, workerId);
  const handler = registry.get(event.eventType, event.payloadVersion);

  if (!handler) {
    await failOutboxEvent(database.pool, claim, "UNSUPPORTED_EVENT_OR_PAYLOAD_VERSION");
    return;
  }

  try {
    await handler.deliver({
      event,
      signal,
      renewLease: () => renewOutboxLease(database.pool, claim, options.leaseMs),
    });

    const delivered = await deliverOutboxEvent(database.pool, claim);
    if (!delivered) {
      console.error("OUTBOX_ACKNOWLEDGEMENT_LOST", { eventId: event.id });
    }
  } catch (error) {
    const code = workerErrorCode(error);
    if (error instanceof PermanentWorkerError) {
      await failOutboxEvent(database.pool, claim, code);
      return;
    }

    await retryOutboxEvent(
      database.pool,
      claim,
      code,
      retryDelayMs(event.attemptCount, event.id, options.retryPolicy),
    );
  }
}

export async function runOutboxBatch(
  database: DatabasePool,
  workerId: string,
  registry: OutboxHandlerRegistry,
  signal: AbortSignal,
  options: OutboxConsumerOptions,
): Promise<number> {
  if (registry.size === 0) return 0;

  const events = await claimOutboxEvents(
    database.pool,
    options.batchSize,
    workerId,
    options.leaseMs,
  );

  await mapWithConcurrency(events, options.concurrency, (event) =>
    deliver(database, workerId, event, registry, signal, options),
  );

  return events.length;
}
