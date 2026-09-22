import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  allocateMessageAndChangeSequence,
  closeDatabasePool,
  createDatabasePool,
  createDeletionManifest,
  databaseConfigFromEnv,
  heartbeatPresence,
  insertAccount,
  insertAccountProfile,
  insertConversationChange,
  insertMessage,
  insertOutboxEvent,
  insertPartnership,
  insertPartnershipMembers,
  insertPrimaryConversation,
  updatePartnershipNickname,
  type DatabasePool,
} from "@shawtie/db";
import { createDefaultDeletionHandlers } from "../src/auth/default-account-handlers.ts";
import { createDefaultOutboxHandlers } from "../src/outbox/default-outbox-handlers.ts";
import { runOutboxBatch } from "../src/outbox/outbox-consumer.ts";
import { runDeletionBatch } from "../src/deletion/deletion-consumer.ts";
import { defaultRetryPolicy } from "../src/runtime/retry-policy.ts";

function requireDisposableDatabase(): DatabasePool {
  if (process.env.DB_TEST_CONFIRM !== "1") {
    throw new Error("DB_TEST_CONFIRM=1 is required for disposable M1 worker tests");
  }
  return createDatabasePool({
    ...databaseConfigFromEnv(),
    applicationName: "shawtie-m1-worker-test",
    maxConnections: 12,
  });
}

async function reset(database: DatabasePool): Promise<void> {
  await database.pool.query(
    "TRUNCATE TABLE accounts, partnerships, registration_intents, outbox_events, scheduled_actions, deletion_manifests CASCADE",
  );
}

async function createMessagingFixture(database: DatabasePool) {
  const aliceId = randomUUID();
  const bobId = randomUUID();
  const partnershipId = randomUUID();
  const conversationId = randomUUID();
  const createdAt = new Date();

  for (const [accountId, username] of [
    [aliceId, "m1_worker_alice"],
    [bobId, "m1_worker_bob"],
  ] as const) {
    await insertAccount(database.pool, {
      id: accountId,
      usernameNormalized: username,
      usernameDisplay: username,
      dateOfBirth: "2000-01-01",
      createdAt,
    });
    await insertAccountProfile(database.pool, {
      accountId,
      displayName: username,
      at: createdAt,
    });
  }

  await insertPartnership(database.pool, {
    id: partnershipId,
    relationshipStartDate: "2020-01-01",
    activatedAt: createdAt,
  });
  await insertPartnershipMembers(database.pool, partnershipId, [aliceId, bobId], createdAt);
  await insertPrimaryConversation(database.pool, {
    id: conversationId,
    partnershipId,
    memberIds: [aliceId, bobId],
    createdAt,
  });

  const sequences = await allocateMessageAndChangeSequence(database.pool, conversationId);
  const messageId = randomUUID();
  await insertMessage(database.pool, {
    id: messageId,
    conversationId,
    partnershipId,
    senderAccountId: aliceId,
    senderDeviceId: null,
    replyToMessageId: null,
    idempotencyKey: "m1-worker-message-key",
    requestFingerprint: Buffer.alloc(32, 4),
    requestFingerprintVersion: 1,
    serverSequence: sequences.serverSequence,
    changeSequence: sequences.changeSequence,
    body: "worker cleanup private body",
    createdAt,
  });
  await insertConversationChange(database.pool, {
    conversationId,
    changeSequence: sequences.changeSequence,
    changeType: "message.created",
    messageId,
    contentVersion: 1n,
    createdAt,
  });
  await updatePartnershipNickname(database.pool, {
    partnershipId,
    subjectAccountId: bobId,
    actorAccountId: aliceId,
    nickname: "Worker Bee",
    expectedVersion: 1n,
    at: createdAt,
  });
  await heartbeatPresence(database.pool, {
    accountId: aliceId,
    at: createdAt,
    onlineUntil: new Date(createdAt.getTime() + 60_000),
    minRefreshBefore: new Date(createdAt.getTime() - 30_000),
  });

  return { aliceId, bobId, partnershipId, conversationId, messageId };
}

