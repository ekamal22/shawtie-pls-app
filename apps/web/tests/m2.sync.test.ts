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

test("M2 coordinator does not reconcile or replay while the browser is offline", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: false },
  });

  try {
    const coordinator = new SyncCoordinator();
    let reconciled = 0;
    let replayed = 0;

    coordinator.register("messages", async () => {
      reconciled += 1;
      return { latestChangeSequence: 1 };
    });
    coordinator.register(
      "outbox",
      async () => {
        replayed += 1;
      },
      "replay",
    );

    coordinator.markDirty(1);
    await coordinator.requestSync();

    assert.equal(coordinator.status, "offline");
    assert.equal(reconciled, 0);
    assert.equal(replayed, 0);
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, "navigator", descriptor);
    } else {
      delete (globalThis as { navigator?: unknown }).navigator;
    }
  }
});

test("M2 coordinator stop waits for active sync and refuses queued reruns", async () => {
  const coordinator = new SyncCoordinator();
  let calls = 0;
  let release: (() => void) | null = null;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });

  coordinator.register("messages", async () => {
    calls += 1;
    await blocked;
  });

  const running = coordinator.requestSync();
  coordinator.markDirty();
  void coordinator.requestSync();
  const stopping = coordinator.stop();
  release?.();
  await Promise.all([running, stopping]);

  coordinator.markDirty();
  await coordinator.requestSync();
  assert.equal(calls, 1);
});
