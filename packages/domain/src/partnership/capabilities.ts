import type { CapabilityContext, CapabilityDecision, CapabilityName, DenialCode } from "./types.ts";
import { isAtOrAfter, isBefore } from "./time.ts";

const ALLOW: CapabilityDecision = { allowed: true, reason: null };

function deny(reason: DenialCode): CapabilityDecision {
  return { allowed: false, reason };
}

function isMember(ctx: CapabilityContext): boolean {
  return Boolean(ctx.partnership?.members.includes(ctx.actor.id));
}

function accountLocked(ctx: CapabilityContext): boolean {
  if (ctx.actor.status !== "active") return true;
  return Boolean(ctx.partnership?.accountDeletion?.accountId === ctx.actor.id);
}

function partnershipDeletionViewOnly(ctx: CapabilityContext): boolean {
  return Boolean(ctx.partnership?.accountDeletion);
}

function isCooldownActive(ctx: CapabilityContext): boolean {
  const eligibleAt = ctx.partnership?.partnerEligibleAt[ctx.actor.id] ?? null;
  return Boolean(eligibleAt && isBefore(ctx.now, eligibleAt));
}

function isPreBreakupMessage(ctx: CapabilityContext): boolean {
  if (!ctx.message || !ctx.partnership?.breakup) return false;
  return isBefore(ctx.message.createdAt, ctx.partnership.breakup.initiatedAt);
}

function messageBaseDecision(ctx: CapabilityContext): CapabilityDecision | null {
  if (accountLocked(ctx)) return deny("ACCOUNT_LOCKED");
  if (!ctx.partnership || !isMember(ctx)) return deny("NO_PARTNERSHIP");
  if (ctx.partnership.lifecycle === "terminated") return deny("PARTNERSHIP_TERMINATED");
  if (partnershipDeletionViewOnly(ctx)) return deny("ACCOUNT_LOCKED");
  if (ctx.message?.deletedAt) return deny("MESSAGE_DELETED");
  return null;
}

