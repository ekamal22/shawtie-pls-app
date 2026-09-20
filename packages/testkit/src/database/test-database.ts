import {
  closeDatabasePool,
  createDatabasePool,
  databaseConfigFromEnv,
  type DatabasePool,
} from "@shawtie/db";

export function requireDisposableDatabase(env: NodeJS.ProcessEnv = process.env): DatabasePool {
  if (env.DB_TEST_CONFIRM !== "1") {
    throw new Error(
      "Refusing database integration test. Set DB_TEST_CONFIRM=1 only for a disposable database.",
    );
  }
  return createDatabasePool({
    ...databaseConfigFromEnv(env),
    applicationName: "shawtie-testkit",
    maxConnections: 12,
  });
}

export { closeDatabasePool };
