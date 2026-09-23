import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  acceptCall,
  closeDatabasePool,
  createDatabasePool,
  createDevice,
  createSession,
  databaseConfigFromEnv,
  insertAccount,
  insertAccountProfile,
  insertCallSession,
  insertPartnership,
  insertPartnershipMembers,
  insertScheduledAction,
  loadCall,
  recordEndpointConnected,
  revokePushSubscriptionForDevice,
  upsertPushSubscription,
  type DatabasePool,
} from "@shawtie/db";
import { createDefaultScheduledHandlers } from "../src/auth/default-account-handlers.ts";
import { defaultRetryPolicy } from "../src/runtime/retry-policy.ts";
import { runScheduledBatch } from "../src/scheduled/scheduled-consumer.ts";

function requireDisposableDatabase(): DatabasePool {
  if (process.env.DB_TEST_CONFIRM !== "1") {
    throw new Error("DB_TEST_CONFIRM=1 is required for disposable C1 worker tests");
  }
  return createDatabasePool({
    ...databaseConfigFromEnv(),
    applicationName: "shawtie-c1-worker-test",
    maxConnections: 12,
  });
}

async function reset(database: DatabasePool): Promise<void> {
  await database.pool.query(
    "TRUNCATE TABLE accounts, partnerships, outbox_events, scheduled_actions, deletion_manifests CASCADE",
  );
}

async function identity(database: DatabasePool, username: string, at: Date) {
  const accountId = randomUUID();
  const deviceId = randomUUID();
  const sessionId = randomUUID();
  await insertAccount(database.pool, {
    id: accountId,
    usernameNormalized: username,
    usernameDisplay: username,
    dateOfBirth: "2000-01-01",
    createdAt: at,
  });
  await insertAccountProfile(database.pool, {
    accountId,
    displayName: username,
    at,
  });
  await createDevice(database.pool, {
    id: deviceId,
    accountId,
    displayName: username + " device",
    handleVerifier: Buffer.from(randomUUID()),
    handleKeyVersion: 1,
    at,
  });
  await createSession(database.pool, {
    id: sessionId,
    accountId,
    deviceId,
    tokenVerifier: Buffer.from(randomUUID()),
    tokenKeyVersion: 1,
    createdAt: at,
    expiresAt: new Date(at.getTime() + 24 * 60 * 60_000),
    idleExpiresAt: new Date(at.getTime() + 24 * 60 * 60_000),
  });
  return { accountId, deviceId, sessionId };
}

async function fixture(database: DatabasePool, at: Date) {
  const alice = await identity(database, "c1_worker_alice_" + randomUUID().slice(0, 8), at);
  const bob = await identity(database, "c1_worker_bob_" + randomUUID().slice(0, 8), at);
  const partnershipId = randomUUID();
  await insertPartnership(database.pool, {
    id: partnershipId,
    relationshipStartDate: "2025-01-01",
    activatedAt: at,
  });
  await insertPartnershipMembers(
    database.pool,
    partnershipId,
    [alice.accountId, bob.accountId],
    at,
  );
  return { alice, bob, partnershipId };
}

async function runScheduled(database: DatabasePool, workerId: string): Promise<number> {
  return runScheduledBatch(database, workerId, createDefaultScheduledHandlers(), {
    batchSize: 20,
    concurrency: 1,
    leaseMs: 60_000,
    retryPolicy: defaultRetryPolicy,
  });
}

