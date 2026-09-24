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
    throw new Error("DB_TEST_CONFIRM=1 is required for disposable P3 worker tests");
  }
  return createDatabasePool({
    ...databaseConfigFromEnv(),
    applicationName: "shawtie-p3-worker-test",
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
): Promise<{ accountId: string; email: string }> {
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
  return { accountId, email };
}

async function partnership(
  database: DatabasePool,
  input: {
    readonly partnershipId: string;
    readonly firstAccountId: string;
    readonly secondAccountId: string;
    readonly state: "active" | "breakup_pending";
    readonly generation: bigint;
    readonly at: Date;
  },
): Promise<void> {
  await database.pool.query(
    "INSERT INTO partnerships (id, relationship_start_date, lifecycle_state, generation, version, activated_at, created_at, updated_at) VALUES ($1, DATE '2025-01-01', $2, $3, 1, $4, $4, $4)",
    [input.partnershipId, input.state, input.generation.toString(), input.at],
  );
  await database.pool.query(
    "INSERT INTO partnership_members (partnership_id, account_id, joined_at) VALUES ($1,$2,$4),($1,$3,$4)",
    [input.partnershipId, input.firstAccountId, input.secondAccountId, input.at],
  );
}

async function breakup(
  database: DatabasePool,
  input: {
    readonly breakupId: string;
    readonly partnershipId: string;
    readonly initiatorAccountId: string;
    readonly initiatedAt: Date;
    readonly finalDeadline: Date;
    readonly generation: bigint;
  },
): Promise<void> {
  await database.pool.query(
    "INSERT INTO breakup_processes (id, partnership_id, initiated_by_account_id, initiated_at, initiator_cancel_until, base_deadline, final_deadline, generation) VALUES ($1,$2,$3,$4,$4::timestamptz + interval '1 hour',$4::timestamptz + interval '7 days',$5,$6)",
    [
      input.breakupId,
      input.partnershipId,
      input.initiatorAccountId,
      input.initiatedAt,
      input.finalDeadline,
      input.generation.toString(),
    ],
  );
}

async function runScheduled(database: DatabasePool, workerId: string): Promise<number> {
  return runScheduledBatch(database, workerId, createDefaultScheduledHandlers(), {
    batchSize: 20,
    concurrency: 1,
    leaseMs: 60_000,
    retryPolicy: defaultRetryPolicy,
  });
}

async function runDeletion(database: DatabasePool, workerId: string): Promise<number> {
  return runDeletionBatch(
    database,
    workerId,
    createDefaultDeletionHandlers(database),
    new AbortController().signal,
    {
      batchSize: 20,
      concurrency: 1,
      leaseMs: 60_000,
      retryPolicy: defaultRetryPolicy,
    },
  );
}

test("P3 breakup finalizer uses the authoritative deadline, exact cooldown, and deletion manifest", async () => {
  const database = requireDisposableDatabase();
  try {
    await reset(database);
    const now = new Date();
    const initiatedAt = new Date(now.getTime() - 8 * 24 * 60 * 60_000);
    const deadline = new Date(initiatedAt.getTime() + 7 * 24 * 60 * 60_000);
    const alice = await account(database, "p3-worker-breakup-a", initiatedAt);
    const bob = await account(database, "p3-worker-breakup-b", initiatedAt);
    const partnershipId = randomUUID();
    const breakupId = randomUUID();

    await partnership(database, {
      partnershipId,
      firstAccountId: alice.accountId,
      secondAccountId: bob.accountId,
      state: "breakup_pending",
      generation: 2n,
      at: initiatedAt,
    });
    await breakup(database, {
      breakupId,
      partnershipId,
      initiatorAccountId: alice.accountId,
      initiatedAt,
      finalDeadline: deadline,
      generation: 2n,
    });
    await insertScheduledAction(database.pool, {
      id: randomUUID(),
      actionType: "partnership_breakup_finalize",
      aggregateType: "breakup_process",
      aggregateId: breakupId,
      executeAt: deadline,
      expectedGeneration: 2n,
      deduplicationKey: "p3-worker-breakup-finalize:" + breakupId,
      payload: { partnershipId },
      payloadVersion: 1,
    });

    assert.equal(await runScheduled(database, "p3-breakup-finalizer"), 1);

    const state = await database.pool.query<{
      lifecycle_state: string;
      termination_reason: string | null;
      terminated_at: Date | null;
      version: string;
      generation: string;
      dissolved_at: Date | null;
      released_count: string;
    }>(
      "SELECT partnership.lifecycle_state, partnership.termination_reason, partnership.terminated_at, partnership.version::text AS version, partnership.generation::text AS generation, breakup.dissolved_at, (SELECT count(*)::text FROM partnership_members member WHERE member.partnership_id = partnership.id AND member.released_at = $2) AS released_count FROM partnerships partnership JOIN breakup_processes breakup ON breakup.partnership_id = partnership.id WHERE partnership.id = $1",
      [partnershipId, deadline],
    );
    assert.equal(state.rows[0]?.lifecycle_state, "terminated");
    assert.equal(state.rows[0]?.termination_reason, "breakup");
    assert.equal(state.rows[0]?.terminated_at?.toISOString(), deadline.toISOString());
    assert.equal(state.rows[0]?.dissolved_at?.toISOString(), deadline.toISOString());
    assert.equal(state.rows[0]?.version, "1");
    assert.equal(state.rows[0]?.generation, "3");
    assert.equal(state.rows[0]?.released_count, "2");

    const cooldowns = await database.pool.query<{
      account_id: string;
      reason: string;
      exact_duration: boolean;
    }>(
      "SELECT account_id, reason, eligible_at = created_at + interval '3 months' AS exact_duration FROM account_partner_eligibility WHERE source_partnership_id = $1 ORDER BY account_id",
      [partnershipId],
    );
    assert.equal(cooldowns.rowCount, 2);
    assert.ok(cooldowns.rows.every((row) => row.reason === "breakup_dissolution"));
    assert.ok(cooldowns.rows.every((row) => row.exact_duration));

    const manifest = await database.pool.query<{
      id: string;
      reason: string;
      status: string;
      target_count: string;
    }>(
      "SELECT manifest.id, manifest.reason, manifest.status, (SELECT count(*)::text FROM deletion_targets target WHERE target.manifest_id = manifest.id) AS target_count FROM deletion_manifests manifest WHERE manifest.subject_type = 'partnership' AND manifest.subject_id = $1",
      [partnershipId],
    );
    assert.equal(manifest.rowCount, 1);
    assert.equal(manifest.rows[0]?.reason, "breakup_dissolution");
    assert.equal(manifest.rows[0]?.status, "pending");
    assert.equal(manifest.rows[0]?.target_count, "3");

    assert.equal(await runDeletion(database, "p3-breakup-cleanup"), 3);
    const completed = await database.pool.query<{ status: string }>(
      "SELECT status FROM deletion_manifests WHERE id = $1",
      [manifest.rows[0]?.id],
    );
    assert.equal(completed.rows[0]?.status, "completed");
  } finally {
    await closeDatabasePool(database);
  }
});

test("P3 stale breakup finalizer is fenced after generation changes", async () => {
  const database = requireDisposableDatabase();
  try {
    await reset(database);
    const now = new Date();
    const initiatedAt = new Date(now.getTime() - 8 * 24 * 60 * 60_000);
    const deadline = new Date(initiatedAt.getTime() + 10 * 24 * 60 * 60_000);
    const alice = await account(database, "p3-worker-stale-a", initiatedAt);
    const bob = await account(database, "p3-worker-stale-b", initiatedAt);
    const partnershipId = randomUUID();
    const breakupId = randomUUID();
    const actionId = randomUUID();

    await partnership(database, {
      partnershipId,
      firstAccountId: alice.accountId,
      secondAccountId: bob.accountId,
      state: "breakup_pending",
      generation: 3n,
      at: initiatedAt,
    });
    await breakup(database, {
      breakupId,
      partnershipId,
      initiatorAccountId: alice.accountId,
      initiatedAt,
      finalDeadline: deadline,
      generation: 3n,
    });
    await insertScheduledAction(database.pool, {
      id: actionId,
      actionType: "partnership_breakup_finalize",
      aggregateType: "breakup_process",
      aggregateId: breakupId,
      executeAt: new Date(now.getTime() - 1_000),
      expectedGeneration: 2n,
      deduplicationKey: "p3-stale-finalizer:" + breakupId,
      payload: { partnershipId },
      payloadVersion: 1,
    });

    assert.equal(await runScheduled(database, "p3-stale-worker"), 1);

    const action = await database.pool.query<{ status: string }>(
      "SELECT status FROM scheduled_actions WHERE id = $1",
      [actionId],
    );
    assert.equal(action.rows[0]?.status, "stale");

    const state = await database.pool.query<{
      lifecycle_state: string;
      terminated_at: Date | null;
      dissolved_at: Date | null;
    }>(
      "SELECT partnership.lifecycle_state, partnership.terminated_at, breakup.dissolved_at FROM partnerships partnership JOIN breakup_processes breakup ON breakup.partnership_id = partnership.id WHERE partnership.id = $1",
      [partnershipId],
    );
    assert.equal(state.rows[0]?.lifecycle_state, "breakup_pending");
    assert.equal(state.rows[0]?.terminated_at, null);
    assert.equal(state.rows[0]?.dissolved_at, null);
  } finally {
    await closeDatabasePool(database);
  }
});

test("P3 permanent partner deletion from active partnership gives only the remaining partner one month", async () => {
  const database = requireDisposableDatabase();
  try {
    await reset(database);
    const now = new Date();
    const requestedAt = new Date(now.getTime() - 8 * 24 * 60 * 60_000);
    const recoverUntil = new Date(requestedAt.getTime() + 7 * 24 * 60 * 60_000);
    const deleting = await account(database, "p3-worker-delete-active-a", requestedAt);
    const remaining = await account(database, "p3-worker-delete-active-b", requestedAt);
    const partnershipId = randomUUID();

    await partnership(database, {
      partnershipId,
      firstAccountId: deleting.accountId,
      secondAccountId: remaining.accountId,
      state: "active",
      generation: 1n,
      at: requestedAt,
    });
    await requestAccountDeletion(database.pool, {
      id: randomUUID(),
      accountId: deleting.accountId,
      requestedAt,
      recoverUntil,
      generation: 1n,
    });
    await insertScheduledAction(database.pool, {
      id: randomUUID(),
      actionType: "account_deletion_finalize",
      aggregateType: "account",
      aggregateId: deleting.accountId,
      executeAt: recoverUntil,
      expectedGeneration: 1n,
      deduplicationKey: "p3-active-delete:" + deleting.accountId,
      payload: {},
      payloadVersion: 1,
    });

    assert.equal(await runScheduled(database, "p3-active-delete-worker"), 1);

    const state = await database.pool.query<{
      lifecycle_state: string;
      termination_reason: string | null;
      terminated_at: Date | null;
      account_status: string;
    }>(
      "SELECT partnership.lifecycle_state, partnership.termination_reason, partnership.terminated_at, account.status AS account_status FROM partnerships partnership JOIN accounts account ON account.id = $2 WHERE partnership.id = $1",
      [partnershipId, deleting.accountId],
    );
    assert.equal(state.rows[0]?.lifecycle_state, "terminated");
    assert.equal(state.rows[0]?.termination_reason, "partner_account_deleted");
    assert.equal(state.rows[0]?.terminated_at?.toISOString(), recoverUntil.toISOString());
    assert.equal(state.rows[0]?.account_status, "deleted");

    const cooldowns = await database.pool.query<{
      account_id: string;
      reason: string;
      exact_duration: boolean;
    }>(
      "SELECT account_id, reason, eligible_at = created_at + interval '1 month' AS exact_duration FROM account_partner_eligibility WHERE source_partnership_id = $1 ORDER BY account_id",
      [partnershipId],
    );
    assert.deepEqual(cooldowns.rows, [
      {
        account_id: remaining.accountId,
        reason: "partner_account_deleted",
        exact_duration: true,
      },
    ]);

    const notice = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM account_notifications WHERE recipient_account_id = $1 AND partnership_id = $2 AND event_type = 'partner_account_deleted'",
      [remaining.accountId, partnershipId],
    );
    assert.equal(notice.rows[0]?.count, "1");
  } finally {
    await closeDatabasePool(database);
  }
});

