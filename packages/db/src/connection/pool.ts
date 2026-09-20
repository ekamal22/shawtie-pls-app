import { Pool } from "pg";
import type { DatabaseConfig } from "./database-config.ts";

export interface DatabasePool {
  readonly pool: Pool;
  readonly transactionPolicy: {
    readonly statementTimeoutMs: number;
    readonly lockTimeoutMs: number;
    readonly idleInTransactionTimeoutMs: number;
    readonly maxRetries: number;
  };
}

export function createDatabasePool(config: DatabaseConfig): DatabasePool {
  const pool = new Pool({
    connectionString: config.connectionString,
    application_name: config.applicationName ?? "shawtie",
    max: config.maxConnections ?? 10,
    connectionTimeoutMillis: config.connectionTimeoutMs ?? 5_000,
    idleTimeoutMillis: config.idleTimeoutMs ?? 30_000,
    query_timeout: config.queryTimeoutMs ?? 20_000,
  });

  pool.on("error", (error) => {
    console.error("POSTGRES_POOL_IDLE_CLIENT_ERROR", {
      name: error.name,
      code: "code" in error ? String(error.code ?? "") : "",
    });
  });

  return {
    pool,
    transactionPolicy: {
      statementTimeoutMs: config.statementTimeoutMs ?? 15_000,
      lockTimeoutMs: config.lockTimeoutMs ?? 5_000,
      idleInTransactionTimeoutMs: config.idleInTransactionTimeoutMs ?? 30_000,
      maxRetries: config.transactionMaxRetries ?? 3,
    },
  };
}

export async function closeDatabasePool(database: DatabasePool): Promise<void> {
  await database.pool.end();
}
