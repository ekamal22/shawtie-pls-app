import type { QueryExecutor } from "../types/query-executor.ts";

interface AccountIdRow {
  id: string;
}

export async function lockAccounts(
  executor: QueryExecutor,
  accountIds: readonly string[],
): Promise<readonly string[]> {
  const uniqueIds = [...new Set(accountIds)];
  if (uniqueIds.length === 0) return [];

  const result = await executor.query<AccountIdRow>(
    `SELECT id
     FROM accounts
     WHERE id = ANY($1::uuid[])
     ORDER BY id
     FOR UPDATE`,
    [uniqueIds],
  );

  return result.rows.map((row) => row.id);
}
