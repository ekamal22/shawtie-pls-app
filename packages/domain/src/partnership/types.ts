export type MemberId = string;

export type AccountStatus = "active" | "deletion_pending" | "deleted";
export type PartnershipLifecycle = "active" | "breakup_pending" | "terminated";
export type TerminationReason = "breakup" | "partner_account_deleted";

export type DenialCode =
  | "ACCOUNT_LOCKED"
  | "NO_PARTNERSHIP"
  | "PARTNERSHIP_TERMINATED"
  | "PARTNERSHIP_OCCUPIED"
  | "PARTNERSHIP_METADATA_LOCKED"
  | "BREAKUP_REQUIRED"
  | "BREAKUP_WINDOW_EXPIRED"
  | "RESTORE_WINDOW_NOT_OPEN"
  | "NOT_BREAKUP_INITIATOR"
  | "BREAKUP_DEADLINE_EXPIRED"
  | "RESTORE_INTENT_ALREADY_SUBMITTED"
  | "PRE_BREAKUP_MESSAGE_LOCKED"
  | "RELATIONSHIP_OBJECTS_VIEW_ONLY"
  | "BLOCK_NOT_ALLOWED"
  | "COOLDOWN_ACTIVE"
  | "USERNAME_CHANGE_BLOCKED"
  | "MESSAGE_EDIT_WINDOW_EXPIRED"
  | "MESSAGE_NOT_OWNED"
  | "MESSAGE_DELETED"
  | "STALE_GENERATION"
  | "TOO_EARLY";

export interface BreakupProcess {
  initiatedBy: MemberId;
  initiatedAt: string;
  initiatorCancelUntil: string;
  baseDeadline: string;
  finalDeadline: string;
  restoreIntentAt: Readonly<Record<MemberId, string | undefined>>;
  generation: number;
  messageFreezeSequence?: number | null;
}

export interface AccountDeletionProcess {
  accountId: MemberId;
  requestedAt: string;
  recoverUntil: string;
  generation: number;
}

export interface PartnershipState {
  id: string;
  members: readonly [MemberId, MemberId];
  lifecycle: PartnershipLifecycle;
  generation: number;
  breakup: BreakupProcess | null;
  accountDeletion: AccountDeletionProcess | null;
  terminatedAt: string | null;
  terminationReason: TerminationReason | null;
  partnerEligibleAt: Readonly<Record<MemberId, string | null>>;
}

export interface AccountState {
  id: MemberId;
  status: AccountStatus;
  nextUsernameChangeEligibleAt: string | null;
}

export interface MessageState {
  id: string;
  senderId: MemberId;
  createdAt: string;
  deletedAt: string | null;
  serverSequence?: number;
}

export type CapabilityName =
  | "view_shared_data"
  | "send_message"
  | "reply_message"
  | "edit_message"
  | "delete_message"
  | "react_message"
  | "send_media"
  | "start_call"
  | "create_relationship_object"
  | "edit_relationship_object"
  | "edit_relationship_object_content"
  | "delete_relationship_object"
  | "mutate_relationship_shared_state"
  | "curate_relationship_space"
  | "recipient_open_relationship_object"
  | "creator_reveal_relationship_object"
  | "create_relationship_signal"
  | "change_relationship_start_date"
  | "change_nickname"
  | "change_email"
  | "change_username"
  | "initiate_breakup"
  | "submit_restore_intent"
  | "cancel_breakup"
  | "block_former_partner"
  | "form_partnership"
  | "recover_account";

export interface CapabilityDecision {
  allowed: boolean;
  reason: DenialCode | null;
}

export interface CapabilityContext {
  actor: AccountState;
  partnership: PartnershipState | null;
  now: string;
  message?: MessageState;
  blockedWithProspectivePartner?: boolean;
}

export interface StateTransition<T> {
  ok: true;
  state: T;
}

export interface StateTransitionError {
  ok: false;
  reason: DenialCode;
}

export type TransitionResult<T> = StateTransition<T> | StateTransitionError;
