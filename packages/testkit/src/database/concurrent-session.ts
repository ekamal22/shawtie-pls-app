import type { DatabasePool, QueryExecutor } from "@shawtie/db";

export async function withTwoClients<T>(
  database: DatabasePool,
  callback: (first: QueryExecutor, second: QueryExecutor) => Promise<T>,
): Promise<T> {
  const first = await database.pool.connect();
  const second = await database.pool.connect();
  try {
    return await callback(first, second);
  } finally {
    first.release();
    second.release();
  }
}
