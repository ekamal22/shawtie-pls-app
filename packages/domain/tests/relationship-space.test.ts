import assert from "node:assert/strict";
import test from "node:test";
import {
  anniversaryDateForYear,
  canDeleteRelationshipItem,
  canEditRelationshipContent,
  canManuallyReleaseRelationshipItem,
  evaluateScheduledRelationshipRelease,
  occurrenceIsValid,
  relationshipItemPolicy,
  relationshipOccurrenceSortTuple,
} from "../src/index.ts";

test("relationship item policy distinguishes creator content, shared state, and manual release", () => {
  assert.equal(relationshipItemPolicy("memory").contentEditor, "creator");
  assert.equal(relationshipItemPolicy("someday").sharedStateEditor, "either_partner");
  assert.equal(relationshipItemPolicy("reunion").contentEditor, "either_partner");
  assert.deepEqual(relationshipItemPolicy("for_you").releaseModes, [
    "immediate",
    "scheduled",
    "recipient_open",
  ]);
  assert.deepEqual(relationshipItemPolicy("surprise").releaseModes, [
    "immediate",
    "creator_reveal",
  ]);
});

test("creator-owned relationship content rejects partner edits and deletes", () => {
  assert.deepEqual(
    canEditRelationshipContent({
      kind: "memory",
      creatorAccountId: "a",
      actorAccountId: "b",
      releasedAt: null,
    }),
    { allowed: false, reason: "RELATIONSHIP_ITEM_NOT_OWNED" },
  );
  assert.deepEqual(
    canDeleteRelationshipItem({
      kind: "memory",
      creatorAccountId: "a",
      actorAccountId: "b",
    }),
    { allowed: false, reason: "RELATIONSHIP_ITEM_NOT_OWNED" },
  );
});

test("relationship signals are immutable after explicit creation", () => {
  assert.deepEqual(
    canEditRelationshipContent({
      kind: "relationship_signal",
      creatorAccountId: "a",
      actorAccountId: "a",
      releasedAt: null,
    }),
    { allowed: false, reason: "RELATIONSHIP_ITEM_IMMUTABLE" },
  );
});

test("released delivery content is immutable", () => {
  assert.deepEqual(
    canEditRelationshipContent({
      kind: "for_you",
      creatorAccountId: "a",
      actorAccountId: "a",
      releasedAt: "2026-09-22T12:00:00.000Z",
    }),
    { allowed: false, reason: "RELATIONSHIP_ITEM_IMMUTABLE" },
  );
});

test("recipient-open belongs to recipient and creator-reveal belongs to creator", () => {
  assert.equal(
    canManuallyReleaseRelationshipItem({
      kind: "for_you",
      releaseMode: "recipient_open",
      creatorAccountId: "a",
      actorAccountId: "b",
    }),
    true,
  );
  assert.equal(
    canManuallyReleaseRelationshipItem({
      kind: "for_you",
      releaseMode: "recipient_open",
      creatorAccountId: "a",
      actorAccountId: "a",
    }),
    false,
  );
  assert.equal(
    canManuallyReleaseRelationshipItem({
      kind: "proposal",
      releaseMode: "creator_reveal",
      creatorAccountId: "a",
      actorAccountId: "a",
    }),
    true,
  );
});

test("occurrence precision validates real dates without fabricating components", () => {
  assert.equal(
    occurrenceIsValid(
      { precision: "day", year: 2026, month: 2, day: 29 },
      "2026-09-22",
      true,
    ),
    false,
  );
  assert.equal(
    occurrenceIsValid(
      { precision: "month", year: 2026, month: 10, day: null },
      "2026-09-22",
      true,
    ),
    false,
  );
  assert.equal(
    occurrenceIsValid(
      { precision: "year", year: 2025, month: null, day: null },
      "2026-09-22",
      true,
    ),
    true,
  );
  assert.equal(
    occurrenceIsValid(
      { precision: "unknown", year: null, month: null, day: null },
      "2026-09-22",
      true,
    ),
    true,
  );
});

test("anniversary uses the last valid day for leap-day relationships", () => {
  assert.equal(anniversaryDateForYear("2024-02-29", 2025), "2025-02-28");
  assert.equal(anniversaryDateForYear("2024-02-29", 2028), "2028-02-29");
});

test("mixed precision ordering uses null components as ordering sentinels only", () => {
  assert.deepEqual(
    relationshipOccurrenceSortTuple(
      { precision: "year", year: 2025, month: null, day: null },
      "a",
    ),
    [2025, 0, 0, "a"],
  );
  assert.deepEqual(
    relationshipOccurrenceSortTuple(
      { precision: "month", year: 2025, month: 11, day: null },
      "b",
    ),
    [2025, 11, 0, "b"],
  );
});

test("scheduled release pauses for account deletion and destructive deadline wins at equality", () => {
  assert.deepEqual(
    evaluateScheduledRelationshipRelease({
      now: "2026-09-22T12:00:00.000Z",
      releaseMode: "scheduled",
      unlockAt: "2026-09-22T11:00:00.000Z",
      releasedAt: null,
      lifecycle: "active",
      breakupFinalDeadline: null,
      accountDeletionRecoverUntil: "2026-09-29T12:00:00.000Z",
    }),
    { action: "pause", until: "2026-09-29T12:00:00.000Z" },
  );

  assert.deepEqual(
    evaluateScheduledRelationshipRelease({
      now: "2026-09-29T12:00:00.000Z",
      releaseMode: "scheduled",
      unlockAt: "2026-09-22T11:00:00.000Z",
      releasedAt: null,
      lifecycle: "active",
      breakupFinalDeadline: null,
      accountDeletionRecoverUntil: "2026-09-29T12:00:00.000Z",
    }),
    { action: "stale", reason: "destructive_deadline" },
  );
});
