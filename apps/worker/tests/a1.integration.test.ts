import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  closeDatabasePool,
  createDatabasePool,
  databaseConfigFromEnv,
  insertAccount,
  insertAccountProfile,
  insertCurrentEmail,
  insertEmailChallenge,
  insertOutboxEvent,
  insertPasswordCredential,
  insertScheduledAction,
  requestAccountDeletion,
  type DatabasePool,
} from "@shawtie/db";
import { OutboxHandlerRegistry } from "../src/outbox/outbox-handler-registry.ts";
import { runOutboxBatch } from "../src/outbox/outbox-consumer.ts";
import { runScheduledBatch } from "../src/scheduled/scheduled-consumer.ts";
import { runDeletionBatch } from "../src/deletion/deletion-consumer.ts";
import {
  createDefaultDeletionHandlers,
  createDefaultScheduledHandlers,
} from "../src/auth/default-account-handlers.ts";
import { createEmailChallengeOutboxHandler } from "../src/auth/auth-email-handlers.ts";
import { WorkerAuthKeyRing } from "../src/auth/worker-auth-key-ring.ts";
import type { EmailDeliveryPort, SecurityEmailMessage } from "../src/auth/email-delivery-port.ts";
import { defaultRetryPolicy } from "../src/runtime/retry-policy.ts";

function requireDisposableDatabase(): DatabasePool {
  if (process.env.DB_TEST_CONFIRM !== "1") {
    throw new Error("DB_TEST_CONFIRM=1 is required for disposable A1 integration tests");
  }
  return createDatabasePool({
    ...databaseConfigFromEnv(),
    applicationName: "shawtie-a1-worker-test",
    maxConnections: 12,
  });
}

async function resetWorkerIntegrationState(database: DatabasePool): Promise<void> {
  await database.pool.query(
    "TRUNCATE TABLE accounts, registration_intents, outbox_events, scheduled_actions, deletion_manifests CASCADE",
  );
}

const key = Buffer.alloc(32, 7);

