import {
  deleteExpiredIncompleteRegistrationIntents,
  getTransactionTimestamp,
  withTransaction,
  type DatabasePool,
} from "@shawtie/db";

export const AUTH_MAINTENANCE_INTERVAL_MS = 60_000;
export const AUTH_MAINTENANCE_BATCH_SIZE = 100;

export async function runAuthMaintenanceBatch(
  database: DatabasePool,
  batchSize: number = AUTH_MAINTENANCE_BATCH_SIZE,
): Promise<number> {
  return withTransaction(database, async (transaction) => {
    const now = await getTransactionTimestamp(transaction);
    const deleted = await deleteExpiredIncompleteRegistrationIntents(
      transaction,
      now,
      batchSize,
    );
    return deleted.length;
  });
}