test("P3 equal breakup and deletion deadlines resolve to breakup and preserve serious email through cleanup", async () => {
  const database = requireDisposableDatabase();
  try {
    await reset(database);
    const now = new Date();
    const sharedDeadline = new Date(now.getTime() - 60_000);
    const initiatedAt = new Date(sharedDeadline.getTime() - 7 * 24 * 60 * 60_000);
    const requestedAt = new Date(sharedDeadline.getTime() - 7 * 24 * 60 * 60_000);
    const deleting = await account(database, "p3-worker-equal-a", initiatedAt);
    const remaining = await account(database, "p3-worker-equal-b", initiatedAt);
    const partnershipId = randomUUID();
    const breakupId = randomUUID();

    await partnership(database, {
      partnershipId,
      firstAccountId: deleting.accountId,
      secondAccountId: remaining.accountId,
      state: "breakup_pending",
      generation: 2n,
      at: initiatedAt,
    });
    await breakup(database, {
      breakupId,
      partnershipId,
      initiatorAccountId: deleting.accountId,
      initiatedAt,
      finalDeadline: sharedDeadline,
      generation: 2n,
    });
    await requestAccountDeletion(database.pool, {
      id: randomUUID(),
      accountId: deleting.accountId,
      requestedAt,
      recoverUntil: sharedDeadline,
      generation: 1n,
    });
    await insertScheduledAction(database.pool, {
      id: randomUUID(),
      actionType: "partnership_breakup_finalize",
      aggregateType: "breakup_process",
      aggregateId: breakupId,
      executeAt: sharedDeadline,
      expectedGeneration: 2n,
      deduplicationKey: "p3-equal-breakup:" + breakupId,
      payload: { partnershipId },
      payloadVersion: 1,
    });
    await insertScheduledAction(database.pool, {
      id: randomUUID(),
      actionType: "account_deletion_finalize",
      aggregateType: "account",
      aggregateId: deleting.accountId,
      executeAt: sharedDeadline,
      expectedGeneration: 1n,
      deduplicationKey: "p3-equal-delete:" + deleting.accountId,
      payload: {},
      payloadVersion: 1,
    });

    assert.equal(await runScheduled(database, "p3-equal-deadline-worker"), 2);

    const state = await database.pool.query<{
      termination_reason: string | null;
      terminated_at: Date | null;
      account_status: string;
    }>(
      "SELECT partnership.termination_reason, partnership.terminated_at, account.status AS account_status FROM partnerships partnership JOIN accounts account ON account.id = $2 WHERE partnership.id = $1",
      [partnershipId, deleting.accountId],
    );
    assert.equal(state.rows[0]?.termination_reason, "breakup");
    assert.equal(state.rows[0]?.terminated_at?.toISOString(), sharedDeadline.toISOString());
    assert.equal(state.rows[0]?.account_status, "deleted");

    const emailBeforeCleanup = await database.pool.query<{
      account_id: string | null;
      destination_email: string;
      template: string;
    }>(
      "SELECT account_id, destination_email, template FROM security_email_deliveries WHERE destination_email = $1 AND template = 'partnership_dissolved' ORDER BY created_at DESC LIMIT 1",
      [deleting.email],
    );
    assert.equal(emailBeforeCleanup.rowCount, 1);
    assert.equal(emailBeforeCleanup.rows[0]?.account_id, null);

    assert.equal(await runDeletion(database, "p3-equal-cleanup"), 4);

    const emailAfterCleanup = await database.pool.query<{
      account_id: string | null;
      destination_email: string;
      template: string;
    }>(
      "SELECT account_id, destination_email, template FROM security_email_deliveries WHERE destination_email = $1 AND template = 'partnership_dissolved' ORDER BY created_at DESC LIMIT 1",
      [deleting.email],
    );
    assert.equal(emailAfterCleanup.rowCount, 1);
    assert.equal(emailAfterCleanup.rows[0]?.account_id, null);

    const cooldowns = await database.pool.query<{
      reason: string;
      exact_duration: boolean;
    }>(
      "SELECT reason, eligible_at = created_at + interval '3 months' AS exact_duration FROM account_partner_eligibility WHERE source_partnership_id = $1",
      [partnershipId],
    );
    assert.equal(cooldowns.rowCount, 2);
    assert.ok(cooldowns.rows.every((row) => row.reason === "breakup_dissolution"));
    assert.ok(cooldowns.rows.every((row) => row.exact_duration));
  } finally {
    await closeDatabasePool(database);
  }
});
