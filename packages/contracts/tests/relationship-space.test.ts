import assert from "node:assert/strict";
import test from "node:test";
import {
  relationshipItemCreateSchema,
  relationshipItemCursorSchema,
  relationshipItemListQuerySchema,
  relationshipItemPatchSchema,
  relationshipItemReleaseSchema,
} from "../src/index.ts";

test("relationship create accepts scheduled For You preview plus sealed body", () => {
  const result = relationshipItemCreateSchema.safeParse({
    kind: "for_you",
    contentSchemaVersion: 1,
    preview: { title: "Later", conditionLabel: null },
    content: { body: "Private body" },
    occurrence: null,
    storyIncluded: false,
    release: { mode: "scheduled", unlockAt: "2026-12-31T21:00:00.000Z" },
    featureState: null,
    references: [],
    links: [],
  });
  assert.equal(result.success, true);
});

test("relationship create rejects a standalone voice_letter kind", () => {
  const result = relationshipItemCreateSchema.safeParse({
    kind: "voice_letter",
    contentSchemaVersion: 1,
    preview: null,
    content: {},
    occurrence: null,
    storyIncluded: false,
    release: null,
    featureState: null,
    references: [],
    links: [],
  });
  assert.equal(result.success, false);
});

test("relationship references enforce roles through their discriminated type", () => {
  const input = {
    kind: "memory",
    contentSchemaVersion: 1,
    preview: null,
    content: { title: "Memory" },
    occurrence: null,
    storyIncluded: false,
    release: null,
    featureState: null,
    links: [],
  };
  const referenceId = "00000000-0000-4000-8000-000000000001";

  assert.equal(
    relationshipItemCreateSchema.safeParse({
      ...input,
      references: [{ referenceType: "message", referenceId, role: "voice_letter", position: 0 }],
    }).success,
    false,
  );
  assert.equal(
    relationshipItemCreateSchema.safeParse({
      ...input,
      references: [{ referenceType: "media", referenceId, role: "source", position: 0 }],
    }).success,
    false,
  );
  assert.equal(
    relationshipItemCreateSchema.safeParse({
      ...input,
      references: [{ referenceType: "media", referenceId, role: "voice_letter", position: 0 }],
    }).success,
    true,
  );
});

test("relationship patch requires expectedVersion and at least one mutation field", () => {
  assert.equal(relationshipItemPatchSchema.safeParse({ expectedVersion: 1 }).success, false);
  assert.equal(
    relationshipItemPatchSchema.safeParse({
      expectedVersion: 1,
      storyIncluded: true,
    }).success,
    true,
  );
});

test("relationship release body is version checked", () => {
  assert.equal(relationshipItemReleaseSchema.safeParse({ expectedVersion: 1 }).success, true);
  assert.equal(relationshipItemReleaseSchema.safeParse({ expectedVersion: 0 }).success, false);
});

test("relationship list query has bounded defaults", () => {
  const parsed = relationshipItemListQuerySchema.parse({});
  assert.equal(parsed.limit, 30);
  assert.equal(parsed.sort, "created_desc");
  assert.equal(parsed.storyOnly, false);
});

test("relationship cursors require an opaque integrity binding", () => {
  const base = {
    v: 1,
    sort: "created_desc",
    snapshotAt: "2026-09-22T12:00:00.000Z",
    createdAt: "2026-09-22T11:00:00.000Z",
    itemId: "00000000-0000-4000-8000-000000000001",
    queryShape: "r1:created_desc:*:all:*",
  };
  assert.equal(relationshipItemCursorSchema.safeParse(base).success, false);
  assert.equal(
    relationshipItemCursorSchema.safeParse({
      ...base,
      binding: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    }).success,
    true,
  );
});
