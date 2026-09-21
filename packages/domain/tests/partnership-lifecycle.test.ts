import assert from "node:assert/strict";
import test from "node:test";
import {
  cancelBreakup,
  evaluateCapability,
  initiateBreakup,
  submitRestoreIntent,
  type CapabilityContext,
} from "../src/index.ts";
import { A, B, START, activeAccount, activePartnership } from "./fixtures.ts";

function expectOk<T>(result: { ok: boolean; state?: T; reason?: string }): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.reason);
  return result.state as T;
}

test("P3 restoration opens exactly when unilateral cancellation closes", () => {
  const pending = expectOk(initiateBreakup(activePartnership(), A, START));

  assert.deepEqual(submitRestoreIntent(pending, B, "2026-09-20T12:59:59.999Z"), {
    ok: false,
    reason: "RESTORE_WINDOW_NOT_OPEN",
  });

  assert.deepEqual(cancelBreakup(pending, A, "2026-09-20T13:00:00.000Z"), {
    ok: false,
    reason: "BREAKUP_WINDOW_EXPIRED",
  });

  const atBoundary = submitRestoreIntent(pending, B, "2026-09-20T13:00:00.000Z");
  assert.equal(atBoundary.ok, true);
  if (atBoundary.ok) {
    assert.equal(atBoundary.state.breakup?.finalDeadline, "2026-09-30T12:00:00.000Z");
  }
});

test("P3 initiation capability is active-only and blocked by account deletion overlay", () => {
  const active: CapabilityContext = {
    actor: activeAccount(A),
    partnership: activePartnership(),
    now: START,
  };
  assert.deepEqual(evaluateCapability("initiate_breakup", active), {
    allowed: true,
    reason: null,
  });

  const pending = expectOk(initiateBreakup(activePartnership(), A, START));
  assert.deepEqual(
    evaluateCapability("initiate_breakup", {
      ...active,
      partnership: pending,
    }),
    { allowed: false, reason: "BREAKUP_REQUIRED" },
  );

  assert.deepEqual(
    evaluateCapability("initiate_breakup", {
      actor: activeAccount(A),
      partnership: {
        ...activePartnership(),
        accountDeletion: {
          accountId: B,
          requestedAt: START,
          recoverUntil: "2026-09-27T12:00:00.000Z",
          generation: 2,
        },
      },
      now: START,
    }),
    { allowed: false, reason: "ACCOUNT_LOCKED" },
  );
});

test("P3 restore capability mirrors the exact time boundary", () => {
  const pending = expectOk(initiateBreakup(activePartnership(), A, START));
  const before: CapabilityContext = {
    actor: activeAccount(B),
    partnership: pending,
    now: "2026-09-20T12:59:59.999Z",
  };
  assert.deepEqual(evaluateCapability("submit_restore_intent", before), {
    allowed: false,
    reason: "RESTORE_WINDOW_NOT_OPEN",
  });
  assert.deepEqual(
    evaluateCapability("submit_restore_intent", {
      ...before,
      now: "2026-09-20T13:00:00.000Z",
    }),
    { allowed: true, reason: null },
  );
});
