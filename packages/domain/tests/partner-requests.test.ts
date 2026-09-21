import assert from "node:assert/strict";
import test from "node:test";
import {
  declineCooldownActive,
  effectivePartnerRequestStatus,
  evaluatePartnerRequestPair,
  relationshipStartDateAllowed,
  rollingMonthCutoffUtc,
} from "../src/index.ts";

test("P1 request expiry is exact at the seven-day deadline", () => {
  assert.equal(
    effectivePartnerRequestStatus(
      { status: "pending", expiresAt: "2026-09-28T12:00:00.000Z" },
      "2026-09-28T11:59:59.999Z",
    ),
    "pending",
  );
  assert.equal(
    effectivePartnerRequestStatus(
      { status: "pending", expiresAt: "2026-09-28T12:00:00.000Z" },
      "2026-09-28T12:00:00.000Z",
    ),
    "expired",
  );
});

test("P1 decline cooldown ends at the exact one-hour boundary", () => {
  assert.equal(
    declineCooldownActive("2026-09-21T12:00:00.000Z", "2026-09-21T12:59:59.999Z"),
    true,
  );
  assert.equal(
    declineCooldownActive("2026-09-21T12:00:00.000Z", "2026-09-21T13:00:00.000Z"),
    false,
  );
});

test("P1 rolling calendar month clamps month-end in UTC", () => {
  assert.equal(
    rollingMonthCutoffUtc("2026-03-31T10:30:00.000Z"),
    "2026-02-28T10:30:00.000Z",
  );
});

test("P1 relationship date accepts today and rejects future or invalid calendar dates", () => {
  assert.equal(relationshipStartDateAllowed("2026-09-21", "2026-09-21"), true);
  assert.equal(relationshipStartDateAllowed("2026-09-22", "2026-09-21"), false);
  assert.equal(relationshipStartDateAllowed("2026-02-31", "2026-09-21"), false);
});

test("P1 pair eligibility keeps recipient-side unavailability generic", () => {
  const base = {
    sender: {
      accountId: "a",
      status: "active" as const,
      occupied: false,
      partnerEligibleAt: null,
    },
    recipient: {
      accountId: "b",
      status: "active" as const,
      occupied: false,
      partnerEligibleAt: null,
    },
    blockedEitherDirection: false,
    sameDirectionPending: false,
    createdAttemptsInRollingMonth: 0,
    lastDeclinedAt: null,
    now: "2026-09-21T12:00:00.000Z",
  };
  assert.deepEqual(evaluatePartnerRequestPair(base), { allowed: true, reason: null });
  assert.deepEqual(
    evaluatePartnerRequestPair({
      ...base,
      recipient: { ...base.recipient, occupied: true },
    }),
    { allowed: false, reason: "TARGET_UNAVAILABLE" },
  );
  assert.deepEqual(
    evaluatePartnerRequestPair({ ...base, blockedEitherDirection: true }),
    { allowed: false, reason: "TARGET_UNAVAILABLE" },
  );
});

test("P1 pair eligibility enforces duplicate, cooldown, and rolling monthly limit", () => {
  const base = {
    sender: {
      accountId: "a",
      status: "active" as const,
      occupied: false,
      partnerEligibleAt: null,
    },
    recipient: {
      accountId: "b",
      status: "active" as const,
      occupied: false,
      partnerEligibleAt: null,
    },
    blockedEitherDirection: false,
    sameDirectionPending: false,
    createdAttemptsInRollingMonth: 0,
    lastDeclinedAt: null,
    now: "2026-09-21T12:00:00.000Z",
  };
  assert.equal(evaluatePartnerRequestPair({ ...base, sameDirectionPending: true }).reason, "REQUEST_ALREADY_PENDING");
  assert.equal(
    evaluatePartnerRequestPair({
      ...base,
      lastDeclinedAt: "2026-09-21T11:30:00.000Z",
    }).reason,
    "REQUEST_DECLINE_COOLDOWN",
  );
  assert.equal(
    evaluatePartnerRequestPair({ ...base, createdAttemptsInRollingMonth: 3 }).reason,
    "REQUEST_MONTHLY_LIMIT",
  );
});
