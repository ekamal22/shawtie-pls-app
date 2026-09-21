import type { QueryExecutor } from "../types/query-executor.ts";

export type PartnerRequestStatus =
  "pending" | "accepted" | "declined" | "cancelled" | "expired" | "invalidated";

export type PartnerRequestInvalidationReason =
  "account_unavailable" | "partnership_formed" | "block_created";

export interface PartnerRequestRecord {
  readonly id: string;
  readonly senderAccountId: string;
  readonly recipientAccountId: string;
  readonly status: PartnerRequestStatus;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly relationshipStartDate: string | null;
  readonly declinedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly acceptedAt: Date | null;
  readonly expiredAt: Date | null;
  readonly invalidatedAt: Date | null;
  readonly invalidatedReason: PartnerRequestInvalidationReason | null;
  readonly acceptedPartnershipId: string | null;
}

interface PartnerRequestDbRow {
  id: string;
  sender_account_id: string;
  recipient_account_id: string;
  status: PartnerRequestStatus;
  created_at: Date;
  expires_at: Date;
  relationship_start_date: string | null;
  declined_at: Date | null;
  cancelled_at: Date | null;
  accepted_at: Date | null;
  expired_at: Date | null;
  invalidated_at: Date | null;
  invalidated_reason: PartnerRequestInvalidationReason | null;
  accepted_partnership_id: string | null;
}

function mapRequest(row: PartnerRequestDbRow): PartnerRequestRecord {
  return {
    id: row.id,
    senderAccountId: row.sender_account_id,
    recipientAccountId: row.recipient_account_id,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    relationshipStartDate: row.relationship_start_date,
    declinedAt: row.declined_at,
    cancelledAt: row.cancelled_at,
    acceptedAt: row.accepted_at,
    expiredAt: row.expired_at,
    invalidatedAt: row.invalidated_at,
    invalidatedReason: row.invalidated_reason,
    acceptedPartnershipId: row.accepted_partnership_id,
  };
}

const requestColumns = `
  id, sender_account_id, recipient_account_id, status, created_at, expires_at,
  relationship_start_date::text, declined_at, cancelled_at, accepted_at,
  expired_at, invalidated_at, invalidated_reason, accepted_partnership_id
`;

export interface PartnerAccountEligibility {
  readonly accountId: string;
  readonly usernameNormalized: string;
  readonly status: "active" | "deletion_pending" | "deleted";
  readonly occupied: boolean;
  readonly partnerEligibleAt: Date | null;
}

export async function loadPartnerAccountEligibility(
  executor: QueryExecutor,
  accountId: string,
): Promise<PartnerAccountEligibility | null> {
  const result = await executor.query<{
    account_id: string;
    username_normalized: string;
    status: "active" | "deletion_pending" | "deleted";
    occupied: boolean;
    partner_eligible_at: Date | null;
  }>(
    `SELECT a.id AS account_id, a.username_normalized, a.status,
            EXISTS (
              SELECT 1 FROM partnership_members member
              WHERE member.account_id = a.id AND member.released_at IS NULL
            ) AS occupied,
            (
              SELECT eligibility.eligible_at
              FROM account_partner_eligibility eligibility
              WHERE eligibility.account_id = a.id
                AND eligibility.resolved_at IS NULL
              ORDER BY eligibility.eligible_at DESC
              LIMIT 1
            ) AS partner_eligible_at
     FROM accounts a
     WHERE a.id = $1`,
    [accountId],
  );
  const row = result.rows[0];
  return row
    ? {
        accountId: row.account_id,
        usernameNormalized: row.username_normalized,
        status: row.status,
        occupied: row.occupied,
        partnerEligibleAt: row.partner_eligible_at,
      }
    : null;
}

