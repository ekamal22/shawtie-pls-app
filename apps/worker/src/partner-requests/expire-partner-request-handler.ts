import { setPartnerRequestExpired } from "@shawtie/db";
import type { ScheduledActionHandler } from "../scheduled/scheduled-handler.ts";

export const partnerRequestExpiryHandler: ScheduledActionHandler = {
  actionType: "partner_request_expire",
  payloadVersion: 1,
  async execute({ transaction, action, now }): Promise<void> {
    if (action.aggregateType !== "partner_request") {
      throw new Error("partner_request_expire action has an invalid aggregate type");
    }
    const result = await setPartnerRequestExpired(transaction, action.aggregateId, now);
    if (result === "too_early") {
      throw new Error("partner_request_expire action was claimed before its request deadline");
    }
  },
};
