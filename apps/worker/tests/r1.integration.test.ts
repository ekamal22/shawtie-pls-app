import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  closeDatabasePool,
  createDatabasePool,
  databaseConfigFromEnv,
  insertAccount,
  insertAccountProfile,
  insertCurrentEmail,
  insertRelationshipItem,
  insertScheduledAction,
  requestAccountDeletion,
  type DatabasePool,
} from "@shawtie/db";
import { createDefaultScheduledHandlers } from "../src/auth/default-account-handlers.ts";
import { defaultRetryPolicy } from "../src/runtime/retry-policy.ts";
import { runScheduledBatch } from "../src/scheduled/scheduled-consumer.ts";

function requireDisposableDatabase(): DatabasePool {
  if (process.env.DB_TEST_CONFIRM !== "1") {
    throw new Error("DB_TEST_CONFIRM=1 is required for disposable R1 worker tests");
  }
  return createDatabasePool({
    ...databaseConfigFromEnv(),
    applicationName: "shawtie-r1-worker-test",
    maxConnections: 16,
  });
}

async function reset(database: DatabasePool): Promise<void> {
  await database.pool.query(
    "TRUNCATE TABLE accounts, partnerships, outbox_events, scheduled_actions, deletion_manifests CASCADE",
  );
  await database.pool.query("DELETE FROM security_email_deliveries");
}

async function account(
  database: DatabasePool,
  username: string,
  at: Date,
): Promise<string> {
  const accountId = randomUUID();
  const email = username + "@example.test";
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
  await insertCurrentEmail(database.pool, {
    id: randomUUID(),
    accountId,
    emailNormalized: email,
    emailDisplay: email,
    at,
  });
  return accountId;
}

async function partnership(
  database: DatabasePool,
  input: {
    partnershipId: string;
    firstAccountId: string;
    secondAccountId: string;
    state: "active" | "breakup_pending";
    generation: bigint;
    at: Date;
  },
): Promise<void> {
  await database.pool.query(
    "INSERT INTO partnerships (id, relationship_start_date, lifecycle_state, generation, version, activated_at, created_at, updated_at) VALUES ($1, DATE '2024-01-01', $2, $3, 1, $4, $4, $4)",
    [input.partnershipId, input.state, input.generation.toString(), input.at],
  );
  await database.pool.query(
    "INSERT INTO partnership_members (partnership_id, account_id, joined_at) VALUES ($1,$2,$4),($1,$3,$4)",
    [input.partnershipId, input.firstAccountId, input.secondAccountId, input.at],
  );
}

async function scheduledItem(
  database: DatabasePool,
  input: {
    partnershipId: string;
    creatorAccountId: string;
    unlockAt: Date;
    now: Date;
  },
): Promise<{ itemId: string; actionId: string }> {
  const itemId = randomUUID();
  const actionId = randomUUID();
  await insertRelationshipItem(database.pool, {
    id: itemId,
    partnershipId: input.partnershipId,
    creatorAccountId: input.creatorAccountId,
    kind: "future_us",
    contentSchemaVersion: 1,
    preview: { title: "Later" },
    content: { body: "Sealed until release." },
    occurredPrecision: null,
    occurredYear: null,
    occurredMonth: null,
    occurredDay: null,
    releaseMode: "scheduled",
    releaseGeneration: 1n,
    unlockAt: input.unlockAt,
    releasedAt: null,
    createdAt: input.now,
  });
  await insertScheduledAction(database.pool, {
    id: actionId,
    actionType: "relationship_item_release",
    aggregateType: "relationship_item",
    aggregateId: itemId,
    executeAt: input.unlockAt,
    expectedGeneration: 1n,
    deduplicationKey: "relationship-release:" + itemId + ":g:1",
    payload: {},
    payloadVersion: 1,
  });
  return { itemId, actionId };
}

async function runScheduled(database: DatabasePool, workerId: string): Promise<number> {
  return runScheduledBatch(database, workerId, createDefaultScheduledHandlers(), {
    batchSize: 20,
    concurrency: 1,
    leaseMs: 60_000,
    retryPolicy: defaultRetryPolicy,
  });
}

