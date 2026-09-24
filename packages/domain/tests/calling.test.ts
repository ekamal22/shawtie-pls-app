import assert from "node:assert/strict";
import test from "node:test";
import {
  callRequiresFreshAcceptance,
  evaluateContinueCall,
  evaluateStartCall,
  publicCallOutcome,
  type CallPolicyContext,
} from "../src/index.ts";

const A = "10000000-0000-4000-8000-000000000001";
const B = "10000000-0000-4000-8000-000000000002";

function context(overrides: Partial<CallPolicyContext> = {}): CallPolicyContext {
  return {
    actorAccountId: A,
    memberAccountIds: [A, B],
    accountStatuses: { [A]: "active", [B]: "active" },
    partnershipLifecycle: "active",
    accountDeletionAccountId: null,
    ...overrides,
  };
}

test("C1 active and breakup partnerships permit fresh voice-call authority", () => {
  assert.deepEqual(evaluateStartCall(context()), { allowed: true, reason: null });
  const breakup = context({ partnershipLifecycle: "breakup_pending" });
  assert.deepEqual(evaluateContinueCall(breakup), { allowed: true, reason: null });
  assert.equal(callRequiresFreshAcceptance(breakup), true);
});

test("C1 account deletion and termination deny new or continued call authority", () => {
  assert.equal(evaluateStartCall(context({ accountDeletionAccountId: A })).allowed, false);
  assert.equal(
    evaluateContinueCall(
      context({
        accountStatuses: { [A]: "active", [B]: "deletion_pending" },
      }),
    ).allowed,
    false,
  );
  assert.equal(
    evaluateContinueCall(context({ partnershipLifecycle: "terminated" })).allowed,
    false,
  );
});

test("C1 internal terminal causes are privacy-minimized in public history", () => {
  assert.equal(publicCallOutcome("rejected"), "rejected");
  assert.equal(publicCallOutcome("completed"), "completed");
  assert.equal(publicCallOutcome("authorization_revoked"), "unavailable");
  assert.equal(publicCallOutcome("session_revoked"), "unavailable");
  assert.equal(publicCallOutcome("account_deletion"), "unavailable");
  assert.equal(publicCallOutcome("partnership_terminated"), "unavailable");
  assert.equal(publicCallOutcome(null), null);
});
