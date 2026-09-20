export { databaseConfigFromEnv, type DatabaseConfig } from "./connection/database-config.ts";
export { closeDatabasePool, createDatabasePool, type DatabasePool } from "./connection/pool.ts";
export { withTransaction, type TransactionOptions } from "./connection/transaction.ts";
export { getClockTimestamp, getTransactionTimestamp } from "./connection/time.ts";
export { DatabaseError, normalizeDatabaseError } from "./errors/database-error.ts";
export {
  POSTGRES_SQLSTATE,
  isRetryableTransactionError,
  postgresSqlState,
  type KnownPostgresSqlState,
} from "./errors/postgres-error-codes.ts";
export { lockAccounts } from "./repositories/accounts.ts";
export {
  appendLifecycleEvent,
  validateLifecycleMetadata,
  type AppendLifecycleEvent,
  type LifecycleMetadata,
  type LifecycleMetadataKey,
  type LifecycleMetadataValue,
} from "./repositories/lifecycle-events.ts";
export {
  claimScheduledActions,
  completeScheduledAction,
  failScheduledAction,
  insertScheduledAction,
  lockScheduledActionClaim,
  markScheduledActionStale,
  renewScheduledActionLease,
  retryScheduledAction,
  type InsertScheduledAction,
  type ScheduledAction,
} from "./repositories/scheduled-actions.ts";
export {
  claimOutboxEvents,
  deliverOutboxEvent,
  failOutboxEvent,
  insertOutboxEvent,
  renewOutboxLease,
  retryOutboxEvent,
  type InsertOutboxEvent,
  type OutboxEvent,
} from "./repositories/outbox-events.ts";
export {
  claimDeletionTargets,
  completeDeletionManifestIfReady,
  completeDeletionTarget,
  createDeletionManifest,
  failDeletionTarget,
  renewDeletionTargetLease,
  resumeFailedDeletionTarget,
  retryDeletionTarget,
  type CreateDeletionManifest,
  type DeletionTarget,
} from "./repositories/deletion-manifests.ts";
export type { DurableClaim } from "./types/claim.ts";
export type { QueryExecutor } from "./types/query-executor.ts";

export const databaseFoundationStatus = "f2-runtime-implemented" as const;
