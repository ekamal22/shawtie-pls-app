import {
  claimDeletionTargets,
  completeDeletionManifestIfReady,
  completeDeletionTarget,
  failDeletionTarget,
  renewDeletionTargetLease,
  retryDeletionTarget,
  type DatabasePool,
  type DeletionTarget,
  type DurableClaim,
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
import type { DeletionHandlerRegistry } from "./deletion-handler-registry.ts";

export interface DeletionConsumerOptions {
  readonly batchSize: number;
  readonly concurrency: number;
  readonly leaseMs: number;
  readonly retryPolicy: RetryPolicy;
}

function claimFrom(target: DeletionTarget, workerId: string): DurableClaim {
  return {
    id: target.id,
    claimedBy: workerId,
    claimVersion: target.claimVersion,
  };
}

async function processTarget(
  database: DatabasePool,
  workerId: string,
  target: DeletionTarget,
  registry: DeletionHandlerRegistry,
  signal: AbortSignal,
  options: DeletionConsumerOptions,
): Promise<void> {
  const claim = claimFrom(target, workerId);
  const handler = registry.get(target.targetType);

  if (!handler) {
    await failDeletionTarget(database.pool, claim, "UNSUPPORTED_DELETION_TARGET");
    return;
  }

  try {
    await handler.execute({
      target,
      signal,
      renewLease: () =>
        renewDeletionTargetLease(database.pool, claim, options.leaseMs),
    });

    const manifestId = await completeDeletionTarget(database.pool, claim);
    if (manifestId) {
      await completeDeletionManifestIfReady(database.pool, manifestId);
    }
  } catch (error) {
    const code = workerErrorCode(error);
    if (error instanceof PermanentWorkerError) {
      await failDeletionTarget(database.pool, claim, code);
      return;
    }

    await retryDeletionTarget(
      database.pool,
      claim,
      code,
      retryDelayMs(target.attemptCount, target.id, options.retryPolicy),
    );
  }
}

export async function runDeletionBatch(
  database: DatabasePool,
  workerId: string,
  registry: DeletionHandlerRegistry,
  signal: AbortSignal,
  options: DeletionConsumerOptions,
): Promise<number> {
  if (registry.size === 0) return 0;

  const targets = await claimDeletionTargets(
    database.pool,
    options.batchSize,
    workerId,
    options.leaseMs,
  );

  await mapWithConcurrency(targets, options.concurrency, (target) =>
    processTarget(database, workerId, target, registry, signal, options),
  );

  return targets.length;
}
