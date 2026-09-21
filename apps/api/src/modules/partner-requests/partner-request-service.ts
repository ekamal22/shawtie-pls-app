import { createHash, randomUUID } from "node:crypto";
import {
  activeBlockExistsForPair,
  appendPartnerRequestAttempt,
  completePartnerRequestIdempotency,
  countCreatedPartnerRequestAttemptsSince,
  expirePartnerRequestsById,
  findCompletedPartnerRequestIdempotency,
  findDiscoverableAccountByUsername,
  getTransactionTimestamp,
  insertPartnerRequest,
  insertScheduledAction,
  latestDeclinedPartnerRequestAt,
  listActivePartnerRequests,
  loadPartnerAccountEligibility,
  loadPartnerRequestParticipants,
  lockAccounts,
  lockPairPendingRequests,
  lockPartnerRequest,
  reservePartnerRequestIdempotency,
  setPartnerRequestCancelled,
  setPartnerRequestDeclined,
  withTransaction,
  type DatabasePool,
  type PartnerRequestRecord,
  type QueryExecutor,
} from "@shawtie/db";
import {
  ageOnDate,
  evaluatePartnerRequestPair,
  normalizeUsername,
  relationshipStartDateAllowed,
  rollingMonthCutoffUtc,
  trustedUtcDate,
} from "@shawtie/domain";
import {
  parseAtBoundary,
  partnerRequestCursorSchema,
  type PartnerRequestCreateInput,
  type PartnerRequestCursor,
  type PartnerRequestListQuery,
} from "@shawtie/contracts";
import { ApiError } from "../../lib/api-error.ts";
import type { AuthContext } from "../../plugins/authentication.ts";
import type { AccountService } from "../accounts/account-service.ts";

const HOUR = 60 * 60_000;
const TEN_MINUTES = 10 * 60_000;
const DAY = 24 * HOUR;
const IDEMPOTENCY_DENIAL_RETENTION = DAY;

export type PartnerRequestMode = "disabled" | "request_only_test" | "paired";

export interface ReciprocalPairCandidate {
  readonly accountIds: readonly [string, string];
  readonly requestIds: readonly [string, string];
  readonly triggeringRequestId: string;
  readonly relationshipStartDate: string;
  readonly observedAt: Date;
}

export interface PartnershipFormationCoordinator {
  handleReciprocalCandidate(
    executor: QueryExecutor,
    candidate: ReciprocalPairCandidate,
    now: Date,
  ): Promise<{ partnershipId: string }>;
}

export interface PartnerRequestServiceOptions {
  readonly mode: PartnerRequestMode;
  readonly coordinator?: PartnershipFormationCoordinator;
}

interface StoredResponse {
  readonly statusCode: number;
  readonly body: unknown;
}

interface CreateError {
  readonly ok: false;
  readonly statusCode: number;
  readonly code: string;
}

interface CreateSuccess {
  readonly ok: true;
  readonly statusCode: number;
  readonly body: unknown;
}

type CreateDecision = CreateError | CreateSuccess;

function addDays(at: Date, days: number): Date {
  return new Date(at.getTime() + days * DAY);
}

function requestFingerprint(input: PartnerRequestCreateInput): Buffer {
  return createHash("sha256")
    .update(
      JSON.stringify({
        recipientAccountId: input.recipientAccountId,
        expectedUsername: normalizeUsername(input.expectedUsername).normalized,
        relationshipStartDate: input.relationshipStartDate,
      }),
    )
    .digest();
}

function sameFingerprint(left: Buffer | null, right: Buffer): boolean {
  return Boolean(left && left.length === right.length && left.equals(right));
}

function encodeCursor(cursor: PartnerRequestCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(raw: string): PartnerRequestCursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    return parseAtBoundary(partnerRequestCursorSchema, parsed);
  } catch {
    throw new ApiError(400, "VALIDATION_FAILED");
  }
}

function validDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function activeRequestsAt(
  requests: readonly PartnerRequestRecord[],
  now: Date,
): readonly PartnerRequestRecord[] {
  return requests.filter(
    (request) => request.status === "pending" && request.expiresAt.getTime() > now.getTime(),
  );
}

function sortedPair(accountA: string, accountB: string): readonly [string, string] {
  return accountA.localeCompare(accountB) <= 0 ? [accountA, accountB] : [accountB, accountA];
}

function sortedRequestPair(requestA: string, requestB: string): readonly [string, string] {
  return requestA.localeCompare(requestB) <= 0 ? [requestA, requestB] : [requestB, requestA];
}

function attemptOutcomeForCode(code: string): string {
  switch (code) {
    case "REQUEST_SELF":
      return "self_request";
    case "REQUEST_ALREADY_PENDING":
      return "duplicate";
    case "REQUEST_MONTHLY_LIMIT":
      return "monthly_limit";
    case "REQUEST_DECLINE_COOLDOWN":
      return "decline_cooldown";
    case "TARGET_CHANGED":
      return "target_changed";
    case "TARGET_UNAVAILABLE":
      return "target_unavailable";
    default:
      return "sender_ineligible";
  }
}

export class PartnerRequestService {
  readonly database: DatabasePool;
  readonly accountService: AccountService;
  readonly mode: PartnerRequestMode;
  readonly coordinator: PartnershipFormationCoordinator | undefined;

  constructor(
    database: DatabasePool,
    accountService: AccountService,
    options: PartnerRequestServiceOptions,
  ) {
    this.database = database;
    this.accountService = accountService;
    this.mode = options.mode;
    this.coordinator = options.coordinator;
    if (this.mode === "paired" && !this.coordinator) {
      throw new Error("paired partner-request mode requires a partnership formation coordinator");
    }
  }

