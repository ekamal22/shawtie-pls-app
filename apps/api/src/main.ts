import { closeDatabasePool, createDatabasePool, databaseConfigFromEnv } from "@shawtie/db";
import { S3MediaObjectStore, mediaStorageConfigFromEnv } from "@shawtie/media-storage";
import { createApiApplication } from "./application.ts";
import { apiConfigFromEnv } from "./config.ts";

const database = createDatabasePool(databaseConfigFromEnv());
const mediaStorageConfig = mediaStorageConfigFromEnv();
const app = createApiApplication({
  database,
  config: apiConfigFromEnv(),
  mediaObjectStore: mediaStorageConfig ? new S3MediaObjectStore(mediaStorageConfig) : null,
});

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "127.0.0.1";

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log("API_SHUTDOWN_REQUESTED", { signal });
  await app.close();
  await closeDatabasePool(database);
}

process.once("SIGTERM", () => {
  void stop("SIGTERM");
});
process.once("SIGINT", () => {
  void stop("SIGINT");
});

try {
  await app.listen({ host, port });
  console.log("API_LISTENING", { host, port });
} catch (error) {
  console.error("API_START_FAILED", {
    name: error instanceof Error ? error.name : "UnknownError",
  });
  await closeDatabasePool(database);
  throw error;
}