class FakeEmail implements EmailDeliveryPort {
  readonly messages: SecurityEmailMessage[] = [];
  async sendSecurityEmail(message: SecurityEmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

test("A1 auth email outbox derives code without storing raw code", async () => {
  const database = requireDisposableDatabase();
  try {
    await resetWorkerIntegrationState(database);
    const accountId = randomUUID();
    const challengeId = randomUUID();
    const nonce = Buffer.alloc(32, 9);
    const ring = new WorkerAuthKeyRing({ activeVersion: 1, keys: new Map([[1, key]]) });
    const code = ring.deriveEmailCode(challengeId, "password_recovery", nonce, 1);

    await insertAccount(database.pool, {
      id: accountId,
      usernameNormalized: "worker-email",
      usernameDisplay: "worker-email",
      dateOfBirth: "2000-01-01",
      createdAt: new Date(),
    });
    await insertEmailChallenge(database.pool, {
      id: challengeId,
      accountId,
      purpose: "password_recovery",
      emailNormalized: "worker@example.test",
      emailDisplay: "worker@example.test",
      verifier: Buffer.alloc(32, 1),
      challengeNonce: nonce,
      expiresAt: new Date(Date.now() + 10 * 60_000),
      verifierKeyVersion: 1,
    });
    await insertOutboxEvent(database.pool, {
      id: randomUUID(),
      eventType: "auth.email_challenge",
      aggregateType: "email_verification",
      aggregateId: challengeId,
      deduplicationKey: "a1-worker-email-" + challengeId,
      payload: { challengeId },
    });

    const fake = new FakeEmail();
    const registry = new OutboxHandlerRegistry();
    registry.register(createEmailChallengeOutboxHandler(database, fake, ring));
    await runOutboxBatch(
      database,
      "a1-email-worker",
      registry,
      new AbortController().signal,
      { batchSize: 10, concurrency: 1, leaseMs: 60_000, retryPolicy: defaultRetryPolicy },
    );
    assert.equal(fake.messages.length, 1);
    assert.equal(fake.messages[0]?.parameters.code, code);

    const outboxPayload = await database.pool.query<{ payload: unknown }>(
      "SELECT payload FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'auth.email_challenge' LIMIT 1",
      [challengeId],
    );
    assert.equal(JSON.stringify(outboxPayload.rows[0]?.payload).includes(code), false);
    assert.deepEqual(outboxPayload.rows[0]?.payload, { challengeId });

    const columns = await database.pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'email_verifications' AND column_name LIKE '%code%'`,
    );
    assert.equal(columns.rowCount, 0);
  } finally {
    await closeDatabasePool(database);
  }
});

test("A1 deletion finalizer revokes account permanently and deletion worker scrubs auth data", async () => {
  const database = requireDisposableDatabase();
  try {
    await resetWorkerIntegrationState(database);
    const accountId = randomUUID();
    const now = new Date();
    const requestedAt = new Date(now.getTime() - 8 * 24 * 60 * 60_000);
    const recoverUntil = new Date(requestedAt.getTime() + 7 * 24 * 60 * 60_000);

    await insertAccount(database.pool, {
      id: accountId,
      usernameNormalized: "delete-worker",
      usernameDisplay: "delete-worker",
      dateOfBirth: "2000-01-01",
      createdAt: requestedAt,
    });
    await insertAccountProfile(database.pool, { accountId, displayName: "Delete Worker", at: requestedAt });
    await insertPasswordCredential(database.pool, accountId, "hash", requestedAt);
    await insertCurrentEmail(database.pool, {
      id: randomUUID(),
      accountId,
      emailNormalized: "delete-worker@example.test",
      emailDisplay: "delete-worker@example.test",
      at: requestedAt,
    });
    await requestAccountDeletion(database.pool, {
      id: randomUUID(),
      accountId,
      requestedAt,
      recoverUntil,
      generation: 1n,
    });
    await insertScheduledAction(database.pool, {
      id: randomUUID(),
      actionType: "account_deletion_finalize",
      aggregateType: "account",
      aggregateId: accountId,
      executeAt: recoverUntil,
      expectedGeneration: 1n,
      deduplicationKey: "a1-delete-finalize-" + accountId,
      payload: {},
    });

    await runScheduledBatch(
      database,
      "a1-scheduled-worker",
      createDefaultScheduledHandlers(),
      { batchSize: 10, concurrency: 1, leaseMs: 60_000, retryPolicy: defaultRetryPolicy },
    );

    const state = await database.pool.query<{ status: string }>(
      "SELECT status FROM accounts WHERE id = $1",
      [accountId],
    );
    assert.equal(state.rows[0]?.status, "deleted");

    await runDeletionBatch(
      database,
      "a1-deletion-worker",
      createDefaultDeletionHandlers(database),
      new AbortController().signal,
      { batchSize: 10, concurrency: 1, leaseMs: 60_000, retryPolicy: defaultRetryPolicy },
    );

    const credential = await database.pool.query(
      "SELECT 1 FROM account_password_credentials WHERE account_id = $1",
      [accountId],
    );
    assert.equal(credential.rowCount, 0);
    const manifest = await database.pool.query<{ status: string }>(
      "SELECT status FROM deletion_manifests WHERE subject_id = $1 ORDER BY created_at DESC LIMIT 1",
      [accountId],
    );
    assert.equal(manifest.rows[0]?.status, "completed");
  } finally {
    await closeDatabasePool(database);
  }
});


test("A1 breakup deadline wins when it precedes account deletion recovery deadline", async () => {
  const database = requireDisposableDatabase();
  try {
    await resetWorkerIntegrationState(database);
    const deletingAccountId = randomUUID();
    const remainingAccountId = randomUUID();
    const partnershipId = randomUUID();
    const breakupId = randomUUID();
    const now = new Date();
    const deletionRequestedAt = new Date(now.getTime() - 2 * 24 * 60 * 60_000);
    const recoverUntil = new Date(deletionRequestedAt.getTime() + 7 * 24 * 60 * 60_000);
    const breakupInitiatedAt = new Date(now.getTime() - 8 * 24 * 60 * 60_000);
    const breakupDeadline = new Date(breakupInitiatedAt.getTime() + 7 * 24 * 60 * 60_000);

    for (const [id, username] of [
      [deletingAccountId, "collision-delete"],
      [remainingAccountId, "collision-remain"],
    ] as const) {
      await insertAccount(database.pool, {
        id,
        usernameNormalized: username,
        usernameDisplay: username,
        dateOfBirth: "2000-01-01",
        createdAt: breakupInitiatedAt,
      });
    }

    await database.pool.query(
      `INSERT INTO partnerships (
         id, relationship_start_date, lifecycle_state, generation, version,
         activated_at, created_at, updated_at
       ) VALUES ($1, DATE '2025-01-01', 'breakup_pending', 3, 3, $2, $2, $2)`,
      [partnershipId, breakupInitiatedAt],
    );
    await database.pool.query(
      `INSERT INTO partnership_members (partnership_id, account_id, joined_at)
       VALUES ($1,$2,$4), ($1,$3,$4)`,
      [partnershipId, deletingAccountId, remainingAccountId, breakupInitiatedAt],
    );
    await database.pool.query(
      `INSERT INTO breakup_processes (
         id, partnership_id, initiated_by_account_id, initiated_at,
         initiator_cancel_until, base_deadline, final_deadline, generation
       ) VALUES (
         $1,$2,$3,$4::timestamptz,
         $4::timestamptz + interval '1 hour',
         $4::timestamptz + interval '7 days',
         $5,3
       )`,
      [breakupId, partnershipId, deletingAccountId, breakupInitiatedAt, breakupDeadline],
    );
    await requestAccountDeletion(database.pool, {
      id: randomUUID(),
      accountId: deletingAccountId,
      requestedAt: deletionRequestedAt,
      recoverUntil,
      generation: 1n,
    });
    await insertScheduledAction(database.pool, {
      id: randomUUID(),
      actionType: "account_deletion_breakup_precedence_finalize",
      aggregateType: "account",
      aggregateId: deletingAccountId,
      executeAt: breakupDeadline,
      expectedGeneration: 1n,
      deduplicationKey: "a1-breakup-precedence-" + partnershipId,
      payload: { partnershipId },
    });

    await runScheduledBatch(
      database,
      "a1-precedence-worker",
      createDefaultScheduledHandlers(),
      { batchSize: 10, concurrency: 1, leaseMs: 60_000, retryPolicy: defaultRetryPolicy },
    );

    const partnership = await database.pool.query<{
      lifecycle_state: string;
      termination_reason: string | null;
      terminated_at: Date | null;
    }>(
      "SELECT lifecycle_state, termination_reason, terminated_at FROM partnerships WHERE id = $1",
      [partnershipId],
    );
    assert.equal(partnership.rows[0]?.lifecycle_state, "terminated");
    assert.equal(partnership.rows[0]?.termination_reason, "breakup");
    assert.equal(partnership.rows[0]?.terminated_at?.toISOString(), breakupDeadline.toISOString());

    const account = await database.pool.query<{ status: string }>(
      "SELECT status FROM accounts WHERE id = $1",
      [deletingAccountId],
    );
    assert.equal(account.rows[0]?.status, "deletion_pending");

    const cooldown = await database.pool.query<{ reason: string; eligible_at: Date }>(
      `SELECT reason, eligible_at
       FROM account_partner_eligibility
       WHERE account_id = $1 AND resolved_at IS NULL`,
      [remainingAccountId],
    );
    assert.equal(cooldown.rows[0]?.reason, "breakup_dissolution");
  } finally {
    await closeDatabasePool(database);
  }
});
