import assert from "node:assert/strict";
import test from "node:test";
import {
  claimScheduledActions,
  lockAccounts,
} from "@shawtie/db";
import {
  closeDatabasePool,
  requireDisposableDatabase,
  withTwoClients,
} from "../src/index.ts";

const accountA = "f2000000-0000-4000-8000-000000000001";
const accountB = "f2000000-0000-4000-8000-000000000002";
const partnershipA = "f2000000-0000-4000-8000-000000000011";
const partnershipB = "f2000000-0000-4000-8000-000000000012";

async function prepare(database: ReturnType<typeof requireDisposableDatabase>) {
  await database.pool.query(
    "DELETE FROM partnership_members WHERE account_id = ANY($1::uuid[])",
    [[accountA, accountB]],
  );
  await database.pool.query(
    "DELETE FROM partnerships WHERE id = ANY($1::uuid[])",
    [[partnershipA, partnershipB]],
  );
  await database.pool.query(
    "DELETE FROM accounts WHERE id = ANY($1::uuid[])",
    [[accountA, accountB]],
  );
  await database.pool.query(
    `INSERT INTO accounts (
       id, username_normalized, username_display, date_of_birth
     ) VALUES
       ($1, 'f2-account-a', 'F2 Account A', DATE '2000-01-01'),
       ($2, 'f2-account-b', 'F2 Account B', DATE '2000-01-01')`,
    [accountA, accountB],
  );
  await database.pool.query(
    `INSERT INTO partnerships (
       id, relationship_start_date, activated_at
     ) VALUES
       ($1, DATE '2026-01-01', clock_timestamp()),
       ($2, DATE '2026-01-01', clock_timestamp())`,
    [partnershipA, partnershipB],
  );
}

test("occupied partnership contention allows exactly one current slot", async () => {
  const database = requireDisposableDatabase();
  try {
    await prepare(database);
    await withTwoClients(database, async (first, second) => {
      await first.query("BEGIN");
      await second.query("BEGIN");
      await first.query(
        `INSERT INTO partnership_members (partnership_id, account_id, joined_at)
         VALUES ($1, $2, clock_timestamp())`,
        [partnershipA, accountA],
      );

      const secondInsert = second.query(
        `INSERT INTO partnership_members (partnership_id, account_id, joined_at)
         VALUES ($1, $2, clock_timestamp())`,
        [partnershipB, accountA],
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      await first.query("COMMIT");

      await assert.rejects(secondInsert, (error: unknown) => {
        return (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "23505"
        );
      });
      await second.query("ROLLBACK");
    });

    const result = await database.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM partnership_members
       WHERE account_id = $1 AND released_at IS NULL`,
      [accountA],
    );
    assert.equal(result.rows[0]?.count, "1");
  } finally {
    await closeDatabasePool(database);
  }
});

test("two workers never claim the same scheduled action", async () => {
  const database = requireDisposableDatabase();
  try {
    await database.pool.query(
      "DELETE FROM scheduled_actions WHERE deduplication_key LIKE 'f2-race-%'",
    );
    await database.pool.query(
      `INSERT INTO scheduled_actions (
         id, action_type, aggregate_type, aggregate_id, execute_at, available_at,
         deduplication_key, payload_version
       )
       SELECT
         ('f2100000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
         'test.race',
         'test',
         ('f2200000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
         clock_timestamp() - interval '1 minute',
         clock_timestamp() - interval '1 minute',
         'f2-race-' || i,
         1
       FROM generate_series(1, 10) AS i`,
    );

    const [first, second] = await Promise.all([
      claimScheduledActions(database.pool, 5, "worker-a", 60_000),
      claimScheduledActions(database.pool, 5, "worker-b", 60_000),
    ]);

    const firstIds = new Set(first.map((item) => item.id));
    assert.equal(second.filter((item) => firstIds.has(item.id)).length, 0);
    assert.equal(first.length + second.length, 10);
  } finally {
    await closeDatabasePool(database);
  }
});

test("expired scheduled claim is reclaimed with a higher fencing version", async () => {
  const database = requireDisposableDatabase();
  try {
    const id = "f2300000-0000-4000-8000-000000000001";
    await database.pool.query("DELETE FROM scheduled_actions WHERE id = $1", [id]);
    await database.pool.query(
      `INSERT INTO scheduled_actions (
         id, action_type, aggregate_type, aggregate_id, execute_at, available_at,
         status, deduplication_key, claimed_at, claimed_by, lease_expires_at,
         claim_version, attempt_count
       ) VALUES (
         $1, 'test.reclaim', 'test', $2, clock_timestamp() - interval '2 minutes',
         clock_timestamp() - interval '2 minutes', 'processing', 'f2-reclaim',
         clock_timestamp() - interval '2 minutes', 'dead-worker',
         clock_timestamp() - interval '1 minute', 4, 1
       )`,
      [id, accountA],
    );

    const claimed = await claimScheduledActions(database.pool, 1, "worker-new", 60_000);
    assert.equal(claimed[0]?.id, id);
    assert.equal(claimed[0]?.claimVersion, 5n);
    assert.equal(claimed[0]?.claimedBy, "worker-new");
  } finally {
    await closeDatabasePool(database);
  }
});

test("opposite account input order acquires deterministic locks without deadlock", async () => {
  const database = requireDisposableDatabase();
  try {
    await prepare(database);
    await withTwoClients(database, async (first, second) => {
      await first.query("BEGIN");
      await second.query("BEGIN");

      const firstLocks = await lockAccounts(first, [accountB, accountA]);
      assert.deepEqual(firstLocks, [accountA, accountB]);

      const secondLockPromise = lockAccounts(second, [accountA, accountB]);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await first.query("COMMIT");

      const secondLocks = await secondLockPromise;
      assert.deepEqual(secondLocks, [accountA, accountB]);
      await second.query("COMMIT");
    });
  } finally {
    await closeDatabasePool(database);
  }
});

test("claimable scheduled work query uses a queue index on realistic synthetic data", async () => {
  const database = requireDisposableDatabase();
  try {
    await database.pool.query(
      "DELETE FROM scheduled_actions WHERE deduplication_key LIKE 'f2-plan-%'",
    );
    await database.pool.query(
      `INSERT INTO scheduled_actions (
         id, action_type, aggregate_type, aggregate_id, execute_at, available_at,
         deduplication_key
       )
       SELECT
         md5('f2-plan-action-' || i)::uuid,
         'test.plan',
         'test',
         md5('f2-plan-aggregate-' || i)::uuid,
         clock_timestamp() + (i * interval '1 second'),
         clock_timestamp() + (i * interval '1 second'),
         'f2-plan-' || i
       FROM generate_series(1, 5000) AS i`,
    );
    await database.pool.query("ANALYZE scheduled_actions");

    const plan = await database.pool.query<{ "QUERY PLAN": string }>(
      `EXPLAIN (FORMAT TEXT)
       SELECT id
       FROM scheduled_actions
       WHERE status = 'pending'
         AND available_at <= clock_timestamp()
       ORDER BY available_at, id
       LIMIT 20`,
    );
    const text = plan.rows.map((row) => row["QUERY PLAN"]).join("\n");
    assert.match(text, /scheduled_actions_claimable/);
  } finally {
    await closeDatabasePool(database);
  }
});
