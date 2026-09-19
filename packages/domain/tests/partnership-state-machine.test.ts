import assert from "node:assert/strict";
import test from "node:test";
import {
  addCalendarMonthsUtc,
  cancelBreakup,
  finalizeAccountDeletion,
  finalizeBreakup,
  initiateBreakup,
  recoverDeletedAccount,
  requestAccountDeletion,
  submitRestoreIntent,
} from "../src/index.ts";
import { A, B, START, activePartnership } from "./fixtures.ts";

function expectOk<T>(result: { ok: boolean; state?: T; reason?: string }): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.reason);
  return result.state as T;
}

test("breakup initiation creates exact one-hour and seven-day deadlines", () => {
  const state = expectOk(initiateBreakup(activePartnership(), A, START));
  assert.equal(state.lifecycle, "breakup_pending");
  assert.equal(state.breakup?.initiatedBy, A);
  assert.equal(state.breakup?.initiatorCancelUntil, "2026-09-20T13:00:00.000Z");
  assert.equal(state.breakup?.baseDeadline, "2026-09-27T12:00:00.000Z");
  assert.equal(state.breakup?.finalDeadline, "2026-09-27T12:00:00.000Z");
});

test("initiator can cancel before one hour but not at the exact one-hour boundary", () => {
  const pending = expectOk(initiateBreakup(activePartnership(), A, START));
  const restored = cancelBreakup(pending, A, "2026-09-20T12:59:59.999Z");
  assert.equal(restored.ok, true);
  if (restored.ok) assert.equal(restored.state.lifecycle, "active");

  const expired = cancelBreakup(pending, A, "2026-09-20T13:00:00.000Z");
  assert.deepEqual(expired, { ok: false, reason: "BREAKUP_WINDOW_EXPIRED" });
});

test("non-initiator cannot use unilateral breakup cancellation", () => {
  const pending = expectOk(initiateBreakup(activePartnership(), A, START));
  assert.deepEqual(
    cancelBreakup(pending, B, "2026-09-20T12:30:00.000Z"),
    { ok: false, reason: "NOT_BREAKUP_INITIATOR" },
  );
});

test("first restoration intent extends the deadline exactly once to day ten", () => {
  const pending = expectOk(initiateBreakup(activePartnership(), A, START));
  const oneIntent = expectOk(submitRestoreIntent(pending, B, "2026-09-22T12:00:00.000Z"));
  assert.equal(oneIntent.lifecycle, "breakup_pending");
  assert.equal(oneIntent.breakup?.finalDeadline, "2026-09-30T12:00:00.000Z");
  assert.equal(oneIntent.breakup?.restoreIntentAt[B], "2026-09-22T12:00:00.000Z");

  const duplicate = submitRestoreIntent(oneIntent, B, "2026-09-23T12:00:00.000Z");
  assert.deepEqual(duplicate, { ok: false, reason: "RESTORE_INTENT_ALREADY_SUBMITTED" });
});

test("second restoration intent restores the same partnership with no cooldown", () => {
  const pending = expectOk(initiateBreakup(activePartnership(), A, START));
  const first = expectOk(submitRestoreIntent(pending, B, "2026-09-22T12:00:00.000Z"));
  const restored = expectOk(submitRestoreIntent(first, A, "2026-09-25T12:00:00.000Z"));
  assert.equal(restored.lifecycle, "active");
  assert.equal(restored.breakup, null);
  assert.equal(restored.partnerEligibleAt[A], null);
  assert.equal(restored.partnerEligibleAt[B], null);
});

test("restoration intent is rejected at the exact final deadline", () => {
  const pending = expectOk(initiateBreakup(activePartnership(), A, START));
  const result = submitRestoreIntent(pending, B, "2026-09-27T12:00:00.000Z");
  assert.deepEqual(result, { ok: false, reason: "BREAKUP_DEADLINE_EXPIRED" });
});

test("stale day-seven finalizer cannot dissolve after the first restore intent extended the deadline", () => {
  const pending = expectOk(initiateBreakup(activePartnership(), A, START));
  const oldGeneration = pending.breakup?.generation as number;
  const extended = expectOk(submitRestoreIntent(pending, B, "2026-09-22T12:00:00.000Z"));
  const result = finalizeBreakup(extended, "2026-09-27T12:00:00.000Z", oldGeneration);
  assert.deepEqual(result, { ok: false, reason: "STALE_GENERATION" });
});

