import type { QueryExecutor } from "../types/query-executor.ts";
import type { DurableClaim } from "../types/claim.ts";

export interface DeletionTarget {
  readonly id: string;
  readonly manifestId: string;
  readonly targetType: string;
  readonly targetKey: string;
  readonly status: "pending" | "processing" | "completed" | "failed";
  readonly attemptCount: number;
  readonly availableAt: Date;
  readonly claimedAt: Date | null;
  readonly claimedBy: string | null;
  readonly leaseExpiresAt: Date | null;
  readonly claimVersion: bigint;
  readonly lastErrorCode: string | null;
}

interface DeletionTargetRow {
  id: string;
  manifest_id: string;
  target_type: string;
  target_key: string;
  status: DeletionTarget["status"];
  attempt_count: number;
  available_at: Date;
  claimed_at: Date | null;
  claimed_by: string | null;
  lease_expires_at: Date | null;
  claim_version: string | number | bigint;
  last_error_code: string | null;
}

const targetColumns = `
  id, manifest_id, target_type, target_key, status, attempt_count, available_at,
  claimed_at, claimed_by, lease_expires_at, claim_version, last_error_code
`;

function mapTarget(row: DeletionTargetRow): DeletionTarget {
  return {
    id: row.id,
    manifestId: row.manifest_id,
    targetType: row.target_type,
    targetKey: row.target_key,
    status: row.status,
    attemptCount: row.attempt_count,
    availableAt: row.available_at,
    claimedAt: row.claimed_at,
    claimedBy: row.claimed_by,
    leaseExpiresAt: row.lease_expires_at,
    claimVersion: BigInt(row.claim_version),
    lastErrorCode: row.last_error_code,
  };
}

export interface CreateDeletionManifest {
  readonly id: string;
  readonly subjectType: "partnership" | "account";
  readonly subjectId: string;
  readonly reason: string;
  readonly accessRevokedAt: Date;
  readonly targets: readonly {
    readonly id: string;
    readonly targetType: string;
    readonly targetKey: string;
  }[];
}

export async function createDeletionManifest(
  executor: QueryExecutor,
  input: CreateDeletionManifest,
): Promise<void> {
  await executor.query(
    `INSERT INTO deletion_manifests (
       id, subject_type, subject_id, reason, status, access_revoked_at
     )
     VALUES ($1, $2, $3, $4, 'pending', $5)`,
    [input.id, input.subjectType, input.subjectId, input.reason, input.accessRevokedAt],
  );

  for (const target of input.targets) {
    await executor.query(
      `INSERT INTO deletion_targets (id, manifest_id, target_type, target_key)
       VALUES ($1, $2, $3, $4)`,
      [target.id, input.id, target.targetType, target.targetKey],
    );
  }
}

export async function createPartnershipDeletionManifestIfAbsent(
  executor: QueryExecutor,
  input: CreateDeletionManifest,
): Promise<string | null> {
  if (input.subjectType !== "partnership") {
    throw new Error("Partnership deletion manifest requires partnership subject");
  }
  const created = await executor.query<{ id: string }>(
    "INSERT INTO deletion_manifests (id, subject_type, subject_id, reason, status, access_revoked_at) VALUES ($1,$2,$3,$4,'pending',$5) ON CONFLICT (subject_type, subject_id) WHERE subject_type = 'partnership' DO NOTHING RETURNING id",
    [input.id, input.subjectType, input.subjectId, input.reason, input.accessRevokedAt],
  );
  const manifestId = created.rows[0]?.id ?? null;
  if (!manifestId) return null;

  for (const target of input.targets) {
    await executor.query(
      "INSERT INTO deletion_targets (id, manifest_id, target_type, target_key) VALUES ($1,$2,$3,$4)",
      [target.id, manifestId, target.targetType, target.targetKey],
    );
  }
  return manifestId;
}

export async function claimDeletionTargets(
  executor: QueryExecutor,
  batchSize: number,
  workerId: string,
  leaseMs: number,
): Promise<readonly DeletionTarget[]> {
  const result = await executor.query<DeletionTargetRow>(
    `WITH candidates AS (
       SELECT id
       FROM deletion_targets
       WHERE
         (status = 'pending' AND available_at <= clock_timestamp())
         OR
         (status = 'processing' AND lease_expires_at <= clock_timestamp())
       ORDER BY
         CASE WHEN status = 'pending' THEN available_at ELSE lease_expires_at END,
         id
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     ),
     claimed AS (
       UPDATE deletion_targets AS target
       SET
         status = 'processing',
         claimed_at = clock_timestamp(),
         claimed_by = $2,
         lease_expires_at = clock_timestamp() + ($3 * interval '1 millisecond'),
         claim_version = target.claim_version + 1,
         attempt_count = target.attempt_count + 1
       FROM candidates
       WHERE target.id = candidates.id
       RETURNING target.*
     ),
     manifests AS (
       UPDATE deletion_manifests AS manifest
       SET status = 'processing'
       WHERE manifest.status = 'pending'
         AND manifest.id IN (SELECT manifest_id FROM claimed)
       RETURNING manifest.id
     )
     SELECT ${targetColumns}
     FROM claimed`,
    [batchSize, workerId, leaseMs],
  );
  return result.rows.map(mapTarget);
}

