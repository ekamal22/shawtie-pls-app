import {
  expirePartnerRequestsById,
  getTransactionTimestamp,
  loadPartnerRequestParticipants,
  loadPartnershipMemberIds,
  loadPartnershipReadModelForAccount,
  lockAccounts,
  lockPartnerRequest,
  lockPartnershipForMetadataUpdate,
  updateRelationshipStartDateIfVersion,
  insertAccountNotification,
  withTransaction,
  type DatabasePool,
} from "@shawtie/db";
import {
  evaluateCapability,
  evaluateRelationshipStartDateMutation,
  trustedUtcDate,
  type CapabilityContext,
  type PartnershipState,
} from "@shawtie/domain";
import type { RelationshipStartDateUpdateInput } from "@shawtie/contracts";
import { randomUUID } from "node:crypto";
import { ApiError } from "../../lib/api-error.ts";
import type { AuthContext } from "../../plugins/authentication.ts";
import { formExplicitAcceptedRequest } from "./partnership-formation-coordinator.ts";

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
    throw new Error("Partnership metadata version exceeds safe integer range");
  }
  return Number(value);
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

export class PartnershipService {
  readonly database: DatabasePool;

  constructor(database: DatabasePool) {
    this.database = database;
  }

  async accept(
    auth: AuthContext,
    requestId: string,
  ): Promise<{
    outcome: "formed" | "already_accepted";
    partnershipId: string;
  }> {
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
        return {
          ok: true,
          outcome: "formed",
          partnershipId: formed.partnershipId,
        };
      },
    );

    if (!decision.ok) throw new ApiError(decision.statusCode, decision.code);
    return {
      outcome: decision.outcome,
      partnershipId: decision.partnershipId,
    };
  }

  async current(auth: AuthContext): Promise<{
    partnership: null | {
      partnershipId: string;
      lifecycleState: "active" | "breakup_pending";
      activatedAt: string;
      relationshipStartDate: string;
      metadataVersion: number;
      capabilities: { changeRelationshipStartDate: boolean };
      otherMember: {
        accountId: string;
        username: string;
        displayName: string;
      };
    };
  }> {
    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const current = await loadPartnershipReadModelForAccount(transaction, auth.session.accountId);
      if (!current) return { partnership: null };

      const memberIds = [auth.session.accountId, current.otherMember.accountId].sort();
      const decision = evaluateCapability(
        "change_relationship_start_date",
        capabilityContext({
          actorAccountId: auth.session.accountId,
          memberIds,
          lifecycleState: current.lifecycleState,
          generation: current.generation,
          viewOnlyAccountId: current.viewOnlyAccountId,
          now,
        }),
      );

      return {
        partnership: {
          partnershipId: current.partnershipId,
          lifecycleState: current.lifecycleState,
          activatedAt: current.activatedAt.toISOString(),
          relationshipStartDate: current.relationshipStartDate,
          metadataVersion: safeVersion(current.metadataVersion),
          capabilities: {
            changeRelationshipStartDate: decision.allowed,
          },
          otherMember: current.otherMember,
        },
      };
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
        deduplicationKey: `relationship-start-date-changed:${partnershipId}:${nextVersion}:${otherMemberId}`,
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
