import {
  getAccountDeletionGeneration,
  getCurrentPartnershipForAccount,
  lockAccounts,
  lockPartnershipLifecycle,
  lockPendingAccountDeletion,
  type ScheduledAction,
} from "@shawtie/db";
import { RetryableWorkerError } from "../runtime/errors.ts";
import type { ScheduledActionHandler } from "../scheduled/scheduled-handler.ts";
import { dissolvePartnership } from "../partnerships/dissolution.ts";

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

    const lifecycle = await lockPartnershipLifecycle(transaction, partnership.partnershipId);
    const breakup = lifecycle?.breakup;
    if (!lifecycle || !breakup) return;
    if (breakup.finalDeadline.getTime() > now.getTime()) {
      throw new RetryableWorkerError("BREAKUP_PRECEDENCE_TOO_EARLY");
    }
    if (breakup.finalDeadline.getTime() >= deletion.recoverUntil.getTime()) return;

    await dissolvePartnership({
      transaction,
      lifecycle,
      reason: "breakup",
      effectiveAt: breakup.finalDeadline,
      observedAt: now,
    });
  },
};
