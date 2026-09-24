import type { CallPolicyContext, CallPolicyDecision } from "./types.ts";

const ALLOW: CallPolicyDecision = { allowed: true, reason: null };

function deny(reason: Exclude<CallPolicyDecision["reason"], null>): CallPolicyDecision {
  return { allowed: false, reason };
}

function isMember(context: CallPolicyContext, accountId: string): boolean {
  return context.memberAccountIds.includes(accountId);
}

export function evaluateStartCall(context: CallPolicyContext): CallPolicyDecision {
  if (!isMember(context, context.actorAccountId)) return deny("NO_PARTNERSHIP");
  if (context.partnershipLifecycle === "terminated") return deny("PARTNERSHIP_TERMINATED");
  if (context.accountDeletionAccountId) return deny("ACCOUNT_LOCKED");
  for (const accountId of context.memberAccountIds) {
    if (context.accountStatuses[accountId] !== "active") return deny("ACCOUNT_LOCKED");
  }
  return ALLOW;
}

export function evaluateContinueCall(context: CallPolicyContext): CallPolicyDecision {
  return evaluateStartCall(context);
}

export function callRequiresFreshAcceptance(context: CallPolicyContext): boolean {
  return (
    context.partnershipLifecycle === "breakup_pending" &&
    !context.accountDeletionAccountId &&
    context.accountStatuses[context.actorAccountId] === "active"
  );
}
