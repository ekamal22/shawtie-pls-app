import { createHash, randomUUID } from "node:crypto";
import {
  acceptCall,
  appendCallEvent,
  completeLifecycleIdempotency,
  getCurrentPartnershipForAccount,
  getTransactionTimestamp,
  insertCallSession,
  insertOutboxEvent,
  insertScheduledAction,
  listCallHistory,
  loadCall,
  loadCallEndpointAuthorization,
  loadCallParticipants,
  loadCurrentCall,
  lockAccounts,
  lockCall,
  lockPartnershipLifecycle,
  recordEndpointConnected,
  reserveLifecycleIdempotency,
  revokePushSubscriptionForDevice,
  terminalizeCall,
  upsertPushSubscription,
  withTransaction,
  type CallSessionRecord,
  type DatabasePool,
  type LockedPartnershipLifecycle,
  type QueryExecutor,
} from "@shawtie/db";
import {
  evaluateContinueCall,
  evaluateStartCall,
  publicCallOutcome,
  type CallPolicyContext,
} from "@shawtie/domain";
import {
  C2_VIDEO_MEDIA_PROFILE,
  type CallAcceptMutationInput,
  type CallCreateInput,
  type CallFailureMutationInput,
  type CallHistoryQuery,
  type CallProjection,
  type CallVersionMutationInput,
  type PushSubscriptionInput,
} from "@shawtie/contracts";
import { ApiError } from "../../lib/api-error.ts";
import type { AuthContext } from "../../plugins/authentication.ts";
import { resolveCallingConfig, type ApiConfig, type CallingConfig } from "../../config.ts";
import type { AuthKeyRing } from "../../security/auth-key-ring.ts";
import type { TurnCredentialProvider } from "./turn-credential-provider.ts";

const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60_000;

function safeNumber(value: bigint): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error("Call numeric value exceeds safe integer range");
  }
  return number;
}

function fingerprint(value: unknown): Buffer {
  return createHash("sha256").update(JSON.stringify(value)).digest();
}

function sameFingerprint(actual: Buffer | null, expected: Buffer): boolean {
  return Boolean(actual && actual.length === expected.length && actual.equals(expected));
}

function contextFromLifecycle(
  actorAccountId: string,
  lifecycle: LockedPartnershipLifecycle,
): CallPolicyContext {
  const first = lifecycle.memberIds[0];
  const second = lifecycle.memberIds[1];
  if (!first || !second || first === second) {
    throw new Error("C1 requires exactly two partnership members");
  }
  return {
    actorAccountId,
    memberAccountIds: [first, second],
    accountStatuses: lifecycle.accountStatuses,
    partnershipLifecycle: lifecycle.lifecycleState,
    accountDeletionAccountId: lifecycle.accountDeletion?.accountId ?? null,
  };
}

function historyCursor(value: { createdAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({ createdAt: value.createdAt.toISOString(), id: value.id }),
    "utf8",
  ).toString("base64url");
}

function parseHistoryCursor(raw: string | undefined): { createdAt: Date; id: string } | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (
      typeof value.createdAt !== "string" ||
      typeof value.id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(value.id)
    ) {
      throw new Error("invalid");
    }
    const createdAt = new Date(value.createdAt);
    if (!Number.isFinite(createdAt.getTime())) throw new Error("invalid");
    return { createdAt, id: value.id };
  } catch {
    throw new ApiError(400, "VALIDATION_FAILED");
  }
}

export class CallingService {
  readonly database: DatabasePool;
  private readonly calling: CallingConfig;
  private readonly turnProvider: TurnCredentialProvider;
  private readonly keys: AuthKeyRing;

  constructor(
    database: DatabasePool,
    config: ApiConfig,
    turnProvider: TurnCredentialProvider,
    keys: AuthKeyRing,
  ) {
    this.database = database;
    this.calling = resolveCallingConfig(config);
    this.turnProvider = turnProvider;
    this.keys = keys;
  }

