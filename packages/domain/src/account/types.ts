export type AccountRuleDenialCode =
  | "AGE_INELIGIBLE"
  | "USERNAME_INVALID"
  | "USERNAME_RESERVED"
  | "PASSWORD_TOO_SHORT"
  | "PASSWORD_TOO_LONG"
  | "PASSWORD_TOO_LARGE"
  | "PASSWORD_COMMON"
  | "USERNAME_CHANGE_NOT_ALLOWED"
  | "DOB_CORRECTION_ALREADY_USED";

export interface RuleDecision {
  readonly allowed: boolean;
  readonly reason: AccountRuleDenialCode | null;
}

export interface UsernameValue {
  readonly display: string;
  readonly normalized: string;
}
