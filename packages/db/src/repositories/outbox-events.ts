import type { QueryExecutor } from "../types/query-executor.ts";
import type { DurableClaim } from "../types/claim.ts";

export interface OutboxEvent {
  readonly id: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly deduplicationKey: string;
  readonly payload: unknown;
  readonly payloadVersion: number;
  readonly status: "pending" | "processing" | "delivered" | "failed";
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly availableAt: Date;
  readonly claimedAt: Date | null;
  readonly claimedBy: string | null;
  readonly leaseExpiresAt: Date | null;
  readonly claimVersion: bigint;
  readonly lastErrorCode: string | null;
}

interface OutboxRow {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  deduplication_key: string;
  payload: unknown;
  payload_version: number;
  status: OutboxEvent["status"];
  attempt_count: number;
  max_attempts: number;
  available_at: Date;
  claimed_at: Date | null;
  claimed_by: string | null;
  lease_expires_at: Date | null;
  claim_version: string | number | bigint;
  last_error_code: string | null;
}

const returningColumns = `
  event.id, event.event_type, event.aggregate_type, event.aggregate_id,
  event.deduplication_key, event.payload, event.payload_version, event.status,
  event.attempt_count, event.max_attempts, event.available_at, event.claimed_at,
  event.claimed_by, event.lease_expires_at, event.claim_version,
  event.last_error_code
`;

function mapRow(row: OutboxRow): OutboxEvent {
  return {
    id: row.id,
    eventType: row.event_type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    deduplicationKey: row.deduplication_key,
    payload: row.payload,
    payloadVersion: row.payload_version,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    availableAt: row.available_at,
    claimedAt: row.claimed_at,
    claimedBy: row.claimed_by,
    leaseExpiresAt: row.lease_expires_at,
    claimVersion: BigInt(row.claim_version),
    lastErrorCode: row.last_error_code,
  };
}

export interface InsertOutboxEvent {
  readonly id: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly deduplicationKey: string;
  readonly payload?: unknown;
  readonly payloadVersion?: number;
  readonly availableAt?: Date;
  readonly maxAttempts?: number;
}

export async function insertOutboxEvent(
  executor: QueryExecutor,
  input: InsertOutboxEvent,
): Promise<void> {
  await executor.query(
    `INSERT INTO outbox_events (
       id, event_type, aggregate_type, aggregate_id, deduplication_key,
       payload, payload_version, available_at, max_attempts
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, COALESCE($8, clock_timestamp()), $9)`,
    [
      input.id,
      input.eventType,
      input.aggregateType,
      input.aggregateId,
      input.deduplicationKey,
      JSON.stringify(input.payload ?? {}),
      input.payloadVersion ?? 1,
      input.availableAt ?? null,
      input.maxAttempts ?? 12,
    ],
  );
}

export async function claimOutboxEvents(
  executor: QueryExecutor,
  batchSize: number,
  workerId: string,
  leaseMs: number,
): Promise<readonly OutboxEvent[]> {
  const result = await executor.query<OutboxRow>(
    `WITH candidates AS (
       SELECT id
       FROM outbox_events
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
     UPDATE outbox_events AS event
     SET
       status = 'processing',
       claimed_at = clock_timestamp(),
       claimed_by = $2,
       lease_expires_at = clock_timestamp() + ($3 * interval '1 millisecond'),
       claim_version = event.claim_version + 1,
       attempt_count = event.attempt_count + 1
     FROM candidates
     WHERE event.id = candidates.id
     RETURNING ${returningColumns}`,
    [batchSize, workerId, leaseMs],
  );
  return result.rows.map(mapRow);
}

export async function renewOutboxLease(
  executor: QueryExecutor,
  claim: DurableClaim,
  leaseMs: number,
): Promise<boolean> {
  const result = await executor.query(
    `UPDATE outbox_events
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

export async function deliverOutboxEvent(
  executor: QueryExecutor,
  claim: DurableClaim,
): Promise<boolean> {
  const result = await executor.query(
    `UPDATE outbox_events
     SET
       status = 'delivered',
       delivered_at = clock_timestamp(),
       last_error_code = NULL,
       claimed_at = NULL,
       claimed_by = NULL,
       lease_expires_at = NULL
     WHERE id = $1
       AND status = 'processing'
       AND claimed_by = $2
       AND claim_version = $3`,
    [claim.id, claim.claimedBy, claim.claimVersion.toString()],
  );
  return result.rowCount === 1;
}

export async function retryOutboxEvent(
  executor: QueryExecutor,
  claim: DurableClaim,
  errorCode: string,
  delayMs: number,
): Promise<"pending" | "failed" | "lost"> {
  const result = await executor.query<{ status: "pending" | "failed" }>(
    `UPDATE outbox_events
     SET
       status = CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'pending' END,
       available_at = CASE
         WHEN attempt_count >= max_attempts THEN available_at
         ELSE clock_timestamp() + ($5 * interval '1 millisecond')
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

export async function failOutboxEvent(
  executor: QueryExecutor,
  claim: DurableClaim,
  errorCode: string,
): Promise<boolean> {
  const result = await executor.query(
    `UPDATE outbox_events
     SET
       status = 'failed',
       last_error_code = $4,
       claimed_at = NULL,
       claimed_by = NULL,
       lease_expires_at = NULL
     WHERE id = $1
       AND status = 'processing'
       AND claimed_by = $2
       AND claim_version = $3`,
    [claim.id, claim.claimedBy, claim.claimVersion.toString(), errorCode],
  );
  return result.rowCount === 1;
}
