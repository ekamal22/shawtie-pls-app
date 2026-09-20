export interface WorkerConfig {
  readonly batchSize: number;
  readonly concurrency: number;
  readonly pollIntervalMs: number;
  readonly leaseMs: number;
  readonly shutdownGraceMs: number;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function workerConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return {
    batchSize: positiveInteger(env.WORKER_BATCH_SIZE, 20, "WORKER_BATCH_SIZE"),
    concurrency: positiveInteger(env.WORKER_CONCURRENCY, 4, "WORKER_CONCURRENCY"),
    pollIntervalMs: positiveInteger(env.WORKER_POLL_INTERVAL_MS, 1_000, "WORKER_POLL_INTERVAL_MS"),
    leaseMs: positiveInteger(env.WORKER_LEASE_MS, 60_000, "WORKER_LEASE_MS"),
    shutdownGraceMs: positiveInteger(
      env.WORKER_SHUTDOWN_GRACE_MS,
      30_000,
      "WORKER_SHUTDOWN_GRACE_MS",
    ),
  };
}
