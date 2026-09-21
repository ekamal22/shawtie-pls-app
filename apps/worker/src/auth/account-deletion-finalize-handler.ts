import { randomUUID } from "node:crypto";
import {
  appendSecurityEvent,
  createDeletionManifest,
  finalizeAccountDeletionState,
  getAccountDeletionGeneration,
  getAccountProfile,
  getCurrentPartnershipForAccount,
  lockAccounts,
  lockPartnershipLifecycle,
  lockPendingAccountDeletion,
  type ScheduledAction,
} from "@shawtie/db";
import { RetryableWorkerError } from "../runtime/errors.ts";
import type { ScheduledActionHandler } from "../scheduled/scheduled-handler.ts";
import { dissolvePartnership } from "../partnerships/dissolution.ts";
import { queueWorkerSecurityEmail } from "../partnerships/lifecycle-notices.ts";

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

    const deletingProfile = await getAccountProfile(transaction, action.aggregateId);
    const partnership = await getCurrentPartnershipForAccount(transaction, action.aggregateId);
    if (
      partnership &&
      (!initialPartnership ||
        partnership.partnershipId !== initialPartnership.partnershipId ||
        partnership.otherAccountId !== initialPartnership.otherAccountId)
    ) {
      throw new RetryableWorkerError("PARTNERSHIP_CHANGED_DURING_LOCK");
    }

    if (partnership) {
      const lifecycle = await lockPartnershipLifecycle(transaction, partnership.partnershipId);
      if (!lifecycle) {
        throw new RetryableWorkerError("PARTNERSHIP_CHANGED_DURING_LOCK");
      }
      const breakupWins = Boolean(
        lifecycle.breakup &&
        lifecycle.breakup.finalDeadline.getTime() <= deletion.recoverUntil.getTime(),
      );
      await dissolvePartnership({
        transaction,
        lifecycle,
        reason: breakupWins ? "breakup" : "partner_account_deleted",
        effectiveAt:
          breakupWins && lifecycle.breakup
            ? lifecycle.breakup.finalDeadline
            : deletion.recoverUntil,
        observedAt: now,
        ...(breakupWins ? {} : { deletingAccountId: action.aggregateId }),
      });
    }

    if (deletingProfile) {
      await queueWorkerSecurityEmail(transaction, {
        accountId: null,
        destinationEmail: deletingProfile.email,
        template: "account_permanently_deleted",
        parameters: { deadline: deletion.recoverUntil.toISOString() },
        deduplicationKey:
          "account-permanently-deleted:" +
          action.aggregateId +
          ":" +
          (action.expectedGeneration ?? 0n),
        now,
      });
    }

    await finalizeAccountDeletionState(transaction, action.aggregateId, deletion.id, now);
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
