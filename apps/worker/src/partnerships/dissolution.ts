import { randomUUID } from "node:crypto";
import {
  appendLifecycleEvent,
  cancelPendingRelationshipReleaseActionsForPartnership,
  cancelPendingScheduledActionsForAggregate,
  createPartnershipDeletionManifestIfAbsent,
  insertOutboxEvent,
  insertPartnerCooldown,
  markBreakupDissolved,
  markOpenBreakupSuperseded,
  resolveExpiredPartnerEligibility,
  terminatePartnershipLifecycle,
  terminalizeCurrentCallForPartnership,
  loadCallParticipants,
  type LockedPartnershipLifecycle,
  type QueryExecutor,
} from "@shawtie/db";
import { queueWorkerLifecycleNotice } from "./lifecycle-notices.ts";

export interface DissolutionInput {
  readonly transaction: QueryExecutor;
  readonly lifecycle: LockedPartnershipLifecycle;
  readonly reason: "breakup" | "partner_account_deleted";
  readonly effectiveAt: Date;
  readonly observedAt: Date;
  readonly deletingAccountId?: string;
}

export interface DissolutionResult {
  readonly applied: boolean;
  readonly generation: bigint;
}

export async function dissolvePartnership(input: DissolutionInput): Promise<DissolutionResult> {
  const { transaction, lifecycle } = input;
  if (lifecycle.memberIds.length !== 2) {
    throw new Error("Partnership dissolution requires exactly two historical members");
  }

  const terminatedCall = await terminalizeCurrentCallForPartnership(transaction, {
    partnershipId: lifecycle.partnershipId,
    reason: "partnership_terminated",
    now: input.effectiveAt,
  });
  if (terminatedCall) {
    const participants = await loadCallParticipants(transaction, terminatedCall.id);
    const accountIds = participants.map((participant) => participant.accountId).sort();
    const callVersion = Number(terminatedCall.version);
    if (
      accountIds.length !== 2
      || accountIds[0] === accountIds[1]
      || !Number.isSafeInteger(callVersion)
      || callVersion <= 0
    ) {
      throw new Error("Invalid call state during partnership dissolution");
    }
    await insertOutboxEvent(transaction, {
      id: randomUUID(),
      eventType: "c1.call.changed",
      aggregateType: "call",
      aggregateId: terminatedCall.id,
      deduplicationKey:
        "c1:call-changed:" + terminatedCall.id + ":" + callVersion,
      payload: {
        partnershipId: terminatedCall.partnershipId,
        callId: terminatedCall.id,
        version: callVersion,
      },
      payloadVersion: 1,
    });
    await insertOutboxEvent(transaction, {
      id: randomUUID(),
      eventType: "c1.call.push",
      aggregateType: "call",
      aggregateId: terminatedCall.id,
      deduplicationKey:
        "c1:call-push:" + terminatedCall.id + ":" + callVersion,
      payload: { accountIds },
      payloadVersion: 1,
    });
  }

  const generation = await terminatePartnershipLifecycle(transaction, {
    partnershipId: lifecycle.partnershipId,
    reason: input.reason,
    effectiveAt: input.effectiveAt,
  });
  if (generation === null) {
    return { applied: false, generation: lifecycle.generation };
  }

  if (input.reason === "breakup") {
    if (!lifecycle.breakup) {
      throw new Error("Breakup dissolution requires an open breakup process");
    }
    const marked = await markBreakupDissolved(transaction, lifecycle.breakup.id, input.effectiveAt);
    if (!marked) throw new Error("Open breakup could not be marked dissolved");
  } else {
    await markOpenBreakupSuperseded(transaction, lifecycle.partnershipId, input.effectiveAt);
  }

  await resolveExpiredPartnerEligibility(transaction, lifecycle.memberIds, input.effectiveAt);

  if (input.reason === "breakup") {
    for (const accountId of lifecycle.memberIds) {
      await insertPartnerCooldown(transaction, {
        id: randomUUID(),
        accountId,
        sourcePartnershipId: lifecycle.partnershipId,
        reason: "breakup_dissolution",
        createdAt: input.effectiveAt,
      });
    }
  } else {
    if (!input.deletingAccountId) {
      throw new Error("Permanent partner deletion requires deleting account identity");
    }
    const remainingAccountId = lifecycle.memberIds.find(
      (accountId) => accountId !== input.deletingAccountId,
    );
    if (!remainingAccountId) {
      throw new Error("Remaining partner could not be derived");
    }
    await insertPartnerCooldown(transaction, {
      id: randomUUID(),
      accountId: remainingAccountId,
      sourcePartnershipId: lifecycle.partnershipId,
      reason: "partner_account_deleted",
      createdAt: input.effectiveAt,
    });
  }

  if (lifecycle.breakup) {
    await cancelPendingScheduledActionsForAggregate(
      transaction,
      "breakup_process",
      lifecycle.breakup.id,
      input.observedAt,
    );
  }
  await cancelPendingScheduledActionsForAggregate(
    transaction,
    "partnership",
    lifecycle.partnershipId,
    input.observedAt,
  );
  await cancelPendingRelationshipReleaseActionsForPartnership(
    transaction,
    lifecycle.partnershipId,
    input.observedAt,
  );

  await createPartnershipDeletionManifestIfAbsent(transaction, {
    id: randomUUID(),
    subjectType: "partnership",
    subjectId: lifecycle.partnershipId,
    reason: input.reason === "breakup" ? "breakup_dissolution" : "partner_account_deleted",
    accessRevokedAt: input.effectiveAt,
    targets: [
      {
        id: randomUUID(),
        targetType: "partnership_relational_content",
        targetKey: lifecycle.partnershipId,
      },
      {
        id: randomUUID(),
        targetType: "partnership_crypto_state",
        targetKey: lifecycle.partnershipId,
      },
    ],
  });

  await appendLifecycleEvent(transaction, {
    id: randomUUID(),
    partnershipId: lifecycle.partnershipId,
    actorAccountId:
      input.reason === "partner_account_deleted" ? (input.deletingAccountId ?? null) : null,
    eventType: "partnership_dissolved",
    aggregateVersion: generation,
    metadata: {
      reason: input.reason,
      generation: Number(generation),
      deadline: input.effectiveAt.toISOString(),
      status: "terminated",
    },
  });
  const realtimeEventId = randomUUID();
  await insertOutboxEvent(transaction, {
    id: realtimeEventId,
    eventType: "m2.partnership.changed",
    aggregateType: "partnership",
    aggregateId: lifecycle.partnershipId,
    deduplicationKey: "m2-partnership:" + realtimeEventId,
    payload: {
      partnershipId: lifecycle.partnershipId,
      accountIds: [...lifecycle.memberIds].sort(),
      generation: Number(generation),
      metadataVersion: Number(lifecycle.metadataVersion),
    },
    payloadVersion: 1,
  });

  if (input.reason === "breakup") {
    for (const accountId of lifecycle.memberIds) {
      await queueWorkerLifecycleNotice(transaction, {
        recipientAccountId: accountId,
        partnershipId: lifecycle.partnershipId,
        eventType: "partnership_dissolved",
        deduplicationKey:
          "partnership-dissolved:" + lifecycle.partnershipId + ":" + generation + ":" + accountId,
        now: input.observedAt,
        emailTemplate: "partnership_dissolved",
        emailParameters: {
          reason: "breakup",
          deadline: input.effectiveAt.toISOString(),
        },
        emailAccountId: lifecycle.accountDeletion?.accountId === accountId ? null : accountId,
      });
    }
  } else {
    const remainingAccountId = lifecycle.memberIds.find(
      (accountId) => accountId !== input.deletingAccountId,
    );
    if (remainingAccountId) {
      await queueWorkerLifecycleNotice(transaction, {
        recipientAccountId: remainingAccountId,
        actorAccountId: input.deletingAccountId ?? null,
        partnershipId: lifecycle.partnershipId,
        eventType: "partner_account_deleted",
        deduplicationKey:
          "partner-account-deleted:" +
          lifecycle.partnershipId +
          ":" +
          generation +
          ":" +
          remainingAccountId,
        now: input.observedAt,
        emailTemplate: "partner_account_deleted",
        emailParameters: { deadline: input.effectiveAt.toISOString() },
      });
    }
  }

  return { applied: true, generation };
}
