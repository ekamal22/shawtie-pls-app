import type { PoolClient } from "pg";
import type { DatabasePool } from "./pool.ts";
import { isRetryableTransactionError } from "../errors/postgres-error-codes.ts";

export interface TransactionOptions {
  readonly maxRetries?: number;
}

async function configureTransaction(client: PoolClient, database: DatabasePool): Promise<void> {
  const policy = database.transactionPolicy;
  await client.query(
    `SELECT
      set_config('statement_timeout', $1, true),
      set_config('lock_timeout', $2, true),
      set_config('idle_in_transaction_session_timeout', $3, true)`,
    [
      `${policy.statementTimeoutMs}ms`,
      `${policy.lockTimeoutMs}ms`,
      `${policy.idleInTransactionTimeoutMs}ms`,
    ],
  );
}

function retryDelayMs(attempt: number): number {
  const boundedAttempt = Math.min(attempt, 6);
  return Math.min(250, 10 * 2 ** boundedAttempt);
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export async function withTransaction<T>(
  database: DatabasePool,
  callback: (client: PoolClient) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? database.transactionPolicy.maxRetries;
  let attempt = 0;

  for (;;) {
    const client = await database.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      await configureTransaction(client, database);
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The original transaction error remains authoritative.
      }

      if (!isRetryableTransactionError(error) || attempt >= maxRetries) {
        throw error;
      }

      attempt += 1;
    } finally {
      client.release();
    }

    await delay(retryDelayMs(attempt));
  }
}
