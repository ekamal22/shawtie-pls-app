import { randomUUID } from "node:crypto";
import {
  appendLifecycleEvent,
  finalizePartnershipForAccountDeletion,
  getAccountDeletionGeneration,
  getCurrentPartnershipForAccount,
  lockAccounts,
  lockPendingAccountDeletion,
  type ScheduledAction,
} from "@shawtie/db";
import { RetryableWorkerError } from "../runtime/errors.ts";
import type { ScheduledActionHandler } from "../scheduled/scheduled-handler.ts";

export const accountDeletionBreakupPrecedenceHandler: ScheduledActionHandler = {
  actionType: "account_deletion_breakup_precedence_finalize",
  payloadVersion: 1,
  loadCurrentGeneration(transaction, action: ScheduledAction) {
    return getAccountDeletionGeneration(transaction, action.aggregateId);
  },
  async execute({ transaction, action, now }) {
    const initial = await getCurrentPartnershipForAccount(transaction, action.aggregateId);
    if (!initial) return;

    await lockAccounts(transaction, [action.aggregateId, initial.otherAccountId]);

    const deletion = await lockPendingAccountDeletion(
      transaction,
      action.aggregateId,
      action.expectedGeneration ?? 0n,
    );
    if (!deletion) return;

    const partnership = await getCurrentPartnershipForAccount(transaction, action.aggregateId);
    if (!partnership) return;
    if (
      partnership.partnershipId !== initial.partnershipId ||
      partnership.otherAccountId !== initial.otherAccountId
    ) {
      throw new RetryableWorkerError("PARTNERSHIP_CHANGED_DURING_LOCK");
    }
    if (partnership.lifecycleState !== "breakup_pending" || !partnership.breakupFinalDeadline) {
      return;
    }
    if (partnership.breakupFinalDeadline.getTime() > now.getTime()) {
      throw new RetryableWorkerError("BREAKUP_PRECEDENCE_TOO_EARLY");
    }
    if (partnership.breakupFinalDeadline.getTime() >= deletion.recoverUntil.getTime()) {
      return;
    }

    const reason = await finalizePartnershipForAccountDeletion(transaction, {
      partnershipId: partnership.partnershipId,
      deletingAccountId: action.aggregateId,
      remainingAccountId: partnership.otherAccountId,
      at: partnership.breakupFinalDeadline,
      breakupDeadline: partnership.breakupFinalDeadline,
    });
    if (reason !== "breakup") {
      throw new RetryableWorkerError("BREAKUP_PRECEDENCE_REASON_MISMATCH");
    }

    await appendLifecycleEvent(transaction, {
      id: randomUUID(),
      partnershipId: partnership.partnershipId,
      actorAccountId: action.aggregateId,
      eventType: "partnership_dissolved",
      aggregateVersion: partnership.generation + 1n,
      metadata: {
        reason,
        deadline: partnership.breakupFinalDeadline.toISOString(),
        status: "terminated",
      },
    });
  },
};
