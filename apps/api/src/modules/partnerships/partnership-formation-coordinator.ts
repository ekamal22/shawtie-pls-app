import { randomUUID } from "node:crypto";
import {
  POSTGRES_SQLSTATE,
  activeBlockExistsForPair,
  appendLifecycleEvent,
  cancelPendingScheduledActionsByDeduplicationKey,
  insertAccountNotification,
  insertPartnership,
  insertPartnershipMembers,
  invalidatePendingRequestsForAccount,
  loadPartnerAccountEligibility,
  lockPartnerRequestsById,
  markPartnerRequestsAccepted,
  postgresSqlState,
  type PartnerRequestRecord,
  type QueryExecutor,
} from "@shawtie/db";
import {
  relationshipStartDateAllowedForPartnership,
  resolveFormationConsent,
  trustedUtcDate,
  type ResolvedFormationConsent,
} from "@shawtie/domain";
import { ApiError } from "../../lib/api-error.ts";
import type {
  PartnershipFormationCoordinator,
  ReciprocalPairCandidate,
} from "../partner-requests/partner-request-service.ts";

function sortedPair(accountA: string, accountB: string): readonly [string, string] {
  return accountA.localeCompare(accountB) <= 0 ? [accountA, accountB] : [accountB, accountA];
}

function samePair(
  left: readonly [string, string],
  right: readonly [string, string],
): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function requestConsent(request: PartnerRequestRecord) {
  if (!request.relationshipStartDate) return null;
  return {
    requestId: request.id,
    senderAccountId: request.senderAccountId,
    recipientAccountId: request.recipientAccountId,
    relationshipStartDate: request.relationshipStartDate,
  };
}

async function assertFormationEligibility(
  executor: QueryExecutor,
  accountIds: readonly [string, string],
  now: Date,
): Promise<void> {
  const first = await loadPartnerAccountEligibility(executor, accountIds[0]);
  const second = await loadPartnerAccountEligibility(executor, accountIds[1]);
  if (!first || !second) throw new ApiError(409, "PARTNERSHIP_UNAVAILABLE");

  for (const account of [first, second]) {
    if (
      account.status !== "active" ||
      account.occupied ||
      (account.partnerEligibleAt !== null &&
        account.partnerEligibleAt.getTime() > now.getTime())
    ) {
      throw new ApiError(409, "PARTNERSHIP_UNAVAILABLE");
    }
  }

  if (await activeBlockExistsForPair(executor, accountIds[0], accountIds[1])) {
    throw new ApiError(409, "PARTNERSHIP_UNAVAILABLE");
  }
}

async function formLockedPair(
  executor: QueryExecutor,
  input: {
    readonly consent: ResolvedFormationConsent;
    readonly accountIds: readonly [string, string];
    readonly requests: readonly PartnerRequestRecord[];
  },
  now: Date,
): Promise<{ partnershipId: string }> {
  if (
    !relationshipStartDateAllowedForPartnership(
      input.consent.relationshipStartDate,
      trustedUtcDate(now),
    )
  ) {
    throw new ApiError(409, "RELATIONSHIP_DATE_FUTURE");
  }

  await assertFormationEligibility(executor, input.accountIds, now);

  const partnershipId = randomUUID();
  try {
    await insertPartnership(executor, {
      id: partnershipId,
      relationshipStartDate: input.consent.relationshipStartDate,
      activatedAt: now,
    });
    await insertPartnershipMembers(executor, partnershipId, input.accountIds, now);
  } catch (error) {
    if (postgresSqlState(error) === POSTGRES_SQLSTATE.uniqueViolation) {
      throw new ApiError(409, "PARTNERSHIP_UNAVAILABLE");
    }
    throw error;
  }

  const accepted = await markPartnerRequestsAccepted(
    executor,
    input.consent.requestIds,
    partnershipId,
    now,
  );
  if (accepted !== input.consent.requestIds.length) {
    throw new ApiError(409, "REQUEST_NOT_AVAILABLE");
  }

  await cancelPendingScheduledActionsByDeduplicationKey(
    executor,
    input.consent.requestIds.map((requestId) => `partner-request-expire:${requestId}`),
    now,
  );

  for (const accountId of input.accountIds) {
    await invalidatePendingRequestsForAccount(
      executor,
      accountId,
      now,
      "partnership_formed",
    );
  }

  await appendLifecycleEvent(executor, {
    id: randomUUID(),
    partnershipId,
    actorAccountId: input.consent.actorAccountId,
    eventType: "partnership_formed",
    aggregateVersion: 1n,
    metadata: { source: input.consent.source },
  });

  const notificationRecipient =
    input.consent.source === "explicit_accept"
      ? input.requests[0]?.senderAccountId
      : input.requests.find(
          (request) => request.id !== input.consent.triggeringRequestId,
        )?.senderAccountId;

  if (!notificationRecipient) {
    throw new Error("Formation notification recipient could not be derived");
  }

  await insertAccountNotification(executor, {
    id: randomUUID(),
    recipientAccountId: notificationRecipient,
    actorAccountId: input.consent.actorAccountId,
    partnershipId,
    eventType: "partnership_formed",
    deduplicationKey: `partnership-formed:${partnershipId}:${notificationRecipient}`,
    createdAt: now,
  });

  return { partnershipId };
}

