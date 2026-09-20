import assert from "node:assert/strict";
import test from "node:test";
import {
  appendLifecycleEvent,
  claimOutboxEvents,
  closeDatabasePool,
  createDatabasePool,
  createDeletionManifest,
  databaseConfigFromEnv,
  deliverOutboxEvent,
  getClockTimestamp,
  getTransactionTimestamp,
  insertOutboxEvent,
  insertScheduledAction,
  renewOutboxLease,
  resumeFailedDeletionTarget,
  validateLifecycleMetadata,
  withTransaction,
} from "@shawtie/db";
import { DeletionHandlerRegistry } from "../src/deletion/deletion-handler-registry.ts";
import { runDeletionBatch } from "../src/deletion/deletion-consumer.ts";
import { OutboxHandlerRegistry } from "../src/outbox/outbox-handler-registry.ts";
import { runOutboxBatch } from "../src/outbox/outbox-consumer.ts";
import {
  PermanentWorkerError,
  RetryableWorkerError,
} from "../src/runtime/errors.ts";
import { WorkerApplication } from "../src/runtime/worker-application.ts";
import { ScheduledActionHandlerRegistry } from "../src/scheduled/scheduled-handler-registry.ts";
import { runScheduledBatch } from "../src/scheduled/scheduled-consumer.ts";

if (process.env.DB_TEST_CONFIRM !== "1") {
  throw new Error(
    "Refusing F2 integration tests. Set DB_TEST_CONFIRM=1 only for a disposable database.",
  );
}

const database = createDatabasePool({
  ...databaseConfigFromEnv(),
  applicationName: "shawtie-f2-worker-tests",
  maxConnections: 12,
});

test.after(async () => {
  await closeDatabasePool(database);
});

const partnershipId = "f2400000-0000-4000-8000-000000000001";
const aggregateId = partnershipId;
const retryPolicy = {
  baseDelayMs: 1,
  maxDelayMs: 2,
  jitterRatio: 0,
} as const;
const consumerOptions = {
  batchSize: 20,
  concurrency: 1,
  leaseMs: 10_000,
  retryPolicy,
};

async function resetPartnership(): Promise<void> {
  await database.pool.query(
    "DELETE FROM partnership_lifecycle_events WHERE partnership_id = $1",
    [partnershipId],
  );
  await database.pool.query(
    "DELETE FROM scheduled_actions WHERE aggregate_id = $1",
    [partnershipId],
  );
  await database.pool.query(
    "DELETE FROM outbox_events WHERE aggregate_id = $1",
    [partnershipId],
  );
  await database.pool.query(
    "DELETE FROM partnerships WHERE id = $1",
    [partnershipId],
  );
  await database.pool.query(
    `INSERT INTO partnerships (
       id, relationship_start_date, lifecycle_state, version, generation,
       activated_at
     ) VALUES ($1, DATE '2026-01-01', 'active', 1, 2, clock_timestamp())`,
    [partnershipId],
  );
}

test("transaction kernel uses Read Committed, configured timeouts, stable business time, and advancing lease time", async () => {
  assert.ok(database.pool.listenerCount("error") > 0);

  await withTransaction(database, async (transaction) => {
    const isolation = await transaction.query<{ transaction_isolation: string }>(
      "SHOW transaction_isolation",
    );
    assert.equal(isolation.rows[0]?.transaction_isolation, "read committed");

    const settings = await transaction.query<{
      statement_timeout: string;
      lock_timeout: string;
      idle_in_transaction_session_timeout: string;
    }>(
      `SELECT
         current_setting('statement_timeout') AS statement_timeout,
         current_setting('lock_timeout') AS lock_timeout,
         current_setting('idle_in_transaction_session_timeout')
           AS idle_in_transaction_session_timeout`,
    );
    assert.equal(settings.rows[0]?.statement_timeout, "15s");
    assert.equal(settings.rows[0]?.lock_timeout, "5s");
    assert.equal(settings.rows[0]?.idle_in_transaction_session_timeout, "30s");

    const businessA = await getTransactionTimestamp(transaction);
    const clockA = await getClockTimestamp(transaction);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const businessB = await getTransactionTimestamp(transaction);
    const clockB = await getClockTimestamp(transaction);

    assert.equal(businessA.getTime(), businessB.getTime());
    assert.ok(clockB.getTime() > clockA.getTime());
  });
});

