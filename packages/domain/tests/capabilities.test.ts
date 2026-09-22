import assert from "node:assert/strict";
import test from "node:test";
import {
  callRequiresExplicitBreakupAcceptance,
  evaluateCapability,
  finalizeBreakup,
  initiateBreakup,
  requestAccountDeletion,
  submitRestoreIntent,
  type CapabilityContext,
  type CapabilityName,
  type MessageState,
  type PartnershipState,
} from "../src/index.ts";
import { A, B, START, activeAccount, activePartnership } from "./fixtures.ts";

function expectOk<T>(result: { ok: boolean; state?: T; reason?: string }): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.reason);
  return result.state as T;
}

function ctx(partnership: PartnershipState | null, now = START): CapabilityContext {
  return { actor: activeAccount(A), partnership, now };
}

function assertAllowed(context: CapabilityContext, ...capabilities: CapabilityName[]): void {
  for (const capability of capabilities) {
    assert.deepEqual(
      evaluateCapability(capability, context),
      { allowed: true, reason: null },
      capability,
    );
  }
}

function assertDenied(
  context: CapabilityContext,
  reason: string,
  ...capabilities: CapabilityName[]
): void {
  for (const capability of capabilities) {
    assert.deepEqual(
      evaluateCapability(capability, context),
      { allowed: false, reason },
      capability,
    );
  }
}

test("active partnership capability matrix allows normal collaboration but blocks username change, blocking, and new pairing", () => {
  const context = ctx(activePartnership());
  assertAllowed(
    context,
    "view_shared_data",
    "send_message",
    "reply_message",
    "send_media",
    "start_call",
    "create_relationship_object",
    "edit_relationship_object",
    "edit_relationship_object_content",
    "delete_relationship_object",
    "mutate_relationship_shared_state",
    "curate_relationship_space",
    "recipient_open_relationship_object",
    "creator_reveal_relationship_object",
    "create_relationship_signal",
    "change_nickname",
    "change_email",
  );
  assertDenied(context, "USERNAME_CHANGE_BLOCKED", "change_username");
  assertDenied(context, "BLOCK_NOT_ALLOWED", "block_former_partner");
  assertDenied(context, "PARTNERSHIP_OCCUPIED", "form_partnership");
});

test("breakup_pending keeps messaging, media, calls, nicknames, and email changes available", () => {
  const pending = expectOk(initiateBreakup(activePartnership(), A, START));
  const context = ctx(pending, "2026-09-20T14:00:00.000Z");
  assertAllowed(
    context,
    "view_shared_data",
    "send_message",
    "reply_message",
    "send_media",
    "start_call",
    "change_nickname",
    "change_email",
    "submit_restore_intent",
  );
  assert.equal(callRequiresExplicitBreakupAcceptance(context), true);
  assertDenied(
    context,
    "RELATIONSHIP_OBJECTS_VIEW_ONLY",
    "create_relationship_object",
    "edit_relationship_object",
    "edit_relationship_object_content",
    "delete_relationship_object",
    "mutate_relationship_shared_state",
    "curate_relationship_space",
    "recipient_open_relationship_object",
    "creator_reveal_relationship_object",
    "create_relationship_signal",
  );
  assertDenied(context, "BLOCK_NOT_ALLOWED", "block_former_partner");
  assertDenied(context, "PARTNERSHIP_OCCUPIED", "form_partnership");
});

test("only the initiator can cancel breakup and only before the exact one-hour boundary", () => {
  const pending = expectOk(initiateBreakup(activePartnership(), A, START));
  assertAllowed(ctx(pending, "2026-09-20T12:59:59.999Z"), "cancel_breakup");
  assertDenied(
    ctx(pending, "2026-09-20T13:00:00.000Z"),
    "BREAKUP_WINDOW_EXPIRED",
    "cancel_breakup",
  );

  const other: CapabilityContext = {
    actor: activeAccount(B),
    partnership: pending,
    now: "2026-09-20T12:30:00.000Z",
  };
  assertDenied(other, "NOT_BREAKUP_INITIATOR", "cancel_breakup");
});

test("pre-breakup messages are visible and repliable but immutable during breakup_pending", () => {
  const pending = expectOk(initiateBreakup(activePartnership(), A, START));
  const message: MessageState = {
    id: "message-old",
    senderId: A,
    createdAt: "2026-09-20T11:45:00.000Z",
    deletedAt: null,
  };
  const context: CapabilityContext = {
    actor: activeAccount(A),
    partnership: pending,
    now: "2026-09-20T12:10:00.000Z",
    message,
  };
  assertAllowed(context, "view_shared_data", "reply_message");
  assertDenied(
    context,
    "PRE_BREAKUP_MESSAGE_LOCKED",
    "edit_message",
    "delete_message",
    "react_message",
  );
});