test("C1 ringing timeout finalizes missed exactly once and emits invalidations", async () => {
  const database = requireDisposableDatabase();
  try {
    await reset(database);
    const now = new Date();
    const createdAt = new Date(now.getTime() - 5 * 60_000);
    const ringExpiresAt = new Date(now.getTime() - 60_000);
    const data = await fixture(database, createdAt);
    const call = await insertCallSession(database.pool, {
      id: randomUUID(),
      partnershipId: data.partnershipId,
      callerAccountId: data.alice.accountId,
      callerDeviceId: data.alice.deviceId,
      callerSessionId: data.alice.sessionId,
      calleeAccountId: data.bob.accountId,
      kind: "voice",
      now: createdAt,
      ringExpiresAt,
    });
    assert.ok(call);
    await insertScheduledAction(database.pool, {
      id: randomUUID(),
      actionType: "c1.call.ringing_timeout",
      aggregateType: "call",
      aggregateId: call.id,
      executeAt: ringExpiresAt,
      expectedGeneration: 1n,
      deduplicationKey: "c1-worker-ring:" + call.id,
      payload: { callId: call.id, expectedState: "ringing" },
      payloadVersion: 1,
    });

    assert.equal(await runScheduled(database, "c1-ring-timeout"), 1);
    const ended = await loadCall(database.pool, call.id, data.partnershipId);
    assert.equal(ended?.state, "ended");
    assert.equal(ended?.terminalReason, "missed");
    assert.equal(ended?.version, 2n);
    assert.equal(ended?.deadlineGeneration, 2n);

    const events = await database.pool.query<{ event_type: string }>(
      "SELECT event_type FROM outbox_events WHERE aggregate_type='call' AND aggregate_id=$1 ORDER BY event_type",
      [call.id],
    );
    assert.deepEqual(
      events.rows.map((row) => row.event_type),
      ["c1.call.changed", "c1.call.push"],
    );
    assert.equal(await runScheduled(database, "c1-ring-timeout-repeat"), 0);
  } finally {
    await closeDatabasePool(database);
  }
});

test("C1 first endpoint attestation preserves accepted timeout generation", async () => {
  const database = requireDisposableDatabase();
  try {
    await reset(database);
    const wallNow = new Date();
    const createdAt = new Date(wallNow.getTime() - 10 * 60_000);
    const acceptedAt = new Date(wallNow.getTime() - 5 * 60_000);
    const connectExpiresAt = new Date(wallNow.getTime() - 60_000);
    const data = await fixture(database, createdAt);
    const ringing = await insertCallSession(database.pool, {
      id: randomUUID(),
      partnershipId: data.partnershipId,
      callerAccountId: data.alice.accountId,
      callerDeviceId: data.alice.deviceId,
      callerSessionId: data.alice.sessionId,
      calleeAccountId: data.bob.accountId,
      kind: "voice",
      now: createdAt,
      ringExpiresAt: new Date(createdAt.getTime() + 60_000),
    });
    assert.ok(ringing);
    const accepted = await acceptCall(database.pool, {
      callId: ringing.id,
      expectedVersion: 1n,
      calleeAccountId: data.bob.accountId,
      deviceId: data.bob.deviceId,
      sessionId: data.bob.sessionId,
      now: acceptedAt,
      connectExpiresAt,
    });
    assert.ok(accepted);
    assert.equal(accepted.deadlineGeneration, 2n);

    await insertScheduledAction(database.pool, {
      id: randomUUID(),
      actionType: "c1.call.accepted_timeout",
      aggregateType: "call",
      aggregateId: ringing.id,
      executeAt: connectExpiresAt,
      expectedGeneration: 2n,
      deduplicationKey: "c1-worker-connect:" + ringing.id,
      payload: { callId: ringing.id, expectedState: "accepted" },
      payloadVersion: 1,
    });

    const first = await recordEndpointConnected(database.pool, {
      callId: ringing.id,
      accountId: data.alice.accountId,
      deviceId: data.alice.deviceId,
      sessionId: data.alice.sessionId,
      now: new Date(wallNow.getTime() - 30_000),
      hardExpiresAt: new Date(wallNow.getTime() + 60 * 60_000),
    });
    assert.ok(first);
    assert.equal(first.transitioned, false);
    assert.equal(first.call.state, "accepted");
    assert.equal(first.call.version, 2n);
    assert.equal(first.call.deadlineGeneration, 2n);

    assert.equal(await runScheduled(database, "c1-connect-timeout"), 1);
    const ended = await loadCall(database.pool, ringing.id, data.partnershipId);
    assert.equal(ended?.state, "ended");
    assert.equal(ended?.terminalReason, "failed");
    assert.equal(ended?.deadlineGeneration, 3n);
  } finally {
    await closeDatabasePool(database);
  }
});

