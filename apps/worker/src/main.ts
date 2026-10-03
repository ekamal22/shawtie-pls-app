import { createDatabasePool, databaseConfigFromEnv } from "@shawtie/db";
import { S3MediaObjectStore, mediaStorageConfigFromEnv } from "@shawtie/media-storage";
import { workerConfigFromEnv } from "./config.ts";
import {
  createDefaultDeletionHandlers,
  createDefaultScheduledHandlers,
} from "./auth/default-account-handlers.ts";
import { emailDeliveryFromEnv } from "./auth/brevo-email-delivery.ts";
import { WorkerAuthKeyRing, workerAuthKeyConfigFromEnv } from "./auth/worker-auth-key-ring.ts";
import { createDefaultOutboxHandlers } from "./outbox/default-outbox-handlers.ts";
import { WorkerApplication } from "./runtime/worker-application.ts";
import { createWorkerIdentity } from "./runtime/worker-identity.ts";

const database = createDatabasePool(databaseConfigFromEnv());
const mediaStorageConfig = mediaStorageConfigFromEnv();
const mediaStore = mediaStorageConfig ? new S3MediaObjectStore(mediaStorageConfig) : null;
const emailDelivery = emailDeliveryFromEnv();
const outboxHandlers = emailDelivery
  ? createDefaultOutboxHandlers(database, {
      email: emailDelivery,
      authKeys: new WorkerAuthKeyRing(workerAuthKeyConfigFromEnv()),
    })
  : createDefaultOutboxHandlers(database);

const application = new WorkerApplication({
  database,
  workerId: createWorkerIdentity("shawtie-worker"),
  config: workerConfigFromEnv(),
  scheduledHandlers: createDefaultScheduledHandlers(mediaStore),
  outboxHandlers,
  deletionHandlers: createDefaultDeletionHandlers(database, mediaStore),
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