  async #lockedLifecycle(
    transaction: QueryExecutor,
    actorAccountId: string,
    expectedPartnershipId?: string,
  ): Promise<{ readonly lifecycle: LockedPartnershipLifecycle; readonly otherAccountId: string }> {
    const current = await getCurrentPartnershipForAccount(transaction, actorAccountId);
    if (!current) throw new ApiError(409, "NO_CURRENT_PARTNERSHIP");
    if (expectedPartnershipId && current.partnershipId !== expectedPartnershipId) {
      throw new ApiError(409, "PARTNERSHIP_CHANGED");
    }

    const lockedAccounts = await lockAccounts(transaction, [
      actorAccountId,
      current.otherAccountId,
    ]);
    if (lockedAccounts.length !== 2) throw new ApiError(409, "CALLING_NOT_ALLOWED");

    const lifecycle = await lockPartnershipLifecycle(transaction, current.partnershipId);
    if (!lifecycle || !lifecycle.memberIds.includes(actorAccountId)) {
      throw new ApiError(409, "PARTNERSHIP_CHANGED");
    }
    return { lifecycle, otherAccountId: current.otherAccountId };
  }

  async #projection(
    executor: QueryExecutor,
    call: CallSessionRecord,
    auth: AuthContext,
  ): Promise<CallProjection> {
    const participants = await loadCallParticipants(executor, call.id);
    const selected = participants.some(
      (participant) =>
        participant.accountId === auth.session.accountId &&
        participant.endpointDeviceId !== null &&
        participant.endpointDeviceId === auth.session.deviceId,
    );

    return {
      id: call.id,
      partnershipId: call.partnershipId,
      kind: call.kind,
      direction: call.initiatedByAccountId === auth.session.accountId ? "outgoing" : "incoming",
      state: call.state,
      version: safeNumber(call.version),
      initiatedAt: call.createdAt.toISOString(),
      ringExpiresAt: call.ringExpiresAt?.toISOString() ?? null,
      acceptedAt: call.acceptedAt?.toISOString() ?? null,
      connectedAt: call.connectedAt?.toISOString() ?? null,
      endedAt: call.endedAt?.toISOString() ?? null,
      outcome: publicCallOutcome(call.terminalReason),
      isThisDeviceSelectedEndpoint: selected,
    };
  }

  async #reserve(
    transaction: QueryExecutor,
    input: {
      readonly accountId: string;
      readonly scope: string;
      readonly idempotencyKey: string;
      readonly request: unknown;
      readonly now: Date;
    },
  ) {
    const requestFingerprint = fingerprint({ v: 1, request: input.request });
    const record = await reserveLifecycleIdempotency(transaction, {
      id: randomUUID(),
      accountId: input.accountId,
      scope: input.scope,
      idempotencyKey: input.idempotencyKey,
      fingerprint: requestFingerprint,
      fingerprintVersion: 1,
      createdAt: input.now,
    });
    if (!sameFingerprint(record.fingerprint, requestFingerprint)) {
      throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED");
    }
    return { record, requestFingerprint };
  }

  async #complete(
    transaction: QueryExecutor,
    recordId: string,
    requestFingerprint: Buffer,
    statusCode: number,
    body: unknown,
    now: Date,
  ): Promise<void> {
    await completeLifecycleIdempotency(transaction, {
      id: recordId,
      fingerprint: requestFingerprint,
      responseStatus: statusCode,
      responseBody: body,
      expiresAt: new Date(now.getTime() + IDEMPOTENCY_RETENTION_MS),
    });
  }

  async #queueChanged(
    transaction: QueryExecutor,
    call: CallSessionRecord,
    accountIds: readonly [string, string],
    pushAccountIds: readonly string[] = accountIds,
  ): Promise<void> {
    const version = safeNumber(call.version);
    await insertOutboxEvent(transaction, {
      id: randomUUID(),
      eventType: "c1.call.changed",
      aggregateType: "call",
      aggregateId: call.id,
      deduplicationKey: `c1:call-changed:${call.id}:${version}`,
      payload: {
        partnershipId: call.partnershipId,
        callId: call.id,
        version,
      },
      payloadVersion: 1,
    });
    if (pushAccountIds.length > 0) {
      await insertOutboxEvent(transaction, {
        id: randomUUID(),
        eventType: "c1.call.push",
        aggregateType: "call",
        aggregateId: call.id,
        deduplicationKey: `c1:call-push:${call.id}:${version}`,
        payload: { accountIds: [...pushAccountIds] },
        payloadVersion: 1,
      });
    }
  }

  async #scheduleDeadline(
    transaction: QueryExecutor,
    call: CallSessionRecord,
    state: "ringing" | "accepted" | "connected",
    executeAt: Date,
  ): Promise<void> {
    await insertScheduledAction(transaction, {
      id: randomUUID(),
      actionType: `c1.call.${state}_timeout`,
      aggregateType: "call",
      aggregateId: call.id,
      executeAt,
      expectedGeneration: call.deadlineGeneration,
      deduplicationKey: `c1:call-timeout:${call.id}:${state}:${call.deadlineGeneration}`,
      payload: { callId: call.id, expectedState: state },
      payloadVersion: 1,
      maxAttempts: 12,
    });
  }

  async create(
    auth: AuthContext,
    input: CallCreateInput,
    idempotencyKey: string,
  ): Promise<CallProjection> {
    if (!this.calling.enabled) throw new ApiError(503, "CALLING_UNAVAILABLE");
    const deviceId = auth.session.deviceId;
    if (!deviceId) throw new ApiError(409, "CALLING_NOT_ALLOWED");
    if (input.kind === "video") {
      if (!this.calling.videoEnabled) throw new ApiError(409, "FEATURE_NOT_AVAILABLE");
      if (input.clientMediaProfile !== C2_VIDEO_MEDIA_PROFILE) {
        throw new ApiError(409, "CALL_MEDIA_PROFILE_UNSUPPORTED");
      }
    }

    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const { lifecycle, otherAccountId } = await this.#lockedLifecycle(
        transaction,
        auth.session.accountId,
        input.expectedPartnershipId,
      );
      const decision = evaluateStartCall(contextFromLifecycle(auth.session.accountId, lifecycle));
      if (!decision.allowed) throw new ApiError(409, "CALLING_NOT_ALLOWED");

      const reserved = await this.#reserve(transaction, {
        accountId: auth.session.accountId,
        scope: `c1.call.create:${lifecycle.partnershipId}`,
        idempotencyKey,
        request: input,
        now,
      });
      if (reserved.record.responseStatus && reserved.record.responseBody) {
        return reserved.record.responseBody as CallProjection;
      }

      const existing = await loadCurrentCall(transaction, lifecycle.partnershipId);
      if (existing) throw new ApiError(409, "CALL_IN_PROGRESS");

      const ringExpiresAt = new Date(now.getTime() + this.calling.ringTimeoutMs);
      const call = await insertCallSession(transaction, {
        id: randomUUID(),
        partnershipId: lifecycle.partnershipId,
        callerAccountId: auth.session.accountId,
        callerDeviceId: deviceId,
        callerSessionId: auth.session.sessionId,
        calleeAccountId: otherAccountId,
        kind: input.kind,
        now,
        ringExpiresAt,
      });
      if (!call) throw new ApiError(409, "CALL_IN_PROGRESS");
      await appendCallEvent(transaction, {
        id: randomUUID(),
        callId: call.id,
        partnershipId: call.partnershipId,
        eventType: "created",
        actorAccountId: auth.session.accountId,
        callVersion: call.version,
        now,
      });
      await this.#scheduleDeadline(transaction, call, "ringing", ringExpiresAt);
      const accountIds = [...lifecycle.memberIds].sort() as [string, string];
      await this.#queueChanged(transaction, call, accountIds, [otherAccountId]);
      const projection = await this.#projection(transaction, call, auth);
      await this.#complete(
        transaction,
        reserved.record.id,
        reserved.requestFingerprint,
        201,
        projection,
        now,
      );
      return projection;
    });
  }

  async current(auth: AuthContext): Promise<{ call: CallProjection | null }> {
    const current = await getCurrentPartnershipForAccount(
      this.database.pool,
      auth.session.accountId,
    );
    if (!current) return { call: null };
    const call = await loadCurrentCall(this.database.pool, current.partnershipId);
    return { call: call ? await this.#projection(this.database.pool, call, auth) : null };
  }

  async get(auth: AuthContext, callId: string): Promise<CallProjection> {
    const current = await getCurrentPartnershipForAccount(
      this.database.pool,
      auth.session.accountId,
    );
    if (!current) throw new ApiError(404, "CALL_NOT_FOUND");
    const call = await loadCall(this.database.pool, callId, current.partnershipId);
    if (!call) throw new ApiError(404, "CALL_NOT_FOUND");
    return this.#projection(this.database.pool, call, auth);
  }

  async history(auth: AuthContext, query: CallHistoryQuery) {
    const current = await getCurrentPartnershipForAccount(
      this.database.pool,
      auth.session.accountId,
    );
    if (!current) return { items: [], nextCursor: null };
    const cursor = parseHistoryCursor(query.cursor);
    const rows = await listCallHistory(this.database.pool, {
      partnershipId: current.partnershipId,
      beforeCreatedAt: cursor?.createdAt ?? null,
      beforeId: cursor?.id ?? null,
      limit: query.limit + 1,
    });
    const visible = rows.slice(0, query.limit);
    const items = visible.map((call) => ({
      id: call.id,
      kind: call.kind,
      direction:
        call.initiatedByAccountId === auth.session.accountId
          ? ("outgoing" as const)
          : ("incoming" as const),
      initiatedAt: call.createdAt.toISOString(),
      connectedAt: call.connectedAt?.toISOString() ?? null,
      endedAt: call.endedAt?.toISOString() ?? null,
      outcome: publicCallOutcome(call.terminalReason),
      durationSeconds:
        call.connectedAt && call.endedAt
          ? Math.max(0, Math.floor((call.endedAt.getTime() - call.connectedAt.getTime()) / 1000))
          : null,
    }));
    const last = visible.at(-1);
    return {
      items,
      nextCursor:
        rows.length > query.limit && last
          ? historyCursor({ createdAt: last.createdAt, id: last.id })
          : null,
    };
  }

  async accept(
    auth: AuthContext,
    callId: string,
    input: CallAcceptMutationInput,
    idempotencyKey: string,
  ): Promise<CallProjection> {
    if (!this.calling.transportEnabled) throw new ApiError(503, "CALL_TRANSPORT_UNAVAILABLE");
    const deviceId = auth.session.deviceId;
    if (!deviceId) throw new ApiError(409, "CALLING_NOT_ALLOWED");
    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const { lifecycle } = await this.#lockedLifecycle(transaction, auth.session.accountId);
      const decision = evaluateContinueCall(
        contextFromLifecycle(auth.session.accountId, lifecycle),
      );
      if (!decision.allowed) throw new ApiError(409, "CALLING_NOT_ALLOWED");
      const call = await lockCall(transaction, callId, lifecycle.partnershipId);
      if (!call) throw new ApiError(404, "CALL_NOT_FOUND");
      if (call.initiatedByAccountId === auth.session.accountId) {
        throw new ApiError(409, "CALL_ACTION_NOT_ALLOWED");
      }
      if (call.kind === "video") {
        if (!this.calling.videoEnabled) throw new ApiError(409, "FEATURE_NOT_AVAILABLE");
        if (input.clientMediaProfile !== C2_VIDEO_MEDIA_PROFILE) {
          throw new ApiError(409, "CALL_MEDIA_PROFILE_UNSUPPORTED");
        }
      }

      const reserved = await this.#reserve(transaction, {
        accountId: auth.session.accountId,
        scope: `c1.call.accept:${call.id}`,
        idempotencyKey,
        request: input,
        now,
      });
      if (reserved.record.responseStatus && reserved.record.responseBody) {
        return reserved.record.responseBody as CallProjection;
      }

      if (call.state !== "ringing") {
        const participants = await loadCallParticipants(transaction, call.id);
        const callee = participants.find((participant) => participant.role === "callee");
        if (
          callee?.endpointDeviceId &&
          (callee.endpointDeviceId !== deviceId ||
            callee.endpointSessionId !== auth.session.sessionId)
        ) {
          throw new ApiError(409, "CALL_ANSWERED_ELSEWHERE");
        }
        throw new ApiError(409, "CALL_NOT_RINGING");
      }
      if (call.version !== BigInt(input.expectedVersion))
        throw new ApiError(409, "VERSION_CONFLICT");
      const connectExpiresAt = new Date(now.getTime() + this.calling.connectTimeoutMs);
      const accepted = await acceptCall(transaction, {
        callId: call.id,
        expectedVersion: call.version,
        calleeAccountId: auth.session.accountId,
        deviceId,
        sessionId: auth.session.sessionId,
        now,
        connectExpiresAt,
      });
      if (!accepted) throw new ApiError(409, "CALL_ANSWERED_ELSEWHERE");

      await appendCallEvent(transaction, {
        id: randomUUID(),
        callId: accepted.id,
        partnershipId: accepted.partnershipId,
        eventType: "accepted",
        actorAccountId: auth.session.accountId,
        callVersion: accepted.version,
        now,
      });
      await this.#scheduleDeadline(transaction, accepted, "accepted", connectExpiresAt);
      const accountIds = [...lifecycle.memberIds].sort() as [string, string];
      await this.#queueChanged(transaction, accepted, accountIds);
      const projection = await this.#projection(transaction, accepted, auth);
      await this.#complete(
        transaction,
        reserved.record.id,
        reserved.requestFingerprint,
        200,
        projection,
        now,
      );
      return projection;
    });
  }

  async #terminalMutation(
    auth: AuthContext,
    callId: string,
    input: CallVersionMutationInput | CallFailureMutationInput,
    idempotencyKey: string,
    action: "reject" | "cancel" | "end" | "fail",
  ): Promise<CallProjection> {
    const deviceId = auth.session.deviceId;
    if (!deviceId) throw new ApiError(409, "CALLING_NOT_ALLOWED");
    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const { lifecycle } = await this.#lockedLifecycle(transaction, auth.session.accountId);
      const call = await lockCall(transaction, callId, lifecycle.partnershipId);
      if (!call) throw new ApiError(404, "CALL_NOT_FOUND");

      const reserved = await this.#reserve(transaction, {
        accountId: auth.session.accountId,
        scope: `c1.call.${action}:${call.id}`,
        idempotencyKey,
        request: input,
        now,
      });
      if (reserved.record.responseStatus && reserved.record.responseBody) {
        return reserved.record.responseBody as CallProjection;
      }
      if (call.version !== BigInt(input.expectedVersion))
        throw new ApiError(409, "VERSION_CONFLICT");

      const participants = await loadCallParticipants(transaction, call.id);
      const mine = participants.find((item) => item.accountId === auth.session.accountId);
      let reason: "rejected" | "cancelled" | "completed" | "failed";
      let allowedStates: readonly ("ringing" | "accepted" | "connected")[];
      const failureCategory = action === "fail" && "category" in input ? input.category : null;

      if (action === "reject") {
        if (call.state !== "ringing" || mine?.role !== "callee") {
          throw new ApiError(409, "CALL_ACTION_NOT_ALLOWED");
        }
        reason = "rejected";
        allowedStates = ["ringing"];
      } else if (action === "cancel") {
        if (call.state !== "ringing" || call.initiatedByAccountId !== auth.session.accountId) {
          throw new ApiError(409, "CALL_ACTION_NOT_ALLOWED");
        }
        reason = "cancelled";
        allowedStates = ["ringing"];
      } else {
        if (
          !mine ||
          mine.endpointDeviceId !== auth.session.deviceId ||
          mine.endpointSessionId !== auth.session.sessionId ||
          !["accepted", "connected"].includes(call.state)
        ) {
          throw new ApiError(409, "CALL_ACTION_NOT_ALLOWED");
        }
        reason = action === "fail" ? "failed" : "completed";
        allowedStates = ["accepted", "connected"];
      }

      const ended = await terminalizeCall(transaction, {
        callId: call.id,
        expectedVersion: call.version,
        allowedStates,
        terminalReason: reason,
        now,
      });
      if (!ended) throw new ApiError(409, "VERSION_CONFLICT");
      await appendCallEvent(transaction, {
        id: randomUUID(),
        callId: ended.id,
        partnershipId: ended.partnershipId,
        eventType: action,
        actorAccountId: auth.session.accountId,
        callVersion: ended.version,
        ...(failureCategory ? { metadata: { category: failureCategory } } : {}),
        now,
      });
      const accountIds = [...lifecycle.memberIds].sort() as [string, string];
      await this.#queueChanged(transaction, ended, accountIds);
      const projection = await this.#projection(transaction, ended, auth);
      await this.#complete(
        transaction,
        reserved.record.id,
        reserved.requestFingerprint,
        200,
        projection,
        now,
      );
      return projection;
    });
  }

  reject(auth: AuthContext, callId: string, input: CallVersionMutationInput, key: string) {
    return this.#terminalMutation(auth, callId, input, key, "reject");
  }

  cancel(auth: AuthContext, callId: string, input: CallVersionMutationInput, key: string) {
    return this.#terminalMutation(auth, callId, input, key, "cancel");
  }

  end(auth: AuthContext, callId: string, input: CallVersionMutationInput, key: string) {
    return this.#terminalMutation(auth, callId, input, key, "end");
  }

  fail(auth: AuthContext, callId: string, input: CallFailureMutationInput, key: string) {
    return this.#terminalMutation(auth, callId, input, key, "fail");
  }

  async endpointConnected(
    auth: AuthContext,
    callId: string,
    idempotencyKey: string,
  ): Promise<CallProjection> {
    const deviceId = auth.session.deviceId;
    if (!deviceId) throw new ApiError(409, "CALLING_NOT_ALLOWED");
    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const { lifecycle } = await this.#lockedLifecycle(transaction, auth.session.accountId);
      const call = await lockCall(transaction, callId, lifecycle.partnershipId);
      if (!call) throw new ApiError(404, "CALL_NOT_FOUND");

      const reserved = await this.#reserve(transaction, {
        accountId: auth.session.accountId,
        scope: `c1.call.endpoint-connected:${call.id}:${deviceId}`,
        idempotencyKey,
        request: {},
        now,
      });
      if (reserved.record.responseStatus && reserved.record.responseBody) {
        return reserved.record.responseBody as CallProjection;
      }

      if (!["accepted", "connected"].includes(call.state)) {
        throw new ApiError(409, "CALL_ACTION_NOT_ALLOWED");
      }
      const hardExpiresAt = new Date(now.getTime() + this.calling.hardTimeoutMs);
      const result = await recordEndpointConnected(transaction, {
        callId: call.id,
        accountId: auth.session.accountId,
        deviceId,
        sessionId: auth.session.sessionId,
        now,
        hardExpiresAt,
      });
      if (!result) throw new ApiError(409, "CALL_ACTION_NOT_ALLOWED");

      if (result.transitioned) {
        await appendCallEvent(transaction, {
          id: randomUUID(),
          callId: result.call.id,
          partnershipId: result.call.partnershipId,
          eventType: "connected",
          actorAccountId: null,
          callVersion: result.call.version,
          now,
        });
        await this.#scheduleDeadline(transaction, result.call, "connected", hardExpiresAt);
        const accountIds = [...lifecycle.memberIds].sort() as [string, string];
        await this.#queueChanged(transaction, result.call, accountIds);
      }
      const projection = await this.#projection(transaction, result.call, auth);
      await this.#complete(
        transaction,
        reserved.record.id,
        reserved.requestFingerprint,
        200,
        projection,
        now,
      );
      return projection;
    });
  }

  async turn(auth: AuthContext, callId: string) {
    if (!this.calling.transportEnabled || !this.turnProvider.available) {
      throw new ApiError(503, "CALL_TRANSPORT_UNAVAILABLE");
    }
    if (!auth.session.deviceId) throw new ApiError(404, "CALL_NOT_FOUND");
    const authorization = await loadCallEndpointAuthorization(this.database.pool, {
      callId,
      accountId: auth.session.accountId,
      deviceId: auth.session.deviceId,
      sessionId: auth.session.sessionId,
    });
    if (!authorization) throw new ApiError(404, "CALL_NOT_FOUND");
    const now = await getTransactionTimestamp(this.database.pool);
    const credential = await this.turnProvider.issue({
      accountId: auth.session.accountId,
      callId,
      now,
    });
    return {
      ...credential,
      urls: [...credential.urls],
      expiresAt: credential.expiresAt.toISOString(),
    };
  }

  async savePushSubscription(auth: AuthContext, input: PushSubscriptionInput): Promise<void> {
    if (!auth.session.deviceId) throw new ApiError(409, "PUSH_NOT_AVAILABLE");
    const now = await getTransactionTimestamp(this.database.pool);
    const endpointFingerprint = this.keys.activeVerifier(
      "push-endpoint-fingerprint",
      input.endpoint,
    );
    await upsertPushSubscription(this.database.pool, {
      deviceId: auth.session.deviceId,
      accountId: auth.session.accountId,
      endpoint: input.endpoint,
      endpointFingerprint: endpointFingerprint.value,
      endpointKeyVersion: endpointFingerprint.version,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      expirationTimeMs:
        input.expirationTime === null || input.expirationTime === undefined
          ? null
          : BigInt(Math.trunc(input.expirationTime)),
      now,
    });
  }

  async removePushSubscription(auth: AuthContext): Promise<void> {
    if (!auth.session.deviceId) return;
    const now = await getTransactionTimestamp(this.database.pool);
    await revokePushSubscriptionForDevice(
      this.database.pool,
      auth.session.deviceId,
      auth.session.accountId,
      now,
    );
  }
}
