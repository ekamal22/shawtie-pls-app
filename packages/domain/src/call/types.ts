export type CallKind = "voice" | "video";
export type CallState = "ringing" | "accepted" | "connected" | "ended";
export type CallParticipantRole = "caller" | "callee";

export type CallTerminalReason =
  | "rejected"
  | "cancelled"
  | "missed"
  | "completed"
  | "failed"
  | "authorization_revoked"
  | "partnership_terminated"
  | "account_deletion"
  | "session_revoked";

export type PublicCallOutcome =
  "rejected" | "cancelled" | "missed" | "completed" | "failed" | "unavailable";

export interface CallPolicyContext {
  readonly actorAccountId: string;
  readonly memberAccountIds: readonly [string, string];
  readonly accountStatuses: Readonly<Record<string, "active" | "deletion_pending" | "deleted">>;
  readonly partnershipLifecycle: "active" | "breakup_pending" | "terminated";
  readonly accountDeletionAccountId: string | null;
}

export interface CallPolicyDecision {
  readonly allowed: boolean;
  readonly reason:
    null | "NO_PARTNERSHIP" | "CALLING_NOT_ALLOWED" | "ACCOUNT_LOCKED" | "PARTNERSHIP_TERMINATED";
}