export function evaluateCapability(
  capability: CapabilityName,
  ctx: CapabilityContext,
): CapabilityDecision {
  const partnership = ctx.partnership;

  if (capability === "recover_account") {
    if (
      ctx.actor.status === "deletion_pending" ||
      partnership?.accountDeletion?.accountId === ctx.actor.id
    ) {
      return ALLOW;
    }
    return deny("ACCOUNT_LOCKED");
  }

  if (capability === "change_relationship_start_date") {
    if (ctx.actor.status !== "active") return deny("ACCOUNT_LOCKED");
    if (!partnership || !isMember(ctx)) return deny("NO_PARTNERSHIP");
    if (partnership.lifecycle === "terminated") return deny("PARTNERSHIP_TERMINATED");
    if (partnershipDeletionViewOnly(ctx)) return deny("PARTNERSHIP_METADATA_LOCKED");
    return ALLOW;
  }

  if (accountLocked(ctx)) return deny("ACCOUNT_LOCKED");

  if (capability === "form_partnership") {
    if (ctx.blockedWithProspectivePartner) return deny("BLOCK_NOT_ALLOWED");
    if (partnership && partnership.lifecycle !== "terminated") return deny("PARTNERSHIP_OCCUPIED");
    if (partnership && isCooldownActive(ctx)) return deny("COOLDOWN_ACTIVE");
    return ALLOW;
  }

  if (capability === "change_username") {
    if (partnership && partnership.lifecycle !== "terminated") {
      return deny("USERNAME_CHANGE_BLOCKED");
    }
    if (
      ctx.actor.nextUsernameChangeEligibleAt &&
      isBefore(ctx.now, ctx.actor.nextUsernameChangeEligibleAt)
    ) {
      return deny("USERNAME_CHANGE_BLOCKED");
    }
    return ALLOW;
  }

  if (capability === "change_email") {
    return ALLOW;
  }

  if (!partnership || !isMember(ctx)) return deny("NO_PARTNERSHIP");

  if (capability === "view_shared_data") {
    if (partnership.lifecycle === "terminated") return deny("PARTNERSHIP_TERMINATED");
    return ALLOW;
  }

  if (capability === "block_former_partner") {
    return partnership.lifecycle === "terminated" ? ALLOW : deny("BLOCK_NOT_ALLOWED");
  }

  if (partnership.lifecycle === "terminated") return deny("PARTNERSHIP_TERMINATED");

  if (partnershipDeletionViewOnly(ctx)) {
    return deny("ACCOUNT_LOCKED");
  }

  if (capability === "initiate_breakup") {
    return partnership.lifecycle === "active" ? ALLOW : deny("BREAKUP_REQUIRED");
  }

  if (capability === "cancel_breakup") {
    if (partnership.lifecycle !== "breakup_pending" || !partnership.breakup) {
      return deny("BREAKUP_REQUIRED");
    }
    if (partnership.breakup.initiatedBy !== ctx.actor.id) return deny("NOT_BREAKUP_INITIATOR");
    if (!isBefore(ctx.now, partnership.breakup.initiatorCancelUntil)) {
      return deny("BREAKUP_WINDOW_EXPIRED");
    }
    return ALLOW;
  }

  if (capability === "submit_restore_intent") {
    if (partnership.lifecycle !== "breakup_pending" || !partnership.breakup) {
      return deny("BREAKUP_REQUIRED");
    }
    if (isBefore(ctx.now, partnership.breakup.initiatorCancelUntil)) {
      return deny("RESTORE_WINDOW_NOT_OPEN");
    }
    if (isAtOrAfter(ctx.now, partnership.breakup.finalDeadline)) {
      return deny("BREAKUP_DEADLINE_EXPIRED");
    }
    if (partnership.breakup.restoreIntentAt[ctx.actor.id]) {
      return deny("RESTORE_INTENT_ALREADY_SUBMITTED");
    }
    return ALLOW;
  }

  if (
    capability === "create_relationship_object" ||
    capability === "edit_relationship_object" ||
    capability === "edit_relationship_object_content" ||
    capability === "delete_relationship_object" ||
    capability === "mutate_relationship_shared_state" ||
    capability === "curate_relationship_space" ||
    capability === "recipient_open_relationship_object" ||
    capability === "creator_reveal_relationship_object" ||
    capability === "create_relationship_signal"
  ) {
    if (partnership.lifecycle === "breakup_pending") return deny("RELATIONSHIP_OBJECTS_VIEW_ONLY");
    return ALLOW;
  }

  if (capability === "change_nickname") {
    return ALLOW;
  }

  if (
    capability === "send_message" ||
    capability === "reply_message" ||
    capability === "send_media" ||
    capability === "start_call"
  ) {
    return ALLOW;
  }

  if (
    capability === "edit_message" ||
    capability === "delete_message" ||
    capability === "react_message"
  ) {
    const base = messageBaseDecision(ctx);
    if (base) return base;
    if (!ctx.message) return deny("MESSAGE_DELETED");
    if (partnership.lifecycle === "breakup_pending" && isPreBreakupMessage(ctx)) {
      return deny("PRE_BREAKUP_MESSAGE_LOCKED");
    }
    if (
      (capability === "edit_message" || capability === "delete_message") &&
      ctx.message.senderId !== ctx.actor.id
    ) {
      return deny("MESSAGE_NOT_OWNED");
    }
    if (capability === "edit_message") {
      const editDeadline = new Date(ctx.message.createdAt).getTime() + 30 * 60 * 1000;
      if (new Date(ctx.now).getTime() >= editDeadline) {
        return deny("MESSAGE_EDIT_WINDOW_EXPIRED");
      }
    }
    return ALLOW;
  }

  return deny("NO_PARTNERSHIP");
}

export function callRequiresExplicitBreakupAcceptance(ctx: CapabilityContext): boolean {
  return Boolean(
    ctx.partnership &&
    ctx.partnership.lifecycle === "breakup_pending" &&
    !ctx.partnership.accountDeletion &&
    !accountLocked(ctx),
  );
}