export async function activeBlockExistsForPair(
  executor: QueryExecutor,
  accountA: string,
  accountB: string,
): Promise<boolean> {
  const result = await executor.query(
    `SELECT 1
     FROM partnership_blocks
     WHERE removed_at IS NULL
       AND (
         (blocker_account_id = $1 AND blocked_account_id = $2)
         OR (blocker_account_id = $2 AND blocked_account_id = $1)
       )
     LIMIT 1`,
    [accountA, accountB],
  );
  return result.rowCount === 1;
}

export async function loadPartnerRequestParticipants(
  executor: QueryExecutor,
  requestId: string,
): Promise<{ senderAccountId: string; recipientAccountId: string } | null> {
  const result = await executor.query<{
    sender_account_id: string;
    recipient_account_id: string;
  }>(
    `SELECT sender_account_id, recipient_account_id
     FROM partner_requests
     WHERE id = $1`,
    [requestId],
  );
  const row = result.rows[0];
  return row
    ? { senderAccountId: row.sender_account_id, recipientAccountId: row.recipient_account_id }
    : null;
}

export async function lockPartnerRequest(
  executor: QueryExecutor,
  requestId: string,
): Promise<PartnerRequestRecord | null> {
  const result = await executor.query<PartnerRequestDbRow>(
    `SELECT ${requestColumns}
     FROM partner_requests
     WHERE id = $1
     FOR UPDATE`,
    [requestId],
  );
  const row = result.rows[0];
  return row ? mapRequest(row) : null;
}

export async function lockPairPendingRequests(
  executor: QueryExecutor,
  accountA: string,
  accountB: string,
): Promise<readonly PartnerRequestRecord[]> {
  const result = await executor.query<PartnerRequestDbRow>(
    `SELECT ${requestColumns}
     FROM partner_requests
     WHERE status = 'pending'
       AND (
         (sender_account_id = $1 AND recipient_account_id = $2)
         OR (sender_account_id = $2 AND recipient_account_id = $1)
       )
     ORDER BY id
     FOR UPDATE`,
    [accountA, accountB],
  );
  return result.rows.map(mapRequest);
}


export async function lockPartnerRequestsById(
  executor: QueryExecutor,
  requestIds: readonly string[],
): Promise<readonly PartnerRequestRecord[]> {
  if (requestIds.length === 0) return [];
  const sorted = [...new Set(requestIds)].sort();
  const result = await executor.query<PartnerRequestDbRow>(
    `SELECT ${requestColumns}
     FROM partner_requests
     WHERE id = ANY($1::uuid[])
     ORDER BY id
     FOR UPDATE`,
    [sorted],
  );
  return result.rows.map(mapRequest);
}

export async function markPartnerRequestsAccepted(
  executor: QueryExecutor,
  requestIds: readonly string[],
  partnershipId: string,
  acceptedAt: Date,
): Promise<number> {
  if (requestIds.length === 0) return 0;
  const result = await executor.query(
    `UPDATE partner_requests
     SET status = 'accepted',
         accepted_at = $3,
         accepted_partnership_id = $2
     WHERE id = ANY($1::uuid[])
       AND status = 'pending'
       AND expires_at > $3
       AND relationship_start_date IS NOT NULL
       AND accepted_partnership_id IS NULL`,
    [[...requestIds], partnershipId, acceptedAt],
  );
  return result.rowCount ?? 0;
}

export async function expirePartnerRequestsById(
  executor: QueryExecutor,
  requestIds: readonly string[],
  at: Date,
): Promise<readonly string[]> {
  if (requestIds.length === 0) return [];
  const result = await executor.query<{ id: string }>(
    `UPDATE partner_requests
     SET status = 'expired', expired_at = expires_at
     WHERE id = ANY($1::uuid[])
       AND status = 'pending'
       AND expires_at <= $2
     RETURNING id`,
    [requestIds, at],
  );
  return result.rows.map((row) => row.id);
}