test("transaction kernel retries the whole callback after a retryable SQLSTATE", async () => {
  let attempts = 0;

  const value = await withTransaction(database, async (transaction) => {
    attempts += 1;
    await transaction.query("SELECT 1");
    if (attempts === 1) {
      throw Object.assign(new Error("simulated serialization failure"), {
        code: "40001",
      });
    }
    return "committed";
  });

  assert.equal(value, "committed");
  assert.equal(attempts, 2);
});

test("scheduled action generation guard rejects stale work and commits matching work", async () => {
  await resetPartnership();

  const staleId = "f2410000-0000-4000-8000-000000000001";
  const currentId = "f2410000-0000-4000-8000-000000000002";
  const registry = new ScheduledActionHandlerRegistry();
  let executions = 0;

  registry.register({
    actionType: "test.partnership.mutate",
    payloadVersion: 1,
    async loadCurrentGeneration(transaction) {
      const result = await transaction.query<{ generation: string }>(
        "SELECT generation::text AS generation FROM partnerships WHERE id = $1 FOR UPDATE",
        [partnershipId],
      );
      return BigInt(result.rows[0]?.generation ?? "0");
    },
    async execute({ transaction }) {
      executions += 1;
      await transaction.query(
        "UPDATE partnerships SET version = version + 1 WHERE id = $1",
        [partnershipId],
      );
    },
  });

  await insertScheduledAction(database.pool, {
    id: staleId,
    actionType: "test.partnership.mutate",
    aggregateType: "partnership",
    aggregateId,
    executeAt: new Date(Date.now() - 1_000),
    expectedGeneration: 1n,
    deduplicationKey: "f2-generation-stale",
  });

  await runScheduledBatch(
    database,
    "generation-worker",
    registry,
    consumerOptions,
  );

  let status = await database.pool.query<{ status: string }>(
    "SELECT status FROM scheduled_actions WHERE id = $1",
    [staleId],
  );
  assert.equal(status.rows[0]?.status, "stale");
  assert.equal(executions, 0);

  await insertScheduledAction(database.pool, {
    id: currentId,
    actionType: "test.partnership.mutate",
    aggregateType: "partnership",
    aggregateId,
    executeAt: new Date(Date.now() - 1_000),
    expectedGeneration: 2n,
    deduplicationKey: "f2-generation-current",
  });

  await runScheduledBatch(
    database,
    "generation-worker",
    registry,
    consumerOptions,
  );

  status = await database.pool.query<{ status: string }>(
    "SELECT status FROM scheduled_actions WHERE id = $1",
    [currentId],
  );
  const partnership = await database.pool.query<{ version: string }>(
    "SELECT version::text AS version FROM partnerships WHERE id = $1",
    [partnershipId],
  );

  assert.equal(status.rows[0]?.status, "completed");
  assert.equal(partnership.rows[0]?.version, "2");
  assert.equal(executions, 1);
});

test("scheduled action with unknown payload version fails closed", async () => {
  await resetPartnership();

  const actionId = "f2410000-0000-4000-8000-000000000004";
  const registry = new ScheduledActionHandlerRegistry();
  registry.register({
    actionType: "test.versioned",
    payloadVersion: 1,
    async execute() {},
  });

  await insertScheduledAction(database.pool, {
    id: actionId,
    actionType: "test.versioned",
    aggregateType: "partnership",
    aggregateId,
    executeAt: new Date(Date.now() - 1_000),
    deduplicationKey: "f2-scheduled-unsupported-version",
    payloadVersion: 2,
  });

  await runScheduledBatch(
    database,
    "version-worker",
    registry,
    consumerOptions,
  );

  const action = await database.pool.query<{
    status: string;
    last_error_code: string | null;
  }>(
    "SELECT status, last_error_code FROM scheduled_actions WHERE id = $1",
    [actionId],
  );

  assert.equal(action.rows[0]?.status, "failed");
  assert.equal(
    action.rows[0]?.last_error_code,
    "UNSUPPORTED_ACTION_OR_PAYLOAD_VERSION",
  );
});

