import assert from "node:assert/strict";
import test from "node:test";
import {
  currentPartnershipResponseSchema,
  notificationCursorSchema,
  notificationListQuerySchema,
  notificationReadBodySchema,
  p2ErrorCodeSchema,
  partnerRequestAcceptBodySchema,
  partnerRequestAcceptParamsSchema,
  partnerRequestAcceptResponseSchema,
  partnershipIdParamsSchema,
  relationshipStartDateUpdateSchema,
  safeParseAtBoundary,
} from "../src/index.ts";

const REQUEST_ID = "10000000-0000-4000-8000-000000000001";
const PARTNERSHIP_ID = "20000000-0000-4000-8000-000000000001";
const ACCOUNT_ID = "30000000-0000-4000-8000-000000000001";
const NOTIFICATION_ID = "40000000-0000-4000-8000-000000000001";

test("P2 accept contract takes request identity from params and accepts no body authority", () => {
  assert.equal(
    safeParseAtBoundary(partnerRequestAcceptParamsSchema, { requestId: REQUEST_ID }).success,
    true,
  );
  assert.equal(safeParseAtBoundary(partnerRequestAcceptBodySchema, undefined).success, true);
  assert.equal(safeParseAtBoundary(partnerRequestAcceptBodySchema, {}).success, false);
  assert.equal(
    safeParseAtBoundary(partnerRequestAcceptResponseSchema, {
      outcome: "formed",
      partnershipId: PARTNERSHIP_ID,
    }).success,
    true,
  );
});

test("P2 public denial-code contract is limited to the hardened stable vocabulary", () => {
  for (const code of [
    "REQUEST_NOT_FOUND",
    "REQUEST_NOT_AVAILABLE",
    "PARTNERSHIP_UNAVAILABLE",
    "RELATIONSHIP_DATE_FUTURE",
    "PARTNERSHIP_METADATA_LOCKED",
    "VERSION_CONFLICT",
  ]) {
    assert.equal(safeParseAtBoundary(p2ErrorCodeSchema, code).success, true);
  }
  assert.equal(safeParseAtBoundary(p2ErrorCodeSchema, "TARGET_OCCUPIED").success, false);
});

test("P2 relationship-date mutation requires partnership identity, date, and metadata version", () => {
  assert.equal(
    safeParseAtBoundary(partnershipIdParamsSchema, { partnershipId: PARTNERSHIP_ID }).success,
    true,
  );
  assert.equal(
    safeParseAtBoundary(relationshipStartDateUpdateSchema, {
      relationshipStartDate: "2025-11-15",
      expectedMetadataVersion: 3,
    }).success,
    true,
  );
  assert.equal(
    safeParseAtBoundary(relationshipStartDateUpdateSchema, {
      relationshipStartDate: "11/15/2025",
      expectedMetadataVersion: 0,
    }).success,
    false,
  );
});

test("P2 current-partnership contract exposes only the documented safe projection", () => {
  assert.equal(
    safeParseAtBoundary(currentPartnershipResponseSchema, { partnership: null }).success,
    true,
  );
  assert.equal(
    safeParseAtBoundary(currentPartnershipResponseSchema, {
      partnership: {
        partnershipId: PARTNERSHIP_ID,
        lifecycleState: "active",
        activatedAt: "2026-09-21T12:00:00.000Z",
        relationshipStartDate: "2025-11-15",
        metadataVersion: 1,
        capabilities: { changeRelationshipStartDate: true },
        otherMember: {
          accountId: ACCOUNT_ID,
          username: "partner",
          displayName: "Partner",
        },
      },
    }).success,
    true,
  );
});

test("P2 notification contracts reuse bounded snapshot cursor semantics and bodyless mark-read", () => {
  const query = safeParseAtBoundary(notificationListQuerySchema, {});
  assert.equal(query.success, true);
  if (query.success) assert.equal(query.data.limit, 25);

  assert.equal(
    safeParseAtBoundary(notificationCursorSchema, {
      v: 1,
      snapshotAt: "2026-09-21T12:00:00.000Z",
      createdAt: "2026-09-21T11:00:00.000Z",
      notificationId: NOTIFICATION_ID,
    }).success,
    true,
  );
  assert.equal(safeParseAtBoundary(notificationReadBodySchema, undefined).success, true);
  assert.equal(safeParseAtBoundary(notificationReadBodySchema, {}).success, false);
});
