import type { AccountStatus } from "../partnership/types.ts";

export type PartnerRequestStatus =
  "pending" | "accepted" | "declined" | "cancelled" | "expired" | "invalidated";

export type PartnerRequestInvalidationReason =
  "account_unavailable" | "partnership_formed" | "block_created";

export type PartnerRequestDenialCode =
  | "REQUEST_SELF"
  | "REQUEST_ALREADY_PENDING"
  | "REQUEST_MONTHLY_LIMIT"
  | "REQUEST_DECLINE_COOLDOWN"
  | "TARGET_CHANGED"
  | "TARGET_UNAVAILABLE"
  | "SENDER_INELIGIBLE"
  | "RELATIONSHIP_DATE_FUTURE";

export interface ProspectivePartnerAccountState {
  readonly accountId: string;
  readonly status: AccountStatus;
  readonly occupied: boolean;
  readonly partnerEligibleAt: string | null;
}

export interface PartnerRequestPairEligibility {
  readonly sender: ProspectivePartnerAccountState;
  readonly recipient: ProspectivePartnerAccountState;
  readonly blockedEitherDirection: boolean;
  readonly sameDirectionPending: boolean;
  readonly createdAttemptsInRollingMonth: number;
  readonly lastDeclinedAt: string | null;
  readonly now: string;
}

export interface PartnerRequestEligibilityDecision {
  readonly allowed: boolean;
  readonly reason: PartnerRequestDenialCode | null;
}