test("scheduled handler failure rolls back authoritative mutation before retry scheduling", async () => {
  await resetPartnership();

  const actionId = "f2410000-0000-4000-8000-000000000003";
  const registry = new ScheduledActionHandlerRegistry();
  registry.register({
    actionType: "test.rollback",
    payloadVersion: 1,
    async execute({ transaction }) {
      await transaction.query(
        "UPDATE partnerships SET version = version + 100 WHERE id = $1",
        [partnershipId],
      );
      throw new RetryableWorkerError("SIMULATED_HANDLER_FAILURE");
    },
  });

  await insertScheduledAction(database.pool, {
    id: actionId,
    actionType: "test.rollback",
    aggregateType: "partnership",
    aggregateId,
    executeAt: new Date(Date.now() - 1_000),
    deduplicationKey: "f2-rollback",
  });

  await runScheduledBatch(database, "rollback-worker", registry, consumerOptions);

  const partnership = await database.pool.query<{ version: string }>(
    "SELECT version::text AS version FROM partnerships WHERE id = $1",
    [partnershipId],
  );
  const action = await database.pool.query<{ status: string }>(
    "SELECT status FROM scheduled_actions WHERE id = $1",
    [actionId],
  );

  assert.equal(partnership.rows[0]?.version, "1");
  assert.equal(action.rows[0]?.status, "pending");
});

test("outbox state change is atomic with authoritative mutation", async () => {
  await resetPartnership();

  const rollbackEventId = "f2420000-0000-4000-8000-000000000001";
  await assert.rejects(
    withTransaction(database, async (transaction) => {
      await transaction.query(
        "UPDATE partnerships SET version = version + 1 WHERE id = $1",
        [partnershipId],
      );
      await insertOutboxEvent(transaction, {
        id: rollbackEventId,
        eventType: "test.atomic",
        aggregateType: "partnership",
        aggregateId,
        deduplicationKey: "f2-outbox-rollback",
      });
      throw new Error("force rollback");
    }),
  );

  let partnership = await database.pool.query<{ version: string }>(
    "SELECT version::text AS version FROM partnerships WHERE id = $1",
    [partnershipId],
  );
  let event = await database.pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM outbox_events WHERE id = $1",
    [rollbackEventId],
  );
  assert.equal(partnership.rows[0]?.version, "1");
  assert.equal(event.rows[0]?.count, "0");

  const committedEventId = "f2420000-0000-4000-8000-000000000002";
  await withTransaction(database, async (transaction) => {
    await transaction.query(
      "UPDATE partnerships SET version = version + 1 WHERE id = $1",
      [partnershipId],
    );
    await insertOutboxEvent(transaction, {
      id: committedEventId,
      eventType: "test.atomic",
      aggregateType: "partnership",
      aggregateId,
      deduplicationKey: "f2-outbox-commit",
    });
  });

  partnership = await database.pool.query<{ version: string }>(
    "SELECT version::text AS version FROM partnerships WHERE id = $1",
    [partnershipId],
  );
  event = await database.pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM outbox_events WHERE id = $1",
    [committedEventId],
  );
  assert.equal(partnership.rows[0]?.version, "2");
  assert.equal(event.rows[0]?.count, "1");
});