test("breakup finalization uses the deadline as dissolution time and starts exact three-calendar-month cooldown", () => {
  const start = "2026-01-31T23:45:00.000Z";
  const pending = expectOk(initiateBreakup(activePartnership(), A, start));
  const generation = pending.breakup?.generation as number;
  const finalized = expectOk(finalizeBreakup(pending, "2026-02-08T00:00:00.000Z", generation));
  assert.equal(finalized.terminatedAt, "2026-02-07T23:45:00.000Z");
  assert.equal(finalized.partnerEligibleAt[A], "2026-05-07T23:45:00.000Z");
  assert.equal(finalized.partnerEligibleAt[B], "2026-05-07T23:45:00.000Z");
});

test("calendar-month arithmetic clamps to the last valid target day", () => {
  assert.equal(
    addCalendarMonthsUtc("2026-01-31T08:15:30.000Z", 1),
    "2026-02-28T08:15:30.000Z",
  );
  assert.equal(
    addCalendarMonthsUtc("2024-01-31T08:15:30.000Z", 1),
    "2024-02-29T08:15:30.000Z",
  );
});

test("account deletion from active partnership creates a seven-day recovery overlay", () => {
  const pending = expectOk(requestAccountDeletion(activePartnership(), A, START));
  assert.equal(pending.lifecycle, "active");
  assert.equal(pending.accountDeletion?.accountId, A);
  assert.equal(pending.accountDeletion?.recoverUntil, "2026-09-27T12:00:00.000Z");
});

test("account recovery restores the exact partnership lifecycle before the recovery deadline", () => {
  const pending = expectOk(requestAccountDeletion(activePartnership(), A, START));
  const recovered = expectOk(recoverDeletedAccount(pending, A, "2026-09-26T12:00:00.000Z"));
  assert.equal(recovered.lifecycle, "active");
  assert.equal(recovered.accountDeletion, null);
});

test("account deletion requested during breakup does not reset the breakup deadline", () => {
  const breakup = expectOk(initiateBreakup(activePartnership(), A, START));
  const originalDeadline = breakup.breakup?.finalDeadline;
  const deletion = expectOk(requestAccountDeletion(breakup, A, "2026-09-22T12:00:00.000Z"));
  assert.equal(deletion.breakup?.finalDeadline, originalDeadline);

  const recovered = expectOk(recoverDeletedAccount(deletion, A, "2026-09-23T12:00:00.000Z"));
  assert.equal(recovered.lifecycle, "breakup_pending");
  assert.equal(recovered.breakup?.finalDeadline, originalDeadline);
});

test("breakup deadline takes precedence over a later account deletion deadline", () => {
  const breakup = expectOk(initiateBreakup(activePartnership(), A, START));
  const deletion = expectOk(requestAccountDeletion(breakup, A, "2026-09-22T12:00:00.000Z"));
  const generation = deletion.breakup?.generation as number;
  const finalized = expectOk(finalizeBreakup(deletion, "2026-09-27T12:00:00.000Z", generation));
  assert.equal(finalized.terminationReason, "breakup");
  assert.equal(finalized.terminatedAt, "2026-09-27T12:00:00.000Z");
});

test("permanent partner account deletion from active partnership gives remaining partner one-calendar-month cooldown", () => {
  const pending = expectOk(requestAccountDeletion(activePartnership(), A, START));
  const generation = pending.accountDeletion?.generation as number;
  const finalized = expectOk(finalizeAccountDeletion(pending, "2026-09-27T12:00:00.000Z", generation));
  assert.equal(finalized.lifecycle, "terminated");
  assert.equal(finalized.terminationReason, "partner_account_deleted");
  assert.equal(finalized.partnerEligibleAt[B], "2026-10-27T12:00:00.000Z");
  assert.equal(finalized.partnerEligibleAt[A], null);
});

test("account deletion overlay blocks breakup cancellation and new restoration intent", () => {
  const breakup = expectOk(initiateBreakup(activePartnership(), A, START));
  const deletion = expectOk(requestAccountDeletion(breakup, A, "2026-09-20T12:15:00.000Z"));

  assert.deepEqual(
    cancelBreakup(deletion, A, "2026-09-20T12:30:00.000Z"),
    { ok: false, reason: "ACCOUNT_LOCKED" },
  );
  assert.deepEqual(
    submitRestoreIntent(deletion, B, "2026-09-20T12:30:00.000Z"),
    { ok: false, reason: "ACCOUNT_LOCKED" },
  );
});

test("account deletion finalization cannot overtake an earlier breakup deadline", () => {
  const breakup = expectOk(initiateBreakup(activePartnership(), A, START));
  const deletion = expectOk(requestAccountDeletion(breakup, A, "2026-09-22T12:00:00.000Z"));
  const generation = deletion.accountDeletion?.generation as number;

  assert.deepEqual(
    finalizeAccountDeletion(deletion, "2026-09-29T12:00:00.000Z", generation),
    { ok: false, reason: "BREAKUP_DEADLINE_EXPIRED" },
  );
});
