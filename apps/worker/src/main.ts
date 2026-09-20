import { createDatabasePool, databaseConfigFromEnv } from "@shawtie/db";
import { workerConfigFromEnv } from "./config.ts";
import { DeletionHandlerRegistry } from "./deletion/deletion-handler-registry.ts";
import { OutboxHandlerRegistry } from "./outbox/outbox-handler-registry.ts";
import { ScheduledActionHandlerRegistry } from "./scheduled/scheduled-handler-registry.ts";
import { WorkerApplication } from "./runtime/worker-application.ts";
import { createWorkerIdentity } from "./runtime/worker-identity.ts";

const application = new WorkerApplication({
  database: createDatabasePool(databaseConfigFromEnv()),
  workerId: createWorkerIdentity("shawtie-worker"),
  config: workerConfigFromEnv(),
  scheduledHandlers: new ScheduledActionHandlerRegistry(),
  outboxHandlers: new OutboxHandlerRegistry(),
  deletionHandlers: new DeletionHandlerRegistry(),
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
