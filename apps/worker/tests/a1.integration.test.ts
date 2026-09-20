import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  insertEmailChallenge,
  insertOutboxEvent,
  insertPasswordCredential,
  insertCurrentEmail,
  insertAccount,
  insertAccountProfile,
  insertScheduledAction,
  requestAccountDeletion,
} from "@shawtie/db";
import { closeDatabasePool, requireDisposableDatabase } from "@shawtie/testkit";
import { OutboxHandlerRegistry } from "../src/outbox/outbox-handler-registry.ts";
import { runOutboxBatch } from "../src/outbox/outbox-consumer.ts";
import { runScheduledBatch } from "../src/scheduled/scheduled-consumer.ts";
import { runDeletionBatch } from "../src/deletion/deletion-consumer.ts";
import {
  createDefaultDeletionHandlers,
  createDefaultScheduledHandlers,
} from "../src/auth/default-account-handlers.ts";
import {
  createEmailChallengeOutboxHandler,
  createSecurityEmailOutboxHandler,
} from "../src/auth/auth-email-handlers.ts";
import { WorkerAuthKeyRing } from "../src/auth/worker-auth-key-ring.ts";
import type { EmailDeliveryPort, SecurityEmailMessage } from "../src/auth/email-delivery-port.ts";
import { defaultRetryPolicy } from "../src/runtime/retry-policy.ts";

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
    await database.pool.query("TRUNCATE TABLE accounts, registration_intents CASCADE");
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
    await database.pool.query("TRUNCATE TABLE accounts, registration_intents CASCADE");
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
