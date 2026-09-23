import type { QueryExecutor } from "../types/query-executor.ts";

export type CallState = "ringing" | "accepted" | "connected" | "ended";
export type CallKind = "voice" | "video";
export type CallTerminalReason =
  | "rejected"
  | "cancelled"
  | "missed"
  | "completed"
  | "failed"
  | "authorization_revoked"
  | "partnership_terminated"
  | "account_deletion"
  | "session_revoked";

export interface CallSessionRecord {
  readonly id: string;
  readonly partnershipId: string;
  readonly initiatedByAccountId: string;
  readonly kind: CallKind;
  readonly state: CallState;
  readonly version: bigint;
  readonly deadlineGeneration: bigint;
  readonly ringExpiresAt: Date | null;
  readonly connectExpiresAt: Date | null;
  readonly hardExpiresAt: Date | null;
  readonly acceptedAt: Date | null;
  readonly connectedAt: Date | null;
  readonly endedAt: Date | null;
  readonly terminalReason: CallTerminalReason | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface CallSessionRow {
  id: string;
  partnership_id: string;
  initiated_by_account_id: string;
  call_type: CallKind;
  status: CallState;
  version: string | number | bigint;
  deadline_generation: string | number | bigint;
  ring_expires_at: Date | null;
  connect_expires_at: Date | null;
  hard_expires_at: Date | null;
  accepted_at: Date | null;
  connected_at: Date | null;
  ended_at: Date | null;
  terminal_reason: CallTerminalReason | null;
  created_at: Date;
  updated_at: Date;
}

export interface CallParticipantRecord {
  readonly accountId: string;
  readonly role: "caller" | "callee";
  readonly endpointDeviceId: string | null;
  readonly acceptedAt: Date | null;
  readonly connectedAt: Date | null;
}

interface CallParticipantRow {
  account_id: string;
  role: "caller" | "callee";
  endpoint_device_id: string | null;
  accepted_at: Date | null;
  connected_at: Date | null;
}

function asBigInt(value: string | number | bigint): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

function mapSession(row: CallSessionRow): CallSessionRecord {
  return {
    id: row.id,
    partnershipId: row.partnership_id,
    initiatedByAccountId: row.initiated_by_account_id,
    kind: row.call_type,
    state: row.status,
    version: asBigInt(row.version),
    deadlineGeneration: asBigInt(row.deadline_generation),
    ringExpiresAt: row.ring_expires_at,
    connectExpiresAt: row.connect_expires_at,
    hardExpiresAt: row.hard_expires_at,
    acceptedAt: row.accepted_at,
    connectedAt: row.connected_at,
    endedAt: row.ended_at,
    terminalReason: row.terminal_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const sessionColumns = `
  id, partnership_id, initiated_by_account_id, call_type, status, version,
  deadline_generation, ring_expires_at, connect_expires_at, hard_expires_at,
  accepted_at, connected_at, ended_at, terminal_reason, created_at, updated_at
`;

export async function insertCallSession(
  executor: QueryExecutor,
  input: {
    readonly id: string;
    readonly partnershipId: string;
    readonly callerAccountId: string;
    readonly callerDeviceId: string;
    readonly calleeAccountId: string;
    readonly kind: CallKind;
    readonly now: Date;
    readonly ringExpiresAt: Date;
  },
): Promise<CallSessionRecord> {
  const result = await executor.query<CallSessionRow>(
    `INSERT INTO call_sessions (
       id, partnership_id, initiated_by_account_id, call_type, status,
       version, deadline_generation, ring_expires_at, created_at, updated_at
     )
     VALUES ($1,$2,$3,$4,'ringing',1,1,$5,$6,$6)
     RETURNING ${sessionColumns}`,
    [input.id, input.partnershipId, input.callerAccountId, input.kind, input.ringExpiresAt, input.now],
  );
  await executor.query(
    `INSERT INTO call_participants (
       call_session_id, partnership_id, account_id, role, endpoint_device_id, accepted_at
     )
     VALUES
       ($1,$2,$3,'caller',$4,$5),
       ($1,$2,$6,'callee',NULL,NULL)`,
    [
      input.id,
      input.partnershipId,
      input.callerAccountId,
      input.callerDeviceId,
      input.now,
      input.calleeAccountId,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Call insert did not return row");
  return mapSession(row);
}

export async function loadCall(
  executor: QueryExecutor,
  callId: string,
  partnershipId: string,
): Promise<CallSessionRecord | null> {
  const result = await executor.query<CallSessionRow>(
    `SELECT ${sessionColumns}
     FROM call_sessions
     WHERE id=$1 AND partnership_id=$2`,
    [callId, partnershipId],
  );
  return result.rows[0] ? mapSession(result.rows[0]) : null;
}

export async function lockCall(
  executor: QueryExecutor,
  callId: string,
  partnershipId: string,
): Promise<CallSessionRecord | null> {
  const result = await executor.query<CallSessionRow>(
    `SELECT ${sessionColumns}
     FROM call_sessions
     WHERE id=$1 AND partnership_id=$2
     FOR UPDATE`,
    [callId, partnershipId],
  );
  return result.rows[0] ? mapSession(result.rows[0]) : null;
}

export async function loadCurrentCall(
  executor: QueryExecutor,
  partnershipId: string,
): Promise<CallSessionRecord | null> {
  const result = await executor.query<CallSessionRow>(
    `SELECT ${sessionColumns}
     FROM call_sessions
     WHERE partnership_id=$1 AND status <> 'ended'
     ORDER BY created_at DESC
     LIMIT 1`,
    [partnershipId],
  );
  return result.rows[0] ? mapSession(result.rows[0]) : null;
}

export async function loadCallParticipants(
  executor: QueryExecutor,
  callId: string,
): Promise<readonly CallParticipantRecord[]> {
  const result = await executor.query<CallParticipantRow>(
    `SELECT account_id, role, endpoint_device_id, accepted_at, connected_at
     FROM call_participants
     WHERE call_session_id=$1
     ORDER BY role DESC`,
    [callId],
  );
  return result.rows.map((row) => ({
    accountId: row.account_id,
    role: row.role,
    endpointDeviceId: row.endpoint_device_id,
    acceptedAt: row.accepted_at,
    connectedAt: row.connected_at,
  }));
}

export async function acceptCall(
  executor: QueryExecutor,
  input: {
    readonly callId: string;
    readonly expectedVersion: bigint;
    readonly calleeAccountId: string;
    readonly deviceId: string;
    readonly now: Date;
    readonly connectExpiresAt: Date;
  },
): Promise<CallSessionRecord | null> {
  const selected = await executor.query(
    `UPDATE call_participants
     SET endpoint_device_id=$4, accepted_at=COALESCE(accepted_at,$5)
     WHERE call_session_id=$1
       AND account_id=$2
       AND role='callee'
       AND (endpoint_device_id IS NULL OR endpoint_device_id=$4)`,
    [input.callId, input.calleeAccountId, "callee", input.deviceId, input.now],
  );
  if (selected.rowCount !== 1) return null;
  const result = await executor.query<CallSessionRow>(
    `UPDATE call_sessions
     SET status='accepted',
         version=version+1,
         deadline_generation=deadline_generation+1,
         accepted_at=COALESCE(accepted_at,$4),
         connect_expires_at=$5,
         updated_at=$4
     WHERE id=$1 AND status='ringing' AND version=$2
     RETURNING ${sessionColumns}`,
    [input.callId, input.expectedVersion.toString(), input.calleeAccountId, input.now, input.connectExpiresAt],
  );
  return result.rows[0] ? mapSession(result.rows[0]) : null;
}

export async function terminalizeCall(
  executor: QueryExecutor,
  input: {
    readonly callId: string;
    readonly expectedVersion: bigint | null;
    readonly allowedStates: readonly CallState[];
    readonly terminalReason: CallTerminalReason;
    readonly now: Date;
  },
): Promise<CallSessionRecord | null> {
  const result = await executor.query<CallSessionRow>(
    `UPDATE call_sessions
     SET status='ended',
         version=version+1,
         deadline_generation=deadline_generation+1,
         ended_at=$4,
         terminal_reason=$5,
         updated_at=$4
     WHERE id=$1
       AND status = ANY($2::text[])
       AND ($3::bigint IS NULL OR version=$3)
     RETURNING ${sessionColumns}`,
    [
      input.callId,
      [...input.allowedStates],
      input.expectedVersion?.toString() ?? null,
      input.now,
      input.terminalReason,
    ],
  );
  return result.rows[0] ? mapSession(result.rows[0]) : null;
}

export async function recordEndpointConnected(
  executor: QueryExecutor,
  input: {
    readonly callId: string;
    readonly accountId: string;
    readonly deviceId: string;
    readonly now: Date;
    readonly hardExpiresAt: Date;
  },
): Promise<{ readonly call: CallSessionRecord; readonly transitioned: boolean } | null> {
  const marked = await executor.query(
    `UPDATE call_participants
     SET connected_at=COALESCE(connected_at,$4)
     WHERE call_session_id=$1
       AND account_id=$2
       AND endpoint_device_id=$3
       AND role IN ('caller','callee')`,
    [input.callId, input.accountId, input.deviceId, input.now],
  );
  if (marked.rowCount !== 1) return null;

  const count = await executor.query<{ connected_count: string }>(
    `SELECT count(*)::text AS connected_count
     FROM call_participants
     WHERE call_session_id=$1
       AND endpoint_device_id IS NOT NULL
       AND connected_at IS NOT NULL`,
    [input.callId],
  );
  const both = Number(count.rows[0]?.connected_count ?? "0") === 2;
  if (both) {
    const transitioned = await executor.query<CallSessionRow>(
      `UPDATE call_sessions
       SET status='connected',
           version=version+1,
           deadline_generation=deadline_generation+1,
           connected_at=COALESCE(connected_at,$2),
           hard_expires_at=COALESCE(hard_expires_at,$3),
           updated_at=$2
       WHERE id=$1 AND status='accepted'
       RETURNING ${sessionColumns}`,
      [input.callId, input.now, input.hardExpiresAt],
    );
    if (transitioned.rows[0]) return { call: mapSession(transitioned.rows[0]), transitioned: true };
  }

  const current = await executor.query<CallSessionRow>(
    `SELECT ${sessionColumns} FROM call_sessions WHERE id=$1`,
    [input.callId],
  );
  return current.rows[0] ? { call: mapSession(current.rows[0]), transitioned: false } : null;
}

export async function timeoutCall(
  executor: QueryExecutor,
  input: {
    readonly callId: string;
    readonly expectedGeneration: bigint;
    readonly expectedState: "ringing" | "accepted" | "connected";
    readonly reason: "missed" | "failed";
    readonly now: Date;
  },
): Promise<CallSessionRecord | null> {
  const deadlineColumn =
    input.expectedState === "ringing"
      ? "ring_expires_at"
      : input.expectedState === "accepted"
        ? "connect_expires_at"
        : "hard_expires_at";
  const result = await executor.query<CallSessionRow>(
    `UPDATE call_sessions
     SET status='ended',
         version=version+1,
         deadline_generation=deadline_generation+1,
         ended_at=$4,
         terminal_reason=$5,
         updated_at=$4
     WHERE id=$1
       AND deadline_generation=$2
       AND status=$3
       AND ${deadlineColumn} IS NOT NULL
       AND ${deadlineColumn} <= $4
     RETURNING ${sessionColumns}`,
    [input.callId, input.expectedGeneration.toString(), input.expectedState, input.now, input.reason],
  );
  return result.rows[0] ? mapSession(result.rows[0]) : null;
}

export async function appendCallEvent(
  executor: QueryExecutor,
  input: {
    readonly id: string;
    readonly callId: string;
    readonly partnershipId: string;
    readonly eventType: string;
    readonly actorAccountId: string | null;
    readonly callVersion: bigint;
    readonly metadata?: Readonly<Record<string, unknown>>;
    readonly now: Date;
  },
): Promise<void> {
  await executor.query(
    `INSERT INTO call_events (
       id, call_session_id, partnership_id, event_type, actor_account_id,
       call_version, metadata_json, created_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
    [
      input.id,
      input.callId,
      input.partnershipId,
      input.eventType,
      input.actorAccountId,
      input.callVersion.toString(),
      JSON.stringify(input.metadata ?? {}),
      input.now,
    ],
  );
}

export async function listCallHistory(
  executor: QueryExecutor,
  input: {
    readonly partnershipId: string;
    readonly beforeCreatedAt?: Date | null;
    readonly beforeId?: string | null;
    readonly limit: number;
  },
): Promise<readonly CallSessionRecord[]> {
  const result = await executor.query<CallSessionRow>(
    `SELECT ${sessionColumns}
     FROM call_sessions
     WHERE partnership_id=$1
       AND (
         $2::timestamptz IS NULL
         OR (created_at,id) < ($2::timestamptz,$3::uuid)
       )
     ORDER BY created_at DESC, id DESC
     LIMIT $4`,
    [input.partnershipId, input.beforeCreatedAt ?? null, input.beforeId ?? null, input.limit],
  );
  return result.rows.map(mapSession);
}

export async function loadCallEndpointAuthorization(
  executor: QueryExecutor,
  input: { readonly callId: string; readonly accountId: string; readonly deviceId: string },
): Promise<{
  readonly partnershipId: string;
  readonly state: CallState;
  readonly version: bigint;
  readonly role: "caller" | "callee";
} | null> {
  const result = await executor.query<{
    partnership_id: string;
    status: CallState;
    version: string | number | bigint;
    role: "caller" | "callee";
  }>(
    `SELECT session.partnership_id, session.status, session.version, participant.role
     FROM call_sessions AS session
     JOIN call_participants AS participant
       ON participant.call_session_id=session.id
     JOIN partnerships AS partnership
       ON partnership.id=session.partnership_id
     JOIN accounts AS account
       ON account.id=participant.account_id
     JOIN account_devices AS device
       ON device.id=participant.endpoint_device_id
      AND device.account_id=participant.account_id
     WHERE session.id=$1
       AND participant.account_id=$2
       AND participant.endpoint_device_id=$3
       AND session.status IN ('accepted','connected')
       AND partnership.lifecycle_state IN ('active','breakup_pending')
       AND account.status='active'
       AND device.revoked_at IS NULL`,
    [input.callId, input.accountId, input.deviceId],
  );
  const row = result.rows[0];
  return row
    ? {
        partnershipId: row.partnership_id,
        state: row.status,
        version: asBigInt(row.version),
        role: row.role,
      }
    : null;
}

export async function loadCallDeadlineGeneration(
  executor: QueryExecutor,
  callId: string,
): Promise<bigint> {
  const result = await executor.query<{ deadline_generation: string | number | bigint }>(
    "SELECT deadline_generation FROM call_sessions WHERE id=$1",
    [callId],
  );
  const row = result.rows[0];
  return row ? asBigInt(row.deadline_generation) : 0n;
}
