import { createHash, randomUUID } from "node:crypto";
import {
  appendLifecycleEvent,
  cancelPendingScheduledActionsForAggregate,
  completeLifecycleIdempotency,
  expirePartnerRequestsById,
  getAccountProfile,
  getCurrentPartnershipForAccount,
  getPrimaryConversationLastServerSequence,
  getTransactionTimestamp,
  insertAccountNotification,
  insertBreakupProcess,
  insertBreakupRestoreIntent,
  insertFormerPartnerBlock,
  insertOutboxEvent,
  insertScheduledAction,
  insertSecurityEmailDelivery,
  invalidatePendingRequestsForPair,
  listFormerPartnerships,
  loadLifecycleMemberIds,
  loadPartnerRequestParticipants,
  loadPartnershipMemberIds,
  loadPartnershipReadModelForAccount,
  lockAccounts,
  lockPartnerRequest,
  lockPartnershipForMetadataUpdate,
  lockPartnershipLifecycle,
  markBreakupCancelled,
  removeFormerPartnerBlock,
  reserveLifecycleIdempotency,
  restorePartnership,
  setPartnershipBreakupPending,
  updateRelationshipStartDateIfVersion,
  extendBreakupDeadline,
  withTransaction,
  type DatabasePool,
  type LockedPartnershipLifecycle,
  type QueryExecutor,
} from "@shawtie/db";
import {
  evaluateCapability,
  evaluateRelationshipStartDateMutation,
  trustedUtcDate,
  type CapabilityContext,
  type PartnershipState,
} from "@shawtie/domain";
import {
  formerPartnershipCursorSchema,
  parseAtBoundary,
  type FormerPartnershipListQuery,
  type RelationshipStartDateUpdateInput,
} from "@shawtie/contracts";
import { ApiError } from "../../lib/api-error.ts";
import type { AuthContext } from "../../plugins/authentication.ts";
import { formExplicitAcceptedRequest } from "./partnership-formation-coordinator.ts";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const IDEMPOTENCY_RETENTION = 7 * DAY;

interface AcceptSuccess {
  readonly ok: true;
  readonly outcome: "formed" | "already_accepted";
  readonly partnershipId: string;
}

interface AcceptFailure {
  readonly ok: false;
  readonly statusCode: number;
  readonly code: string;
}

type AcceptDecision = AcceptSuccess | AcceptFailure;

function safeVersion(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Lifecycle version exceeds safe integer range");
  }
  return Number(value);
}

function addMs(value: Date, milliseconds: number): Date {
  return new Date(value.getTime() + milliseconds);
}

function sameFingerprint(actual: Buffer | null, expected: Buffer): boolean {
  return Boolean(actual && actual.length === expected.length && actual.equals(expected));
}

function mutationFingerprint(action: string, partnershipId: string, breakupId?: string): Buffer {
  return createHash("sha256")
    .update(JSON.stringify({ v: 1, action, partnershipId, breakupId: breakupId ?? null }))
    .digest();
}

function capabilityContext(input: {
  readonly actorAccountId: string;
  readonly memberIds: readonly string[];
  readonly lifecycleState: "active" | "breakup_pending" | "terminated";
  readonly generation: bigint;
  readonly viewOnlyAccountId: string | null;
  readonly now: Date;
}): CapabilityContext {
  const first = input.memberIds[0];
  const second = input.memberIds[1];
  const members: readonly [string, string] =
    first && second ? [first, second] : [input.actorAccountId, input.actorAccountId];

  const partnership: PartnershipState = {
    id: "authoritative-partnership",
    members,
    lifecycle: input.lifecycleState,
    generation: safeVersion(input.generation),
    breakup: null,
    accountDeletion: input.viewOnlyAccountId
      ? {
          accountId: input.viewOnlyAccountId,
          requestedAt: input.now.toISOString(),
          recoverUntil: input.now.toISOString(),
          generation: 1,
        }
      : null,
    terminatedAt: null,
    terminationReason: null,
    partnerEligibleAt: Object.fromEntries(members.map((memberId) => [memberId, null])),
  };

  return {
    actor: {
      id: input.actorAccountId,
      status: "active",
      nextUsernameChangeEligibleAt: null,
    },
    partnership,
    now: input.now.toISOString(),
  };
}

