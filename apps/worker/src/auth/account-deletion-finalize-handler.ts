import { randomUUID } from "node:crypto";
import {
  appendLifecycleEvent,
  appendSecurityEvent,
  createDeletionManifest,
  finalizeAccountDeletionState,
  finalizePartnershipForAccountDeletion,
  getAccountDeletionGeneration,
  getCurrentPartnershipForAccount,
  lockAccounts,
  lockPendingAccountDeletion,
  type ScheduledAction,
} from "@shawtie/db";
import { RetryableWorkerError } from "../runtime/errors.ts";
import type { ScheduledActionHandler } from "../scheduled/scheduled-handler.ts";

export const accountDeletionFinalizeHandler: ScheduledActionHandler = {
  actionType: "account_deletion_finalize",
  payloadVersion: 1,
  loadCurrentGeneration(transaction, action: ScheduledAction) {
    return getAccountDeletionGeneration(transaction, action.aggregateId);
  },
  async execute({ transaction, action, now }) {
    const initialPartnership = await getCurrentPartnershipForAccount(
      transaction,
      action.aggregateId,
    );
    const ids = initialPartnership
      ? [action.aggregateId, initialPartnership.otherAccountId]
      : [action.aggregateId];
    await lockAccounts(transaction, ids);

    const deletion = await lockPendingAccountDeletion(
      transaction,
      action.aggregateId,
      action.expectedGeneration ?? 0n,
    );
    if (!deletion) return;
    if (now.getTime() < deletion.recoverUntil.getTime()) {
      throw new RetryableWorkerError("ACCOUNT_DELETION_TOO_EARLY");
    }

    const partnership = await getCurrentPartnershipForAccount(
      transaction,
      action.aggregateId,
    );
    if (partnership) {
      const reason = await finalizePartnershipForAccountDeletion(transaction, {
        partnershipId: partnership.partnershipId,
        deletingAccountId: action.aggregateId,
        remainingAccountId: partnership.otherAccountId,
        at: now,
        breakupDeadline: partnership.breakupFinalDeadline,
      });
      await appendLifecycleEvent(transaction, {
        id: randomUUID(),
        partnershipId: partnership.partnershipId,
        actorAccountId: action.aggregateId,
        eventType: "partnership_dissolved",
        aggregateVersion: partnership.generation + 1n,
        metadata: { reason, status: "terminated" },
      });
    }

    await finalizeAccountDeletionState(
      transaction,
      action.aggregateId,
      deletion.id,
      now,
    );
    await appendSecurityEvent(transaction, {
      id: randomUUID(),
      accountId: action.aggregateId,
      eventType: "account_permanently_deleted",
      metadata: { generation: Number(action.expectedGeneration ?? 0n) },
      at: now,
    });
    await createDeletionManifest(transaction, {
      id: randomUUID(),
      subjectType: "account",
      subjectId: action.aggregateId,
      reason: "account_permanently_deleted",
      accessRevokedAt: deletion.requestedAt,
      targets: [
        {
          id: randomUUID(),
          targetType: "account_auth_data",
          targetKey: action.aggregateId,
        },
      ],
    });
  },
};
