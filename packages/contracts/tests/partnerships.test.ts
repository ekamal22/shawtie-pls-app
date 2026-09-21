import assert from "node:assert/strict";
import test from "node:test";
import {
  blockFormerPartnerResponseSchema,
  breakupCancelResponseSchema,
  breakupIdParamsSchema,
  breakupInitiateResponseSchema,
  currentPartnershipResponseSchema,
  formerPartnershipListQuerySchema,
  formerPartnershipListResponseSchema,
  notificationCursorSchema,
  notificationListQuerySchema,
  notificationListResponseSchema,
  notificationReadBodySchema,
  notificationReadResponseSchema,
  p2ErrorCodeSchema,
  partnerRequestAcceptBodySchema,
  partnerRequestAcceptParamsSchema,
  partnerRequestAcceptResponseSchema,
  partnershipIdParamsSchema,
  partnershipLifecycleMutationBodySchema,
  relationshipStartDateUpdateResponseSchema,
  restoreIntentResponseSchema,
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

test("P2 relationship-date mutation requires id, date, and metadata version", () => {
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

test("P2 relationship-date response exposes the new metadata version and change flag", () => {
  assert.equal(
    safeParseAtBoundary(relationshipStartDateUpdateResponseSchema, {
      partnershipId: PARTNERSHIP_ID,
      relationshipStartDate: "2025-11-15",
      metadataVersion: 2,
      changed: true,
    }).success,
    true,
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
        interactionMode: "normal",
        activatedAt: "2026-09-21T12:00:00.000Z",
        relationshipStartDate: "2025-11-15",
        metadataVersion: 1,
        generation: 1,
        breakup: null,
        accountDeletion: null,
        capabilities: {
          changeRelationshipStartDate: true,
          initiateBreakup: true,
          cancelBreakup: false,
          submitRestoreIntent: false,
          viewSharedData: true,
        },
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

test("P2 notification contracts use bounded cursor and bodyless mark-read", () => {
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

test("P2 notification response contracts expose routing metadata only", () => {
  assert.equal(
    safeParseAtBoundary(notificationListResponseSchema, {
      items: [
        {
          notificationId: NOTIFICATION_ID,
          eventType: "partnership_formed",
          actorAccountId: ACCOUNT_ID,
          partnershipId: PARTNERSHIP_ID,
          createdAt: "2026-09-21T12:00:00.000Z",
          readAt: null,
        },
      ],
      nextCursor: null,
    }).success,
    true,
  );
  assert.equal(
    safeParseAtBoundary(notificationReadResponseSchema, {
      notificationId: NOTIFICATION_ID,
      readAt: "2026-09-21T12:01:00.000Z",
    }).success,
    true,
  );
});


test("P3 lifecycle mutation contracts keep actor, deadlines, and generation server-owned", () => {
  const BREAKUP_ID = "50000000-0000-4000-8000-000000000001";
  assert.equal(
    safeParseAtBoundary(breakupIdParamsSchema, {
      partnershipId: PARTNERSHIP_ID,
      breakupId: BREAKUP_ID,
    }).success,
    true,
  );
  assert.equal(safeParseAtBoundary(partnershipLifecycleMutationBodySchema, undefined).success, true);
  assert.equal(
    safeParseAtBoundary(partnershipLifecycleMutationBodySchema, {
      partnerAccountId: ACCOUNT_ID,
      finalDeadline: "2026-10-01T00:00:00.000Z",
      generation: 9,
    }).success,
    false,
  );

  assert.equal(
    safeParseAtBoundary(breakupInitiateResponseSchema, {
      partnershipId: PARTNERSHIP_ID,
      breakupId: BREAKUP_ID,
      lifecycleState: "breakup_pending",
      initiatedAt: "2026-09-21T12:00:00.000Z",
      initiatorCancelUntil: "2026-09-21T13:00:00.000Z",
      baseDeadline: "2026-09-28T12:00:00.000Z",
      finalDeadline: "2026-09-28T12:00:00.000Z",
      generation: 2,
    }).success,
    true,
  );
  assert.equal(
    safeParseAtBoundary(breakupCancelResponseSchema, {
      partnershipId: PARTNERSHIP_ID,
      breakupId: BREAKUP_ID,
      lifecycleState: "active",
      generation: 3,
    }).success,
    true,
  );
  assert.equal(
    safeParseAtBoundary(restoreIntentResponseSchema, {
      partnershipId: PARTNERSHIP_ID,
      breakupId: BREAKUP_ID,
      lifecycleState: "breakup_pending",
      finalDeadline: "2026-10-01T12:00:00.000Z",
      generation: 3,
      restored: false,
    }).success,
    true,
  );
});

test("P3 former-partnership contracts are private-history projections", () => {
  const query = safeParseAtBoundary(formerPartnershipListQuerySchema, {});
  assert.equal(query.success, true);
  if (query.success) assert.equal(query.data.limit, 25);

  assert.equal(
    safeParseAtBoundary(formerPartnershipListResponseSchema, {
      items: [
        {
          partnershipId: PARTNERSHIP_ID,
          terminatedAt: "2026-09-21T12:00:00.000Z",
          terminationReason: "breakup",
          formerPartner: {
            accountId: ACCOUNT_ID,
            username: "former",
            displayName: "Former",
          },
          blockedByMe: false,
        },
      ],
      nextCursor: null,
    }).success,
    true,
  );
  assert.equal(
    safeParseAtBoundary(blockFormerPartnerResponseSchema, {
      partnershipId: PARTNERSHIP_ID,
      blocked: true,
    }).success,
    true,
  );
});
