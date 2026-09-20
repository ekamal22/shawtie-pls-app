import type { QueryExecutor } from "../types/query-executor.ts";

interface TimestampRow {
  now: Date;
}

export async function getTransactionTimestamp(
  executor: QueryExecutor,
): Promise<Date> {
  const result = await executor.query<TimestampRow>(
    "SELECT transaction_timestamp() AS now",
  );
  const value = result.rows[0]?.now;
  if (!value) throw new Error("PostgreSQL transaction timestamp was not returned");
  return value;
}

export async function getClockTimestamp(
  executor: QueryExecutor,
): Promise<Date> {
  const result = await executor.query<TimestampRow>(
    "SELECT clock_timestamp() AS now",
  );
  const value = result.rows[0]?.now;
  if (!value) throw new Error("PostgreSQL clock timestamp was not returned");
  return value;
}
