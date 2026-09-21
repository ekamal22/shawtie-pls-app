import type { QueryExecutor } from "../types/query-executor.ts";

export type LifecycleAccountStatus = "active" | "deletion_pending" | "deleted";
export type LifecycleState = "active" | "breakup_pending" | "terminated";
export type LifecycleTerminationReason = "breakup" | "partner_account_deleted";

export interface OpenBreakupProcess {
  readonly id: string;
  readonly partnershipId: string;
  readonly initiatedByAccountId: string;
  readonly initiatedAt: Date;
  readonly initiatorCancelUntil: Date;
  readonly baseDeadline: Date;
  readonly finalDeadline: Date;
  readonly generation: bigint;
  readonly restoreIntentAt: Readonly<Record<string, Date>>;
}

export interface PartnershipDeletionOverlay {
  readonly accountId: string;
  readonly requestedAt: Date;
  readonly recoverUntil: Date;
  readonly generation: bigint;
}

export interface LockedPartnershipLifecycle {
  readonly partnershipId: string;
  readonly lifecycleState: LifecycleState;
  readonly relationshipStartDate: string;
  readonly metadataVersion: bigint;
  readonly generation: bigint;
  readonly activatedAt: Date;
  readonly terminatedAt: Date | null;
  readonly terminationReason: LifecycleTerminationReason | null;
  readonly memberIds: readonly string[];
  readonly accountStatuses: Readonly<Record<string, LifecycleAccountStatus>>;
  readonly breakup: OpenBreakupProcess | null;
  readonly accountDeletion: PartnershipDeletionOverlay | null;
}

export async function loadLifecycleMemberIds(
  executor: QueryExecutor,
  partnershipId: string,
): Promise<readonly string[]> {
  const result = await executor.query<{ account_id: string }>(
    "SELECT account_id FROM partnership_members WHERE partnership_id = $1 ORDER BY account_id",
    [partnershipId],
  );
  return result.rows.map((row) => row.account_id);
}

