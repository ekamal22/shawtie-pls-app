import assert from "node:assert/strict";
import test from "node:test";
import {
  messageChangeQuerySchema,
  messageEditSchema,
  messageHistoryQuerySchema,
  messageReactionSchema,
  messageSendSchema,
  nicknameMutationSchema,
  safeParseAtBoundary,
} from "../src/index.ts";

const MESSAGE_ID = "10000000-0000-4000-8000-000000000001";

test("M1 message body trims input and rejects empty or oversized values", () => {
  const valid = safeParseAtBoundary(messageSendSchema, {
    body: "  hello  ",
    replyToMessageId: MESSAGE_ID,
  });
  assert.equal(valid.success, true);
  if (valid.success) assert.equal(valid.data.body, "hello");

  assert.equal(
    safeParseAtBoundary(messageSendSchema, { body: "   ", replyToMessageId: null }).success,
    false,
  );
  assert.equal(
    safeParseAtBoundary(messageSendSchema, {
      body: "a".repeat(4_001),
      replyToMessageId: null,
    }).success,
    false,
  );
});

test("M1 history contract keeps before and after cursors mutually exclusive", () => {
  const defaults = safeParseAtBoundary(messageHistoryQuerySchema, {});
  assert.equal(defaults.success, true);
  if (defaults.success) assert.equal(defaults.data.limit, 50);

  assert.equal(
    safeParseAtBoundary(messageHistoryQuerySchema, {
      beforeSequence: 10,
      afterSequence: 3,
    }).success,
    false,
  );
  assert.equal(
    safeParseAtBoundary(messageHistoryQuerySchema, { limit: 101 }).success,
    false,
  );
});

test("M1 change feed requires a bounded durable cursor", () => {
  const valid = safeParseAtBoundary(messageChangeQuerySchema, {
    afterChangeSequence: 0,
  });
  assert.equal(valid.success, true);
  if (valid.success) assert.equal(valid.data.limit, 100);
  assert.equal(
    safeParseAtBoundary(messageChangeQuerySchema, {
      afterChangeSequence: -1,
    }).success,
    false,
  );
  assert.equal(
    safeParseAtBoundary(messageChangeQuerySchema, {
      afterChangeSequence: 0,
      limit: 201,
    }).success,
    false,
  );
});

test("M1 edit requires optimistic content version", () => {
  assert.equal(
    safeParseAtBoundary(messageEditSchema, {
      body: "edited",
      expectedContentVersion: 2,
    }).success,
    true,
  );
  assert.equal(
    safeParseAtBoundary(messageEditSchema, {
      body: "edited",
      expectedContentVersion: 0,
    }).success,
    false,
  );
});

test("M1 reaction and nickname content stay bounded", () => {
  assert.equal(
    safeParseAtBoundary(messageReactionSchema, { emoji: "❤️" }).success,
    true,
  );
  assert.equal(
    safeParseAtBoundary(messageReactionSchema, { emoji: "" }).success,
    false,
  );
  assert.equal(
    safeParseAtBoundary(nicknameMutationSchema, {
      nickname: null,
      expectedVersion: 1,
    }).success,
    true,
  );
  assert.equal(
    safeParseAtBoundary(nicknameMutationSchema, {
      nickname: "x".repeat(81),
      expectedVersion: 1,
    }).success,
    false,
  );
});
