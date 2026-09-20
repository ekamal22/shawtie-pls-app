export interface DatabaseConfig {
  readonly connectionString: string;
  readonly applicationName?: string;
  readonly maxConnections?: number;
  readonly connectionTimeoutMs?: number;
  readonly idleTimeoutMs?: number;
  readonly queryTimeoutMs?: number;
  readonly statementTimeoutMs?: number;
  readonly lockTimeoutMs?: number;
  readonly idleInTransactionTimeoutMs?: number;
  readonly transactionMaxRetries?: number;
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function databaseConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): DatabaseConfig {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");

  return {
    connectionString,
    applicationName: env.DATABASE_APPLICATION_NAME ?? "shawtie",
    maxConnections: positiveInteger(env.DB_MAX_CONNECTIONS, 10, "DB_MAX_CONNECTIONS"),
    connectionTimeoutMs: positiveInteger(
      env.DB_CONNECTION_TIMEOUT_MS,
      5_000,
      "DB_CONNECTION_TIMEOUT_MS",
    ),
    idleTimeoutMs: positiveInteger(env.DB_IDLE_TIMEOUT_MS, 30_000, "DB_IDLE_TIMEOUT_MS"),
    queryTimeoutMs: positiveInteger(env.DB_QUERY_TIMEOUT_MS, 20_000, "DB_QUERY_TIMEOUT_MS"),
    statementTimeoutMs: positiveInteger(
      env.DB_STATEMENT_TIMEOUT_MS,
      15_000,
      "DB_STATEMENT_TIMEOUT_MS",
    ),
    lockTimeoutMs: positiveInteger(env.DB_LOCK_TIMEOUT_MS, 5_000, "DB_LOCK_TIMEOUT_MS"),
    idleInTransactionTimeoutMs: positiveInteger(
      env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS,
      30_000,
      "DB_IDLE_IN_TRANSACTION_TIMEOUT_MS",
    ),
    transactionMaxRetries: positiveInteger(
      env.DB_TRANSACTION_MAX_RETRIES,
      3,
      "DB_TRANSACTION_MAX_RETRIES",
    ),
  };
}