test("C1 connected hard expiry is deadline-generation fenced", async () => {
  const database = requireDisposableDatabase();
  try {
    await reset(database);
    const wallNow = new Date();
    const createdAt = new Date(wallNow.getTime() - 3 * 60 * 60_000);
    const acceptedAt = new Date(wallNow.getTime() - 2 * 60 * 60_000);
    const firstConnectedAt = new Date(wallNow.getTime() - 95 * 60_000);
    const secondConnectedAt = new Date(wallNow.getTime() - 90 * 60_000);
    const hardExpiresAt = new Date(wallNow.getTime() - 60_000);
    const data = await fixture(database, createdAt);

    const ringing = await insertCallSession(database.pool, {
      id: randomUUID(),
      partnershipId: data.partnershipId,
      callerAccountId: data.alice.accountId,
      callerDeviceId: data.alice.deviceId,
      callerSessionId: data.alice.sessionId,
      calleeAccountId: data.bob.accountId,
      kind: "voice",
      now: createdAt,
      ringExpiresAt: new Date(createdAt.getTime() + 60_000),
    });
    assert.ok(ringing);

    const accepted = await acceptCall(database.pool, {
      callId: ringing.id,
      expectedVersion: 1n,
      calleeAccountId: data.bob.accountId,
      deviceId: data.bob.deviceId,
      sessionId: data.bob.sessionId,
      now: acceptedAt,
      connectExpiresAt: new Date(acceptedAt.getTime() + 10 * 60_000),
    });
    assert.ok(accepted);

    const first = await recordEndpointConnected(database.pool, {
      callId: ringing.id,
      accountId: data.alice.accountId,
      deviceId: data.alice.deviceId,
      sessionId: data.alice.sessionId,
      now: firstConnectedAt,
      hardExpiresAt,
    });
    assert.ok(first);
    assert.equal(first.transitioned, false);

    const second = await recordEndpointConnected(database.pool, {
      callId: ringing.id,
      accountId: data.bob.accountId,
      deviceId: data.bob.deviceId,
      sessionId: data.bob.sessionId,
      now: secondConnectedAt,
      hardExpiresAt,
    });
    assert.ok(second);
    assert.equal(second.transitioned, true);
    assert.equal(second.call.state, "connected");
    assert.equal(second.call.version, 3n);
    assert.equal(second.call.deadlineGeneration, 3n);

    await insertScheduledAction(database.pool, {
      id: randomUUID(),
      actionType: "c1.call.connected_timeout",
      aggregateType: "call",
      aggregateId: ringing.id,
      executeAt: hardExpiresAt,
      expectedGeneration: 3n,
      deduplicationKey: "c1-worker-hard:" + ringing.id,
      payload: { callId: ringing.id, expectedState: "connected" },
      payloadVersion: 1,
    });

    assert.equal(await runScheduled(database, "c1-hard-timeout"), 1);
    const ended = await loadCall(database.pool, ringing.id, data.partnershipId);
    assert.equal(ended?.state, "ended");
    assert.equal(ended?.terminalReason, "failed");
    assert.equal(ended?.deadlineGeneration, 4n);
  } finally {
    await closeDatabasePool(database);
  }
});

test("C1 revoked push endpoint can be safely rebound without duplicate active routing", async () => {
  const database = requireDisposableDatabase();
  try {
    await reset(database);
    const at = new Date();
    const data = await fixture(database, at);
    const endpoint = "https://push.example.test/c1-rebind";

    await upsertPushSubscription(database.pool, {
      deviceId: data.alice.deviceId,
      accountId: data.alice.accountId,
      endpoint,
      p256dh: "alice-p256dh",
      auth: "alice-auth-secret",
      expirationTimeMs: null,
      now: at,
    });
    await revokePushSubscriptionForDevice(
      database.pool,
      data.alice.deviceId,
      data.alice.accountId,
      new Date(at.getTime() + 1_000),
    );
    await upsertPushSubscription(database.pool, {
      deviceId: data.bob.deviceId,
      accountId: data.bob.accountId,
      endpoint,
      p256dh: "bob-p256dh",
      auth: "bob-auth-secret",
      expirationTimeMs: null,
      now: new Date(at.getTime() + 2_000),
    });

    const rows = await database.pool.query<{
      device_id: string;
      account_id: string;
      revoked_at: Date | null;
    }>(
      "SELECT device_id, account_id, revoked_at FROM push_subscriptions WHERE endpoint=$1 ORDER BY created_at",
      [endpoint],
    );
    assert.equal(rows.rowCount, 2);
    assert.equal(rows.rows.filter((row) => row.revoked_at === null).length, 1);
    assert.equal(
      rows.rows.find((row) => row.revoked_at === null)?.device_id,
      data.bob.deviceId,
    );
  } finally {
    await closeDatabasePool(database);
  }
});
