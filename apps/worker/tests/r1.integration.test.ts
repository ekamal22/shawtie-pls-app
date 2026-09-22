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
import {
  createDefaultDeletionHandlers,
  createDefaultScheduledHandlers,
} from "../src/auth/default-account-handlers.ts";
import { runDeletionBatch } from "../src/deletion/deletion-consumer.ts";
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
    const finalDeadline = new Date(now.getTime() - 1_000);
    const initiatedAt = new Date(finalDeadline.getTime() - 7 * 24 * 60 * 60_000);
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


test("R1 preconfigured scheduled release may complete strictly before a breakup deadline", async () => {
  const database = requireDisposableDatabase();
  try {
    await reset(database);
    const now = new Date();
    const finalDeadline = new Date(now.getTime() + 24 * 60 * 60_000);
    const initiatedAt = new Date(finalDeadline.getTime() - 7 * 24 * 60 * 60_000);
    const unlockAt = new Date(now.getTime() - 60_000);
    const alice = await account(database, "r1-worker-before-breakup-a", initiatedAt);
    const bob = await account(database, "r1-worker-before-breakup-b", initiatedAt);
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
      "INSERT INTO breakup_processes (id, partnership_id, initiated_by_account_id, initiated_at, initiator_cancel_until, base_deadline, final_deadline, generation) VALUES ($1,$2,$3,$4,$4::timestamptz + interval '1 hour',$5,$5,2)",
      [breakupId, partnershipId, alice, initiatedAt, finalDeadline],
    );

    const item = await scheduledItem(database, {
      partnershipId,
      creatorAccountId: alice,
      unlockAt,
      now: initiatedAt,
    });

    assert.equal(await runScheduled(database, "r1-before-breakup-worker"), 1);

    const persisted = await database.pool.query<{
      released_at: Date | null;
      action_status: string;
    }>(
      "SELECT item.released_at, action.status AS action_status FROM relationship_items item JOIN scheduled_actions action ON action.id = $2 WHERE item.id = $1",
      [item.itemId, item.actionId],
    );
    assert.ok(persisted.rows[0]?.released_at);
    assert.equal(persisted.rows[0]?.action_status, "completed");
  } finally {
    await closeDatabasePool(database);
  }
});

test("R1 obsolete release generation is marked stale before content can unlock", async () => {
  const database = requireDisposableDatabase();
  try {
    await reset(database);
    const now = new Date();
    const createdAt = new Date(now.getTime() - 60 * 60_000);
    const unlockAt = new Date(now.getTime() - 60_000);
    const alice = await account(database, "r1-worker-generation-a", createdAt);
    const bob = await account(database, "r1-worker-generation-b", createdAt);
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

    await database.pool.query(
      "UPDATE relationship_items SET release_generation = 2 WHERE id = $1",
      [item.itemId],
    );

    assert.equal(await runScheduled(database, "r1-generation-worker"), 1);

    const persisted = await database.pool.query<{
      released_at: Date | null;
      action_status: string;
      release_generation: string;
    }>(
      "SELECT item.released_at, item.release_generation::text AS release_generation, action.status AS action_status FROM relationship_items item JOIN scheduled_actions action ON action.id = $2 WHERE item.id = $1",
      [item.itemId, item.actionId],
    );
    assert.equal(persisted.rows[0]?.released_at, null);
    assert.equal(persisted.rows[0]?.release_generation, "2");
    assert.equal(persisted.rows[0]?.action_status, "stale");
  } finally {
    await closeDatabasePool(database);
  }
});


test("R1 final breakup dissolution cancels pending release work and deletion cleanup removes R1 rows", async () => {
  const database = requireDisposableDatabase();
  try {
    await reset(database);
    const now = new Date();
    const deadline = new Date(now.getTime() - 60_000);
    const initiatedAt = new Date(deadline.getTime() - 7 * 24 * 60 * 60_000);
    const alice = await account(database, "r1-worker-final-a", initiatedAt);
    const bob = await account(database, "r1-worker-final-b", initiatedAt);
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
      "INSERT INTO breakup_processes (id, partnership_id, initiated_by_account_id, initiated_at, initiator_cancel_until, base_deadline, final_deadline, generation) VALUES ($1,$2,$3,$4,$4::timestamptz + interval '1 hour',$5,$5,2)",
      [breakupId, partnershipId, alice, initiatedAt, deadline],
    );

    const unlockAt = new Date(now.getTime() + 24 * 60 * 60_000);
    const item = await scheduledItem(database, {
      partnershipId,
      creatorAccountId: alice,
      unlockAt,
      now: initiatedAt,
    });
    await insertScheduledAction(database.pool, {
      id: randomUUID(),
      actionType: "partnership_breakup_finalize",
      aggregateType: "breakup_process",
      aggregateId: breakupId,
      executeAt: deadline,
      expectedGeneration: 2n,
      deduplicationKey: "r1-finalize:" + breakupId,
      payload: { partnershipId },
      payloadVersion: 1,
    });

    assert.equal(await runScheduled(database, "r1-finalizer-worker"), 1);

    const action = await database.pool.query<{ status: string }>(
      "SELECT status FROM scheduled_actions WHERE id = $1",
      [item.actionId],
    );
    assert.equal(action.rows[0]?.status, "cancelled");

    const manifest = await database.pool.query<{ id: string; status: string }>(
      "SELECT id, status FROM deletion_manifests WHERE subject_type = 'partnership' AND subject_id = $1",
      [partnershipId],
    );
    assert.equal(manifest.rowCount, 1);
    assert.equal(manifest.rows[0]?.status, "pending");

    const deletionHandlers = createDefaultDeletionHandlers(database);
    assert.equal(
      await runDeletionBatch(
        database,
        "r1-final-cleanup",
        deletionHandlers,
        new AbortController().signal,
        {
          batchSize: 20,
          concurrency: 1,
          leaseMs: 60_000,
          retryPolicy: defaultRetryPolicy,
        },
      ),
      2,
    );

    const roots = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM relationship_items WHERE partnership_id = $1",
      [partnershipId],
    );
    assert.equal(roots.rows[0]?.count, "0");

    const children = await database.pool.query<{ total: string }>(
      "SELECT ((SELECT count(*) FROM relationship_someday_state WHERE partnership_id = $1) + (SELECT count(*) FROM relationship_signal_state WHERE partnership_id = $1) + (SELECT count(*) FROM relationship_reunion_state WHERE partnership_id = $1) + (SELECT count(*) FROM relationship_curations WHERE partnership_id = $1) + (SELECT count(*) FROM relationship_item_references WHERE partnership_id = $1) + (SELECT count(*) FROM relationship_item_links WHERE partnership_id = $1) + (SELECT count(*) FROM relationship_story_members WHERE partnership_id = $1) + (SELECT count(*) FROM relationship_events WHERE partnership_id = $1))::text AS total",
      [partnershipId],
    );
    assert.equal(children.rows[0]?.total, "0");
  } finally {
    await closeDatabasePool(database);
  }
});