test("R1 scheduled release marks item released exactly once and appends an event", async () => {
  const database = requireDisposableDatabase();
  try {
    await reset(database);
    const now = new Date();
    const createdAt = new Date(now.getTime() - 60 * 60_000);
    const unlockAt = new Date(now.getTime() - 60_000);
    const alice = await account(database, "r1-worker-release-a", createdAt);
    const bob = await account(database, "r1-worker-release-b", createdAt);
    const partnershipId = randomUUID();
    await partnership(database, {
      partnershipId,
      firstAccountId: alice,
      secondAccountId: bob,
      state: "active",
      generation: 1n,
      at: createdAt,
    });
    const item = await scheduledItem(database, {
      partnershipId,
      creatorAccountId: alice,
      unlockAt,
      now: createdAt,
    });

    assert.equal(await runScheduled(database, "r1-release-worker"), 1);

    const persisted = await database.pool.query<{
      released_at: Date | null;
      version: string;
      action_status: string;
      event_count: string;
    }>(
      "SELECT item.released_at, item.version::text AS version, action.status AS action_status, (SELECT count(*)::text FROM relationship_events event WHERE event.item_id = item.id AND event.event_type = 'item_released') AS event_count FROM relationship_items item JOIN scheduled_actions action ON action.id = $2 WHERE item.id = $1",
      [item.itemId, item.actionId],
    );
    assert.ok(persisted.rows[0]?.released_at);
    assert.equal(persisted.rows[0]?.version, "2");
    assert.equal(persisted.rows[0]?.action_status, "completed");
    assert.equal(persisted.rows[0]?.event_count, "1");

    assert.equal(await runScheduled(database, "r1-release-worker-repeat"), 0);
  } finally {
    await closeDatabasePool(database);
  }
});

test("R1 in-flight release reschedules through account-deletion recovery window", async () => {
  const database = requireDisposableDatabase();
  try {
    await reset(database);
    const now = new Date();
    const createdAt = new Date(now.getTime() - 60 * 60_000);
    const unlockAt = new Date(now.getTime() - 60_000);
    const recoverUntil = new Date(now.getTime() + 7 * 24 * 60 * 60_000);
    const alice = await account(database, "r1-worker-pause-a", createdAt);
    const bob = await account(database, "r1-worker-pause-b", createdAt);
    const partnershipId = randomUUID();
    await partnership(database, {
      partnershipId,
      firstAccountId: alice,
      secondAccountId: bob,
      state: "active",
      generation: 1n,
      at: createdAt,
    });
    const item = await scheduledItem(database, {
      partnershipId,
      creatorAccountId: alice,
      unlockAt,
      now: createdAt,
    });

    await requestAccountDeletion(database.pool, {
      id: randomUUID(),
      accountId: alice,
      requestedAt: now,
      recoverUntil,
      generation: 1n,
    });

    assert.equal(await runScheduled(database, "r1-pause-worker"), 1);

    const persisted = await database.pool.query<{
      released_at: Date | null;
      action_status: string;
      available_at: Date;
      execute_at: Date;
      attempt_count: number;
    }>(
      "SELECT item.released_at, action.status AS action_status, action.available_at, action.execute_at, action.attempt_count FROM relationship_items item JOIN scheduled_actions action ON action.id = $2 WHERE item.id = $1",
      [item.itemId, item.actionId],
    );
    assert.equal(persisted.rows[0]?.released_at, null);
    assert.equal(persisted.rows[0]?.action_status, "pending");
    assert.equal(persisted.rows[0]?.execute_at.toISOString(), unlockAt.toISOString());
    assert.ok(
      (persisted.rows[0]?.available_at.getTime() ?? 0) >= recoverUntil.getTime(),
    );
    assert.equal(persisted.rows[0]?.attempt_count, 1);
  } finally {
    await closeDatabasePool(database);
  }
});

test("R1 breakup destructive deadline wins over a scheduled release at equality or later", async () => {
  const database = requireDisposableDatabase();
  try {
    await reset(database);
    const now = new Date();
    const initiatedAt = new Date(now.getTime() - 8 * 24 * 60 * 60_000);
    const finalDeadline = new Date(now.getTime() - 1_000);
    const unlockAt = new Date(now.getTime() - 60_000);
    const alice = await account(database, "r1-worker-breakup-a", initiatedAt);
    const bob = await account(database, "r1-worker-breakup-b", initiatedAt);
    const partnershipId = randomUUID();
    const breakupId = randomUUID();

    await partnership(database, {
      partnershipId,
      firstAccountId: alice,
      secondAccountId: bob,
      state: "breakup_pending",
      generation: 2n,
      at: initiatedAt,
    });
    await database.pool.query(
      "INSERT INTO breakup_processes (id, partnership_id, initiated_by_account_id, initiated_at, initiator_cancel_until, base_deadline, final_deadline, generation) VALUES ($1,$2,$3,$4,$4::timestamptz + interval '1 hour',$4::timestamptz + interval '7 days',$5,2)",
      [breakupId, partnershipId, alice, initiatedAt, finalDeadline],
    );

    const item = await scheduledItem(database, {
      partnershipId,
      creatorAccountId: alice,
      unlockAt,
      now: initiatedAt,
    });

    assert.equal(await runScheduled(database, "r1-breakup-race-worker"), 1);

    const persisted = await database.pool.query<{
      released_at: Date | null;
      action_status: string;
    }>(
      "SELECT item.released_at, action.status AS action_status FROM relationship_items item JOIN scheduled_actions action ON action.id = $2 WHERE item.id = $1",
      [item.itemId, item.actionId],
    );
    assert.equal(persisted.rows[0]?.released_at, null);
    assert.equal(persisted.rows[0]?.action_status, "stale");
  } finally {
    await closeDatabasePool(database);
  }
});