export async function insertPartnerRequest(
  executor: QueryExecutor,
  input: {
    id: string;
    senderAccountId: string;
    recipientAccountId: string;
    relationshipStartDate: string;
    createdAt: Date;
    expiresAt: Date;
  },
): Promise<void> {
  await executor.query(
    `INSERT INTO partner_requests (
       id, sender_account_id, recipient_account_id, status, created_at, expires_at,
       relationship_start_date
     ) VALUES ($1,$2,$3,'pending',$4,$5,$6::date)`,
    [
      input.id,
      input.senderAccountId,
      input.recipientAccountId,
      input.createdAt,
      input.expiresAt,
      input.relationshipStartDate,
    ],
  );
}

export async function appendPartnerRequestAttempt(
  executor: QueryExecutor,
  input: {
    id: string;
    requestId?: string | null;
    senderAccountId: string;
    recipientAccountId: string;
    outcome: string;
    createdAt: Date;
  },
): Promise<void> {
  await executor.query(
    `INSERT INTO partner_request_attempts (
       id, request_id, sender_account_id, recipient_account_id, outcome, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      input.id,
      input.requestId ?? null,
      input.senderAccountId,
      input.recipientAccountId,
      input.outcome,
      input.createdAt,
    ],
  );
}

export async function countCreatedPartnerRequestAttemptsSince(
  executor: QueryExecutor,
  senderAccountId: string,
  recipientAccountId: string,
  cutoff: Date,
  now: Date,
): Promise<number> {
  const result = await executor.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM partner_request_attempts
     WHERE sender_account_id = $1
       AND recipient_account_id = $2
       AND outcome = 'created'
       AND created_at > $3
       AND created_at <= $4`,
    [senderAccountId, recipientAccountId, cutoff, now],
  );
  return Number(result.rows[0]?.count ?? "0");
}

export async function latestDeclinedPartnerRequestAt(
  executor: QueryExecutor,
  senderAccountId: string,
  recipientAccountId: string,
): Promise<Date | null> {
  const result = await executor.query<{ declined_at: Date }>(
    `SELECT declined_at
     FROM partner_requests
     WHERE sender_account_id = $1
       AND recipient_account_id = $2
       AND status = 'declined'
       AND declined_at IS NOT NULL
     ORDER BY declined_at DESC
     LIMIT 1`,
    [senderAccountId, recipientAccountId],
  );
  return result.rows[0]?.declined_at ?? null;
}

export async function setPartnerRequestCancelled(
  executor: QueryExecutor,
  requestId: string,
  at: Date,
): Promise<void> {
  await executor.query(
    `UPDATE partner_requests
     SET status = 'cancelled', cancelled_at = $2
     WHERE id = $1 AND status = 'pending'`,
    [requestId, at],
  );
}

export async function setPartnerRequestDeclined(
  executor: QueryExecutor,
  requestId: string,
  at: Date,
): Promise<void> {
  await executor.query(
    `UPDATE partner_requests
     SET status = 'declined', declined_at = $2
     WHERE id = $1 AND status = 'pending'`,
    [requestId, at],
  );
}

export async function setPartnerRequestExpired(
  executor: QueryExecutor,
  requestId: string,
  at: Date,
): Promise<"expired" | "terminal" | "too_early" | "missing"> {
  const locked = await lockPartnerRequest(executor, requestId);
  if (!locked) return "missing";
  if (locked.status !== "pending") return "terminal";
  if (at.getTime() < locked.expiresAt.getTime()) return "too_early";
  await executor.query(
    `UPDATE partner_requests
     SET status = 'expired', expired_at = expires_at
     WHERE id = $1 AND status = 'pending'`,
    [requestId],
  );
  return "expired";
}

