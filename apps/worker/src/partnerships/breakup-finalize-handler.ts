import {
  getOpenBreakupGeneration,
  loadBreakupPartnershipId,
  loadLifecycleMemberIds,
  lockAccounts,
  lockPartnershipLifecycle,
  type ScheduledAction,
} from "@shawtie/db";
import { RetryableWorkerError } from "../runtime/errors.ts";
import type { ScheduledActionHandler } from "../scheduled/scheduled-handler.ts";
import { dissolvePartnership } from "./dissolution.ts";

export const partnershipBreakupFinalizeHandler: ScheduledActionHandler = {
  actionType: "partnership_breakup_finalize",
  payloadVersion: 1,
  loadCurrentGeneration(transaction, action: ScheduledAction) {
    return getOpenBreakupGeneration(transaction, action.aggregateId);
  },
  async execute({ transaction, action, now }) {
    const partnershipId = await loadBreakupPartnershipId(transaction, action.aggregateId);
    if (!partnershipId) return;

    const memberIds = await loadLifecycleMemberIds(transaction, partnershipId);
    if (memberIds.length !== 2) return;
    await lockAccounts(transaction, memberIds);

    const lifecycle = await lockPartnershipLifecycle(transaction, partnershipId);
    const breakup = lifecycle?.breakup;
    if (!lifecycle || !breakup || breakup.id !== action.aggregateId) return;
    if (action.expectedGeneration !== breakup.generation) return;
    if (now.getTime() < breakup.finalDeadline.getTime()) {
      throw new RetryableWorkerError("BREAKUP_FINALIZE_TOO_EARLY");
    }

    const deletion = lifecycle.accountDeletion;
    if (deletion && deletion.recoverUntil.getTime() < breakup.finalDeadline.getTime()) {
      return;
    }

    await dissolvePartnership({
      transaction,
      lifecycle,
      reason: "breakup",
      effectiveAt: breakup.finalDeadline,
      observedAt: now,
    });
  },
};