async function loadOpenBreakup(
  executor: QueryExecutor,
  partnershipId: string,
): Promise<OpenBreakupProcess | null> {
  const result = await executor.query<{
    id: string;
    partnership_id: string;
    initiated_by_account_id: string;
    initiated_at: Date;
    initiator_cancel_until: Date;
    base_deadline: Date;
    final_deadline: Date;
    generation: string | number | bigint;
  }>(
    "SELECT id, partnership_id, initiated_by_account_id, initiated_at, initiator_cancel_until, base_deadline, final_deadline, generation FROM breakup_processes WHERE partnership_id = $1 AND restored_at IS NULL AND dissolved_at IS NULL AND cancelled_at IS NULL AND superseded_at IS NULL LIMIT 1",
    [partnershipId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const intents = await executor.query<{ account_id: string; submitted_at: Date }>(
    "SELECT account_id, submitted_at FROM breakup_restore_intents WHERE breakup_process_id = $1 ORDER BY account_id",
    [row.id],
  );
  return {
    id: row.id,
    partnershipId: row.partnership_id,
    initiatedByAccountId: row.initiated_by_account_id,
    initiatedAt: row.initiated_at,
    initiatorCancelUntil: row.initiator_cancel_until,
    baseDeadline: row.base_deadline,
    finalDeadline: row.final_deadline,
    generation: BigInt(row.generation),
    restoreIntentAt: Object.fromEntries(
      intents.rows.map((intent) => [intent.account_id, intent.submitted_at]),
    ),
  };
}

export async function lockPartnershipLifecycle(
  executor: QueryExecutor,
  partnershipId: string,
): Promise<LockedPartnershipLifecycle | null> {
  const partnership = await executor.query<{
    id: string;
    lifecycle_state: LifecycleState;
    relationship_start_date: string;
    version: string | number | bigint;
    generation: string | number | bigint;
    activated_at: Date;
    terminated_at: Date | null;
    termination_reason: LifecycleTerminationReason | null;
  }>(
    "SELECT id, lifecycle_state, relationship_start_date::text, version, generation, activated_at, terminated_at, termination_reason FROM partnerships WHERE id = $1 FOR UPDATE",
    [partnershipId],
  );
  const row = partnership.rows[0];
  if (!row) return null;

  const members = await executor.query<{ account_id: string; status: LifecycleAccountStatus }>(
    "SELECT member.account_id, account.status FROM partnership_members member JOIN accounts account ON account.id = member.account_id WHERE member.partnership_id = $1 ORDER BY member.account_id",
    [partnershipId],
  );
  const deletion = await executor.query<{
    account_id: string;
    requested_at: Date;
    recover_until: Date;
    generation: string | number | bigint;
  }>(
    "SELECT request.account_id, request.requested_at, request.recover_until, request.generation FROM account_deletion_requests request JOIN partnership_members member ON member.account_id = request.account_id AND member.partnership_id = $1 WHERE request.status = 'pending' ORDER BY request.requested_at, request.account_id LIMIT 1",
    [partnershipId],
  );
  const deletionRow = deletion.rows[0];

  return {
    partnershipId: row.id,
    lifecycleState: row.lifecycle_state,
    relationshipStartDate: row.relationship_start_date,
    metadataVersion: BigInt(row.version),
    generation: BigInt(row.generation),
    activatedAt: row.activated_at,
    terminatedAt: row.terminated_at,
    terminationReason: row.termination_reason,
    memberIds: members.rows.map((member) => member.account_id),
    accountStatuses: Object.fromEntries(
      members.rows.map((member) => [member.account_id, member.status]),
    ),
    breakup: await loadOpenBreakup(executor, partnershipId),
    accountDeletion: deletionRow
      ? {
          accountId: deletionRow.account_id,
          requestedAt: deletionRow.requested_at,
          recoverUntil: deletionRow.recover_until,
          generation: BigInt(deletionRow.generation),
        }
      : null,
  };
}

export async function insertBreakupProcess(
  executor: QueryExecutor,
  input: {
    readonly id: string;
    readonly partnershipId: string;
    readonly initiatedByAccountId: string;
    readonly initiatedAt: Date;
    readonly initiatorCancelUntil: Date;
    readonly baseDeadline: Date;
    readonly finalDeadline: Date;
    readonly generation: bigint;
  },
): Promise<void> {
  await executor.query(
    "INSERT INTO breakup_processes (id, partnership_id, initiated_by_account_id, initiated_at, initiator_cancel_until, base_deadline, final_deadline, generation) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      input.id,
      input.partnershipId,
      input.initiatedByAccountId,
      input.initiatedAt,
      input.initiatorCancelUntil,
      input.baseDeadline,
      input.finalDeadline,
      input.generation.toString(),
    ],
  );
}

export async function setPartnershipBreakupPending(
  executor: QueryExecutor,
  partnershipId: string,
  expectedGeneration: bigint,
  at: Date,
): Promise<bigint | null> {
  const result = await executor.query<{ generation: string | number | bigint }>(
    "UPDATE partnerships SET lifecycle_state = 'breakup_pending', generation = generation + 1, updated_at = $3 WHERE id = $1 AND lifecycle_state = 'active' AND generation = $2 RETURNING generation",
    [partnershipId, expectedGeneration.toString(), at],
  );
  const row = result.rows[0];
  return row ? BigInt(row.generation) : null;
}

export async function markBreakupCancelled(
  executor: QueryExecutor,
  input: {
    readonly partnershipId: string;
    readonly breakupId: string;
    readonly expectedGeneration: bigint;
    readonly cancelledAt: Date;
  },
): Promise<bigint | null> {
  const breakup = await executor.query(
    "UPDATE breakup_processes SET cancelled_at = $3 WHERE id = $1 AND partnership_id = $2 AND generation = $4 AND restored_at IS NULL AND dissolved_at IS NULL AND cancelled_at IS NULL AND superseded_at IS NULL",
    [
      input.breakupId,
      input.partnershipId,
      input.cancelledAt,
      input.expectedGeneration.toString(),
    ],
  );
  if (breakup.rowCount !== 1) return null;
  const result = await executor.query<{ generation: string | number | bigint }>(
    "UPDATE partnerships SET lifecycle_state = 'active', generation = generation + 1, updated_at = $2 WHERE id = $1 AND lifecycle_state = 'breakup_pending' RETURNING generation",
    [input.partnershipId, input.cancelledAt],
  );
  const row = result.rows[0];
  return row ? BigInt(row.generation) : null;
}

export async function insertBreakupRestoreIntent(
  executor: QueryExecutor,
  input: {
    readonly breakupProcessId: string;
    readonly partnershipId: string;
    readonly accountId: string;
    readonly submittedAt: Date;
  },
): Promise<boolean> {
  const result = await executor.query(
    "INSERT INTO breakup_restore_intents (breakup_process_id, partnership_id, account_id, submitted_at) VALUES ($1,$2,$3,$4) ON CONFLICT (breakup_process_id, account_id) DO NOTHING",
    [input.breakupProcessId, input.partnershipId, input.accountId, input.submittedAt],
  );
  return result.rowCount === 1;
}

export async function extendBreakupDeadline(
  executor: QueryExecutor,
  input: {
    readonly partnershipId: string;
    readonly breakupId: string;
    readonly expectedGeneration: bigint;
    readonly finalDeadline: Date;
    readonly at: Date;
  },
): Promise<bigint | null> {
  const partnership = await executor.query<{ generation: string | number | bigint }>(
    "UPDATE partnerships SET generation = generation + 1, updated_at = $3 WHERE id = $1 AND lifecycle_state = 'breakup_pending' AND generation = $2 RETURNING generation",
    [input.partnershipId, input.expectedGeneration.toString(), input.at],
  );
  const row = partnership.rows[0];
  if (!row) return null;
  const generation = BigInt(row.generation);
  const breakup = await executor.query(
    "UPDATE breakup_processes SET final_deadline = $3, generation = $4 WHERE id = $1 AND partnership_id = $2 AND generation = $5 AND restored_at IS NULL AND dissolved_at IS NULL AND cancelled_at IS NULL AND superseded_at IS NULL",
    [
      input.breakupId,
      input.partnershipId,
      input.finalDeadline,
      generation.toString(),
      input.expectedGeneration.toString(),
    ],
  );
  if (breakup.rowCount !== 1) {
    throw new Error("Breakup generation changed after partnership generation update");
  }
  return generation;
}

export async function restorePartnership(
  executor: QueryExecutor,
  input: {
    readonly partnershipId: string;
    readonly breakupId: string;
    readonly expectedGeneration: bigint;
    readonly restoredAt: Date;
  },
): Promise<bigint | null> {
  const breakup = await executor.query(
    "UPDATE breakup_processes SET restored_at = $3 WHERE id = $1 AND partnership_id = $2 AND generation = $4 AND restored_at IS NULL AND dissolved_at IS NULL AND cancelled_at IS NULL AND superseded_at IS NULL",
    [
      input.breakupId,
      input.partnershipId,
      input.restoredAt,
      input.expectedGeneration.toString(),
    ],
  );
  if (breakup.rowCount !== 1) return null;
  const result = await executor.query<{ generation: string | number | bigint }>(
    "UPDATE partnerships SET lifecycle_state = 'active', generation = generation + 1, updated_at = $2 WHERE id = $1 AND lifecycle_state = 'breakup_pending' RETURNING generation",
    [input.partnershipId, input.restoredAt],
  );
  const row = result.rows[0];
  return row ? BigInt(row.generation) : null;
}

export async function getOpenBreakupGeneration(
  executor: QueryExecutor,
  breakupId: string,
): Promise<bigint> {
  const result = await executor.query<{ generation: string | number | bigint }>(
    "SELECT generation FROM breakup_processes WHERE id = $1 AND restored_at IS NULL AND dissolved_at IS NULL AND cancelled_at IS NULL AND superseded_at IS NULL",
    [breakupId],
  );
  return BigInt(result.rows[0]?.generation ?? 0);
}

export async function loadBreakupPartnershipId(
  executor: QueryExecutor,
  breakupId: string,
): Promise<string | null> {
  const result = await executor.query<{ partnership_id: string }>(
    "SELECT partnership_id FROM breakup_processes WHERE id = $1",
    [breakupId],
  );
  return result.rows[0]?.partnership_id ?? null;
}

export async function cancelPendingScheduledActionsForAggregate(
  executor: QueryExecutor,
  aggregateType: string,
  aggregateId: string,
  cancelledAt: Date,
): Promise<number> {
  const result = await executor.query(
    "UPDATE scheduled_actions SET status = 'cancelled', completed_at = $3 WHERE aggregate_type = $1 AND aggregate_id = $2 AND status = 'pending'",
    [aggregateType, aggregateId, cancelledAt],
  );
  return result.rowCount ?? 0;
}

export async function resolveExpiredPartnerEligibility(
  executor: QueryExecutor,
  accountIds: readonly string[],
  at: Date,
): Promise<number> {
  if (accountIds.length === 0) return 0;
  const result = await executor.query(
    "UPDATE account_partner_eligibility SET resolved_at = $2 WHERE account_id = ANY($1::uuid[]) AND resolved_at IS NULL AND eligible_at <= $2",
    [[...accountIds], at],
  );
  return result.rowCount ?? 0;
}

export async function insertPartnerCooldown(
  executor: QueryExecutor,
  input: {
    readonly id: string;
    readonly accountId: string;
    readonly sourcePartnershipId: string;
    readonly reason: "breakup_dissolution" | "partner_account_deleted";
    readonly createdAt: Date;
  },
): Promise<Date> {
  const interval = input.reason === "breakup_dissolution" ? "3 months" : "1 month";
  const result = await executor.query<{ eligible_at: Date }>(
    "INSERT INTO account_partner_eligibility (id, account_id, source_partnership_id, reason, created_at, eligible_at) VALUES ($1,$2,$3,$4,$5,$5::timestamptz + $6::interval) RETURNING eligible_at",
    [
      input.id,
      input.accountId,
      input.sourcePartnershipId,
      input.reason,
      input.createdAt,
      interval,
    ],
  );
  const eligibleAt = result.rows[0]?.eligible_at;
  if (!eligibleAt) throw new Error("Partner cooldown was not created");
  return eligibleAt;
}

export async function terminatePartnershipLifecycle(
  executor: QueryExecutor,
  input: {
    readonly partnershipId: string;
    readonly reason: LifecycleTerminationReason;
    readonly effectiveAt: Date;
  },
): Promise<bigint | null> {
  const result = await executor.query<{ generation: string | number | bigint }>(
    "UPDATE partnerships SET lifecycle_state = 'terminated', terminated_at = $2, termination_reason = $3, generation = generation + 1, updated_at = $2 WHERE id = $1 AND lifecycle_state <> 'terminated' RETURNING generation",
    [input.partnershipId, input.effectiveAt, input.reason],
  );
  const row = result.rows[0];
  if (!row) return null;
  await executor.query(
    "UPDATE partnership_members SET released_at = COALESCE(released_at, $2) WHERE partnership_id = $1 AND released_at IS NULL",
    [input.partnershipId, input.effectiveAt],
  );
  return BigInt(row.generation);
}

export async function markBreakupDissolved(
  executor: QueryExecutor,
  breakupId: string,
  dissolvedAt: Date,
): Promise<boolean> {
  const result = await executor.query(
    "UPDATE breakup_processes SET dissolved_at = $2 WHERE id = $1 AND restored_at IS NULL AND dissolved_at IS NULL AND cancelled_at IS NULL AND superseded_at IS NULL",
    [breakupId, dissolvedAt],
  );
  return result.rowCount === 1;
}

export async function markOpenBreakupSuperseded(
  executor: QueryExecutor,
  partnershipId: string,
  supersededAt: Date,
): Promise<string | null> {
  const result = await executor.query<{ id: string }>(
    "UPDATE breakup_processes SET superseded_at = $2 WHERE partnership_id = $1 AND restored_at IS NULL AND dissolved_at IS NULL AND cancelled_at IS NULL AND superseded_at IS NULL RETURNING id",
    [partnershipId, supersededAt],
  );
  return result.rows[0]?.id ?? null;
}

export interface LifecycleIdempotencyRecord {
  readonly id: string;
  readonly fingerprint: Buffer | null;
  readonly responseStatus: number | null;
  readonly responseBody: unknown;
}

export async function reserveLifecycleIdempotency(
  executor: QueryExecutor,
  input: {
    readonly id: string;
    readonly accountId: string;
    readonly scope: string;
    readonly idempotencyKey: string;
    readonly fingerprint: Buffer;
    readonly createdAt: Date;
  },
): Promise<LifecycleIdempotencyRecord> {
  await executor.query(
    "INSERT INTO idempotency_records (id, account_id, scope, idempotency_key, request_fingerprint, created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (account_id, scope, idempotency_key) DO NOTHING",
    [
      input.id,
      input.accountId,
      input.scope,
      input.idempotencyKey,
      input.fingerprint,
      input.createdAt,
    ],
  );
  const result = await executor.query<{
    id: string;
    request_fingerprint: Buffer | null;
    response_status: number | null;
    response_body: unknown;
  }>(
    "SELECT id, request_fingerprint, response_status, response_body FROM idempotency_records WHERE account_id = $1 AND scope = $2 AND idempotency_key = $3 FOR UPDATE",
    [input.accountId, input.scope, input.idempotencyKey],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Lifecycle idempotency reservation missing");
  return {
    id: row.id,
    fingerprint: row.request_fingerprint,
    responseStatus: row.response_status,
    responseBody: row.response_body,
  };
}

export async function completeLifecycleIdempotency(
  executor: QueryExecutor,
  input: {
    readonly id: string;
    readonly fingerprint: Buffer;
    readonly responseStatus: number;
    readonly responseBody: unknown;
    readonly expiresAt: Date;
  },
): Promise<void> {
  await executor.query(
    "UPDATE idempotency_records SET request_fingerprint = $2, response_status = $3, response_body = $4::jsonb, expires_at = $5 WHERE id = $1",
    [
      input.id,
      input.fingerprint,
      input.responseStatus,
      JSON.stringify(input.responseBody),
      input.expiresAt,
    ],
  );
}

export interface FormerPartnershipRow {
  readonly partnershipId: string;
  readonly terminatedAt: Date;
  readonly terminationReason: LifecycleTerminationReason;
  readonly releasedAt: Date;
  readonly formerPartnerAccountId: string;
  readonly formerPartnerUsername: string | null;
  readonly formerPartnerDisplayName: string | null;
  readonly blockedByMe: boolean;
}

export async function listFormerPartnerships(
  executor: QueryExecutor,
  input: {
    readonly accountId: string;
    readonly snapshotAt: Date;
    readonly cursorReleasedAt?: Date;
    readonly cursorPartnershipId?: string;
    readonly limit: number;
  },
): Promise<readonly FormerPartnershipRow[]> {
  const result = await executor.query<{
    partnership_id: string;
    terminated_at: Date;
    termination_reason: LifecycleTerminationReason;
    released_at: Date;
    former_partner_account_id: string;
    former_partner_username: string | null;
    former_partner_display_name: string | null;
    blocked_by_me: boolean;
  }>(
    "SELECT partnership.id AS partnership_id, partnership.terminated_at, partnership.termination_reason, self_member.released_at, other_member.account_id AS former_partner_account_id, other_account.username_display AS former_partner_username, other_profile.display_name AS former_partner_display_name, EXISTS (SELECT 1 FROM partnership_blocks block WHERE block.blocker_account_id = $1 AND block.blocked_account_id = other_member.account_id AND block.source_partnership_id = partnership.id AND block.removed_at IS NULL) AS blocked_by_me FROM partnership_members self_member JOIN partnerships partnership ON partnership.id = self_member.partnership_id JOIN partnership_members other_member ON other_member.partnership_id = partnership.id AND other_member.account_id <> self_member.account_id LEFT JOIN accounts other_account ON other_account.id = other_member.account_id LEFT JOIN account_profiles other_profile ON other_profile.account_id = other_member.account_id WHERE self_member.account_id = $1 AND self_member.released_at IS NOT NULL AND partnership.lifecycle_state = 'terminated' AND self_member.released_at <= $2 AND ($3::timestamptz IS NULL OR (self_member.released_at, partnership.id) < ($3::timestamptz, $4::uuid)) ORDER BY self_member.released_at DESC, partnership.id DESC LIMIT $5",
    [
      input.accountId,
      input.snapshotAt,
      input.cursorReleasedAt ?? null,
      input.cursorPartnershipId ?? null,
      input.limit,
    ],
  );
  return result.rows.map((row) => ({
    partnershipId: row.partnership_id,
    terminatedAt: row.terminated_at,
    terminationReason: row.termination_reason,
    releasedAt: row.released_at,
    formerPartnerAccountId: row.former_partner_account_id,
    formerPartnerUsername: row.former_partner_username,
    formerPartnerDisplayName: row.former_partner_display_name,
    blockedByMe: row.blocked_by_me,
  }));
}

export async function insertFormerPartnerBlock(
  executor: QueryExecutor,
  input: {
    readonly id: string;
    readonly blockerAccountId: string;
    readonly blockedAccountId: string;
    readonly sourcePartnershipId: string;
    readonly createdAt: Date;
  },
): Promise<void> {
  await executor.query(
    "INSERT INTO partnership_blocks (id, blocker_account_id, blocked_account_id, source_partnership_id, created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (blocker_account_id, blocked_account_id) WHERE removed_at IS NULL DO NOTHING",
    [
      input.id,
      input.blockerAccountId,
      input.blockedAccountId,
      input.sourcePartnershipId,
      input.createdAt,
    ],
  );
}

export async function removeFormerPartnerBlock(
  executor: QueryExecutor,
  blockerAccountId: string,
  sourcePartnershipId: string,
  removedAt: Date,
): Promise<boolean> {
  const result = await executor.query(
    "UPDATE partnership_blocks SET removed_at = $3 WHERE blocker_account_id = $1 AND source_partnership_id = $2 AND removed_at IS NULL",
    [blockerAccountId, sourcePartnershipId, removedAt],
  );
  return result.rowCount === 1;
}

export async function deletePartnershipRelationalContent(
  executor: QueryExecutor,
  partnershipId: string,
): Promise<void> {
  await executor.query("DELETE FROM relationship_events WHERE partnership_id = $1", [partnershipId]);
  await executor.query("DELETE FROM relationship_items WHERE partnership_id = $1", [partnershipId]);
  await executor.query("DELETE FROM media_objects WHERE partnership_id = $1", [partnershipId]);
  await executor.query("DELETE FROM call_sessions WHERE partnership_id = $1", [partnershipId]);
  await executor.query("DELETE FROM conversations WHERE partnership_id = $1", [partnershipId]);
}

export async function deletePartnershipCryptoState(
  executor: QueryExecutor,
  partnershipId: string,
): Promise<void> {
  await executor.query("DELETE FROM partnership_crypto_epochs WHERE partnership_id = $1", [
    partnershipId,
  ]);
}
