import {
  getOpenBreakupGeneration,
  loadBreakupPartnershipId,
  loadLifecycleMemberIds,
  lockAccounts,
  lockPartnershipLifecycle,
  type ScheduledAction,
} from "@shawtie/db";
import type { ScheduledActionHandler } from "../scheduled/scheduled-handler.ts";
import { queueWorkerLifecycleNotice } from "./lifecycle-notices.ts";

export const partnershipBreakupDeadlineReminderHandler: ScheduledActionHandler = {
  actionType: "partnership_breakup_deadline_reminder",
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

    for (const accountId of lifecycle.memberIds) {
      await queueWorkerLifecycleNotice(transaction, {
        recipientAccountId: accountId,
        partnershipId,
        eventType: "breakup_deadline_reminder",
        deduplicationKey:
          "breakup-deadline-reminder:" +
          breakup.id +
          ":" +
          breakup.generation +
          ":" +
          accountId,
        now,
        emailTemplate: "breakup_deadline_reminder",
        emailParameters: { deadline: breakup.finalDeadline.toISOString() },
      });
    }
  },
};