function lifecycleCapabilityContext(
  actorAccountId: string,
  lifecycle: LockedPartnershipLifecycle,
  now: Date,
): CapabilityContext {
  const first = lifecycle.memberIds[0];
  const second = lifecycle.memberIds[1];
  if (!first || !second) throw new Error("Partnership must have exactly two members");
  const members: readonly [string, string] = [first, second];
  return {
    actor: {
      id: actorAccountId,
      status: lifecycle.accountStatuses[actorAccountId] ?? "deleted",
      nextUsernameChangeEligibleAt: null,
    },
    partnership: {
      id: lifecycle.partnershipId,
      members,
      lifecycle: lifecycle.lifecycleState,
      generation: safeVersion(lifecycle.generation),
      breakup: lifecycle.breakup
        ? {
            initiatedBy: lifecycle.breakup.initiatedByAccountId,
            initiatedAt: lifecycle.breakup.initiatedAt.toISOString(),
            initiatorCancelUntil: lifecycle.breakup.initiatorCancelUntil.toISOString(),
            baseDeadline: lifecycle.breakup.baseDeadline.toISOString(),
            finalDeadline: lifecycle.breakup.finalDeadline.toISOString(),
            restoreIntentAt: Object.fromEntries(
              Object.entries(lifecycle.breakup.restoreIntentAt).map(([accountId, at]) => [
                accountId,
                at.toISOString(),
              ]),
            ),
            generation: safeVersion(lifecycle.breakup.generation),
            messageFreezeSequence:
              lifecycle.breakup.messageFreezeSequence === null
                ? null
                : safeVersion(lifecycle.breakup.messageFreezeSequence),
          }
        : null,
      accountDeletion: lifecycle.accountDeletion
        ? {
            accountId: lifecycle.accountDeletion.accountId,
            requestedAt: lifecycle.accountDeletion.requestedAt.toISOString(),
            recoverUntil: lifecycle.accountDeletion.recoverUntil.toISOString(),
            generation: safeVersion(lifecycle.accountDeletion.generation),
          }
        : null,
      terminatedAt: lifecycle.terminatedAt?.toISOString() ?? null,
      terminationReason: lifecycle.terminationReason,
      partnerEligibleAt: Object.fromEntries(members.map((memberId) => [memberId, null])),
    },
    now: now.toISOString(),
  };
}

function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeFormerCursor(raw: string) {
  try {
    return parseAtBoundary(
      formerPartnershipCursorSchema,
      JSON.parse(Buffer.from(raw, "base64url").toString("utf8")),
    );
  } catch {
    throw new ApiError(400, "VALIDATION_FAILED");
  }
}

export class PartnershipService {
  readonly database: DatabasePool;

  constructor(database: DatabasePool) {
    this.database = database;
  }