export async function formExplicitAcceptedRequest(
  executor: QueryExecutor,
  request: PartnerRequestRecord,
  recipientAccountId: string,
  now: Date,
): Promise<{ partnershipId: string }> {
  const consentRequest = requestConsent(request);
  if (
    !consentRequest ||
    request.status !== "pending" ||
    request.recipientAccountId !== recipientAccountId ||
    now.getTime() >= request.expiresAt.getTime()
  ) {
    throw new ApiError(409, "REQUEST_NOT_AVAILABLE");
  }

  const resolved = resolveFormationConsent({
    source: "explicit_accept",
    request: consentRequest,
  });
  if (!resolved.ok) throw new ApiError(409, "REQUEST_NOT_AVAILABLE");

  return formLockedPair(
    executor,
    {
      consent: resolved.consent,
      accountIds: sortedPair(request.senderAccountId, request.recipientAccountId),
      requests: [request],
    },
    now,
  );
}

export function createP2PartnershipFormationCoordinator(): PartnershipFormationCoordinator {
  return {
    async handleReciprocalCandidate(
      executor: QueryExecutor,
      candidate: ReciprocalPairCandidate,
      now: Date,
    ): Promise<{ partnershipId: string }> {
      if (candidate.observedAt.getTime() !== now.getTime()) {
        throw new ApiError(409, "PARTNERSHIP_UNAVAILABLE");
      }

      const requests = await lockPartnerRequestsById(executor, candidate.requestIds);
      if (requests.length !== 2) throw new ApiError(409, "REQUEST_NOT_AVAILABLE");

      const first = requests[0];
      const second = requests[1];
      if (!first || !second) throw new ApiError(409, "REQUEST_NOT_AVAILABLE");
      if (
        first.status !== "pending" ||
        second.status !== "pending" ||
        now.getTime() >= first.expiresAt.getTime() ||
        now.getTime() >= second.expiresAt.getTime()
      ) {
        throw new ApiError(409, "REQUEST_NOT_AVAILABLE");
      }

      const firstConsent = requestConsent(first);
      const secondConsent = requestConsent(second);
      if (!firstConsent || !secondConsent) {
        throw new ApiError(409, "REQUEST_NOT_AVAILABLE");
      }

      const resolved = resolveFormationConsent({
        source: "reciprocal_request",
        requests: [firstConsent, secondConsent],
        triggeringRequestId: candidate.triggeringRequestId,
      });
      if (!resolved.ok) throw new ApiError(409, "REQUEST_NOT_AVAILABLE");

      const actualPair = sortedPair(first.senderAccountId, first.recipientAccountId);
      if (
        !samePair(actualPair, candidate.accountIds) ||
        resolved.consent.relationshipStartDate !== candidate.relationshipStartDate
      ) {
        throw new ApiError(409, "REQUEST_NOT_AVAILABLE");
      }

      return formLockedPair(
        executor,
        {
          consent: resolved.consent,
          accountIds: actualPair,
          requests,
        },
        now,
      );
    },
  };
}
