import type { QueryExecutor } from "../types/query-executor.ts";
import type { DurableClaim } from "../types/claim.ts";

export interface ScheduledAction {
  readonly id: string;
  readonly actionType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly executeAt: Date;
  readonly availableAt: Date;
  readonly status: "pending" | "processing" | "completed" | "failed" | "stale" | "cancelled";
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly expectedGeneration: bigint | null;
  readonly deduplicationKey: string;
  readonly payload: unknown;
  readonly payloadVersion: number;
  readonly claimedAt: Date | null;
  readonly claimedBy: string | null;
  readonly leaseExpiresAt: Date | null;
  readonly claimVersion: bigint;
  readonly lastErrorCode: string | null;
}

interface ScheduledActionRow {
  id: string;
  action_type: string;
  aggregate_type: string;
  aggregate_id: string;
  execute_at: Date;
  available_at: Date;
  status: ScheduledAction["status"];
  attempt_count: number;
  max_attempts: number;
  expected_generation: string | number | bigint | null;
  deduplication_key: string;
  payload: unknown;
  payload_version: number;
  claimed_at: Date | null;
  claimed_by: string | null;
  lease_expires_at: Date | null;
  claim_version: string | number | bigint;
  last_error_code: string | null;
}

function asBigInt(value: string | number | bigint): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

function mapAction(row: ScheduledActionRow): ScheduledAction {
  return {
    id: row.id,
    actionType: row.action_type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    executeAt: row.execute_at,
    availableAt: row.available_at,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    expectedGeneration: row.expected_generation === null ? null : asBigInt(row.expected_generation),
    deduplicationKey: row.deduplication_key,
    payload: row.payload,
    payloadVersion: row.payload_version,
    claimedAt: row.claimed_at,
    claimedBy: row.claimed_by,
    leaseExpiresAt: row.lease_expires_at,
    claimVersion: asBigInt(row.claim_version),
    lastErrorCode: row.last_error_code,
  };
}

const returningColumns = `
  action.id, action.action_type, action.aggregate_type, action.aggregate_id,
  action.execute_at, action.available_at, action.status, action.attempt_count,
  action.max_attempts, action.expected_generation, action.deduplication_key,
  action.payload, action.payload_version, action.claimed_at, action.claimed_by,
  action.lease_expires_at, action.claim_version, action.last_error_code
`;

const selectColumns = `
  id, action_type, aggregate_type, aggregate_id, execute_at, available_at,
  status, attempt_count, max_attempts, expected_generation, deduplication_key,
  payload, payload_version, claimed_at, claimed_by, lease_expires_at,
  claim_version, last_error_code
`;

export interface InsertScheduledAction {
  readonly id: string;
  readonly actionType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly executeAt: Date;
  readonly expectedGeneration?: bigint | null;
  readonly deduplicationKey: string;
  readonly payload?: unknown;
  readonly payloadVersion?: number;
  readonly maxAttempts?: number;
}

export async function insertScheduledAction(
  executor: QueryExecutor,
  input: InsertScheduledAction,
): Promise<void> {
  await executor.query(
    `INSERT INTO scheduled_actions (
       id, action_type, aggregate_type, aggregate_id, execute_at, available_at,
       expected_generation, deduplication_key, payload, payload_version, max_attempts
     )
     VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8::jsonb, $9, $10)`,
    [
      input.id,
      input.actionType,
      input.aggregateType,
      input.aggregateId,
      input.executeAt,
      input.expectedGeneration?.toString() ?? null,
      input.deduplicationKey,
      JSON.stringify(input.payload ?? {}),
      input.payloadVersion ?? 1,
      input.maxAttempts ?? 12,
    ],
  );
}

export async function claimScheduledActions(
  executor: QueryExecutor,
  batchSize: number,
  workerId: string,
  leaseMs: number,
): Promise<readonly ScheduledAction[]> {
  const result = await executor.query<ScheduledActionRow>(
    `WITH candidates AS (
       SELECT id
       FROM scheduled_actions
       WHERE attempt_count < max_attempts
         AND (
           (status = 'pending' AND available_at <= clock_timestamp())
           OR
           (status = 'processing' AND lease_expires_at <= clock_timestamp())
         )
       ORDER BY
         CASE WHEN status = 'pending' THEN available_at ELSE lease_expires_at END,
         id
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE scheduled_actions AS action
     SET
       status = 'processing',
       claimed_at = clock_timestamp(),
       claimed_by = $2,
       lease_expires_at = clock_timestamp() + ($3 * interval '1 millisecond'),
       claim_version = action.claim_version + 1,
       attempt_count = action.attempt_count + 1
     FROM candidates
     WHERE action.id = candidates.id
     RETURNING ${returningColumns}`,
    [batchSize, workerId, leaseMs],
  );

  return result.rows.map(mapAction);
}

