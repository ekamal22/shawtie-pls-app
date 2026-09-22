import assert from "node:assert/strict";
import test from "node:test";
import {
  MESSAGE_EDIT_WINDOW_MS,
  isMessageEditWindowOpen,
  isMessageFrozenByBreakup,
  messageEditDeadline,
} from "../src/index.ts";

test("M1 breakup freeze prefers immutable server sequence over timestamp", () => {
  const breakup = {
    initiatedAt: "2026-09-22T12:00:00.000Z",
    messageFreezeSequence: 8,
  };

  assert.equal(
    isMessageFrozenByBreakup(
      {
        createdAt: "2026-09-22T12:00:01.000Z",
        serverSequence: 8,
      },
      breakup,
    ),
    true,
  );
  assert.equal(
    isMessageFrozenByBreakup(
      {
        createdAt: "2026-09-22T11:59:59.000Z",
        serverSequence: 9,
      },
      breakup,
    ),
    false,
  );
});

test("M1 legacy breakup rows use trusted timestamp fallback", () => {
  const breakup = {
    initiatedAt: "2026-09-22T12:00:00.000Z",
    messageFreezeSequence: null,
  };
  assert.equal(isMessageFrozenByBreakup({ createdAt: "2026-09-22T11:59:59.999Z" }, breakup), true);
  assert.equal(isMessageFrozenByBreakup({ createdAt: "2026-09-22T12:00:00.000Z" }, breakup), false);
});

test("M1 edit window closes at exact thirty-minute boundary", () => {
  const createdAt = "2026-09-22T12:00:00.000Z";
  assert.equal(MESSAGE_EDIT_WINDOW_MS, 30 * 60_000);
  assert.equal(messageEditDeadline(createdAt), "2026-09-22T12:30:00.000Z");
  assert.equal(isMessageEditWindowOpen(createdAt, "2026-09-22T12:29:59.999Z"), true);
  assert.equal(isMessageEditWindowOpen(createdAt, "2026-09-22T12:30:00.000Z"), false);
});
