import { isAdultOnDate } from "./age.ts";
import type { RuleDecision } from "./types.ts";

export function evaluateUsernameChange(
  now: Date,
  nextEligibleAt: Date | null,
  hasOccupiedPartnership: boolean,
): RuleDecision {
  if (hasOccupiedPartnership) {
    return { allowed: false, reason: "USERNAME_CHANGE_NOT_ALLOWED" };
  }
  if (nextEligibleAt && now.getTime() < nextEligibleAt.getTime()) {
    return { allowed: false, reason: "USERNAME_CHANGE_NOT_ALLOWED" };
  }
  return { allowed: true, reason: null };
}

export function evaluateDateOfBirthCorrection(
  currentDate: string,
  proposedDateOfBirth: string,
  alreadyCorrected: boolean,
): RuleDecision {
  if (alreadyCorrected) {
    return { allowed: false, reason: "DOB_CORRECTION_ALREADY_USED" };
  }
  if (!isAdultOnDate(proposedDateOfBirth, currentDate)) {
    return { allowed: false, reason: "AGE_INELIGIBLE" };
  }
  return { allowed: true, reason: null };
}