export async function lockScheduledActionClaim(
  executor: QueryExecutor,
  claim: DurableClaim,
): Promise<ScheduledAction | null> {
  const result = await executor.query<ScheduledActionRow>(
    `SELECT ${selectColumns}
     FROM scheduled_actions
     WHERE id = $1
       AND status = 'processing'
       AND claimed_by = $2
       AND claim_version = $3
       AND lease_expires_at > clock_timestamp()
     FOR UPDATE`,
    [claim.id, claim.claimedBy, claim.claimVersion.toString()],
  );
  const row = result.rows[0];
  return row ? mapAction(row) : null;
}

export async function renewScheduledActionLease(
  executor: QueryExecutor,
  claim: DurableClaim,
  leaseMs: number,
): Promise<boolean> {
  const result = await executor.query(
    `UPDATE scheduled_actions
     SET lease_expires_at = clock_timestamp() + ($4 * interval '1 millisecond')
     WHERE id = $1
       AND status = 'processing'
       AND claimed_by = $2
       AND claim_version = $3
       AND lease_expires_at > clock_timestamp()`,
    [claim.id, claim.claimedBy, claim.claimVersion.toString(), leaseMs],
  );
  return result.rowCount === 1;
}

async function finishScheduledAction(
  executor: QueryExecutor,
  claim: DurableClaim,
  status: "completed" | "stale" | "failed" | "cancelled",
  errorCode: string | null,
): Promise<boolean> {
  const result = await executor.query(
    `UPDATE scheduled_actions
     SET
       status = $4,
       completed_at = clock_timestamp(),
       last_error_code = $5,
       claimed_at = NULL,
       claimed_by = NULL,
       lease_expires_at = NULL
     WHERE id = $1
       AND status = 'processing'
       AND claimed_by = $2
       AND claim_version = $3`,
    [claim.id, claim.claimedBy, claim.claimVersion.toString(), status, errorCode],
  );
  return result.rowCount === 1;
}

export function completeScheduledAction(
  executor: QueryExecutor,
  claim: DurableClaim,
): Promise<boolean> {
  return finishScheduledAction(executor, claim, "completed", null);
}

export function markScheduledActionStale(
  executor: QueryExecutor,
  claim: DurableClaim,
): Promise<boolean> {
  return finishScheduledAction(executor, claim, "stale", null);
}

export function failScheduledAction(
  executor: QueryExecutor,
  claim: DurableClaim,
  errorCode: string,
): Promise<boolean> {
  return finishScheduledAction(executor, claim, "failed", errorCode);
}

export async function retryScheduledAction(
  executor: QueryExecutor,
  claim: DurableClaim,
  errorCode: string,
  delayMs: number,
): Promise<"pending" | "failed" | "lost"> {
  const result = await executor.query<{ status: "pending" | "failed" }>(
    `UPDATE scheduled_actions
     SET
       status = CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'pending' END,
       available_at = CASE
         WHEN attempt_count >= max_attempts THEN available_at
         ELSE clock_timestamp() + ($5 * interval '1 millisecond')
       END,
       completed_at = CASE
         WHEN attempt_count >= max_attempts THEN clock_timestamp()
         ELSE NULL
       END,
       last_error_code = $4,
       claimed_at = NULL,
       claimed_by = NULL,
       lease_expires_at = NULL
     WHERE id = $1
       AND status = 'processing'
       AND claimed_by = $2
       AND claim_version = $3
     RETURNING status`,
    [claim.id, claim.claimedBy, claim.claimVersion.toString(), errorCode, delayMs],
  );
  return result.rows[0]?.status ?? "lost";
}

export async function cancelPendingScheduledActionsByDeduplicationKey(
  executor: QueryExecutor,
  deduplicationKeys: readonly string[],
  cancelledAt: Date,
): Promise<number> {
  if (deduplicationKeys.length === 0) return 0;
  const result = await executor.query(
    `UPDATE scheduled_actions
     SET status = 'cancelled',
         completed_at = $2
     WHERE deduplication_key = ANY($1::text[])
       AND status = 'pending'`,
    [[...deduplicationKeys], cancelledAt],
  );
  return result.rowCount ?? 0;
}
