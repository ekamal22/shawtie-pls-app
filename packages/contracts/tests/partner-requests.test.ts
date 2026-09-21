import assert from "node:assert/strict";
import test from "node:test";
import {
  idempotencyKeySchema,
  partnerRequestCreateSchema,
  partnerRequestCursorSchema,
  partnerRequestListQuerySchema,
  safeParseAtBoundary,
} from "../src/index.ts";

test("P1 create contract requires stable target identity and relationship date", () => {
  assert.equal(
    safeParseAtBoundary(partnerRequestCreateSchema, {
      recipientAccountId: "00000000-0000-4000-8000-000000000001",
      expectedUsername: "Alice",
      relationshipStartDate: "2026-01-01",
    }).success,
    true,
  );
  assert.equal(
    safeParseAtBoundary(partnerRequestCreateSchema, {
      recipientAccountId: "not-a-uuid",
      expectedUsername: "",
      relationshipStartDate: "01/01/2026",
    }).success,
    false,
  );
});

test("P1 request list contract applies bounded pagination defaults", () => {
  const result = safeParseAtBoundary(partnerRequestListQuerySchema, {
    direction: "incoming",
  });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.limit, 25);
  assert.equal(
    safeParseAtBoundary(partnerRequestListQuerySchema, {
      direction: "incoming",
      limit: 51,
    }).success,
    false,
  );
});

test("P1 cursor contract is versioned and direction bound", () => {
  assert.equal(
    safeParseAtBoundary(partnerRequestCursorSchema, {
      v: 1,
      snapshotAt: "2026-09-21T12:00:00.000Z",
      createdAt: "2026-09-21T11:00:00.000Z",
      requestId: "00000000-0000-4000-8000-000000000001",
      direction: "outgoing",
    }).success,
    true,
  );
});

test("P1 idempotency key is bounded visible ASCII", () => {
  assert.equal(safeParseAtBoundary(idempotencyKeySchema, "0123456789abcdef").success, true);
  assert.equal(safeParseAtBoundary(idempotencyKeySchema, "short").success, false);
  assert.equal(safeParseAtBoundary(idempotencyKeySchema, "0123456789abcde\n").success, false);
});