export interface PartnerRequestListRow {
  readonly requestId: string;
  readonly senderAccountId: string;
  readonly recipientAccountId: string;
  readonly counterpartAccountId: string;
  readonly counterpartUsername: string;
  readonly counterpartDisplayName: string;
  readonly counterpartDateOfBirth: string;
  readonly counterpartBio: string | null;
  readonly counterpartAvatarObjectId: string | null;
  readonly relationshipStartDate: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export async function listActivePartnerRequests(
  executor: QueryExecutor,
  input: {
    accountId: string;
    direction: "incoming" | "outgoing";
    now: Date;
    snapshotAt: Date;
    cursorCreatedAt?: Date;
    cursorRequestId?: string;
    limit: number;
  },
): Promise<readonly PartnerRequestListRow[]> {
  const ownerColumn =
    input.direction === "incoming" ? "request.recipient_account_id" : "request.sender_account_id";
  const counterpartColumn =
    input.direction === "incoming" ? "request.sender_account_id" : "request.recipient_account_id";
  const result = await executor.query<{
    request_id: string;
    sender_account_id: string;
    recipient_account_id: string;
    counterpart_account_id: string;
    username_display: string;
    display_name: string;
    date_of_birth: string;
    bio: string | null;
    avatar_object_id: string | null;
    relationship_start_date: string;
    created_at: Date;
    expires_at: Date;
  }>(
    `SELECT request.id AS request_id, request.sender_account_id, request.recipient_account_id,
            counterpart.id AS counterpart_account_id, counterpart.username_display,
            profile.display_name, counterpart.date_of_birth::text, profile.bio,
            profile.avatar_object_id, request.relationship_start_date::text,
            request.created_at, request.expires_at
     FROM partner_requests request
     JOIN accounts counterpart ON counterpart.id = ${counterpartColumn}
     JOIN account_profiles profile ON profile.account_id = counterpart.id
     WHERE ${ownerColumn} = $1
       AND request.status = 'pending'
       AND request.expires_at > $2
       AND request.relationship_start_date IS NOT NULL
       AND request.created_at <= $3
       AND (
         $4::timestamptz IS NULL
         OR (request.created_at, request.id) < ($4::timestamptz, $5::uuid)
       )
     ORDER BY request.created_at DESC, request.id DESC
     LIMIT $6`,
    [
      input.accountId,
      input.now,
      input.snapshotAt,
      input.cursorCreatedAt ?? null,
      input.cursorRequestId ?? null,
      input.limit,
    ],
  );
  return result.rows.map((row) => ({
    requestId: row.request_id,
    senderAccountId: row.sender_account_id,
    recipientAccountId: row.recipient_account_id,
    counterpartAccountId: row.counterpart_account_id,
    counterpartUsername: row.username_display,
    counterpartDisplayName: row.display_name,
    counterpartDateOfBirth: row.date_of_birth,
    counterpartBio: row.bio,
    counterpartAvatarObjectId: row.avatar_object_id,
    relationshipStartDate: row.relationship_start_date,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }));
}

async function invalidate(
  executor: QueryExecutor,
  predicateSql: string,
  predicateParams: readonly string[],
  at: Date,
  reason: PartnerRequestInvalidationReason,
): Promise<number> {
  const params = [...predicateParams, at, reason];
  const atIndex = predicateParams.length + 1;
  const reasonIndex = predicateParams.length + 2;
  const result = await executor.query(
    `WITH locked AS (
       SELECT id
       FROM partner_requests
       WHERE status = 'pending' AND (${predicateSql})
       ORDER BY id
       FOR UPDATE
     )
     UPDATE partner_requests request
     SET status = 'invalidated',
         invalidated_at = $${atIndex},
         invalidated_reason = $${reasonIndex}
     FROM locked
     WHERE request.id = locked.id`,
    params,
  );
  return result.rowCount ?? 0;
}

export function invalidatePendingRequestsForAccount(
  executor: QueryExecutor,
  accountId: string,
  invalidatedAt: Date,
  reason: PartnerRequestInvalidationReason,
): Promise<number> {
  return invalidate(
    executor,
    "sender_account_id = $1 OR recipient_account_id = $1",
    [accountId],
    invalidatedAt,
    reason,
  );
}

export function invalidatePendingRequestsForPair(
  executor: QueryExecutor,
  accountA: string,
  accountB: string,
  invalidatedAt: Date,
  reason: PartnerRequestInvalidationReason,
): Promise<number> {
  return invalidate(
    executor,
    "(sender_account_id = $1 AND recipient_account_id = $2) OR " +
      "(sender_account_id = $2 AND recipient_account_id = $1)",
    [accountA, accountB],
    invalidatedAt,
    reason,
  );
}

export interface PartnerRequestIdempotencyRecord {
  readonly id: string;
  readonly fingerprint: Buffer | null;
  readonly responseStatus: number | null;
  readonly responseBody: unknown;
  readonly expiresAt: Date | null;
}

function mapIdempotency(row: {
  id: string;
  request_fingerprint: Buffer | null;
  response_status: number | null;
  response_body: unknown;
  expires_at: Date | null;
}): PartnerRequestIdempotencyRecord {
  return {
    id: row.id,
    fingerprint: row.request_fingerprint,
    responseStatus: row.response_status,
    responseBody: row.response_body,
    expiresAt: row.expires_at,
  };
}

export async function findCompletedPartnerRequestIdempotency(
  executor: QueryExecutor,
  accountId: string,
  idempotencyKey: string,
): Promise<PartnerRequestIdempotencyRecord | null> {
  const result = await executor.query<{
    id: string;
    request_fingerprint: Buffer | null;
    response_status: number | null;
    response_body: unknown;
    expires_at: Date | null;
  }>(
    `SELECT id, request_fingerprint, response_status, response_body, expires_at
     FROM idempotency_records
     WHERE account_id = $1
       AND scope = 'partner_request_create'
       AND idempotency_key = $2
       AND response_status IS NOT NULL
     LIMIT 1`,
    [accountId, idempotencyKey],
  );
  const row = result.rows[0];
  return row ? mapIdempotency(row) : null;
}

export async function reservePartnerRequestIdempotency(
  executor: QueryExecutor,
  input: {
    id: string;
    accountId: string;
    idempotencyKey: string;
    fingerprint: Buffer;
    createdAt: Date;
  },
): Promise<{ record: PartnerRequestIdempotencyRecord; created: boolean }> {
  const inserted = await executor.query(
    `INSERT INTO idempotency_records (
       id, account_id, scope, idempotency_key, request_fingerprint, created_at
     ) VALUES ($1,$2,'partner_request_create',$3,$4,$5)
     ON CONFLICT (account_id, scope, idempotency_key) DO NOTHING
     RETURNING id`,
    [input.id, input.accountId, input.idempotencyKey, input.fingerprint, input.createdAt],
  );
  const result = await executor.query<{
    id: string;
    request_fingerprint: Buffer | null;
    response_status: number | null;
    response_body: unknown;
    expires_at: Date | null;
  }>(
    `SELECT id, request_fingerprint, response_status, response_body, expires_at
     FROM idempotency_records
     WHERE account_id = $1
       AND scope = 'partner_request_create'
       AND idempotency_key = $2
     FOR UPDATE`,
    [input.accountId, input.idempotencyKey],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Idempotency reservation disappeared");
  return { record: mapIdempotency(row), created: inserted.rowCount === 1 };
}

export async function completePartnerRequestIdempotency(
  executor: QueryExecutor,
  input: {
    id: string;
    fingerprint: Buffer;
    responseStatus: number;
    responseBody: unknown;
    expiresAt: Date;
  },
): Promise<void> {
  const result = await executor.query(
    `UPDATE idempotency_records
     SET response_status = $3,
         response_body = $4::jsonb,
         expires_at = $5
     WHERE id = $1
       AND request_fingerprint = $2
       AND response_status IS NULL`,
    [
      input.id,
      input.fingerprint,
      input.responseStatus,
      JSON.stringify(input.responseBody),
      input.expiresAt,
    ],
  );
  if (result.rowCount !== 1) throw new Error("Idempotency response could not be stored");
}
