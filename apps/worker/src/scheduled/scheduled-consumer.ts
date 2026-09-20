import {
  claimScheduledActions,
  completeScheduledAction,
  failScheduledAction,
  getTransactionTimestamp,
  lockScheduledActionClaim,
  markScheduledActionStale,
  retryScheduledAction,
  type DatabasePool,
  type DurableClaim,
  type ScheduledAction,
  withTransaction,
} from "@shawtie/db";
import { mapWithConcurrency } from "../runtime/concurrency-limit.ts";
import {
  PermanentWorkerError,
  workerErrorCode,
} from "../runtime/errors.ts";
import {
  retryDelayMs,
  type RetryPolicy,
} from "../runtime/retry-policy.ts";
import type { ScheduledActionHandlerRegistry } from "./scheduled-handler-registry.ts";

function claimFrom(action: ScheduledAction, workerId: string): DurableClaim {
  return {
    id: action.id,
    claimedBy: workerId,
    claimVersion: action.claimVersion,
  };
}

export interface ScheduledConsumerOptions {
  readonly batchSize: number;
  readonly concurrency: number;
  readonly leaseMs: number;
  readonly retryPolicy: RetryPolicy;
}

async function executeClaim(
  database: DatabasePool,
  workerId: string,
  action: ScheduledAction,
  registry: ScheduledActionHandlerRegistry,
  retryPolicy: RetryPolicy,
): Promise<void> {
  const claim = claimFrom(action, workerId);

  try {
    await withTransaction(database, async (transaction) => {
      const locked = await lockScheduledActionClaim(transaction, claim);
      if (!locked) return;

      const handler = registry.get(locked.actionType, locked.payloadVersion);
      if (!handler) {
        await failScheduledAction(
          transaction,
          claim,
          "UNSUPPORTED_ACTION_OR_PAYLOAD_VERSION",
        );
        return;
      }

      if (locked.expectedGeneration !== null) {
        if (!handler.loadCurrentGeneration) {
          throw new PermanentWorkerError("GENERATION_GUARD_MISSING");
        }
        const currentGeneration = await handler.loadCurrentGeneration(
          transaction,
          locked,
        );
        if (currentGeneration !== locked.expectedGeneration) {
          await markScheduledActionStale(transaction, claim);
          return;
        }
      }

      const now = await getTransactionTimestamp(transaction);
      await handler.execute({ transaction, action: locked, now });

      const completed = await completeScheduledAction(transaction, claim);
      if (!completed) throw new Error("Scheduled claim was lost before completion");
    });
  } catch (error) {
    const code = workerErrorCode(error);
    if (error instanceof PermanentWorkerError) {
      await failScheduledAction(database.pool, claim, code);
      return;
    }

    await retryScheduledAction(
      database.pool,
      claim,
      code,
      retryDelayMs(action.attemptCount, action.id, retryPolicy),
    );
  }
}

export async function runScheduledBatch(
  database: DatabasePool,
  workerId: string,
  registry: ScheduledActionHandlerRegistry,
  options: ScheduledConsumerOptions,
): Promise<number> {
  if (registry.size === 0) return 0;

  const actions = await claimScheduledActions(
    database.pool,
    options.batchSize,
    workerId,
    options.leaseMs,
  );

  await mapWithConcurrency(actions, options.concurrency, (action) =>
    executeClaim(database, workerId, action, registry, options.retryPolicy),
  );

  return actions.length;
}
