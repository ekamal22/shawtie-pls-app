import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  closeDatabasePool,
  createDatabasePool,
  databaseConfigFromEnv,
  insertAccount,
  insertAccountProfile,
  insertPartnerRequest,
  insertScheduledAction,
  type DatabasePool,
} from "@shawtie/db";
import { createDefaultScheduledHandlers } from "../src/auth/default-account-handlers.ts";
import { runScheduledBatch } from "../src/scheduled/scheduled-consumer.ts";
import { defaultRetryPolicy } from "../src/runtime/retry-policy.ts";

function requireDisposableDatabase(): DatabasePool {
  if (process.env.DB_TEST_CONFIRM !== "1") {
    throw new Error("DB_TEST_CONFIRM=1 is required for disposable P1 worker tests");
  }
  return createDatabasePool({
    ...databaseConfigFromEnv(),
    applicationName: "shawtie-p1-worker-test",
    maxConnections: 8,
  });
}

async function reset(database: DatabasePool): Promise<void> {
  await database.pool.query(
    "TRUNCATE TABLE accounts, partnerships, scheduled_actions CASCADE",
  );
}

async function account(database: DatabasePool, username: string, at: Date): Promise<string> {
  const id = randomUUID();
  await insertAccount(database.pool, {
    id,
    usernameNormalized: username,
    usernameDisplay: username,
    dateOfBirth: "2000-01-01",
    createdAt: at,
  });
  await insertAccountProfile(database.pool, { accountId: id, displayName: username, at });
  return id;
}

test("P1 scheduled expiry persists the exact request deadline", async () => {
  const database = requireDisposableDatabase();
  try {
    await reset(database);
    const now = new Date();
    const createdAt = new Date(now.getTime() - 8 * 24 * 60 * 60_000);
    const expiresAt = new Date(createdAt.getTime() + 7 * 24 * 60 * 60_000);
    const sender = await account(database, "p1-worker-a", createdAt);
    const recipient = await account(database, "p1-worker-b", createdAt);
    const requestId = randomUUID();

    await insertPartnerRequest(database.pool, {
      id: requestId,
      senderAccountId: sender,
      recipientAccountId: recipient,
      relationshipStartDate: "2025-01-01",
      createdAt,
      expiresAt,
    });
    await insertScheduledAction(database.pool, {
      id: randomUUID(),
      actionType: "partner_request_expire",
      aggregateType: "partner_request",
      aggregateId: requestId,
      executeAt: expiresAt,
      deduplicationKey: "partner-request-expire:" + requestId,
      payload: {},
      payloadVersion: 1,
    });

    const processed = await runScheduledBatch(
      database,
      "p1-expiry-worker",
      createDefaultScheduledHandlers(),
      { batchSize: 10, concurrency: 1, leaseMs: 60_000, retryPolicy: defaultRetryPolicy },
    );
    assert.equal(processed, 1);

    const request = await database.pool.query<{
      status: string;
      expires_at: Date;
      expired_at: Date;
    }>("SELECT status, expires_at, expired_at FROM partner_requests WHERE id = $1", [requestId]);
    assert.equal(request.rows[0]?.status, "expired");
    assert.equal(
      request.rows[0]?.expired_at.toISOString(),
      request.rows[0]?.expires_at.toISOString(),
    );

    const action = await database.pool.query<{ status: string }>(
      "SELECT status FROM scheduled_actions WHERE aggregate_id = $1",
      [requestId],
    );
    assert.equal(action.rows[0]?.status, "completed");
  } finally {
    await closeDatabasePool(database);
  }
});

test("P1 scheduled expiry is a no-op after the request became terminal", async () => {
  const database = requireDisposableDatabase();
  try {
    await reset(database);
    const now = new Date();
    const createdAt = new Date(now.getTime() - 8 * 24 * 60 * 60_000);
    const expiresAt = new Date(createdAt.getTime() + 7 * 24 * 60 * 60_000);
    const sender = await account(database, "p1-worker-terminal-a", createdAt);
    const recipient = await account(database, "p1-worker-terminal-b", createdAt);
    const requestId = randomUUID();

    await insertPartnerRequest(database.pool, {
      id: requestId,
      senderAccountId: sender,
      recipientAccountId: recipient,
      relationshipStartDate: "2025-01-01",
      createdAt,
      expiresAt,
    });
    await database.pool.query(
      "UPDATE partner_requests " +
        "SET status = 'cancelled', cancelled_at = transaction_timestamp() " +
        "WHERE id = $1",
      [requestId],
    );
    await insertScheduledAction(database.pool, {
      id: randomUUID(),
      actionType: "partner_request_expire",
      aggregateType: "partner_request",
      aggregateId: requestId,
      executeAt: expiresAt,
      deduplicationKey: "partner-request-expire:" + requestId,
      payload: {},
      payloadVersion: 1,
    });

    await runScheduledBatch(database, "p1-terminal-worker", createDefaultScheduledHandlers(), {
      batchSize: 10,
      concurrency: 1,
      leaseMs: 60_000,
      retryPolicy: defaultRetryPolicy,
    });

    const request = await database.pool.query<{
      status: string;
      expired_at: Date | null;
    }>("SELECT status, expired_at FROM partner_requests WHERE id = $1", [requestId]);
    assert.equal(request.rows[0]?.status, "cancelled");
    assert.equal(request.rows[0]?.expired_at, null);
  } finally {
    await closeDatabasePool(database);
  }
});
