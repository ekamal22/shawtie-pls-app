import assert from "node:assert/strict";
import test from "node:test";
import { mapWithConcurrency } from "../src/runtime/concurrency-limit.ts";
import { retryDelayMs } from "../src/runtime/retry-policy.ts";
import { OutboxHandlerRegistry } from "../src/outbox/outbox-handler-registry.ts";
import { ScheduledActionHandlerRegistry } from "../src/scheduled/scheduled-handler-registry.ts";

test("retry delay is deterministic, bounded, and grows with attempts", () => {
  const first = retryDelayMs(1, "job-a");
  const second = retryDelayMs(2, "job-a");
  const repeated = retryDelayMs(2, "job-a");

  assert.ok(first >= 1_000);
  assert.ok(second >= first);
  assert.equal(second, repeated);
  assert.ok(retryDelayMs(100, "job-a") <= 15 * 60_000);
});

test("handler registries dispatch by type and payload version", () => {
  const scheduled = new ScheduledActionHandlerRegistry();
  scheduled.register({
    actionType: "test.action",
    payloadVersion: 1,
    async execute() {},
  });

  assert.ok(scheduled.get("test.action", 1));
  assert.equal(scheduled.get("test.action", 2), null);

  const outbox = new OutboxHandlerRegistry();
  outbox.register({
    eventType: "test.event",
    payloadVersion: 3,
    async deliver() {},
  });
  assert.ok(outbox.get("test.event", 3));
  assert.equal(outbox.get("test.event", 4), null);
});

test("bounded concurrency never exceeds its configured limit", async () => {
  let active = 0;
  let maximum = 0;

  await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
  });

  assert.equal(maximum, 2);
});