export async function renewDeletionTargetLease(
  executor: QueryExecutor,
  claim: DurableClaim,
  leaseMs: number,
): Promise<boolean> {
  const result = await executor.query(
    `UPDATE deletion_targets
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

export async function completeDeletionTarget(
  executor: QueryExecutor,
  claim: DurableClaim,
): Promise<string | null> {
  const result = await executor.query<{ manifest_id: string }>(
    `UPDATE deletion_targets
     SET
       status = 'completed',
       completed_at = clock_timestamp(),
       last_error_code = NULL,
       claimed_at = NULL,
       claimed_by = NULL,
       lease_expires_at = NULL
     WHERE id = $1
       AND status = 'processing'
       AND claimed_by = $2
       AND claim_version = $3
     RETURNING manifest_id`,
    [claim.id, claim.claimedBy, claim.claimVersion.toString()],
  );
  return result.rows[0]?.manifest_id ?? null;
}

export async function retryDeletionTarget(
  executor: QueryExecutor,
  claim: DurableClaim,
  errorCode: string,
  delayMs: number,
): Promise<boolean> {
  const result = await executor.query(
    `UPDATE deletion_targets
     SET
       status = 'pending',
       available_at = clock_timestamp() + ($5 * interval '1 millisecond'),
       last_error_code = $4,
       claimed_at = NULL,
       claimed_by = NULL,
       lease_expires_at = NULL
     WHERE id = $1
       AND status = 'processing'
       AND claimed_by = $2
       AND claim_version = $3`,
    [claim.id, claim.claimedBy, claim.claimVersion.toString(), errorCode, delayMs],
  );
  return result.rowCount === 1;
}

export async function failDeletionTarget(
  executor: QueryExecutor,
  claim: DurableClaim,
  errorCode: string,
): Promise<string | null> {
  const result = await executor.query<{ manifest_id: string }>(
    `UPDATE deletion_targets
     SET
       status = 'failed',
       last_error_code = $4,
       claimed_at = NULL,
       claimed_by = NULL,
       lease_expires_at = NULL
     WHERE id = $1
       AND status = 'processing'
       AND claimed_by = $2
       AND claim_version = $3
     RETURNING manifest_id`,
    [claim.id, claim.claimedBy, claim.claimVersion.toString(), errorCode],
  );
  const manifestId = result.rows[0]?.manifest_id ?? null;
  if (manifestId) {
    await executor.query(
      `UPDATE deletion_manifests
       SET status = 'failed', last_error_code = $2
       WHERE id = $1 AND status <> 'completed'`,
      [manifestId, errorCode],
    );
  }
  return manifestId;
}

export async function resumeFailedDeletionTarget(
  executor: QueryExecutor,
  targetId: string,
  delayMs = 0,
): Promise<string | null> {
  const result = await executor.query<{ manifest_id: string }>(
    `UPDATE deletion_targets
     SET
       status = 'pending',
       available_at = clock_timestamp() + ($2 * interval '1 millisecond'),
       last_error_code = NULL,
       completed_at = NULL,
       claimed_at = NULL,
       claimed_by = NULL,
       lease_expires_at = NULL
     WHERE id = $1
       AND status = 'failed'
     RETURNING manifest_id`,
    [targetId, delayMs],
  );

  const manifestId = result.rows[0]?.manifest_id ?? null;
  if (manifestId) {
    await executor.query(
      `UPDATE deletion_manifests
       SET status = 'pending', completed_at = NULL, last_error_code = NULL
       WHERE id = $1 AND status = 'failed'`,
      [manifestId],
    );
  }
  return manifestId;
}

export async function completeDeletionManifestIfReady(
  executor: QueryExecutor,
  manifestId: string,
): Promise<boolean> {
  const result = await executor.query(
    `UPDATE deletion_manifests AS manifest
     SET
       status = 'completed',
       completed_at = clock_timestamp(),
       last_error_code = NULL
     WHERE manifest.id = $1
       AND manifest.access_revoked_at IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM deletion_targets AS target
         WHERE target.manifest_id = manifest.id
           AND target.status <> 'completed'
       )`,
    [manifestId],
  );
  return result.rowCount === 1;
}
