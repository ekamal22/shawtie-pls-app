import { createDatabasePool, databaseConfigFromEnv } from "@shawtie/db";
import { workerConfigFromEnv } from "./config.ts";
import { createDefaultDeletionHandlers, createDefaultScheduledHandlers } from "./auth/default-account-handlers.ts";
import { OutboxHandlerRegistry } from "./outbox/outbox-handler-registry.ts";
import { WorkerApplication } from "./runtime/worker-application.ts";
import { createWorkerIdentity } from "./runtime/worker-identity.ts";

const database = createDatabasePool(databaseConfigFromEnv());

const application = new WorkerApplication({
  database,
  workerId: createWorkerIdentity("shawtie-worker"),
  config: workerConfigFromEnv(),
  scheduledHandlers: createDefaultScheduledHandlers(),
  outboxHandlers: new OutboxHandlerRegistry(),
  deletionHandlers: createDefaultDeletionHandlers(database),
});

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log("WORKER_SHUTDOWN_REQUESTED", { signal });
  await application.stop();
}

process.once("SIGTERM", () => {
  void stop("SIGTERM");
});
process.once("SIGINT", () => {
  void stop("SIGINT");
});

await application.run();