test("M1 partnership cleanup is idempotent and removes all messaging-private relational state", async () => {
  const database = requireDisposableDatabase();
  try {
    await reset(database);
    const fixture = await createMessagingFixture(database);
    const manifestId = randomUUID();

    await createDeletionManifest(database.pool, {
      id: manifestId,
      subjectType: "partnership",
      subjectId: fixture.partnershipId,
      reason: "m1_worker_cleanup",
      accessRevokedAt: new Date(),
      targets: [
        {
          id: randomUUID(),
          targetType: "partnership_relational_content",
          targetKey: fixture.partnershipId,
        },
      ],
    });

    const handlers = createDefaultDeletionHandlers(database);
    const options = {
      batchSize: 10,
      concurrency: 1,
      leaseMs: 60_000,
      retryPolicy: defaultRetryPolicy,
    };

    await runDeletionBatch(
      database,
      "m1-deletion-worker",
      handlers,
      new AbortController().signal,
      options,
    );
    await runDeletionBatch(
      database,
      "m1-deletion-worker",
      handlers,
      new AbortController().signal,
      options,
    );

    const counts = await database.pool.query<{
      conversations: string;
      messages: string;
      changes: string;
      nicknames: string;
      presence: string;
      manifest_status: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM conversations WHERE partnership_id = $1) AS conversations,
         (SELECT count(*)::text FROM messages WHERE partnership_id = $1) AS messages,
         (SELECT count(*)::text
            FROM conversation_changes
           WHERE conversation_id = $4) AS changes,
         (SELECT count(*)::text FROM partnership_chat_nicknames WHERE partnership_id = $1) AS nicknames,
         (SELECT count(*)::text FROM account_presence WHERE account_id = $2) AS presence,
         (SELECT status FROM deletion_manifests WHERE id = $3) AS manifest_status`,
      [fixture.partnershipId, fixture.aliceId, manifestId, fixture.conversationId],
    );

    assert.equal(counts.rows[0]?.conversations, "0");
    assert.equal(counts.rows[0]?.messages, "0");
    assert.equal(counts.rows[0]?.changes, "0");
    assert.equal(counts.rows[0]?.nicknames, "0");
    assert.equal(counts.rows[0]?.presence, "1");
    assert.equal(counts.rows[0]?.manifest_status, "completed");
  } finally {
    await closeDatabasePool(database);
  }
});

test("M1 permanent account cleanup removes the account-scoped presence snapshot", async () => {
  const database = requireDisposableDatabase();
  try {
    await reset(database);
    const fixture = await createMessagingFixture(database);
    const manifestId = randomUUID();

    await createDeletionManifest(database.pool, {
      id: manifestId,
      subjectType: "account",
      subjectId: fixture.aliceId,
      reason: "m1_account_cleanup",
      accessRevokedAt: new Date(),
      targets: [
        {
          id: randomUUID(),
          targetType: "account_auth_data",
          targetKey: fixture.aliceId,
        },
      ],
    });

    await runDeletionBatch(
      database,
      "m1-account-deletion-worker",
      createDefaultDeletionHandlers(database),
      new AbortController().signal,
      {
        batchSize: 10,
        concurrency: 1,
        leaseMs: 60_000,
        retryPolicy: defaultRetryPolicy,
      },
    );

    const presence = await database.pool.query(
      "SELECT 1 FROM account_presence WHERE account_id = $1",
      [fixture.aliceId],
    );
    assert.equal(presence.rowCount, 0);
  } finally {
    await closeDatabasePool(database);
  }
});

test("M1 content-free messaging invalidations are consumed as delivered before M2", async () => {
  const database = requireDisposableDatabase();
  try {
    await reset(database);
    const fixture = await createMessagingFixture(database);
    const eventId = randomUUID();

    await insertOutboxEvent(database.pool, {
      id: eventId,
      eventType: "message.created",
      aggregateType: "conversation",
      aggregateId: fixture.conversationId,
      deduplicationKey: "m1-worker-valid-invalidation",
      payload: {
        conversationId: fixture.conversationId,
        messageId: fixture.messageId,
        serverSequence: 1,
        changeSequence: 1,
        contentVersion: 1,
      },
      payloadVersion: 1,
    });

    const processed = await runOutboxBatch(
      database,
      "m1-outbox-worker",
      createDefaultOutboxHandlers(),
      new AbortController().signal,
      {
        batchSize: 10,
        concurrency: 1,
        leaseMs: 60_000,
        retryPolicy: defaultRetryPolicy,
      },
    );
    assert.equal(processed, 1);

    const row = await database.pool.query<{
      status: string;
      last_error_code: string | null;
    }>("SELECT status, last_error_code FROM outbox_events WHERE id = $1", [eventId]);
    assert.deepEqual(row.rows[0], {
      status: "delivered",
      last_error_code: null,
    });
  } finally {
    await closeDatabasePool(database);
  }
});

test("M1 invalidation sink fails closed if private content appears in the outbox payload", async () => {
  const database = requireDisposableDatabase();
  try {
    await reset(database);
    const fixture = await createMessagingFixture(database);
    const eventId = randomUUID();

    await insertOutboxEvent(database.pool, {
      id: eventId,
      eventType: "message.updated",
      aggregateType: "conversation",
      aggregateId: fixture.conversationId,
      deduplicationKey: "m1-worker-invalid-invalidation",
      payload: {
        conversationId: fixture.conversationId,
        messageId: fixture.messageId,
        changeSequence: 2,
        contentVersion: 2,
        body: "must never leave canonical message storage",
      },
      payloadVersion: 1,
    });

    const processed = await runOutboxBatch(
      database,
      "m1-outbox-worker",
      createDefaultOutboxHandlers(),
      new AbortController().signal,
      {
        batchSize: 10,
        concurrency: 1,
        leaseMs: 60_000,
        retryPolicy: defaultRetryPolicy,
      },
    );
    assert.equal(processed, 1);

    const row = await database.pool.query<{
      status: string;
      last_error_code: string | null;
    }>("SELECT status, last_error_code FROM outbox_events WHERE id = $1", [eventId]);
    assert.deepEqual(row.rows[0], {
      status: "failed",
      last_error_code: "INVALID_M1_OUTBOX_PAYLOAD",
    });
  } finally {
    await closeDatabasePool(database);
  }
});

test("M1 outbox consumer leaves unrelated event families pending and fails unknown M1 versions", async () => {
  const database = requireDisposableDatabase();
  try {
    await reset(database);
    const fixture = await createMessagingFixture(database);
    const unrelatedId = randomUUID();
    const unknownVersionId = randomUUID();

    await insertOutboxEvent(database.pool, {
      id: unrelatedId,
      eventType: "auth.security_email",
      aggregateType: "security_email_delivery",
      aggregateId: randomUUID(),
      deduplicationKey: "m1-worker-unrelated-auth-event",
      payload: { securityEmailDeliveryId: randomUUID() },
      payloadVersion: 1,
    });
    await insertOutboxEvent(database.pool, {
      id: unknownVersionId,
      eventType: "message.updated",
      aggregateType: "conversation",
      aggregateId: fixture.conversationId,
      deduplicationKey: "m1-worker-unknown-message-version",
      payload: {
        conversationId: fixture.conversationId,
        messageId: fixture.messageId,
        changeSequence: 2,
        contentVersion: 2,
      },
      payloadVersion: 99,
    });

    const processed = await runOutboxBatch(
      database,
      "m1-selective-outbox-worker",
      createDefaultOutboxHandlers(),
      new AbortController().signal,
      {
        batchSize: 10,
        concurrency: 1,
        leaseMs: 60_000,
        retryPolicy: defaultRetryPolicy,
      },
    );
    assert.equal(processed, 1);

    const rows = await database.pool.query<{
      id: string;
      status: string;
      last_error_code: string | null;
    }>(
      "SELECT id, status, last_error_code FROM outbox_events WHERE id = ANY($1::uuid[]) ORDER BY id",
      [[unrelatedId, unknownVersionId]],
    );
    const byId = new Map(rows.rows.map((row) => [row.id, row]));

    assert.deepEqual(byId.get(unrelatedId), {
      id: unrelatedId,
      status: "pending",
      last_error_code: null,
    });
    assert.deepEqual(byId.get(unknownVersionId), {
      id: unknownVersionId,
      status: "failed",
      last_error_code: "UNSUPPORTED_EVENT_OR_PAYLOAD_VERSION",
    });
  } finally {
    await closeDatabasePool(database);
  }
});
