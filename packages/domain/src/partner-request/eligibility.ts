import type {
  PartnerRequestEligibilityDecision,
  PartnerRequestPairEligibility,
  ProspectivePartnerAccountState,
} from "./types.ts";
import { declineCooldownActive } from "./time.ts";

const ALLOW: PartnerRequestEligibilityDecision = { allowed: true, reason: null };

function accountAvailable(account: ProspectivePartnerAccountState, now: string): boolean {
  if (account.status !== "active") return false;
  if (account.occupied) return false;
  if (account.partnerEligibleAt && now < account.partnerEligibleAt) return false;
  return true;
}

export function evaluatePartnerRequestPair(
  input: PartnerRequestPairEligibility,
): PartnerRequestEligibilityDecision {
  if (!accountAvailable(input.sender, input.now)) {
    return { allowed: false, reason: "SENDER_INELIGIBLE" };
  }
  if (!accountAvailable(input.recipient, input.now) || input.blockedEitherDirection) {
    return { allowed: false, reason: "TARGET_UNAVAILABLE" };
  }
  if (input.sameDirectionPending) {
    return { allowed: false, reason: "REQUEST_ALREADY_PENDING" };
  }
  if (declineCooldownActive(input.lastDeclinedAt, input.now)) {
    return { allowed: false, reason: "REQUEST_DECLINE_COOLDOWN" };
  }
  if (input.createdAttemptsInRollingMonth >= 3) {
    return { allowed: false, reason: "REQUEST_MONTHLY_LIMIT" };
  }
  return ALLOW;
}

export function publicPartnerRequestDenial(
  reason: PartnerRequestEligibilityDecision["reason"],
): PartnerRequestEligibilityDecision["reason"] {
  return reason === "SENDER_INELIGIBLE" ? "SENDER_INELIGIBLE" : reason;
}