  async #queueLifecycleNotice(
    transaction: QueryExecutor,
    input: {
      readonly recipientAccountId: string;
      readonly actorAccountId: string | null;
      readonly partnershipId: string;
      readonly eventType:
        "breakup_started" | "breakup_cancelled" | "restoration_requested" | "partnership_restored";
      readonly deduplicationKey: string;
      readonly now: Date;
      readonly email: boolean;
      readonly deadline?: Date;
    },
  ): Promise<void> {
    await insertAccountNotification(transaction, {
      id: randomUUID(),
      recipientAccountId: input.recipientAccountId,
      actorAccountId: input.actorAccountId,
      partnershipId: input.partnershipId,
      eventType: input.eventType,
      deduplicationKey: input.deduplicationKey,
      createdAt: input.now,
    });

    if (!input.email) return;
    const profile = await getAccountProfile(transaction, input.recipientAccountId);
    if (!profile) return;

    const deliveryId = randomUUID();
    await insertSecurityEmailDelivery(transaction, {
      id: deliveryId,
      accountId: input.recipientAccountId,
      destinationEmail: profile.email,
      template: input.eventType,
      parameters: input.deadline ? { deadline: input.deadline.toISOString() } : {},
      expiresAt: addMs(input.now, IDEMPOTENCY_RETENTION),
      at: input.now,
    });
    await insertOutboxEvent(transaction, {
      id: randomUUID(),
      eventType: "auth.security_email",
      aggregateType: "security_email_delivery",
      aggregateId: deliveryId,
      deduplicationKey: "lifecycle-email:" + input.deduplicationKey,
      payload: { securityEmailDeliveryId: deliveryId },
      payloadVersion: 1,
    });
  }

  async #reserveMutation(
    transaction: QueryExecutor,
    input: {
      readonly actorAccountId: string;
      readonly scope: string;
      readonly idempotencyKey: string;
      readonly fingerprint: Buffer;
      readonly now: Date;
    },
  ) {
    const record = await reserveLifecycleIdempotency(transaction, {
      id: randomUUID(),
      accountId: input.actorAccountId,
      scope: input.scope,
      idempotencyKey: input.idempotencyKey,
      fingerprint: input.fingerprint,
      createdAt: input.now,
    });
    if (!sameFingerprint(record.fingerprint, input.fingerprint)) {
      throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED");
    }
    return record;
  }

  async #completeMutation(
    transaction: QueryExecutor,
    recordId: string,
    fingerprint: Buffer,
    responseBody: unknown,
    now: Date,
  ): Promise<void> {
    await completeLifecycleIdempotency(transaction, {
      id: recordId,
      fingerprint,
      responseStatus: 200,
      responseBody,
      expiresAt: addMs(now, IDEMPOTENCY_RETENTION),
    });
  }

  async accept(
    auth: AuthContext,
    requestId: string,
  ): Promise<{ outcome: "formed" | "already_accepted"; partnershipId: string }> {
    const decision = await withTransaction(
      this.database,
      async (transaction): Promise<AcceptDecision> => {
        const now = await getTransactionTimestamp(transaction);
        const participants = await loadPartnerRequestParticipants(transaction, requestId);
        if (!participants || participants.recipientAccountId !== auth.session.accountId) {
          return { ok: false, statusCode: 404, code: "REQUEST_NOT_FOUND" };
        }

        const lockedAccounts = await lockAccounts(transaction, [
          participants.senderAccountId,
          participants.recipientAccountId,
        ]);
        if (lockedAccounts.length !== 2) {
          return { ok: false, statusCode: 404, code: "REQUEST_NOT_FOUND" };
        }

        const request = await lockPartnerRequest(transaction, requestId);
        if (
          !request ||
          request.senderAccountId !== participants.senderAccountId ||
          request.recipientAccountId !== participants.recipientAccountId ||
          request.recipientAccountId !== auth.session.accountId
        ) {
          return { ok: false, statusCode: 404, code: "REQUEST_NOT_FOUND" };
        }

        if (request.status === "accepted" && request.acceptedPartnershipId) {
          return {
            ok: true,
            outcome: "already_accepted",
            partnershipId: request.acceptedPartnershipId,
          };
        }

        if (request.status !== "pending") {
          return { ok: false, statusCode: 409, code: "REQUEST_NOT_AVAILABLE" };
        }

        if (now.getTime() >= request.expiresAt.getTime()) {
          await expirePartnerRequestsById(transaction, [request.id], now);
          return { ok: false, statusCode: 409, code: "REQUEST_NOT_AVAILABLE" };
        }

        const formed = await formExplicitAcceptedRequest(
          transaction,
          request,
          auth.session.accountId,
          now,
        );
        return { ok: true, outcome: "formed", partnershipId: formed.partnershipId };
      },
    );

    if (!decision.ok) throw new ApiError(decision.statusCode, decision.code);
    return { outcome: decision.outcome, partnershipId: decision.partnershipId };
  }

  async current(auth: AuthContext): Promise<unknown> {
    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const readModel = await loadPartnershipReadModelForAccount(
        transaction,
        auth.session.accountId,
      );
      if (!readModel) return { partnership: null };

      const lifecycle = await lockPartnershipLifecycle(transaction, readModel.partnershipId);
      if (!lifecycle || !lifecycle.memberIds.includes(auth.session.accountId)) {
        return { partnership: null };
      }
      const context = lifecycleCapabilityContext(auth.session.accountId, lifecycle, now);
      const breakup = lifecycle.breakup;
      const otherMemberId = readModel.otherMember.accountId;

      return {
        partnership: {
          partnershipId: lifecycle.partnershipId,
          lifecycleState: lifecycle.lifecycleState,
          interactionMode: lifecycle.accountDeletion
            ? "account_deletion_view_only"
            : lifecycle.lifecycleState === "breakup_pending"
              ? "breakup_restricted"
              : "normal",
          activatedAt: lifecycle.activatedAt.toISOString(),
          relationshipStartDate: lifecycle.relationshipStartDate,
          metadataVersion: safeVersion(lifecycle.metadataVersion),
          generation: safeVersion(lifecycle.generation),
          breakup: breakup
            ? {
                breakupId: breakup.id,
                initiatedBy:
                  breakup.initiatedByAccountId === auth.session.accountId ? "self" : "partner",
                initiatedAt: breakup.initiatedAt.toISOString(),
                initiatorCancelUntil: breakup.initiatorCancelUntil.toISOString(),
                baseDeadline: breakup.baseDeadline.toISOString(),
                finalDeadline: breakup.finalDeadline.toISOString(),
                selfRestoreIntentAt:
                  breakup.restoreIntentAt[auth.session.accountId]?.toISOString() ?? null,
                partnerRestoreIntentAt:
                  breakup.restoreIntentAt[otherMemberId]?.toISOString() ?? null,
              }
            : null,
          accountDeletion: lifecycle.accountDeletion
            ? {
                deletingMember:
                  lifecycle.accountDeletion.accountId === auth.session.accountId
                    ? "self"
                    : "partner",
                recoverUntil: lifecycle.accountDeletion.recoverUntil.toISOString(),
              }
            : null,
          capabilities: {
            changeRelationshipStartDate: evaluateCapability(
              "change_relationship_start_date",
              context,
            ).allowed,
            initiateBreakup: evaluateCapability("initiate_breakup", context).allowed,
            cancelBreakup: evaluateCapability("cancel_breakup", context).allowed,
            submitRestoreIntent: evaluateCapability("submit_restore_intent", context).allowed,
            viewSharedData: evaluateCapability("view_shared_data", context).allowed,
          },
          otherMember: readModel.otherMember,
        },
      };
    });
  }

  async initiateBreakup(
    auth: AuthContext,
    partnershipId: string,
    idempotencyKey: string,
  ): Promise<unknown> {
    const memberIds = await loadLifecycleMemberIds(this.database.pool, partnershipId);
    if (memberIds.length !== 2 || !memberIds.includes(auth.session.accountId)) {
      throw new ApiError(404, "PARTNERSHIP_UNAVAILABLE");
    }

    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const locked = await lockAccounts(transaction, memberIds);
      if (locked.length !== 2) throw new ApiError(404, "PARTNERSHIP_UNAVAILABLE");
      const lifecycle = await lockPartnershipLifecycle(transaction, partnershipId);
      if (!lifecycle || !lifecycle.memberIds.includes(auth.session.accountId)) {
        throw new ApiError(404, "PARTNERSHIP_UNAVAILABLE");
      }

      const fingerprint = mutationFingerprint("initiate_breakup", partnershipId);
      const reservation = await this.#reserveMutation(transaction, {
        actorAccountId: auth.session.accountId,
        scope: "partnership.breakup.initiate",
        idempotencyKey,
        fingerprint,
        now,
      });
      if (reservation.responseStatus !== null) return reservation.responseBody;

      const capability = evaluateCapability(
        "initiate_breakup",
        lifecycleCapabilityContext(auth.session.accountId, lifecycle, now),
      );
      if (!capability.allowed) {
        throw new ApiError(
          capability.reason === "ACCOUNT_LOCKED" ? 409 : 409,
          capability.reason ?? "BREAKUP_NOT_AVAILABLE",
        );
      }

      const messageFreezeSequence = await getPrimaryConversationLastServerSequence(
        transaction,
        partnershipId,
      );
      if (messageFreezeSequence === null) {
        throw new Error("Primary conversation missing for current partnership");
      }

      const generation = await setPartnershipBreakupPending(
        transaction,
        partnershipId,
        lifecycle.generation,
        now,
      );
      if (generation === null) throw new ApiError(409, "BREAKUP_NOT_AVAILABLE");

      const breakupId = randomUUID();
      const initiatorCancelUntil = addMs(now, HOUR);
      const baseDeadline = addMs(now, 7 * DAY);
      await insertBreakupProcess(transaction, {
        id: breakupId,
        partnershipId,
        initiatedByAccountId: auth.session.accountId,
        initiatedAt: now,
        initiatorCancelUntil,
        baseDeadline,
        finalDeadline: baseDeadline,
        generation,
        messageFreezeSequence,
      });
      await insertScheduledAction(transaction, {
        id: randomUUID(),
        actionType: "partnership_breakup_finalize",
        aggregateType: "breakup_process",
        aggregateId: breakupId,
        executeAt: baseDeadline,
        expectedGeneration: generation,
        deduplicationKey: "partnership-breakup-finalize:" + breakupId + ":" + generation,
        payload: { partnershipId },
        payloadVersion: 1,
      });
      await insertScheduledAction(transaction, {
        id: randomUUID(),
        actionType: "partnership_breakup_deadline_reminder",
        aggregateType: "breakup_process",
        aggregateId: breakupId,
        executeAt: addMs(baseDeadline, -2 * DAY),
        expectedGeneration: generation,
        deduplicationKey: "partnership-breakup-reminder:" + breakupId + ":" + generation,
        payload: { partnershipId },
        payloadVersion: 1,
      });
      await appendLifecycleEvent(transaction, {
        id: randomUUID(),
        partnershipId,
        actorAccountId: auth.session.accountId,
        eventType: "breakup_started",
        aggregateVersion: generation,
        metadata: {
          generation: safeVersion(generation),
          deadline: baseDeadline.toISOString(),
          status: "breakup_pending",
        },
      });
      for (const accountId of lifecycle.memberIds) {
        await this.#queueLifecycleNotice(transaction, {
          recipientAccountId: accountId,
          actorAccountId: auth.session.accountId,
          partnershipId,
          eventType: "breakup_started",
          deduplicationKey: "breakup-started:" + breakupId + ":" + accountId,
          now,
          email: true,
          deadline: baseDeadline,
        });
      }

      const response = {
        partnershipId,
        breakupId,
        lifecycleState: "breakup_pending" as const,
        initiatedAt: now.toISOString(),
        initiatorCancelUntil: initiatorCancelUntil.toISOString(),
        baseDeadline: baseDeadline.toISOString(),
        finalDeadline: baseDeadline.toISOString(),
        generation: safeVersion(generation),
      };
      await this.#completeMutation(transaction, reservation.id, fingerprint, response, now);
      return response;
    });
  }

  async cancelBreakup(
    auth: AuthContext,
    partnershipId: string,
    breakupId: string,
    idempotencyKey: string,
  ): Promise<unknown> {
    const memberIds = await loadLifecycleMemberIds(this.database.pool, partnershipId);
    if (memberIds.length !== 2 || !memberIds.includes(auth.session.accountId)) {
      throw new ApiError(404, "PARTNERSHIP_UNAVAILABLE");
    }

    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      await lockAccounts(transaction, memberIds);
      const lifecycle = await lockPartnershipLifecycle(transaction, partnershipId);
      if (!lifecycle || lifecycle.breakup?.id !== breakupId) {
        throw new ApiError(404, "PARTNERSHIP_UNAVAILABLE");
      }

      const fingerprint = mutationFingerprint("cancel_breakup", partnershipId, breakupId);
      const reservation = await this.#reserveMutation(transaction, {
        actorAccountId: auth.session.accountId,
        scope: "partnership.breakup.cancel",
        idempotencyKey,
        fingerprint,
        now,
      });
      if (reservation.responseStatus !== null) return reservation.responseBody;

      const capability = evaluateCapability(
        "cancel_breakup",
        lifecycleCapabilityContext(auth.session.accountId, lifecycle, now),
      );
      if (!capability.allowed) {
        throw new ApiError(409, capability.reason ?? "BREAKUP_NOT_AVAILABLE");
      }

      const generation = await markBreakupCancelled(transaction, {
        partnershipId,
        breakupId,
        expectedGeneration: lifecycle.breakup.generation,
        cancelledAt: now,
      });
      if (generation === null) throw new ApiError(409, "BREAKUP_NOT_AVAILABLE");
      await cancelPendingScheduledActionsForAggregate(
        transaction,
        "breakup_process",
        breakupId,
        now,
      );
      await appendLifecycleEvent(transaction, {
        id: randomUUID(),
        partnershipId,
        actorAccountId: auth.session.accountId,
        eventType: "breakup_cancelled",
        aggregateVersion: generation,
        metadata: { generation: safeVersion(generation), status: "active" },
      });
      for (const accountId of lifecycle.memberIds) {
        await this.#queueLifecycleNotice(transaction, {
          recipientAccountId: accountId,
          actorAccountId: auth.session.accountId,
          partnershipId,
          eventType: "breakup_cancelled",
          deduplicationKey: "breakup-cancelled:" + breakupId + ":" + accountId,
          now,
          email: false,
        });
      }

      const response = {
        partnershipId,
        breakupId,
        lifecycleState: "active" as const,
        generation: safeVersion(generation),
      };
      await this.#completeMutation(transaction, reservation.id, fingerprint, response, now);
      return response;
    });
  }

  async submitRestoreIntent(
    auth: AuthContext,
    partnershipId: string,
    breakupId: string,
    idempotencyKey: string,
  ): Promise<unknown> {
    const memberIds = await loadLifecycleMemberIds(this.database.pool, partnershipId);
    if (memberIds.length !== 2 || !memberIds.includes(auth.session.accountId)) {
      throw new ApiError(404, "PARTNERSHIP_UNAVAILABLE");
    }

    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      await lockAccounts(transaction, memberIds);
      const lifecycle = await lockPartnershipLifecycle(transaction, partnershipId);
      if (!lifecycle || lifecycle.breakup?.id !== breakupId) {
        throw new ApiError(404, "PARTNERSHIP_UNAVAILABLE");
      }

      const fingerprint = mutationFingerprint("restore_intent", partnershipId, breakupId);
      const reservation = await this.#reserveMutation(transaction, {
        actorAccountId: auth.session.accountId,
        scope: "partnership.breakup.restore",
        idempotencyKey,
        fingerprint,
        now,
      });
      if (reservation.responseStatus !== null) return reservation.responseBody;

      const capability = evaluateCapability(
        "submit_restore_intent",
        lifecycleCapabilityContext(auth.session.accountId, lifecycle, now),
      );
      if (!capability.allowed) {
        throw new ApiError(409, capability.reason ?? "BREAKUP_NOT_AVAILABLE");
      }

      const breakup = lifecycle.breakup;
      const inserted = await insertBreakupRestoreIntent(transaction, {
        breakupProcessId: breakupId,
        partnershipId,
        accountId: auth.session.accountId,
        submittedAt: now,
      });
      if (!inserted) throw new ApiError(409, "RESTORE_INTENT_ALREADY_SUBMITTED");

      const otherAccountId = lifecycle.memberIds.find(
        (accountId) => accountId !== auth.session.accountId,
      );
      if (!otherAccountId) throw new Error("Partnership other member missing");
      const otherIntent = breakup.restoreIntentAt[otherAccountId];

      if (otherIntent) {
        const generation = await restorePartnership(transaction, {
          partnershipId,
          breakupId,
          expectedGeneration: breakup.generation,
          restoredAt: now,
        });
        if (generation === null) throw new ApiError(409, "BREAKUP_NOT_AVAILABLE");
        await cancelPendingScheduledActionsForAggregate(
          transaction,
          "breakup_process",
          breakupId,
          now,
        );
        await appendLifecycleEvent(transaction, {
          id: randomUUID(),
          partnershipId,
          actorAccountId: auth.session.accountId,
          eventType: "restoration_intent_submitted",
          aggregateVersion: generation,
          metadata: { generation: safeVersion(generation), status: "active" },
        });
        await appendLifecycleEvent(transaction, {
          id: randomUUID(),
          partnershipId,
          actorAccountId: auth.session.accountId,
          eventType: "partnership_restored",
          aggregateVersion: generation,
          metadata: { generation: safeVersion(generation), status: "active" },
        });
        for (const accountId of lifecycle.memberIds) {
          await this.#queueLifecycleNotice(transaction, {
            recipientAccountId: accountId,
            actorAccountId: auth.session.accountId,
            partnershipId,
            eventType: "partnership_restored",
            deduplicationKey: "partnership-restored:" + breakupId + ":" + accountId,
            now,
            email: true,
          });
        }
        const response = {
          partnershipId,
          breakupId,
          lifecycleState: "active" as const,
          finalDeadline: breakup.finalDeadline.toISOString(),
          generation: safeVersion(generation),
          restored: true,
        };
        await this.#completeMutation(transaction, reservation.id, fingerprint, response, now);
        return response;
      }

      const finalDeadline = addMs(breakup.initiatedAt, 10 * DAY);
      const generation = await extendBreakupDeadline(transaction, {
        partnershipId,
        breakupId,
        expectedGeneration: breakup.generation,
        finalDeadline,
        at: now,
      });
      if (generation === null) throw new ApiError(409, "BREAKUP_NOT_AVAILABLE");
      await cancelPendingScheduledActionsForAggregate(
        transaction,
        "breakup_process",
        breakupId,
        now,
      );
      await insertScheduledAction(transaction, {
        id: randomUUID(),
        actionType: "partnership_breakup_finalize",
        aggregateType: "breakup_process",
        aggregateId: breakupId,
        executeAt: finalDeadline,
        expectedGeneration: generation,
        deduplicationKey: "partnership-breakup-finalize:" + breakupId + ":" + generation,
        payload: { partnershipId },
        payloadVersion: 1,
      });
      await insertScheduledAction(transaction, {
        id: randomUUID(),
        actionType: "partnership_breakup_deadline_reminder",
        aggregateType: "breakup_process",
        aggregateId: breakupId,
        executeAt: addMs(finalDeadline, -2 * DAY),
        expectedGeneration: generation,
        deduplicationKey: "partnership-breakup-reminder:" + breakupId + ":" + generation,
        payload: { partnershipId },
        payloadVersion: 1,
      });
      await appendLifecycleEvent(transaction, {
        id: randomUUID(),
        partnershipId,
        actorAccountId: auth.session.accountId,
        eventType: "restoration_intent_submitted",
        aggregateVersion: generation,
        metadata: {
          generation: safeVersion(generation),
          deadline: finalDeadline.toISOString(),
          status: "breakup_pending",
        },
      });
      await this.#queueLifecycleNotice(transaction, {
        recipientAccountId: otherAccountId,
        actorAccountId: auth.session.accountId,
        partnershipId,
        eventType: "restoration_requested",
        deduplicationKey: "restoration-requested:" + breakupId + ":" + otherAccountId,
        now,
        email: true,
        deadline: finalDeadline,
      });

      const response = {
        partnershipId,
        breakupId,
        lifecycleState: "breakup_pending" as const,
        finalDeadline: finalDeadline.toISOString(),
        generation: safeVersion(generation),
        restored: false,
      };
      await this.#completeMutation(transaction, reservation.id, fingerprint, response, now);
      return response;
    });
  }

  async former(auth: AuthContext, input: FormerPartnershipListQuery): Promise<unknown> {
    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      let snapshotAt = now;
      let cursorReleasedAt: Date | undefined;
      let cursorPartnershipId: string | undefined;
      if (input.cursor) {
        const cursor = decodeFormerCursor(input.cursor);
        const snapshot = new Date(cursor.snapshotAt);
        const released = new Date(cursor.releasedAt);
        if (
          !Number.isFinite(snapshot.getTime()) ||
          !Number.isFinite(released.getTime()) ||
          snapshot.getTime() > now.getTime()
        ) {
          throw new ApiError(400, "VALIDATION_FAILED");
        }
        snapshotAt = snapshot;
        cursorReleasedAt = released;
        cursorPartnershipId = cursor.partnershipId;
      }

      const rows = await listFormerPartnerships(transaction, {
        accountId: auth.session.accountId,
        snapshotAt,
        ...(cursorReleasedAt ? { cursorReleasedAt } : {}),
        ...(cursorPartnershipId ? { cursorPartnershipId } : {}),
        limit: input.limit + 1,
      });
      const visible = rows.slice(0, input.limit);
      const last = visible.at(-1);
      return {
        items: visible.map((row) => ({
          partnershipId: row.partnershipId,
          terminatedAt: row.terminatedAt.toISOString(),
          terminationReason: row.terminationReason,
          formerPartner:
            row.formerPartnerUsername && row.formerPartnerDisplayName
              ? {
                  accountId: row.formerPartnerAccountId,
                  username: row.formerPartnerUsername,
                  displayName: row.formerPartnerDisplayName,
                }
              : null,
          blockedByMe: row.blockedByMe,
        })),
        nextCursor:
          rows.length > input.limit && last
            ? encodeCursor({
                v: 1,
                snapshotAt: snapshotAt.toISOString(),
                releasedAt: last.releasedAt.toISOString(),
                partnershipId: last.partnershipId,
              })
            : null,
      };
    });
  }

  async blockFormerPartner(
    auth: AuthContext,
    partnershipId: string,
    idempotencyKey: string,
  ): Promise<unknown> {
    const memberIds = await loadLifecycleMemberIds(this.database.pool, partnershipId);
    if (memberIds.length !== 2 || !memberIds.includes(auth.session.accountId)) {
      throw new ApiError(404, "PARTNERSHIP_UNAVAILABLE");
    }
    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      await lockAccounts(transaction, memberIds);
      const lifecycle = await lockPartnershipLifecycle(transaction, partnershipId);
      if (
        !lifecycle ||
        lifecycle.lifecycleState !== "terminated" ||
        !lifecycle.memberIds.includes(auth.session.accountId)
      ) {
        throw new ApiError(404, "PARTNERSHIP_UNAVAILABLE");
      }
      const target = lifecycle.memberIds.find((id) => id !== auth.session.accountId);
      if (!target) throw new ApiError(404, "PARTNERSHIP_UNAVAILABLE");

      const fingerprint = mutationFingerprint("block_former_partner", partnershipId);
      const reservation = await this.#reserveMutation(transaction, {
        actorAccountId: auth.session.accountId,
        scope: "partnership.block.create",
        idempotencyKey,
        fingerprint,
        now,
      });
      if (reservation.responseStatus !== null) return reservation.responseBody;

      const current = await getCurrentPartnershipForAccount(transaction, auth.session.accountId);
      if (current?.otherAccountId === target) {
        throw new ApiError(409, "BLOCK_NOT_AVAILABLE");
      }

      await insertFormerPartnerBlock(transaction, {
        id: randomUUID(),
        blockerAccountId: auth.session.accountId,
        blockedAccountId: target,
        sourcePartnershipId: partnershipId,
        createdAt: now,
      });
      await invalidatePendingRequestsForPair(
        transaction,
        auth.session.accountId,
        target,
        now,
        "block_created",
      );
      await appendLifecycleEvent(transaction, {
        id: randomUUID(),
        partnershipId,
        actorAccountId: auth.session.accountId,
        eventType: "former_partner_blocked",
        aggregateVersion: lifecycle.generation,
        metadata: { status: "active" },
      });
      const response = { partnershipId, blocked: true };
      await this.#completeMutation(transaction, reservation.id, fingerprint, response, now);
      return response;
    });
  }

  async unblockFormerPartner(
    auth: AuthContext,
    partnershipId: string,
    idempotencyKey: string,
  ): Promise<unknown> {
    const memberIds = await loadLifecycleMemberIds(this.database.pool, partnershipId);
    if (memberIds.length !== 2 || !memberIds.includes(auth.session.accountId)) {
      throw new ApiError(404, "PARTNERSHIP_UNAVAILABLE");
    }
    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      await lockAccounts(transaction, memberIds);
      const lifecycle = await lockPartnershipLifecycle(transaction, partnershipId);
      if (!lifecycle || lifecycle.lifecycleState !== "terminated") {
        throw new ApiError(404, "PARTNERSHIP_UNAVAILABLE");
      }

      const fingerprint = mutationFingerprint("unblock_former_partner", partnershipId);
      const reservation = await this.#reserveMutation(transaction, {
        actorAccountId: auth.session.accountId,
        scope: "partnership.block.remove",
        idempotencyKey,
        fingerprint,
        now,
      });
      if (reservation.responseStatus !== null) return reservation.responseBody;

      await removeFormerPartnerBlock(transaction, auth.session.accountId, partnershipId, now);
      await appendLifecycleEvent(transaction, {
        id: randomUUID(),
        partnershipId,
        actorAccountId: auth.session.accountId,
        eventType: "former_partner_unblocked",
        aggregateVersion: lifecycle.generation,
        metadata: { status: "removed" },
      });
      const response = { partnershipId, blocked: false };
      await this.#completeMutation(transaction, reservation.id, fingerprint, response, now);
      return response;
    });
  }

  async updateRelationshipStartDate(
    auth: AuthContext,
    partnershipId: string,
    input: RelationshipStartDateUpdateInput,
  ): Promise<{
    partnershipId: string;
    relationshipStartDate: string;
    metadataVersion: number;
    changed: boolean;
  }> {
    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const memberIds = await loadPartnershipMemberIds(transaction, partnershipId);
      if (memberIds.length !== 2 || !memberIds.includes(auth.session.accountId)) {
        throw new ApiError(404, "PARTNERSHIP_UNAVAILABLE");
      }

      const lockedAccounts = await lockAccounts(transaction, memberIds);
      if (lockedAccounts.length !== 2) {
        throw new ApiError(404, "PARTNERSHIP_UNAVAILABLE");
      }

      const partnership = await lockPartnershipForMetadataUpdate(transaction, partnershipId);
      if (
        !partnership ||
        partnership.memberIds.length !== 2 ||
        !partnership.memberIds.includes(auth.session.accountId)
      ) {
        throw new ApiError(404, "PARTNERSHIP_UNAVAILABLE");
      }

      const capability = evaluateCapability(
        "change_relationship_start_date",
        capabilityContext({
          actorAccountId: auth.session.accountId,
          memberIds: partnership.memberIds,
          lifecycleState: partnership.lifecycleState,
          generation: partnership.generation,
          viewOnlyAccountId: partnership.viewOnlyAccountId,
          now,
        }),
      );

      if (!capability.allowed) {
        if (capability.reason === "PARTNERSHIP_METADATA_LOCKED") {
          throw new ApiError(409, "PARTNERSHIP_METADATA_LOCKED");
        }
        throw new ApiError(404, "PARTNERSHIP_UNAVAILABLE");
      }

      const mutation = evaluateRelationshipStartDateMutation({
        currentRelationshipStartDate: partnership.relationshipStartDate,
        requestedRelationshipStartDate: input.relationshipStartDate,
        currentMetadataVersion: safeVersion(partnership.metadataVersion),
        expectedMetadataVersion: input.expectedMetadataVersion,
        trustedServerDate: trustedUtcDate(now),
      });

      if (!mutation.ok) {
        throw new ApiError(409, mutation.reason);
      }

      if (!mutation.changed) {
        return {
          partnershipId,
          relationshipStartDate: partnership.relationshipStartDate,
          metadataVersion: mutation.metadataVersion,
          changed: false,
        };
      }

      const nextVersion = await updateRelationshipStartDateIfVersion(transaction, {
        partnershipId,
        relationshipStartDate: input.relationshipStartDate,
        expectedVersion: partnership.metadataVersion,
        updatedAt: now,
      });
      if (nextVersion === null) throw new ApiError(409, "VERSION_CONFLICT");

      const otherMemberId = partnership.memberIds.find(
        (memberId) => memberId !== auth.session.accountId,
      );
      if (!otherMemberId) throw new Error("Partnership other member could not be derived");

      await insertAccountNotification(transaction, {
        id: randomUUID(),
        recipientAccountId: otherMemberId,
        actorAccountId: auth.session.accountId,
        partnershipId,
        eventType: "relationship_start_date_changed",
        deduplicationKey:
          "relationship-start-date-changed:" +
          partnershipId +
          ":" +
          nextVersion +
          ":" +
          otherMemberId,
        createdAt: now,
      });

      return {
        partnershipId,
        relationshipStartDate: input.relationshipStartDate,
        metadataVersion: safeVersion(nextVersion),
        changed: true,
      };
    });
  }
}