test("outbox is at-least-once, duplicate-safe, versioned, and fenced", async () => {
  await resetPartnership();

  const duplicateEventId = "f2420000-0000-4000-8000-000000000003";
  const unsupportedEventId = "f2420000-0000-4000-8000-000000000004";
  const registry = new OutboxHandlerRegistry();
  let calls = 0;
  const providerKeys = new Set<string>();

  registry.register({
    eventType: "test.delivery",
    payloadVersion: 1,
    async deliver({ event }) {
      calls += 1;
      providerKeys.add(event.id);
      if (calls === 1) {
        throw new RetryableWorkerError("SIMULATED_POST_DELIVERY_CRASH");
      }
    },
  });

  await insertOutboxEvent(database.pool, {
    id: duplicateEventId,
    eventType: "test.delivery",
    aggregateType: "partnership",
    aggregateId,
    deduplicationKey: "f2-outbox-duplicate",
    payloadVersion: 1,
  });

  await runOutboxBatch(
    database,
    "outbox-worker",
    registry,
    new AbortController().signal,
    consumerOptions,
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  await runOutboxBatch(
    database,
    "outbox-worker",
    registry,
    new AbortController().signal,
    consumerOptions,
  );

  const delivered = await database.pool.query<{ status: string }>(
    "SELECT status FROM outbox_events WHERE id = $1",
    [duplicateEventId],
  );
  assert.equal(delivered.rows[0]?.status, "delivered");
  assert.equal(calls, 2);
  assert.equal(providerKeys.size, 1);

  await insertOutboxEvent(database.pool, {
    id: unsupportedEventId,
    eventType: "test.delivery",
    aggregateType: "partnership",
    aggregateId,
    deduplicationKey: "f2-outbox-unsupported-version",
    payloadVersion: 2,
  });

  await runOutboxBatch(
    database,
    "outbox-worker",
    registry,
    new AbortController().signal,
    consumerOptions,
  );

  const unsupported = await database.pool.query<{
    status: string;
    last_error_code: string | null;
  }>(
    "SELECT status, last_error_code FROM outbox_events WHERE id = $1",
    [unsupportedEventId],
  );
  assert.equal(unsupported.rows[0]?.status, "failed");
  assert.equal(
    unsupported.rows[0]?.last_error_code,
    "UNSUPPORTED_EVENT_OR_PAYLOAD_VERSION",
  );

  const renewableId = "f2420000-0000-4000-8000-000000000006";
  await insertOutboxEvent(database.pool, {
    id: renewableId,
    eventType: "test.delivery",
    aggregateType: "partnership",
    aggregateId,
    deduplicationKey: "f2-outbox-current-renewal",
  });

  const renewableClaim = (await claimOutboxEvents(
    database.pool,
    20,
    "lease-owner",
    10_000,
  )).find((item) => item.id === renewableId);
  assert.ok(renewableClaim);
  assert.equal(
    await renewOutboxLease(
      database.pool,
      {
        id: renewableClaim.id,
        claimedBy: "lease-owner",
        claimVersion: renewableClaim.claimVersion,
      },
      20_000,
    ),
    true,
  );
  assert.equal(
    await deliverOutboxEvent(database.pool, {
      id: renewableClaim.id,
      claimedBy: "lease-owner",
      claimVersion: renewableClaim.claimVersion,
    }),
    true,
  );

  const fencedId = "f2420000-0000-4000-8000-000000000005";
  await insertOutboxEvent(database.pool, {
    id: fencedId,
    eventType: "test.delivery",
    aggregateType: "partnership",
    aggregateId,
    deduplicationKey: "f2-outbox-fencing",
  });

  const firstClaim = (await claimOutboxEvents(
    database.pool,
    1,
    "old-worker",
    2,
  )).find((item) => item.id === fencedId);
  assert.ok(firstClaim);
  await new Promise((resolve) => setTimeout(resolve, 10));

  const secondClaim = (await claimOutboxEvents(
    database.pool,
    20,
    "new-worker",
    10_000,
  )).find((item) => item.id === fencedId);
  assert.ok(secondClaim);
  assert.ok(secondClaim.claimVersion > firstClaim.claimVersion);

  assert.equal(
    await deliverOutboxEvent(database.pool, {
      id: firstClaim.id,
      claimedBy: "old-worker",
      claimVersion: firstClaim.claimVersion,
    }),
    false,
  );
  assert.equal(
    await renewOutboxLease(
      database.pool,
      {
        id: firstClaim.id,
        claimedBy: "old-worker",
        claimVersion: firstClaim.claimVersion,
      },
      10_000,
    ),
    false,
  );
  assert.equal(
    await deliverOutboxEvent(database.pool, {
      id: secondClaim.id,
      claimedBy: "new-worker",
      claimVersion: secondClaim.claimVersion,
    }),
    true,
  );
});

test("lifecycle event ledger is append-only and metadata rejects content-shaped fields", async () => {
  await resetPartnership();

  const eventId = "f2430000-0000-4000-8000-000000000001";
  await appendLifecycleEvent(database.pool, {
    id: eventId,
    partnershipId,
    eventType: "test.lifecycle",
    aggregateVersion: 1n,
    metadata: {
      reason: "test",
      generation: 2,
      status: "active",
    },
  });

  await assert.rejects(
    database.pool.query(
      "UPDATE partnership_lifecycle_events SET event_type = 'changed' WHERE id = $1",
      [eventId],
    ),
  );

  assert.throws(() => {
    validateLifecycleMetadata({
      message: "private content must not enter the lifecycle ledger",
    });
  });
});

test("deletion manifest resumes after partial failure while access stays revoked", async () => {
  const manifestId = "f2440000-0000-4000-8000-000000000001";
  const targetA = "f2440000-0000-4000-8000-000000000011";
  const targetB = "f2440000-0000-4000-8000-000000000012";

  await database.pool.query(
    "DELETE FROM deletion_manifests WHERE id = $1",
    [manifestId],
  );
  await createDeletionManifest(database.pool, {
    id: manifestId,
    subjectType: "partnership",
    subjectId: partnershipId,
    reason: "test",
    accessRevokedAt: new Date(),
    targets: [
      { id: targetA, targetType: "test.blob", targetKey: "a" },
      { id: targetB, targetType: "test.blob", targetKey: "b" },
    ],
  });

  const attempts = new Map<string, number>();
  const registry = new DeletionHandlerRegistry();
  registry.register({
    targetType: "test.blob",
    async execute({ target }) {
      const count = (attempts.get(target.targetKey) ?? 0) + 1;
      attempts.set(target.targetKey, count);
      if (target.targetKey === "b" && count === 1) {
        throw new RetryableWorkerError("SIMULATED_DELETE_FAILURE");
      }
    },
  });

  await runDeletionBatch(
    database,
    "deletion-worker-a",
    registry,
    new AbortController().signal,
    consumerOptions,
  );

  let manifest = await database.pool.query<{
    status: string;
    access_revoked_at: Date | null;
  }>(
    "SELECT status, access_revoked_at FROM deletion_manifests WHERE id = $1",
    [manifestId],
  );
  assert.equal(manifest.rows[0]?.status, "processing");
  assert.ok(manifest.rows[0]?.access_revoked_at);

  await new Promise((resolve) => setTimeout(resolve, 5));

  await runDeletionBatch(
    database,
    "deletion-worker-b",
    registry,
    new AbortController().signal,
    consumerOptions,
  );

  manifest = await database.pool.query<{
    status: string;
    access_revoked_at: Date | null;
  }>(
    "SELECT status, access_revoked_at FROM deletion_manifests WHERE id = $1",
    [manifestId],
  );
  assert.equal(manifest.rows[0]?.status, "completed");
  assert.ok(manifest.rows[0]?.access_revoked_at);
  assert.equal(attempts.get("a"), 1);
  assert.equal(attempts.get("b"), 2);
});

test("permanently failed deletion target can be repaired and resumed without restoring access", async () => {
  const manifestId = "f2440000-0000-4000-8000-000000000002";
  const targetId = "f2440000-0000-4000-8000-000000000021";

  await database.pool.query(
    "DELETE FROM deletion_manifests WHERE id = $1",
    [manifestId],
  );
  await createDeletionManifest(database.pool, {
    id: manifestId,
    subjectType: "partnership",
    subjectId: partnershipId,
    reason: "test-permanent",
    accessRevokedAt: new Date(),
    targets: [
      { id: targetId, targetType: "test.repairable", targetKey: "repairable" },
    ],
  });

  const failingRegistry = new DeletionHandlerRegistry();
  failingRegistry.register({
    targetType: "test.repairable",
    async execute() {
      throw new PermanentWorkerError("SIMULATED_PERMANENT_DELETE_FAILURE");
    },
  });

  await runDeletionBatch(
    database,
    "deletion-failing-worker",
    failingRegistry,
    new AbortController().signal,
    consumerOptions,
  );

  let manifest = await database.pool.query<{
    status: string;
    access_revoked_at: Date | null;
  }>(
    "SELECT status, access_revoked_at FROM deletion_manifests WHERE id = $1",
    [manifestId],
  );
  assert.equal(manifest.rows[0]?.status, "failed");
  assert.ok(manifest.rows[0]?.access_revoked_at);

  assert.equal(
    await resumeFailedDeletionTarget(database.pool, targetId),
    manifestId,
  );

  const successfulRegistry = new DeletionHandlerRegistry();
  successfulRegistry.register({
    targetType: "test.repairable",
    async execute() {},
  });

  await runDeletionBatch(
    database,
    "deletion-repair-worker",
    successfulRegistry,
    new AbortController().signal,
    consumerOptions,
  );

  manifest = await database.pool.query<{
    status: string;
    access_revoked_at: Date | null;
  }>(
    "SELECT status, access_revoked_at FROM deletion_manifests WHERE id = $1",
    [manifestId],
  );
  assert.equal(manifest.rows[0]?.status, "completed");
  assert.ok(manifest.rows[0]?.access_revoked_at);
});

test("worker with no registered product handlers stays inert and shuts down cleanly", async () => {
  const isolatedDatabase = createDatabasePool({
    ...databaseConfigFromEnv(),
    applicationName: "shawtie-f2-shutdown-test",
    maxConnections: 2,
  });
  const application = new WorkerApplication({
    database: isolatedDatabase,
    workerId: "shutdown-worker",
    config: {
      batchSize: 5,
      concurrency: 1,
      pollIntervalMs: 5,
      leaseMs: 1_000,
      shutdownGraceMs: 1_000,
    },
    scheduledHandlers: new ScheduledActionHandlerRegistry(),
    outboxHandlers: new OutboxHandlerRegistry(),
    deletionHandlers: new DeletionHandlerRegistry(),
  });

  const running = application.run();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await application.stop();
  await running;
});
