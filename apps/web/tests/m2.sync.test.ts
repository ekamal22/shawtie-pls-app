import assert from "node:assert/strict";
import test from "node:test";
import { SyncCoordinator } from "../src/lib/realtime/sync-coordinator.ts";

test("M2 coordinator closes the dirty-counter barrier before live", async () => {
  const coordinator = new SyncCoordinator();
  let calls = 0;

  coordinator.register("messages", async () => {
    calls += 1;
    if (calls === 1) coordinator.markDirty(2);
    return { latestChangeSequence: calls === 1 ? 1 : 2 };
  });

  coordinator.markDirty(1);
  await coordinator.requestSync();

  assert.equal(coordinator.status, "live");
  assert.equal(calls, 2);
});

test("M2 coordinator runs replay only after a clean reconcile pass", async () => {
  const coordinator = new SyncCoordinator();
  const order: string[] = [];

  coordinator.register("messages", async () => {
    order.push("reconcile");
    return { latestChangeSequence: 3 };
  });
  coordinator.register(
    "outbox",
    async () => {
      order.push("replay");
    },
    "replay",
  );

  coordinator.markDirty(3);
  await coordinator.requestSync();

  assert.deepEqual(order, ["reconcile", "replay"]);
  assert.equal(coordinator.status, "live");
});

test("M2 update-required state prevents mutation replay", async () => {
  const coordinator = new SyncCoordinator();
  let replayed = false;
  coordinator.register(
    "outbox",
    async () => {
      replayed = true;
    },
    "replay",
  );

  coordinator.markUpdateRequired();
  await coordinator.requestSync();

  assert.equal(coordinator.status, "update-required");
  assert.equal(replayed, false);
});