  async discover(
    auth: AuthContext,
    usernameInput: string,
    networkKey: string,
  ): Promise<{
    result: null | {
      accountId: string;
      username: string;
      displayName: string;
      age: number;
      bio: string | null;
    };
  }> {
    await this.accountService.consumeSecurityRateLimit([
      {
        scope: "partner_discovery_account",
        subject: auth.session.accountId,
        limit: 60,
        windowMs: TEN_MINUTES,
        blockMs: TEN_MINUTES,
      },
      {
        scope: "partner_discovery_network",
        subject: networkKey,
        limit: 180,
        windowMs: TEN_MINUTES,
        blockMs: TEN_MINUTES,
      },
    ]);

    const username = normalizeUsername(usernameInput).normalized;
    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const account = await findDiscoverableAccountByUsername(transaction, {
        viewerAccountId: auth.session.accountId,
        usernameNormalized: username,
      });
      if (!account) return { result: null };
      return {
        result: {
          accountId: account.accountId,
          username: account.username,
          displayName: account.displayName,
          age: ageOnDate(account.dateOfBirth, trustedUtcDate(now)),
          bio: account.bio,
        },
      };
    });
  }

  async list(
    auth: AuthContext,
    input: PartnerRequestListQuery,
  ): Promise<{ items: unknown[]; nextCursor: string | null }> {
    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      let snapshotAt = now;
      let cursorCreatedAt: Date | undefined;
      let cursorRequestId: string | undefined;

      if (input.cursor) {
        const cursor = decodeCursor(input.cursor);
        if (cursor.direction !== input.direction) throw new ApiError(400, "VALIDATION_FAILED");
        const parsedSnapshot = validDate(cursor.snapshotAt);
        const parsedCreatedAt = validDate(cursor.createdAt);
        if (!parsedSnapshot || !parsedCreatedAt || parsedSnapshot.getTime() > now.getTime()) {
          throw new ApiError(400, "VALIDATION_FAILED");
        }
        snapshotAt = parsedSnapshot;
        cursorCreatedAt = parsedCreatedAt;
        cursorRequestId = cursor.requestId;
      }

      const rows = await listActivePartnerRequests(transaction, {
        accountId: auth.session.accountId,
        direction: input.direction,
        now,
        snapshotAt,
        ...(cursorCreatedAt ? { cursorCreatedAt } : {}),
        ...(cursorRequestId ? { cursorRequestId } : {}),
        limit: input.limit + 1,
      });
      const visible = rows.slice(0, input.limit);
      const serverDate = trustedUtcDate(now);
      const items = visible.map((row) => ({
        requestId: row.requestId,
        direction: input.direction,
        counterpart: {
          accountId: row.counterpartAccountId,
          username: row.counterpartUsername,
          displayName: row.counterpartDisplayName,
          age: ageOnDate(row.counterpartDateOfBirth, serverDate),
          bio: row.counterpartBio,
        },
        relationshipStartDate: row.relationshipStartDate,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      }));

      const last = visible.at(-1);
      const nextCursor =
        rows.length > input.limit && last
          ? encodeCursor({
              v: 1,
              snapshotAt: snapshotAt.toISOString(),
              createdAt: last.createdAt.toISOString(),
              requestId: last.requestId,
              direction: input.direction,
            })
          : null;

      return { items, nextCursor };
    });
  }

  async create(
    auth: AuthContext,
    input: PartnerRequestCreateInput,
    idempotencyKey: string,
    networkKey: string,
  ): Promise<StoredResponse> {
    const normalizedUsername = normalizeUsername(input.expectedUsername).normalized;
    const fingerprint = requestFingerprint(input);
    if (!relationshipStartDateAllowed(input.relationshipStartDate, "9999-12-31")) {
      throw new ApiError(400, "VALIDATION_FAILED");
    }

    const completed = await findCompletedPartnerRequestIdempotency(
      this.database.pool,
      auth.session.accountId,
      idempotencyKey,
    );
    if (completed) {
      if (!sameFingerprint(completed.fingerprint, fingerprint)) {
        throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED");
      }
      return {
        statusCode: completed.responseStatus ?? 201,
        body: completed.responseBody,
      };
    }

    await this.accountService.consumeSecurityRateLimit([
      {
        scope: "partner_request_create_account",
        subject: auth.session.accountId,
        limit: 30,
        windowMs: HOUR,
        blockMs: HOUR,
      },
      {
        scope: "partner_request_create_network",
        subject: networkKey,
        limit: 120,
        windowMs: HOUR,
        blockMs: HOUR,
      },
    ]);

    const decision = await withTransaction(this.database, async (transaction): Promise<CreateDecision> => {
      const now = await getTransactionTimestamp(transaction);
      const accountIds = await lockAccounts(transaction, [
        auth.session.accountId,
        input.recipientAccountId,
      ]);
      const sender = await loadPartnerAccountEligibility(transaction, auth.session.accountId);
      const recipient = await loadPartnerAccountEligibility(transaction, input.recipientAccountId);

      if (!sender) return { ok: false, statusCode: 401, code: "AUTH_REQUIRED" };

      const reservation = await reservePartnerRequestIdempotency(transaction, {
        id: randomUUID(),
        accountId: auth.session.accountId,
        idempotencyKey,
        fingerprint,
        createdAt: now,
      });
      if (!sameFingerprint(reservation.record.fingerprint, fingerprint)) {
        return { ok: false, statusCode: 409, code: "IDEMPOTENCY_KEY_REUSED" };
      }
      if (reservation.record.responseStatus !== null) {
        return {
          ok: true,
          statusCode: reservation.record.responseStatus,
          body: reservation.record.responseBody,
        };
      }

      const deny = async (
        code: string,
        recordAttempt: boolean,
      ): Promise<CreateError> => {
        if (recordAttempt) {
          await this.recordAttempt(
            transaction,
            auth.session.accountId,
            input.recipientAccountId,
            code,
            now,
          );
        }
        await completePartnerRequestIdempotency(transaction, {
          id: reservation.record.id,
          fingerprint,
          responseStatus: 409,
          responseBody: { error: { code } },
          expiresAt: new Date(now.getTime() + IDEMPOTENCY_DENIAL_RETENTION),
        });
        return { ok: false, statusCode: 409, code };
      };

      if (!relationshipStartDateAllowed(input.relationshipStartDate, trustedUtcDate(now))) {
        return deny("RELATIONSHIP_DATE_FUTURE", false);
      }
      if (auth.session.accountId === input.recipientAccountId) {
        return deny("REQUEST_SELF", true);
      }
      if (accountIds.length !== 2 || !recipient) {
        return deny("TARGET_UNAVAILABLE", false);
      }
      if (recipient.usernameNormalized !== normalizedUsername) {
        return deny("TARGET_CHANGED", true);
      }

      const lockedPair = await lockPairPendingRequests(
        transaction,
        auth.session.accountId,
        input.recipientAccountId,
      );
      await expirePartnerRequestsById(
        transaction,
        lockedPair.map((request) => request.id),
        now,
      );
      const activePair = activeRequestsAt(lockedPair, now);
      const sameDirectionPending = activePair.some(
        (request) =>
          request.senderAccountId === auth.session.accountId &&
          request.recipientAccountId === input.recipientAccountId,
      );
      const reciprocal = activePair.find(
        (request) =>
          request.senderAccountId === input.recipientAccountId &&
          request.recipientAccountId === auth.session.accountId,
      );

      const lastDeclinedAt = await latestDeclinedPartnerRequestAt(
        transaction,
        auth.session.accountId,
        input.recipientAccountId,
      );
      const cutoff = new Date(rollingMonthCutoffUtc(now.toISOString()));
      const createdAttempts = await countCreatedPartnerRequestAttemptsSince(
        transaction,
        auth.session.accountId,
        input.recipientAccountId,
        cutoff,
        now,
      );
      const blockedEitherDirection = await activeBlockExistsForPair(
        transaction,
        auth.session.accountId,
        input.recipientAccountId,
      );

      const eligibility = evaluatePartnerRequestPair({
        sender: {
          accountId: sender.accountId,
          status: sender.status,
          occupied: sender.occupied,
          partnerEligibleAt: sender.partnerEligibleAt?.toISOString() ?? null,
        },
        recipient: {
          accountId: recipient.accountId,
          status: recipient.status,
          occupied: recipient.occupied,
          partnerEligibleAt: recipient.partnerEligibleAt?.toISOString() ?? null,
        },
        blockedEitherDirection,
        sameDirectionPending,
        createdAttemptsInRollingMonth: createdAttempts,
        lastDeclinedAt: lastDeclinedAt?.toISOString() ?? null,
        now: now.toISOString(),
      });

      if (!eligibility.allowed) {
        let code = eligibility.reason ?? "TARGET_UNAVAILABLE";
        if (code === "SENDER_INELIGIBLE") {
          if (sender.status !== "active") code = "ACCOUNT_LOCKED";
          else if (sender.occupied) code = "PARTNERSHIP_OCCUPIED";
          else code = "COOLDOWN_ACTIVE";
        }
        return deny(code, true);
      }

      const requestId = randomUUID();
      const expiresAt = addDays(now, 7);
      await insertPartnerRequest(transaction, {
        id: requestId,
        senderAccountId: auth.session.accountId,
        recipientAccountId: input.recipientAccountId,
        relationshipStartDate: input.relationshipStartDate,
        createdAt: now,
        expiresAt,
      });
      await appendPartnerRequestAttempt(transaction, {
        id: randomUUID(),
        requestId,
        senderAccountId: auth.session.accountId,
        recipientAccountId: input.recipientAccountId,
        outcome: "created",
        createdAt: now,
      });
      await insertScheduledAction(transaction, {
        id: randomUUID(),
        actionType: "partner_request_expire",
        aggregateType: "partner_request",
        aggregateId: requestId,
        executeAt: expiresAt,
        deduplicationKey: `partner-request-expire:${requestId}`,
        payload: {},
        payloadVersion: 1,
      });

      let body: unknown = {
        outcome: reciprocal ? "reciprocal_pair_ready" : "created",
        requestId,
        expiresAt: expiresAt.toISOString(),
      };

      if (reciprocal && this.mode === "paired") {
        if (!this.coordinator) throw new Error("P2 coordinator missing in paired mode");
        const accountPair = sortedPair(auth.session.accountId, input.recipientAccountId);
        const requestPair = sortedRequestPair(reciprocal.id, requestId);
        const formed = await this.coordinator.handleReciprocalCandidate(
          transaction,
          {
            accountIds: accountPair,
            requestIds: requestPair,
            triggeringRequestId: requestId,
            relationshipStartDate: input.relationshipStartDate,
            observedAt: now,
          },
          now,
        );
        body = { outcome: "paired", requestId, partnershipId: formed.partnershipId };
      }

      await completePartnerRequestIdempotency(transaction, {
        id: reservation.record.id,
        fingerprint,
        responseStatus: 201,
        responseBody: body,
        expiresAt,
      });
      return { ok: true, statusCode: 201, body };
    });

    if (!decision.ok) throw new ApiError(decision.statusCode, decision.code);
    return { statusCode: decision.statusCode, body: decision.body };
  }

  async cancel(auth: AuthContext, requestId: string): Promise<unknown> {
    return this.transitionOwnedRequest(auth, requestId, "cancel");
  }

  async decline(auth: AuthContext, requestId: string): Promise<unknown> {
    return this.transitionOwnedRequest(auth, requestId, "decline");
  }

  private async transitionOwnedRequest(
    auth: AuthContext,
    requestId: string,
    action: "cancel" | "decline",
  ): Promise<unknown> {
    const participants = await loadPartnerRequestParticipants(this.database.pool, requestId);
    const expectedOwner =
      action === "cancel" ? participants?.senderAccountId : participants?.recipientAccountId;
    if (!participants || expectedOwner !== auth.session.accountId) {
      throw new ApiError(404, "REQUEST_NOT_FOUND");
    }

    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const lockedAccounts = await lockAccounts(transaction, [
        participants.senderAccountId,
        participants.recipientAccountId,
      ]);
      if (lockedAccounts.length !== 2) throw new ApiError(404, "REQUEST_NOT_FOUND");
      const request = await lockPartnerRequest(transaction, requestId);
      const owner = action === "cancel" ? request?.senderAccountId : request?.recipientAccountId;
      if (
        !request ||
        owner !== auth.session.accountId ||
        request.senderAccountId !== participants.senderAccountId ||
        request.recipientAccountId !== participants.recipientAccountId
      ) {
        throw new ApiError(404, "REQUEST_NOT_FOUND");
      }

      if (request.status !== "pending") {
        return { requestId: request.id, status: request.status };
      }
      if (now.getTime() >= request.expiresAt.getTime()) {
        await expirePartnerRequestsById(transaction, [request.id], now);
        return { requestId: request.id, status: "expired" };
      }

      if (action === "cancel") await setPartnerRequestCancelled(transaction, request.id, now);
      else await setPartnerRequestDeclined(transaction, request.id, now);
      return { requestId: request.id, status: action === "cancel" ? "cancelled" : "declined" };
    });
  }

  private async recordAttempt(
    transaction: QueryExecutor,
    senderAccountId: string,
    recipientAccountId: string,
    code: string,
    now: Date,
  ): Promise<void> {
    await appendPartnerRequestAttempt(transaction, {
      id: randomUUID(),
      senderAccountId,
      recipientAccountId,
      outcome: attemptOutcomeForCode(code),
      createdAt: now,
    });
  }
}