test("messages created after breakup initiation retain normal edit, delete, and reaction behavior", () => {
  const pending = expectOk(initiateBreakup(activePartnership(), A, START));
  const message: MessageState = {
    id: "message-new",
    senderId: A,
    createdAt: "2026-09-20T12:05:00.000Z",
    deletedAt: null,
  };
  const context: CapabilityContext = {
    actor: activeAccount(A),
    partnership: pending,
    now: "2026-09-20T12:20:00.000Z",
    message,
  };
  assertAllowed(context, "edit_message", "delete_message", "react_message");
});

test("message edit capability expires at exactly thirty minutes", () => {
  const message: MessageState = {
    id: "message-1",
    senderId: A,
    createdAt: START,
    deletedAt: null,
  };
  const before: CapabilityContext = {
    actor: activeAccount(A),
    partnership: activePartnership(),
    now: "2026-09-20T12:29:59.999Z",
    message,
  };
  const at: CapabilityContext = { ...before, now: "2026-09-20T12:30:00.000Z" };
  assertAllowed(before, "edit_message");
  assertDenied(at, "MESSAGE_EDIT_WINDOW_EXPIRED", "edit_message");
});

test("nickname changes remain allowed after one restoration intent", () => {
  const pending = expectOk(initiateBreakup(activePartnership(), A, START));
  const extended = expectOk(submitRestoreIntent(pending, B, "2026-09-21T12:00:00.000Z"));
  assertAllowed(ctx(extended, "2026-09-22T12:00:00.000Z"), "change_nickname");
});

test("account deletion overlay makes shared partnership view-only and locks deleting account", () => {
  const deletion = expectOk(requestAccountDeletion(activePartnership(), A, START));
  const deleting: CapabilityContext = {
    actor: { ...activeAccount(A), status: "deletion_pending" },
    partnership: deletion,
    now: "2026-09-21T12:00:00.000Z",
  };
  assertAllowed(deleting, "recover_account");
  assertDenied(
    deleting,
    "ACCOUNT_LOCKED",
    "send_message",
    "send_media",
    "start_call",
    "change_email",
    "change_nickname",
  );

  const remaining: CapabilityContext = {
    actor: activeAccount(B),
    partnership: deletion,
    now: "2026-09-21T12:00:00.000Z",
  };
  assertAllowed(remaining, "view_shared_data");
  assertDenied(
    remaining,
    "ACCOUNT_LOCKED",
    "send_message",
    "send_media",
    "start_call",
    "create_relationship_object",
    "edit_relationship_object_content",
    "delete_relationship_object",
    "mutate_relationship_shared_state",
    "curate_relationship_space",
    "recipient_open_relationship_object",
    "creator_reveal_relationship_object",
    "create_relationship_signal",
    "change_nickname",
  );
  assertDenied(remaining, "PARTNERSHIP_OCCUPIED", "form_partnership");
});

test("email changes remain allowed in breakup_pending when account access is active", () => {
  const pending = expectOk(initiateBreakup(activePartnership(), A, START));
  assertAllowed(ctx(pending, "2026-09-21T12:00:00.000Z"), "change_email");
});

test("terminated partnership allows blocking but respects partnership cooldown", () => {
  const pending = expectOk(initiateBreakup(activePartnership(), A, START));
  const generation = pending.breakup?.generation as number;
  const terminated = expectOk(finalizeBreakup(pending, "2026-09-27T12:00:00.000Z", generation));

  const during = ctx(terminated, "2026-10-01T12:00:00.000Z");
  assertAllowed(during, "block_former_partner");
  assertDenied(during, "COOLDOWN_ACTIVE", "form_partnership");

  const after = ctx(terminated, "2026-12-27T12:00:00.000Z");
  assertAllowed(after, "form_partnership");
});

test("blocked prospective partner prevents partnership formation after cooldown", () => {
  const context: CapabilityContext = {
    actor: activeAccount(A),
    partnership: null,
    now: START,
    blockedWithProspectivePartner: true,
  };
  assertDenied(context, "BLOCK_NOT_ALLOWED", "form_partnership");
});
