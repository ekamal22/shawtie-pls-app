import {
  closeDatabasePool,
  type DatabasePool,
} from "@shawtie/db";
import type { WorkerConfig } from "../config.ts";
import { runDeletionBatch } from "../deletion/deletion-consumer.ts";
import type { DeletionHandlerRegistry } from "../deletion/deletion-handler-registry.ts";
import { runOutboxBatch } from "../outbox/outbox-consumer.ts";
import type { OutboxHandlerRegistry } from "../outbox/outbox-handler-registry.ts";
import { runScheduledBatch } from "../scheduled/scheduled-consumer.ts";
import type { ScheduledActionHandlerRegistry } from "../scheduled/scheduled-handler-registry.ts";
import { defaultRetryPolicy } from "./retry-policy.ts";
import { runPollLoop } from "./poll-loop.ts";

export interface WorkerApplicationDependencies {
  readonly database: DatabasePool;
  readonly workerId: string;
  readonly config: WorkerConfig;
  readonly scheduledHandlers: ScheduledActionHandlerRegistry;
  readonly outboxHandlers: OutboxHandlerRegistry;
  readonly deletionHandlers: DeletionHandlerRegistry;
}

export class WorkerApplication {
  readonly #abortController = new AbortController();
  readonly #loops: Promise<void>[];
  readonly #dependencies: WorkerApplicationDependencies;
  #stopped = false;

  constructor(dependencies: WorkerApplicationDependencies) {
    this.#dependencies = dependencies;
    const { database, workerId, config } = dependencies;
    const common = {
      batchSize: config.batchSize,
      concurrency: config.concurrency,
      leaseMs: config.leaseMs,
      retryPolicy: defaultRetryPolicy,
    };

    this.#loops = [
      runPollLoop(
        "scheduled",
        this.#abortController.signal,
        config.pollIntervalMs,
        () =>
          runScheduledBatch(
            database,
            workerId,
            dependencies.scheduledHandlers,
            common,
          ).then(() => undefined),
      ),
      runPollLoop(
        "outbox",
        this.#abortController.signal,
        config.pollIntervalMs,
        () =>
          runOutboxBatch(
            database,
            workerId,
            dependencies.outboxHandlers,
            this.#abortController.signal,
            common,
          ).then(() => undefined),
      ),
      runPollLoop(
        "deletion",
        this.#abortController.signal,
        config.pollIntervalMs,
        () =>
          runDeletionBatch(
            database,
            workerId,
            dependencies.deletionHandlers,
            this.#abortController.signal,
            common,
          ).then(() => undefined),
      ),
    ];
  }

  async run(): Promise<void> {
    await Promise.all(this.#loops);
  }

  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#abortController.abort();

    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const grace = new Promise<"timeout">((resolve) => {
      graceTimer = setTimeout(
        () => resolve("timeout"),
        this.#dependencies.config.shutdownGraceMs,
      );
    });

    const result = await Promise.race([
      Promise.all(this.#loops).then(() => "drained" as const),
      grace,
    ]);
    if (graceTimer) clearTimeout(graceTimer);

    if (result === "timeout") {
      console.error("WORKER_SHUTDOWN_GRACE_EXCEEDED");
    }

    await closeDatabasePool(this.#dependencies.database);
  }
}
