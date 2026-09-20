import assert from "node:assert/strict";
import test from "node:test";

import { BoundaryValidationError, parseAtBoundary, z } from "../src/index.ts";

const exampleSchema = z.object({
  requestId: z.string().uuid(),
});

test("parseAtBoundary accepts validated external input", () => {
  const value = parseAtBoundary(exampleSchema, {
    requestId: "00000000-0000-4000-8000-000000000001",
  });

  assert.equal(value.requestId, "00000000-0000-4000-8000-000000000001");
});

test("parseAtBoundary rejects invalid external input", () => {
  assert.throws(
    () => parseAtBoundary(exampleSchema, { requestId: "not-a-uuid" }),
    BoundaryValidationError,
  );
});
