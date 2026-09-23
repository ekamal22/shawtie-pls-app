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

test("M2 coordinator does not revisit a reconciler that re-registers itself mid-pass", async () => {
  const coordinator = new SyncCoordinator();
  let calls = 0;
  let replayed = 0;
  let unregister: (() => void) | null = null;

  function registerMessaging() {
    unregister = coordinator.register("messaging", async () => {
      calls += 1;
      // Simulate a React effect cleanup-then-rerun cycle: the reconciler's
      // own completion triggers a state update, the owning component
      // re-renders, its effect tears down the old registration and sets up
      // a new one with a fresh closure under the same name, exactly as
      // MessagingPanel's unstable useCallback deps did. Unregistering then
      // registering (rather than merely overwriting) removes and reinserts
      // the map key, which is what made a live Map iterator revisit it.
      unregister?.();
      registerMessaging();
      return { latestChangeSequence: 1 };
    });
  }
  registerMessaging();
  coordinator.register(
    "outbox",
    async () => {
      replayed += 1;
    },
    "replay",
  );

  coordinator.markDirty(1);
  await coordinator.requestSync();

  assert.equal(calls, 1, "a reconciler that re-registers itself must only run once per pass");
  assert.equal(replayed, 1, "replay must still run once the reconcile pass completes");
  assert.equal(coordinator.status, "live");
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

test("M2 coordinator retries after a reconciler throws instead of stranding queued replay", async () => {
  const coordinator = new SyncCoordinator();
  let reconcileAttempts = 0;
  let replayed = 0;

  coordinator.register("messages", async () => {
    reconcileAttempts += 1;
    if (reconcileAttempts === 1) {
      throw new Error("simulated transient network failure");
    }
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

  // The first pass failed inside the reconciler and must not leave the
  // coordinator permanently stuck: it schedules its own retry.
  assert.equal(reconcileAttempts, 1);
  assert.equal(replayed, 0);

  await new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      if (coordinator.status === "live") {
        clearInterval(interval);
        resolve();
      }
    }, 25);
  });

  assert.equal(reconcileAttempts, 2);
  assert.equal(replayed, 1);
  assert.equal(coordinator.status, "live");

  await coordinator.stop();
});

test("M2 coordinator retries after a replayer throws instead of stranding queued replay", async () => {
  const coordinator = new SyncCoordinator();
  let replayAttempts = 0;

  coordinator.register("messages", async () => ({ latestChangeSequence: 1 }));
  coordinator.register(
    "outbox",
    async () => {
      replayAttempts += 1;
      if (replayAttempts === 1) {
        throw new Error("simulated transient network failure");
      }
    },
    "replay",
  );

  coordinator.markDirty(1);
  await coordinator.requestSync();

  assert.equal(replayAttempts, 1);
  assert.notEqual(coordinator.status, "live");

  await new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      if (coordinator.status === "live") {
        clearInterval(interval);
        resolve();
      }
    }, 25);
  });

  assert.equal(replayAttempts, 2);
  assert.equal(coordinator.status, "live");

  await coordinator.stop();
});

test("M2 coordinator stays inert after stop until resume is called", async () => {
  const coordinator = new SyncCoordinator();
  let calls = 0;
  coordinator.register("messages", async () => {
    calls += 1;
    return { latestChangeSequence: 1 };
  });

  await coordinator.stop();

  coordinator.markDirty(1);
  await coordinator.requestSync();
  assert.equal(calls, 0, "requestSync must stay a no-op after stop without resume");
  assert.equal(coordinator.status, "idle");

  coordinator.register("messages", async () => {
    calls += 1;
    return { latestChangeSequence: 1 };
  });
  coordinator.resume();
  coordinator.markDirty(1);
  await coordinator.requestSync();

  assert.equal(calls, 1, "requestSync must run again once resume is called");
  assert.equal(coordinator.status, "live");
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
