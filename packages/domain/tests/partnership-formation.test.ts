import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateCapability,
  evaluateRelationshipStartDateMutation,
  initiateBreakup,
  relationshipStartDateAllowedForPartnership,
  requestAccountDeletion,
  resolveFormationConsent,
  type CapabilityContext,
} from "../src/index.ts";
import { A, B, START, activeAccount, activePartnership } from "./fixtures.ts";

const REQUEST_A = "10000000-0000-4000-8000-000000000001";
const REQUEST_B = "10000000-0000-4000-8000-000000000002";

function expectState<T>(result: { ok: boolean; state?: T; reason?: string }): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.reason);
  return result.state as T;
}

test("P2 explicit acceptance uses the accepted request proposal and recipient as actor", () => {
  const result = resolveFormationConsent({
    source: "explicit_accept",
    request: {
      requestId: REQUEST_A,
      senderAccountId: A,
      recipientAccountId: B,
      relationshipStartDate: "2025-11-15",
    },
  });

  assert.deepEqual(result, {
    ok: true,
    consent: {
      source: "explicit_accept",
      actorAccountId: B,
      requestIds: [REQUEST_A],
      triggeringRequestId: REQUEST_A,
      relationshipStartDate: "2025-11-15",
    },
  });
});

test("P2 reciprocal formation uses the triggering request proposal, not request ordering", () => {
  const result = resolveFormationConsent({
    source: "reciprocal_request",
    requests: [
      {
        requestId: REQUEST_A,
        senderAccountId: A,
        recipientAccountId: B,
        relationshipStartDate: "2025-01-01",
      },
      {
        requestId: REQUEST_B,
        senderAccountId: B,
        recipientAccountId: A,
        relationshipStartDate: "2026-02-14",
      },
    ],
    triggeringRequestId: REQUEST_B,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.consent.actorAccountId, B);
    assert.equal(result.consent.triggeringRequestId, REQUEST_B);
    assert.equal(result.consent.relationshipStartDate, "2026-02-14");
  }
});

test("P2 reciprocal consent fails closed when requests are not opposite directions", () => {
  assert.deepEqual(
    resolveFormationConsent({
      source: "reciprocal_request",
      requests: [
        {
          requestId: REQUEST_A,
          senderAccountId: A,
          recipientAccountId: B,
          relationshipStartDate: "2025-01-01",
        },
        {
          requestId: REQUEST_B,
          senderAccountId: A,
          recipientAccountId: B,
          relationshipStartDate: "2025-01-02",
        },
      ],
      triggeringRequestId: REQUEST_B,
    }),
    { ok: false, reason: "REQUEST_NOT_AVAILABLE" },
  );
});

test("P2 trusted relationship date accepts today and rejects future or invalid calendar dates", () => {
  assert.equal(relationshipStartDateAllowedForPartnership("2026-09-21", "2026-09-21"), true);
  assert.equal(relationshipStartDateAllowedForPartnership("2026-09-22", "2026-09-21"), false);
  assert.equal(relationshipStartDateAllowedForPartnership("2026-02-31", "2026-09-21"), false);
});

test("P2 relationship-date retry is a no-op before stale-version rejection", () => {
  assert.deepEqual(
    evaluateRelationshipStartDateMutation({
      currentRelationshipStartDate: "2025-11-15",
      requestedRelationshipStartDate: "2025-11-15",
      currentMetadataVersion: 8,
      expectedMetadataVersion: 7,
      trustedServerDate: "2026-09-21",
    }),
    { ok: true, changed: false, metadataVersion: 8 },
  );
});

test("P2 relationship-date real change enforces metadata version and increments only that version", () => {
  const base = {
    currentRelationshipStartDate: "2025-11-15",
    requestedRelationshipStartDate: "2025-12-01",
    currentMetadataVersion: 8,
    trustedServerDate: "2026-09-21",
  };

  assert.deepEqual(
    evaluateRelationshipStartDateMutation({ ...base, expectedMetadataVersion: 7 }),
    { ok: false, reason: "VERSION_CONFLICT" },
  );
  assert.deepEqual(
    evaluateRelationshipStartDateMutation({ ...base, expectedMetadataVersion: 8 }),
    { ok: true, changed: true, metadataVersion: 9 },
  );
});

test("P2 relationship-date capability follows lifecycle state", () => {
  const active: CapabilityContext = {
    actor: activeAccount(A),
    partnership: activePartnership(),
    now: START,
  };
  assert.deepEqual(evaluateCapability("change_relationship_start_date", active), {
    allowed: true,
    reason: null,
  });

  const breakup = expectState(initiateBreakup(activePartnership(), A, START));
  assert.deepEqual(
    evaluateCapability("change_relationship_start_date", {
      actor: activeAccount(B),
      partnership: breakup,
      now: START,
    }),
    { allowed: true, reason: null },
  );

  const deletion = expectState(requestAccountDeletion(activePartnership(), A, START));
  assert.deepEqual(
    evaluateCapability("change_relationship_start_date", {
      actor: activeAccount(B),
      partnership: deletion,
      now: START,
    }),
    { allowed: false, reason: "PARTNERSHIP_METADATA_LOCKED" },
  );

  assert.deepEqual(
    evaluateCapability("change_relationship_start_date", {
      actor: activeAccount(A),
      partnership: { ...activePartnership(), lifecycle: "terminated" },
      now: START,
    }),
    { allowed: false, reason: "PARTNERSHIP_TERMINATED" },
  );
});
