import assert from "node:assert/strict";
import test from "node:test";
import { createApiApplication } from "../src/application.ts";
import { AuthKeyRing } from "../src/security/auth-key-ring.ts";
import {
  closeDatabasePool,
  createDatabasePool,
  databaseConfigFromEnv,
  getTransactionTimestamp,
  lockAccounts,
  terminatePartnershipLifecycle,
  withTransaction,
  type DatabasePool,
} from "@shawtie/db";
import type { ApiConfig } from "../src/config.ts";

function requireDisposableDatabase(): DatabasePool {
  if (process.env.DB_TEST_CONFIRM !== "1") {
    throw new Error("DB_TEST_CONFIRM=1 is required for disposable M1 integration tests");
  }
  return createDatabasePool({
    ...databaseConfigFromEnv(),
    applicationName: "shawtie-m1-api-test",
    maxConnections: 28,
  });
}

const rootKey = Buffer.alloc(32, 7);
const config: ApiConfig = {
  environment: "test",
  appOrigin: "http://127.0.0.1:4173",
  allowInsecureLoopbackCookies: true,
  trustedProxy: false,
  authKeys: { activeVersion: 1, keys: new Map([[1, rootKey]]) },
  partnerRequestMode: "paired",
};

type App = ReturnType<typeof createApiApplication>;

interface TestAccount {
  readonly accountId: string;
  readonly cookie: string;
  readonly username: string;
  readonly password: string;
}

function jsonHeaders(cookie?: string, key?: string): Record<string, string> {
  return {
    origin: config.appOrigin,
    "x-shawtie-csrf": "1",
    "content-type": "application/json",
    ...(cookie ? { cookie } : {}),
    ...(key ? { "idempotency-key": key } : {}),
  };
}

function mutationHeaders(cookie: string, key?: string): Record<string, string> {
  return {
    origin: config.appOrigin,
    "x-shawtie-csrf": "1",
    cookie,
    ...(key ? { "idempotency-key": key } : {}),
  };
}

function cookieHeader(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers["set-cookie"];
  const values = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  return values.map((value) => value.split(";")[0]).join("; ");
}

async function reset(database: DatabasePool): Promise<void> {
  await database.pool.query(
    "TRUNCATE TABLE accounts, partnerships, registration_intents, outbox_events, scheduled_actions, deletion_manifests CASCADE",
  );
  await database.pool.query("DELETE FROM security_rate_limit_buckets");
  await database.pool.query("DELETE FROM security_email_deliveries");
}

async function latestRegistrationCode(
  database: DatabasePool,
  registrationIntentId: string,
): Promise<string> {
  const result = await database.pool.query<{
    id: string;
    purpose: string;
    challenge_nonce: Buffer;
    verifier_key_version: number;
  }>(
    `SELECT id, purpose, challenge_nonce, verifier_key_version
     FROM email_verifications
     WHERE registration_intent_id = $1
       AND purpose = 'registration'
       AND consumed_at IS NULL
       AND superseded_at IS NULL
     LIMIT 1`,
    [registrationIntentId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Missing registration challenge");
  return new AuthKeyRing(config.authKeys).deriveEmailCode(
    row.id,
    row.purpose,
    row.challenge_nonce,
    row.verifier_key_version,
  );
}

async function latestAccountRecoveryCode(
  database: DatabasePool,
  accountId: string,
): Promise<string> {
  const result = await database.pool.query<{
    id: string;
    purpose: string;
    challenge_nonce: Buffer;
    verifier_key_version: number;
  }>(
    `SELECT id, purpose, challenge_nonce, verifier_key_version
     FROM email_verifications
     WHERE account_id = $1
       AND purpose = 'account_recovery'
       AND consumed_at IS NULL
       AND superseded_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [accountId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Missing account recovery challenge");
  return new AuthKeyRing(config.authKeys).deriveEmailCode(
    row.id,
    row.purpose,
    row.challenge_nonce,
    row.verifier_key_version,
  );
}

async function register(app: App, database: DatabasePool, suffix: string): Promise<TestAccount> {
  const username = "m1_" + suffix;
  const password = "very secure M1 password " + suffix;
  const start = await app.inject({
    method: "POST",
    url: "/api/v1/auth/registration/start",
    headers: jsonHeaders(),
    payload: {
      username,
      displayName: "M1 " + suffix,
      dateOfBirth: "2000-01-01",
      email: username + "@example.test",
      password,
    },
  });
  assert.equal(start.statusCode, 200, start.body);
  const registrationIntentId = (start.json() as { registrationIntentId: string })
    .registrationIntentId;
  const code = await latestRegistrationCode(database, registrationIntentId);
  const verify = await app.inject({
    method: "POST",
    url: "/api/v1/auth/registration/verify",
    headers: jsonHeaders(),
    payload: { registrationIntentId, code, deviceName: "M1 Browser" },
  });
  assert.equal(verify.statusCode, 200, verify.body);
  return {
    accountId: (verify.json() as { accountId: string }).accountId,
    cookie: cookieHeader(verify),
    username,
    password,
  };
}

async function login(app: App, account: TestAccount): Promise<TestAccount> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: jsonHeaders(),
    payload: {
      identifier: account.username,
      password: account.password,
      deviceName: "M1 Recovery Browser",
    },
  });
  assert.equal(response.statusCode, 200, response.body);
  return { ...account, cookie: cookieHeader(response) };
}

async function formPartnership(
  app: App,
  sender: TestAccount,
  recipient: TestAccount,
  suffix: string,
): Promise<{ partnershipId: string; conversationId: string }> {
  const request = await app.inject({
    method: "POST",
    url: "/api/v1/partner-requests",
    headers: jsonHeaders(sender.cookie, "m1-request-" + suffix + "-0001"),
    payload: {
      recipientAccountId: recipient.accountId,
      expectedUsername: recipient.username,
      relationshipStartDate: "2020-01-01",
    },
  });
  assert.equal(request.statusCode, 201, request.body);
  const requestId = (request.json() as { requestId: string }).requestId;

  const accepted = await app.inject({
    method: "POST",
    url: "/api/v1/partner-requests/" + requestId + "/accept",
    headers: mutationHeaders(recipient.cookie),
  });
  assert.equal(accepted.statusCode, 200, accepted.body);
  const partnershipId = (accepted.json() as { partnershipId: string }).partnershipId;

  const current = await app.inject({
    method: "GET",
    url: "/api/v1/conversations/current",
    headers: { cookie: sender.cookie },
  });
  assert.equal(current.statusCode, 200, current.body);
  const conversation = (current.json() as {
    conversation: { conversationId: string; partnershipId: string } | null;
  }).conversation;
  assert.ok(conversation);
  assert.equal(conversation.partnershipId, partnershipId);

  return { partnershipId, conversationId: conversation.conversationId };
}

async function sendMessage(
  app: App,
  account: TestAccount,
  conversationId: string,
  body: string,
  key: string,
  replyToMessageId: string | null = null,
) {
  return app.inject({
    method: "POST",
    url: "/api/v1/conversations/" + conversationId + "/messages",
    headers: jsonHeaders(account.cookie, key),
    payload: { body, replyToMessageId },
  });
}

async function reauthenticate(app: App, account: TestAccount): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/reauthenticate",
    headers: jsonHeaders(account.cookie),
    payload: { password: account.password },
  });
  assert.equal(response.statusCode, 200, response.body);
  return cookieHeader(response);
}

test("M1 formation provisions one conversation and send/reply are ordered and idempotent", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "basic_alice");
    const bob = await register(app, database, "basic_bob");
    const { partnershipId, conversationId } = await formPartnership(
      app,
      alice,
      bob,
      "basic",
    );

    const conversationCount = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM conversations WHERE partnership_id = $1 AND kind = 'primary'",
      [partnershipId],
    );
    assert.equal(conversationCount.rows[0]?.count, "1");

    const first = await sendMessage(
      app,
      alice,
      conversationId,
      "first private message",
      "m1-basic-send-key-0001",
    );
    assert.equal(first.statusCode, 201, first.body);
    const firstBody = first.json() as {
      messageId: string;
      serverSequence: number;
      changeSequence: number;
      contentVersion: number;
    };
    assert.deepEqual(
      {
        serverSequence: firstBody.serverSequence,
        changeSequence: firstBody.changeSequence,
        contentVersion: firstBody.contentVersion,
      },
      { serverSequence: 1, changeSequence: 1, contentVersion: 1 },
    );

    const replay = await sendMessage(
      app,
      alice,
      conversationId,
      "first private message",
      "m1-basic-send-key-0001",
    );
    assert.equal(replay.statusCode, 201, replay.body);
    assert.equal((replay.json() as { messageId: string }).messageId, firstBody.messageId);
    assert.equal((replay.json() as { serverSequence: number }).serverSequence, 1);

    const mismatch = await sendMessage(
      app,
      alice,
      conversationId,
      "different body",
      "m1-basic-send-key-0001",
    );
    assert.equal(mismatch.statusCode, 409, mismatch.body);
    assert.equal(
      (mismatch.json() as { error: { code: string } }).error.code,
      "IDEMPOTENCY_KEY_REUSED",
    );

    const reply = await sendMessage(
      app,
      bob,
      conversationId,
      "reply",
      "m1-basic-reply-key-0001",
      firstBody.messageId,
    );
    assert.equal(reply.statusCode, 201, reply.body);
    assert.equal((reply.json() as { serverSequence: number }).serverSequence, 2);
    assert.equal((reply.json() as { changeSequence: number }).changeSequence, 2);

    const history = await app.inject({
      method: "GET",
      url: "/api/v1/conversations/" + conversationId + "/messages?limit=50",
      headers: { cookie: alice.cookie },
    });
    assert.equal(history.statusCode, 200, history.body);
    const historyBody = history.json() as {
      items: Array<{
        messageId: string;
        serverSequence: number;
        replyContext: { messageId: string; body: string | null } | null;
      }>;
    };
    assert.deepEqual(
      historyBody.items.map((message) => message.serverSequence),
      [1, 2],
    );
    assert.equal(historyBody.items[1]?.replyContext?.messageId, firstBody.messageId);
    assert.equal(historyBody.items[1]?.replyContext?.body, "first private message");

    const stored = await database.pool.query<{
      sender_device_id: string | null;
      request_fingerprint: Buffer | null;
      request_fingerprint_version: number | null;
    }>(
      "SELECT sender_device_id, request_fingerprint, request_fingerprint_version FROM messages WHERE id = $1",
      [firstBody.messageId],
    );
    assert.ok(stored.rows[0]?.sender_device_id);
    assert.ok(stored.rows[0]?.request_fingerprint);
    assert.equal(stored.rows[0]?.request_fingerprint_version, 1);

    const outbox = await database.pool.query<{ payload: unknown }>(
      "SELECT payload FROM outbox_events WHERE deduplication_key = $1",
      ["m1-change:" + conversationId + ":1"],
    );
    const payload = JSON.stringify(outbox.rows[0]?.payload ?? {});
    assert.equal(payload.includes("first private message"), false);
    assert.equal(payload.includes("body"), false);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("M1 old-message edits reactions and deletion are recovered from durable change cursor", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "changes_alice");
    const bob = await register(app, database, "changes_bob");
    const { conversationId } = await formPartnership(app, alice, bob, "changes");

    const first = await sendMessage(
      app,
      alice,
      conversationId,
      "old message",
      "m1-change-send-key-0001",
    );
    const second = await sendMessage(
      app,
      bob,
      conversationId,
      "newer message",
      "m1-change-send-key-0002",
    );
    assert.equal(first.statusCode, 201, first.body);
    assert.equal(second.statusCode, 201, second.body);
    const firstBody = first.json() as { messageId: string };
    const baselineCursor = 2;

    const noReactionRemoval = await app.inject({
      method: "DELETE",
      url:
        "/api/v1/conversations/"
        + conversationId
        + "/messages/"
        + (second.json() as { messageId: string }).messageId
        + "/reaction",
      headers: mutationHeaders(bob.cookie, "m1-noop-reaction-remove-key"),
    });
    assert.equal(noReactionRemoval.statusCode, 200, noReactionRemoval.body);
    assert.equal(
      (noReactionRemoval.json() as { changeSequence: number }).changeSequence,
      2,
    );
    const afterNoop = await database.pool.query<{
      next_change_sequence: string | number | bigint;
    }>(
      "SELECT next_change_sequence FROM conversations WHERE id = $1",
      [conversationId],
    );
    assert.equal(Number(afterNoop.rows[0]?.next_change_sequence), 3);

    const [editA, editB] = await Promise.all([
      app.inject({
        method: "PATCH",
        url:
          "/api/v1/conversations/"
          + conversationId
          + "/messages/"
          + firstBody.messageId,
        headers: jsonHeaders(alice.cookie, "m1-edit-race-key-0001"),
        payload: { body: "edit winner A", expectedContentVersion: 1 },
      }),
      app.inject({
        method: "PATCH",
        url:
          "/api/v1/conversations/"
          + conversationId
          + "/messages/"
          + firstBody.messageId,
        headers: jsonHeaders(alice.cookie, "m1-edit-race-key-0002"),
        payload: { body: "edit winner B", expectedContentVersion: 1 },
      }),
    ]);
    assert.deepEqual(
      [editA.statusCode, editB.statusCode].sort((left, right) => left - right),
      [200, 409],
      editA.body + "\n" + editB.body,
    );
    const loser = editA.statusCode === 409 ? editA : editB;
    assert.equal(
      (loser.json() as { error: { code: string } }).error.code,
      "VERSION_CONFLICT",
    );

    const reaction = await app.inject({
      method: "PUT",
      url:
        "/api/v1/conversations/"
        + conversationId
        + "/messages/"
        + firstBody.messageId
        + "/reaction",
      headers: jsonHeaders(bob.cookie, "m1-reaction-key-0001"),
      payload: { emoji: "❤️" },
    });
    assert.equal(reaction.statusCode, 200, reaction.body);

    const changedReaction = await app.inject({
      method: "PUT",
      url:
        "/api/v1/conversations/"
        + conversationId
        + "/messages/"
        + firstBody.messageId
        + "/reaction",
      headers: jsonHeaders(bob.cookie, "m1-reaction-key-0002"),
      payload: { emoji: "🥹" },
    });
    assert.equal(changedReaction.statusCode, 200, changedReaction.body);
    assert.equal(
      (changedReaction.json() as { reaction: { emoji: string } }).reaction.emoji,
      "🥹",
    );

    const removedReaction = await app.inject({
      method: "DELETE",
      url:
        "/api/v1/conversations/"
        + conversationId
        + "/messages/"
        + firstBody.messageId
        + "/reaction",
      headers: mutationHeaders(bob.cookie, "m1-reaction-remove-key-0001"),
    });
    assert.equal(removedReaction.statusCode, 200, removedReaction.body);
    assert.equal(
      (removedReaction.json() as { reaction: null }).reaction,
      null,
    );

    const deletion = await app.inject({
      method: "DELETE",
      url:
        "/api/v1/conversations/"
        + conversationId
        + "/messages/"
        + firstBody.messageId,
      headers: mutationHeaders(alice.cookie, "m1-delete-key-0001"),
    });
    assert.equal(deletion.statusCode, 200, deletion.body);
    const deletionBody = deletion.json() as {
      changeSequence: number;
      deletedAt: string;
    };

    const deleteReplay = await app.inject({
      method: "DELETE",
      url:
        "/api/v1/conversations/"
        + conversationId
        + "/messages/"
        + firstBody.messageId,
      headers: mutationHeaders(alice.cookie, "m1-delete-key-0001"),
    });
    assert.equal(deleteReplay.statusCode, 200, deleteReplay.body);
    assert.deepEqual(deleteReplay.json(), deletionBody);

    const deleteDifferentKey = await app.inject({
      method: "DELETE",
      url:
        "/api/v1/conversations/"
        + conversationId
        + "/messages/"
        + firstBody.messageId,
      headers: mutationHeaders(alice.cookie, "m1-delete-key-0002"),
    });
    assert.equal(deleteDifferentKey.statusCode, 409, deleteDifferentKey.body);
    assert.equal(
      (deleteDifferentKey.json() as { error: { code: string } }).error.code,
      "MESSAGE_DELETED",
    );

    const originalSendReplay = await sendMessage(
      app,
      alice,
      conversationId,
      "old message",
      "m1-change-send-key-0001",
    );
    assert.equal(originalSendReplay.statusCode, 201, originalSendReplay.body);
    assert.deepEqual(
      {
        messageId: (originalSendReplay.json() as { messageId: string }).messageId,
        contentVersion: (originalSendReplay.json() as { contentVersion: number }).contentVersion,
        changeSequence: (originalSendReplay.json() as { changeSequence: number }).changeSequence,
      },
      {
        messageId: firstBody.messageId,
        contentVersion: 1,
        changeSequence: 1,
      },
    );

    const changes = await app.inject({
      method: "GET",
      url:
        "/api/v1/conversations/"
        + conversationId
        + "/changes?afterChangeSequence="
        + baselineCursor
        + "&limit=100",
      headers: { cookie: bob.cookie },
    });
    assert.equal(changes.statusCode, 200, changes.body);
    const changeBody = changes.json() as {
      items: Array<{ changeSequence: number; type: string; messageId: string }>;
    };
    assert.deepEqual(
      changeBody.items.map((change) => change.type),
      [
        "message.updated",
        "message.reaction_changed",
        "message.reaction_changed",
        "message.reaction_changed",
        "message.deleted",
      ],
    );
    assert.equal(
      changeBody.items.every((change) => change.messageId === firstBody.messageId),
      true,
    );
    assert.deepEqual(
      changeBody.items.map((change) => change.changeSequence),
      [3, 4, 5, 6, 7],
    );

    const tombstone = await app.inject({
      method: "GET",
      url:
        "/api/v1/conversations/"
        + conversationId
        + "/messages/"
        + firstBody.messageId,
      headers: { cookie: bob.cookie },
    });
    assert.equal(tombstone.statusCode, 200, tombstone.body);
    const tombstoneBody = tombstone.json() as {
      body: string | null;
      deletedAt: string | null;
      reactions: unknown[];
      contentVersion: number;
    };
    assert.equal(tombstoneBody.body, null);
    assert.ok(tombstoneBody.deletedAt);
    assert.deepEqual(tombstoneBody.reactions, []);
    assert.equal(tombstoneBody.contentVersion, 3);

    const versions = await database.pool.query(
      "SELECT 1 FROM message_versions WHERE message_id = $1",
      [firstBody.messageId],
    );
    assert.equal(versions.rowCount, 0);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("M1 send fingerprint replay survives key rotation and fails closed without the historical key", async () => {
  const database = requireDisposableDatabase();
  let app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "rotation_alice");
    const bob = await register(app, database, "rotation_bob");
    const { conversationId } = await formPartnership(app, alice, bob, "rotation");

    const first = await sendMessage(
      app,
      alice,
      conversationId,
      "rotation-safe private message",
      "m1-rotation-send-idempotency-key",
    );
    assert.equal(first.statusCode, 201, first.body);
    const firstResponse = first.json() as {
      messageId: string;
      serverSequence: number;
      changeSequence: number;
    };
    const firstIdentity = {
      messageId: firstResponse.messageId,
      serverSequence: firstResponse.serverSequence,
      changeSequence: firstResponse.changeSequence,
    };

    await app.close();

    const rotatedConfig: ApiConfig = {
      ...config,
      authKeys: {
        activeVersion: 2,
        keys: new Map([
          [1, rootKey],
          [2, Buffer.alloc(32, 8)],
        ]),
      },
    };
    app = createApiApplication({ database, config: rotatedConfig });

    const replayWithRetainedKey = await sendMessage(
      app,
      alice,
      conversationId,
      "rotation-safe private message",
      "m1-rotation-send-idempotency-key",
    );
    assert.equal(replayWithRetainedKey.statusCode, 201, replayWithRetainedKey.body);
    assert.deepEqual(
      {
        messageId: (replayWithRetainedKey.json() as { messageId: string }).messageId,
        serverSequence: (replayWithRetainedKey.json() as { serverSequence: number }).serverSequence,
        changeSequence: (replayWithRetainedKey.json() as { changeSequence: number }).changeSequence,
      },
      firstIdentity,
    );

    const rotatedAlice = await login(app, alice);
    await app.close();

    const retiredConfig: ApiConfig = {
      ...config,
      authKeys: {
        activeVersion: 2,
        keys: new Map([[2, Buffer.alloc(32, 8)]]),
      },
    };
    app = createApiApplication({ database, config: retiredConfig });

    const replayWithoutHistoricalKey = await sendMessage(
      app,
      rotatedAlice,
      conversationId,
      "rotation-safe private message",
      "m1-rotation-send-idempotency-key",
    );
    assert.equal(replayWithoutHistoricalKey.statusCode, 409, replayWithoutHistoricalKey.body);
    assert.equal(
      (replayWithoutHistoricalKey.json() as { error: { code: string } }).error.code,
      "IDEMPOTENCY_KEY_REUSED",
    );

    const count = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM messages WHERE conversation_id = $1",
      [conversationId],
    );
    assert.equal(count.rows[0]?.count, "1");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("M1 private message content never leaks into durable operational metadata", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "privacy_alice");
    const bob = await register(app, database, "privacy_bob");
    const { partnershipId, conversationId } = await formPartnership(
      app,
      alice,
      bob,
      "privacy",
    );

    const originalSentinel = "M1_PRIVATE_ORIGINAL_9c4e4d7a";
    const currentSentinel = "M1_PRIVATE_CURRENT_2d8f6a1b";
    const sent = await sendMessage(
      app,
      alice,
      conversationId,
      originalSentinel,
      "m1-privacy-send-idempotency-key",
    );
    assert.equal(sent.statusCode, 201, sent.body);
    const messageId = (sent.json() as { messageId: string }).messageId;

    const edit = await app.inject({
      method: "PATCH",
      url: "/api/v1/conversations/" + conversationId + "/messages/" + messageId,
      headers: jsonHeaders(alice.cookie, "m1-privacy-edit-idempotency-key"),
      payload: { body: currentSentinel, expectedContentVersion: 1 },
    });
    assert.equal(edit.statusCode, 200, edit.body);

    const reaction = await app.inject({
      method: "PUT",
      url:
        "/api/v1/conversations/"
        + conversationId
        + "/messages/"
        + messageId
        + "/reaction",
      headers: jsonHeaders(bob.cookie, "m1-privacy-reaction-key"),
      payload: { emoji: "🥹" },
    });
    assert.equal(reaction.statusCode, 200, reaction.body);

    const nickname = await app.inject({
      method: "PATCH",
      url:
        "/api/v1/partnerships/"
        + partnershipId
        + "/nicknames/"
        + bob.accountId,
      headers: jsonHeaders(alice.cookie, "m1-privacy-nickname-key"),
      payload: { nickname: "Private Bee", expectedVersion: 1 },
    });
    assert.equal(nickname.statusCode, 200, nickname.body);

    const currentMessage = await database.pool.query<{ body_text: string | null }>(
      "SELECT body_text FROM messages WHERE id = $1",
      [messageId],
    );
    assert.equal(currentMessage.rows[0]?.body_text, currentSentinel);

    const oldBody = await database.pool.query(
      "SELECT 1 FROM messages WHERE body_text = $1 UNION ALL SELECT 1 FROM message_versions WHERE convert_from(ciphertext, 'UTF8') = $1",
      [originalSentinel],
    );
    assert.equal(oldBody.rowCount, 0);

    const leaked = await database.pool.query<{
      outbox: string;
      idempotency: string;
      lifecycle: string;
      notifications: string;
      scheduled: string;
      security: string;
      email_delivery: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM outbox_events WHERE payload::text LIKE '%' || $1 || '%') AS outbox,
         (SELECT count(*)::text FROM idempotency_records WHERE COALESCE(response_body::text, '') LIKE '%' || $1 || '%') AS idempotency,
         (SELECT count(*)::text FROM partnership_lifecycle_events WHERE COALESCE(metadata_json::text, '') LIKE '%' || $1 || '%') AS lifecycle,
         (SELECT count(*)::text FROM account_notifications WHERE event_type LIKE '%' || $1 || '%' OR deduplication_key LIKE '%' || $1 || '%') AS notifications,
         (SELECT count(*)::text FROM scheduled_actions WHERE payload::text LIKE '%' || $1 || '%') AS scheduled,
         (SELECT count(*)::text FROM security_events WHERE metadata_json::text LIKE '%' || $1 || '%') AS security,
         (SELECT count(*)::text FROM security_email_deliveries WHERE parameters_json::text LIKE '%' || $1 || '%') AS email_delivery`,
      [currentSentinel],
    );
    assert.deepEqual(leaked.rows[0], {
      outbox: "0",
      idempotency: "0",
      lifecycle: "0",
      notifications: "0",
      scheduled: "0",
      security: "0",
      email_delivery: "0",
    });

    const changeColumns = await database.pool.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'conversation_changes'
         AND column_name IN ('body', 'body_text', 'emoji', 'emoji_text', 'nickname', 'reply_body')`,
    );
    assert.equal(changeColumns.rowCount, 0);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("M1 reply context survives pagination and deleted reply targets stay tombstone-safe", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "reply_alice");
    const bob = await register(app, database, "reply_bob");
    const { conversationId } = await formPartnership(app, alice, bob, "reply");

    const anchor = await sendMessage(
      app,
      alice,
      conversationId,
      "anchor outside page",
      "m1-reply-anchor-key-0001",
    );
    assert.equal(anchor.statusCode, 201, anchor.body);
    const anchorId = (anchor.json() as { messageId: string }).messageId;

    const filler = await sendMessage(
      app,
      bob,
      conversationId,
      "filler",
      "m1-reply-filler-key-0001",
    );
    assert.equal(filler.statusCode, 201, filler.body);

    const reply = await sendMessage(
      app,
      bob,
      conversationId,
      "reply to anchor",
      "m1-reply-message-key-0001",
      anchorId,
    );
    assert.equal(reply.statusCode, 201, reply.body);
    const replyId = (reply.json() as { messageId: string }).messageId;

    const page = await app.inject({
      method: "GET",
      url: "/api/v1/conversations/" + conversationId + "/messages?limit=2",
      headers: { cookie: alice.cookie },
    });
    assert.equal(page.statusCode, 200, page.body);
    const pageBody = page.json() as {
      items: Array<{
        messageId: string;
        serverSequence: number;
        replyContext: { messageId: string; body: string | null; deleted: boolean } | null;
      }>;
      hasMore: boolean;
    };
    assert.equal(pageBody.hasMore, true);
    assert.deepEqual(
      pageBody.items.map((message) => message.serverSequence),
      [2, 3],
    );
    const pagedReply = pageBody.items.find((message) => message.messageId === replyId);
    assert.equal(pagedReply?.replyContext?.messageId, anchorId);
    assert.equal(pagedReply?.replyContext?.body, "anchor outside page");
    assert.equal(pagedReply?.replyContext?.deleted, false);

    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/v1/conversations/" + conversationId + "/messages/" + anchorId,
      headers: mutationHeaders(alice.cookie, "m1-reply-anchor-delete-key"),
    });
    assert.equal(deleted.statusCode, 200, deleted.body);

    const replyAfterDelete = await app.inject({
      method: "GET",
      url: "/api/v1/conversations/" + conversationId + "/messages/" + replyId,
      headers: { cookie: bob.cookie },
    });
    assert.equal(replyAfterDelete.statusCode, 200, replyAfterDelete.body);
    const tombstoneContext = (replyAfterDelete.json() as {
      replyContext: { messageId: string; body: string | null; deleted: boolean } | null;
    }).replyContext;
    assert.equal(tombstoneContext?.messageId, anchorId);
    assert.equal(tombstoneContext?.body, null);
    assert.equal(tombstoneContext?.deleted, true);

    const replyToTombstone = await sendMessage(
      app,
      bob,
      conversationId,
      "reply to tombstone",
      "m1-reply-tombstone-key-0001",
      anchorId,
    );
    assert.equal(replyToTombstone.statusCode, 201, replyToTombstone.body);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("M1 API rejects editing at the trusted thirty-minute boundary", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "boundary_alice");
    const bob = await register(app, database, "boundary_bob");
    const { conversationId } = await formPartnership(app, alice, bob, "boundary");

    const sent = await sendMessage(
      app,
      alice,
      conversationId,
      "boundary message",
      "m1-boundary-send-key-0001",
    );
    assert.equal(sent.statusCode, 201, sent.body);
    const messageId = (sent.json() as { messageId: string }).messageId;

    await database.pool.query(
      "UPDATE messages SET created_at = clock_timestamp() - interval '30 minutes' WHERE id = $1",
      [messageId],
    );

    const edit = await app.inject({
      method: "PATCH",
      url: "/api/v1/conversations/" + conversationId + "/messages/" + messageId,
      headers: jsonHeaders(alice.cookie, "m1-boundary-edit-key-0001"),
      payload: { body: "too late", expectedContentVersion: 1 },
    });
    assert.equal(edit.statusCode, 409, edit.body);
    assert.equal(
      (edit.json() as { error: { code: string } }).error.code,
      "MESSAGE_EDIT_WINDOW_EXPIRED",
    );
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("M1 breakup sequence cutoff freezes old messages while post-breakup messages stay mutable", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "breakup_alice");
    const bob = await register(app, database, "breakup_bob");
    const { partnershipId, conversationId } = await formPartnership(
      app,
      alice,
      bob,
      "breakup",
    );

    const before = await sendMessage(
      app,
      alice,
      conversationId,
      "before breakup",
      "m1-breakup-send-key-0001",
    );
    assert.equal(before.statusCode, 201, before.body);
    const beforeId = (before.json() as { messageId: string }).messageId;

    const breakup = await app.inject({
      method: "POST",
      url: "/api/v1/partnerships/" + partnershipId + "/breakup",
      headers: mutationHeaders(alice.cookie, "m1-breakup-start-key-0001"),
    });
    assert.equal(breakup.statusCode, 200, breakup.body);

    const cutoff = await database.pool.query<{
      message_freeze_sequence: string | number | bigint | null;
    }>(
      "SELECT message_freeze_sequence FROM breakup_processes WHERE partnership_id = $1 AND dissolved_at IS NULL AND restored_at IS NULL AND cancelled_at IS NULL AND superseded_at IS NULL",
      [partnershipId],
    );
    assert.equal(Number(cutoff.rows[0]?.message_freeze_sequence), 1);

    const editOld = await app.inject({
      method: "PATCH",
      url: "/api/v1/conversations/" + conversationId + "/messages/" + beforeId,
      headers: jsonHeaders(alice.cookie, "m1-breakup-old-edit-key"),
      payload: { body: "not allowed", expectedContentVersion: 1 },
    });
    assert.equal(editOld.statusCode, 409, editOld.body);
    assert.equal(
      (editOld.json() as { error: { code: string } }).error.code,
      "PRE_BREAKUP_MESSAGE_LOCKED",
    );

    const reactOld = await app.inject({
      method: "PUT",
      url:
        "/api/v1/conversations/"
        + conversationId
        + "/messages/"
        + beforeId
        + "/reaction",
      headers: jsonHeaders(bob.cookie, "m1-breakup-old-react-key"),
      payload: { emoji: "😂" },
    });
    assert.equal(reactOld.statusCode, 409, reactOld.body);
    assert.equal(
      (reactOld.json() as { error: { code: string } }).error.code,
      "PRE_BREAKUP_MESSAGE_LOCKED",
    );

    const deleteOld = await app.inject({
      method: "DELETE",
      url: "/api/v1/conversations/" + conversationId + "/messages/" + beforeId,
      headers: mutationHeaders(alice.cookie, "m1-breakup-old-delete-key"),
    });
    assert.equal(deleteOld.statusCode, 409, deleteOld.body);
    assert.equal(
      (deleteOld.json() as { error: { code: string } }).error.code,
      "PRE_BREAKUP_MESSAGE_LOCKED",
    );

    const nicknameDuringBreakup = await app.inject({
      method: "PATCH",
      url:
        "/api/v1/partnerships/"
        + partnershipId
        + "/nicknames/"
        + bob.accountId,
      headers: jsonHeaders(alice.cookie, "m1-breakup-nickname-key"),
      payload: { nickname: "Still Bee", expectedVersion: 1 },
    });
    assert.equal(nicknameDuringBreakup.statusCode, 200, nicknameDuringBreakup.body);

    const post = await sendMessage(
      app,
      bob,
      conversationId,
      "after breakup",
      "m1-breakup-send-key-0002",
      beforeId,
    );
    assert.equal(post.statusCode, 201, post.body);
    const postBody = post.json() as { messageId: string; serverSequence: number };
    assert.equal(postBody.serverSequence, 2);

    const editPost = await app.inject({
      method: "PATCH",
      url:
        "/api/v1/conversations/"
        + conversationId
        + "/messages/"
        + postBody.messageId,
      headers: jsonHeaders(bob.cookie, "m1-breakup-post-edit-key"),
      payload: { body: "after breakup edited", expectedContentVersion: 1 },
    });
    assert.equal(editPost.statusCode, 200, editPost.body);

    const current = await app.inject({
      method: "GET",
      url: "/api/v1/conversations/current",
      headers: { cookie: bob.cookie },
    });
    assert.equal(current.statusCode, 200, current.body);
    const currentBody = current.json() as {
      conversation: {
        interactionMode: string;
        breakup: { messageFreezeSequence: number | null } | null;
      };
    };
    assert.equal(currentBody.conversation.interactionMode, "breakup_restricted");
    assert.equal(currentBody.conversation.breakup?.messageFreezeSequence, 1);
    assert.equal(
      (current.json() as {
        conversation: { partner: { nickname: string | null } };
      }).conversation.partner.nickname,
      "Still Bee",
    );
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("M1 nickname presence typing and receipts are shared but privacy bounded", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "interaction_alice");
    const bob = await register(app, database, "interaction_bob");

    const prePresence = await app.inject({
      method: "POST",
      url: "/api/v1/presence/heartbeat",
      headers: jsonHeaders(alice.cookie),
      payload: {},
    });
    assert.equal(prePresence.statusCode, 200, prePresence.body);

    const { partnershipId, conversationId } = await formPartnership(
      app,
      alice,
      bob,
      "interaction",
    );

    const beforeHeartbeat = await app.inject({
      method: "GET",
      url: "/api/v1/conversations/current",
      headers: { cookie: bob.cookie },
    });
    assert.equal(beforeHeartbeat.statusCode, 200, beforeHeartbeat.body);
    assert.equal(
      (beforeHeartbeat.json() as {
        conversation: { partner: { presence: { lastSeenAt: string | null } } };
      }).conversation.partner.presence.lastSeenAt,
      null,
    );

    const postPresence = await app.inject({
      method: "POST",
      url: "/api/v1/presence/heartbeat",
      headers: jsonHeaders(alice.cookie),
      payload: {},
    });
    assert.equal(postPresence.statusCode, 200, postPresence.body);

    const visiblePresence = await app.inject({
      method: "GET",
      url: "/api/v1/conversations/current",
      headers: { cookie: bob.cookie },
    });
    assert.ok(
      (visiblePresence.json() as {
        conversation: { partner: { presence: { lastSeenAt: string | null } } };
      }).conversation.partner.presence.lastSeenAt,
    );

    const nickname = await app.inject({
      method: "PATCH",
      url:
        "/api/v1/partnerships/"
        + partnershipId
        + "/nicknames/"
        + bob.accountId,
      headers: jsonHeaders(alice.cookie, "m1-nickname-key-0001"),
      payload: { nickname: "Bee", expectedVersion: 1 },
    });
    assert.equal(nickname.statusCode, 200, nickname.body);
    assert.equal((nickname.json() as { version: number }).version, 2);

    const nicknameVisibleToAlice = await app.inject({
      method: "GET",
      url: "/api/v1/conversations/current",
      headers: { cookie: alice.cookie },
    });
    assert.equal(nicknameVisibleToAlice.statusCode, 200, nicknameVisibleToAlice.body);
    assert.equal(
      (nicknameVisibleToAlice.json() as {
        conversation: { partner: { nickname: string | null } };
      }).conversation.partner.nickname,
      "Bee",
    );

    const nicknameVisibleToBob = await app.inject({
      method: "GET",
      url: "/api/v1/conversations/current",
      headers: { cookie: bob.cookie },
    });
    assert.equal(nicknameVisibleToBob.statusCode, 200, nicknameVisibleToBob.body);
    assert.equal(
      (nicknameVisibleToBob.json() as {
        conversation: { self: { nickname: string | null } };
      }).conversation.self.nickname,
      "Bee",
    );

    const staleNickname = await app.inject({
      method: "PATCH",
      url:
        "/api/v1/partnerships/"
        + partnershipId
        + "/nicknames/"
        + bob.accountId,
      headers: jsonHeaders(bob.cookie, "m1-nickname-key-0002"),
      payload: { nickname: "B", expectedVersion: 1 },
    });
    assert.equal(staleNickname.statusCode, 409, staleNickname.body);
    assert.equal(
      (staleNickname.json() as { error: { code: string } }).error.code,
      "VERSION_CONFLICT",
    );

    const typing = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/" + conversationId + "/typing",
      headers: jsonHeaders(bob.cookie),
      payload: { typing: true },
    });
    assert.equal(typing.statusCode, 200, typing.body);

    const typingVisible = await app.inject({
      method: "GET",
      url: "/api/v1/conversations/current",
      headers: { cookie: alice.cookie },
    });
    assert.equal(
      (typingVisible.json() as {
        conversation: { partner: { typing: boolean } };
      }).conversation.partner.typing,
      true,
    );

    await database.pool.query(
      "UPDATE conversation_typing_state SET expires_at = clock_timestamp() - interval '1 second' WHERE conversation_id = $1 AND account_id = $2",
      [conversationId, bob.accountId],
    );
    const typingExpired = await app.inject({
      method: "GET",
      url: "/api/v1/conversations/current",
      headers: { cookie: alice.cookie },
    });
    assert.equal(
      (typingExpired.json() as {
        conversation: { partner: { typing: boolean } };
      }).conversation.partner.typing,
      false,
    );

    const message = await sendMessage(
      app,
      alice,
      conversationId,
      "receipt test",
      "m1-receipt-send-key-0001",
    );
    assert.equal(message.statusCode, 201, message.body);

    const read = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/" + conversationId + "/receipt",
      headers: jsonHeaders(bob.cookie),
      payload: { type: "read", throughSequence: 1 },
    });
    assert.equal(read.statusCode, 200, read.body);
    assert.deepEqual(read.json(), { deliveredThrough: 1, readThrough: 1 });

    const lower = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/" + conversationId + "/receipt",
      headers: jsonHeaders(bob.cookie),
      payload: { type: "delivered", throughSequence: 0 },
    });
    assert.equal(lower.statusCode, 200, lower.body);
    assert.deepEqual(lower.json(), { deliveredThrough: 1, readThrough: 1 });

    const ahead = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/" + conversationId + "/receipt",
      headers: jsonHeaders(bob.cookie),
      payload: { type: "read", throughSequence: 2 },
    });
    assert.equal(ahead.statusCode, 409, ahead.body);
    assert.equal(
      (ahead.json() as { error: { code: string } }).error.code,
      "RECEIPT_SEQUENCE_AHEAD",
    );
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("M1 typing writes coalesce and the endpoint enforces its server rate limit", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "typing_alice");
    const bob = await register(app, database, "typing_bob");
    const { conversationId } = await formPartnership(app, alice, bob, "typing");

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/" + conversationId + "/typing",
      headers: jsonHeaders(alice.cookie),
      payload: { typing: true },
    });
    assert.equal(first.statusCode, 200, first.body);

    const firstStored = await database.pool.query<{
      updated_at: Date;
      expires_at: Date;
    }>(
      "SELECT updated_at, expires_at FROM conversation_typing_state WHERE conversation_id = $1 AND account_id = $2",
      [conversationId, alice.accountId],
    );
    assert.ok(firstStored.rows[0]);

    const immediateRefresh = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/" + conversationId + "/typing",
      headers: jsonHeaders(alice.cookie),
      payload: { typing: true },
    });
    assert.equal(immediateRefresh.statusCode, 200, immediateRefresh.body);

    const secondStored = await database.pool.query<{
      updated_at: Date;
      expires_at: Date;
    }>(
      "SELECT updated_at, expires_at FROM conversation_typing_state WHERE conversation_id = $1 AND account_id = $2",
      [conversationId, alice.accountId],
    );
    assert.equal(
      secondStored.rows[0]?.updated_at.getTime(),
      firstStored.rows[0]?.updated_at.getTime(),
    );
    assert.equal(
      secondStored.rows[0]?.expires_at.getTime(),
      firstStored.rows[0]?.expires_at.getTime(),
    );

    await database.pool.query(
      "UPDATE security_rate_limit_buckets SET attempt_count = 60, blocked_until = NULL WHERE scope = 'm1.typing'",
    );

    const limited = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/" + conversationId + "/typing",
      headers: jsonHeaders(alice.cookie),
      payload: { typing: true },
    });
    assert.equal(limited.statusCode, 429, limited.body);
    assert.equal(
      (limited.json() as { error: { code: string } }).error.code,
      "RATE_LIMITED",
    );
    assert.ok(Number(limited.headers["retry-after"]) >= 1);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("M1 account-deletion overlay is view-only and recovery preserves the same conversation", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "overlay_alice");
    const bob = await register(app, database, "overlay_bob");
    const { conversationId } = await formPartnership(app, alice, bob, "overlay");

    const initial = await sendMessage(
      app,
      alice,
      conversationId,
      "preserve me",
      "m1-overlay-send-key-0001",
    );
    assert.equal(initial.statusCode, 201, initial.body);

    const reauthedCookie = await reauthenticate(app, alice);
    const deletion = await app.inject({
      method: "POST",
      url: "/api/v1/me/account-deletion",
      headers: jsonHeaders(reauthedCookie),
      payload: {},
    });
    assert.equal(deletion.statusCode, 200, deletion.body);

    const current = await app.inject({
      method: "GET",
      url: "/api/v1/conversations/current",
      headers: { cookie: bob.cookie },
    });
    assert.equal(current.statusCode, 200, current.body);
    assert.equal(
      (current.json() as {
        conversation: { conversationId: string; interactionMode: string };
      }).conversation.conversationId,
      conversationId,
    );
    assert.equal(
      (current.json() as {
        conversation: { interactionMode: string };
      }).conversation.interactionMode,
      "account_deletion_view_only",
    );

    const history = await app.inject({
      method: "GET",
      url: "/api/v1/conversations/" + conversationId + "/messages",
      headers: { cookie: bob.cookie },
    });
    assert.equal(history.statusCode, 200, history.body);
    assert.equal((history.json() as { items: unknown[] }).items.length, 1);

    const denied = await sendMessage(
      app,
      bob,
      conversationId,
      "must fail",
      "m1-overlay-send-key-0002",
    );
    assert.equal(denied.statusCode, 409, denied.body);
    assert.equal(
      (denied.json() as { error: { code: string } }).error.code,
      "ACCOUNT_LOCKED",
    );

    const startRecovery = await app.inject({
      method: "POST",
      url: "/api/v1/auth/account-recovery/start",
      headers: jsonHeaders(),
      payload: { identifier: alice.username },
    });
    assert.equal(startRecovery.statusCode, 202, startRecovery.body);
    const code = await latestAccountRecoveryCode(database, alice.accountId);
    const recover = await app.inject({
      method: "POST",
      url: "/api/v1/auth/account-recovery/complete",
      headers: jsonHeaders(),
      payload: { identifier: alice.username, code },
    });
    assert.equal(recover.statusCode, 200, recover.body);

    const recoveredAlice = await login(app, alice);
    const after = await app.inject({
      method: "GET",
      url: "/api/v1/conversations/current",
      headers: { cookie: recoveredAlice.cookie },
    });
    assert.equal(after.statusCode, 200, after.body);
    assert.equal(
      (after.json() as {
        conversation: { conversationId: string; interactionMode: string };
      }).conversation.conversationId,
      conversationId,
    );
    assert.equal(
      (after.json() as {
        conversation: { interactionMode: string };
      }).conversation.interactionMode,
      "normal",
    );

    const resumed = await sendMessage(
      app,
      recoveredAlice,
      conversationId,
      "after recovery",
      "m1-overlay-send-key-0003",
    );
    assert.equal(resumed.statusCode, 201, resumed.body);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("M1 edit-delete and reaction-delete races converge on content-free tombstones", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "mutation_race_alice");
    const bob = await register(app, database, "mutation_race_bob");
    const { conversationId } = await formPartnership(app, alice, bob, "mutation_race");

    const editable = await sendMessage(
      app,
      alice,
      conversationId,
      "edit delete race",
      "m1-edit-delete-race-send-key",
    );
    assert.equal(editable.statusCode, 201, editable.body);
    const editableId = (editable.json() as { messageId: string }).messageId;

    const [edit, deletion] = await Promise.all([
      app.inject({
        method: "PATCH",
        url: "/api/v1/conversations/" + conversationId + "/messages/" + editableId,
        headers: jsonHeaders(alice.cookie, "m1-edit-delete-race-edit-key"),
        payload: { body: "edited before delete maybe", expectedContentVersion: 1 },
      }),
      app.inject({
        method: "DELETE",
        url: "/api/v1/conversations/" + conversationId + "/messages/" + editableId,
        headers: mutationHeaders(alice.cookie, "m1-edit-delete-race-delete-key"),
      }),
    ]);
    assert.equal(deletion.statusCode, 200, deletion.body);
    assert.ok(edit.statusCode === 200 || edit.statusCode === 409, edit.body);
    if (edit.statusCode === 409) {
      assert.equal(
        (edit.json() as { error: { code: string } }).error.code,
        "MESSAGE_DELETED",
      );
    }

    const editDeleteFinal = await app.inject({
      method: "GET",
      url: "/api/v1/conversations/" + conversationId + "/messages/" + editableId,
      headers: { cookie: bob.cookie },
    });
    assert.equal(editDeleteFinal.statusCode, 200, editDeleteFinal.body);
    assert.equal((editDeleteFinal.json() as { body: string | null }).body, null);
    assert.ok((editDeleteFinal.json() as { deletedAt: string | null }).deletedAt);

    const reactable = await sendMessage(
      app,
      bob,
      conversationId,
      "reaction delete race",
      "m1-react-delete-race-send-key",
    );
    assert.equal(reactable.statusCode, 201, reactable.body);
    const reactableId = (reactable.json() as { messageId: string }).messageId;

    const [reaction, reactionDeletion] = await Promise.all([
      app.inject({
        method: "PUT",
        url:
          "/api/v1/conversations/"
          + conversationId
          + "/messages/"
          + reactableId
          + "/reaction",
        headers: jsonHeaders(alice.cookie, "m1-react-delete-race-react-key"),
        payload: { emoji: "😮" },
      }),
      app.inject({
        method: "DELETE",
        url: "/api/v1/conversations/" + conversationId + "/messages/" + reactableId,
        headers: mutationHeaders(bob.cookie, "m1-react-delete-race-delete-key"),
      }),
    ]);
    assert.equal(reactionDeletion.statusCode, 200, reactionDeletion.body);
    assert.ok(reaction.statusCode === 200 || reaction.statusCode === 409, reaction.body);
    if (reaction.statusCode === 409) {
      assert.equal(
        (reaction.json() as { error: { code: string } }).error.code,
        "MESSAGE_DELETED",
      );
    }

    const reactionDeleteFinal = await app.inject({
      method: "GET",
      url: "/api/v1/conversations/" + conversationId + "/messages/" + reactableId,
      headers: { cookie: alice.cookie },
    });
    assert.equal(reactionDeleteFinal.statusCode, 200, reactionDeleteFinal.body);
    assert.equal((reactionDeleteFinal.json() as { body: string | null }).body, null);
    assert.deepEqual(
      (reactionDeleteFinal.json() as { reactions: unknown[] }).reactions,
      [],
    );

    const persistedReactions = await database.pool.query(
      "SELECT 1 FROM message_reactions WHERE message_id = ANY($1::uuid[])",
      [[editableId, reactableId]],
    );
    assert.equal(persistedReactions.rowCount, 0);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("M1 send and breakup initiation serialize around the immutable freeze sequence", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "send_breakup_alice");
    const bob = await register(app, database, "send_breakup_bob");
    const { partnershipId, conversationId } = await formPartnership(
      app,
      alice,
      bob,
      "send_breakup",
    );

    const [send, breakup] = await Promise.all([
      sendMessage(
        app,
        bob,
        conversationId,
        "racing breakup",
        "m1-send-breakup-race-message-key",
      ),
      app.inject({
        method: "POST",
        url: "/api/v1/partnerships/" + partnershipId + "/breakup",
        headers: mutationHeaders(alice.cookie, "m1-send-breakup-race-start-key"),
      }),
    ]);
    assert.equal(send.statusCode, 201, send.body);
    assert.equal(breakup.statusCode, 200, breakup.body);

    const sent = send.json() as { messageId: string; serverSequence: number };
    const persisted = await database.pool.query<{
      message_freeze_sequence: string | number | bigint | null;
    }>(
      "SELECT message_freeze_sequence FROM breakup_processes WHERE partnership_id = $1 AND restored_at IS NULL AND dissolved_at IS NULL AND cancelled_at IS NULL AND superseded_at IS NULL",
      [partnershipId],
    );
    const cutoff = Number(persisted.rows[0]?.message_freeze_sequence);
    assert.ok(cutoff === 0 || cutoff === 1);

    const reaction = await app.inject({
      method: "PUT",
      url:
        "/api/v1/conversations/"
        + conversationId
        + "/messages/"
        + sent.messageId
        + "/reaction",
      headers: jsonHeaders(alice.cookie, "m1-send-breakup-race-reaction-key"),
      payload: { emoji: "👍" },
    });

    if (sent.serverSequence <= cutoff) {
      assert.equal(reaction.statusCode, 409, reaction.body);
      assert.equal(
        (reaction.json() as { error: { code: string } }).error.code,
        "PRE_BREAKUP_MESSAGE_LOCKED",
      );
    } else {
      assert.equal(reaction.statusCode, 200, reaction.body);
    }
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("M1 send and account deletion serialize into a durable view-only overlay", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "send_delete_alice");
    const bob = await register(app, database, "send_delete_bob");
    const { conversationId } = await formPartnership(app, alice, bob, "send_delete");
    const reauthedCookie = await reauthenticate(app, alice);

    const [send, deletion] = await Promise.all([
      sendMessage(
        app,
        bob,
        conversationId,
        "racing deletion",
        "m1-send-delete-race-message-key",
      ),
      app.inject({
        method: "POST",
        url: "/api/v1/me/account-deletion",
        headers: jsonHeaders(reauthedCookie),
        payload: {},
      }),
    ]);
    assert.equal(deletion.statusCode, 200, deletion.body);
    assert.ok(send.statusCode === 201 || send.statusCode === 409, send.body);
    if (send.statusCode === 409) {
      assert.equal(
        (send.json() as { error: { code: string } }).error.code,
        "ACCOUNT_LOCKED",
      );
    }

    const current = await app.inject({
      method: "GET",
      url: "/api/v1/conversations/current",
      headers: { cookie: bob.cookie },
    });
    assert.equal(current.statusCode, 200, current.body);
    assert.equal(
      (current.json() as { conversation: { interactionMode: string } }).conversation
        .interactionMode,
      "account_deletion_view_only",
    );

    const laterSend = await sendMessage(
      app,
      bob,
      conversationId,
      "must remain blocked",
      "m1-send-delete-after-overlay-key",
    );
    assert.equal(laterSend.statusCode, 409, laterSend.body);
    assert.equal(
      (laterSend.json() as { error: { code: string } }).error.code,
      "ACCOUNT_LOCKED",
    );
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("M1 message mutation and final dissolution serialize with authorization revoked at termination", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "final_race_alice");
    const bob = await register(app, database, "final_race_bob");
    const { partnershipId, conversationId } = await formPartnership(
      app,
      alice,
      bob,
      "final_race",
    );

    const breakup = await app.inject({
      method: "POST",
      url: "/api/v1/partnerships/" + partnershipId + "/breakup",
      headers: mutationHeaders(alice.cookie, "m1-final-race-breakup-key"),
    });
    assert.equal(breakup.statusCode, 200, breakup.body);

    const sent = await sendMessage(
      app,
      bob,
      conversationId,
      "post-cutoff mutable",
      "m1-final-race-message-key",
    );
    assert.equal(sent.statusCode, 201, sent.body);
    const messageId = (sent.json() as { messageId: string }).messageId;

    const [edit] = await Promise.all([
      app.inject({
        method: "PATCH",
        url: "/api/v1/conversations/" + conversationId + "/messages/" + messageId,
        headers: jsonHeaders(bob.cookie, "m1-final-race-edit-key"),
        payload: { body: "race edit", expectedContentVersion: 1 },
      }),
      withTransaction(database, async (transaction) => {
        const now = await getTransactionTimestamp(transaction);
        await lockAccounts(transaction, [alice.accountId, bob.accountId]);
        const generation = await terminatePartnershipLifecycle(transaction, {
          partnershipId,
          reason: "breakup",
          effectiveAt: now,
        });
        assert.ok(generation !== null);
      }),
    ]);

    assert.ok(edit.statusCode === 200 || edit.statusCode === 404, edit.body);

    const partnership = await database.pool.query<{
      lifecycle_state: string;
      released_count: string;
    }>(
      "SELECT lifecycle_state, (SELECT count(*)::text FROM partnership_members WHERE partnership_id = $1 AND released_at IS NOT NULL) AS released_count FROM partnerships WHERE id = $1",
      [partnershipId],
    );
    assert.equal(partnership.rows[0]?.lifecycle_state, "terminated");
    assert.equal(partnership.rows[0]?.released_count, "2");

    const after = await app.inject({
      method: "GET",
      url: "/api/v1/conversations/" + conversationId + "/messages/" + messageId,
      headers: { cookie: bob.cookie },
    });
    assert.equal(after.statusCode, 404, after.body);
    assert.equal(
      (after.json() as { error: { code: string } }).error.code,
      "CONVERSATION_NOT_FOUND",
    );
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("M1 concurrent sends stay gap-free and guessed cross-partnership identifiers fail closed", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "race_alice");
    const bob = await register(app, database, "race_bob");
    const carol = await register(app, database, "race_carol");
    const dave = await register(app, database, "race_dave");
    const firstPair = await formPartnership(app, alice, bob, "race_first");
    const secondPair = await formPartnership(app, carol, dave, "race_second");

    const secondPairMessage = await sendMessage(
      app,
      carol,
      secondPair.conversationId,
      "second partnership message",
      "m1-race-second-pair-message-key",
    );
    assert.equal(secondPairMessage.statusCode, 201, secondPairMessage.body);
    const secondPairMessageId = (secondPairMessage.json() as { messageId: string }).messageId;

    const invalidCrossReply = await sendMessage(
      app,
      alice,
      firstPair.conversationId,
      "invalid cross-partnership reply",
      "m1-race-invalid-cross-reply-key",
      secondPairMessageId,
    );
    assert.equal(invalidCrossReply.statusCode, 404, invalidCrossReply.body);
    assert.equal(
      (invalidCrossReply.json() as { error: { code: string } }).error.code,
      "MESSAGE_NOT_FOUND",
    );

    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        sendMessage(
          app,
          index % 2 === 0 ? alice : bob,
          firstPair.conversationId,
          "race " + index,
          "m1-race-send-key-" + String(index).padStart(4, "0"),
        ),
      ),
    );
    assert.equal(responses.every((response) => response.statusCode === 201), true);

    const sequences = responses
      .map((response) => (response.json() as { serverSequence: number }).serverSequence)
      .sort((left, right) => left - right);
    const changes = responses
      .map((response) => (response.json() as { changeSequence: number }).changeSequence)
      .sort((left, right) => left - right);
    assert.deepEqual(sequences, [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(changes, [1, 2, 3, 4, 5, 6, 7, 8]);

    const otherHistory = await app.inject({
      method: "GET",
      url:
        "/api/v1/conversations/"
        + secondPair.conversationId
        + "/messages?limit=50",
      headers: { cookie: alice.cookie },
    });
    assert.equal(otherHistory.statusCode, 404, otherHistory.body);
    assert.equal(
      (otherHistory.json() as { error: { code: string } }).error.code,
      "CONVERSATION_NOT_FOUND",
    );

    const otherSend = await sendMessage(
      app,
      alice,
      secondPair.conversationId,
      "cross partnership",
      "m1-cross-send-key-0001",
    );
    assert.equal(otherSend.statusCode, 404, otherSend.body);
    assert.equal(
      (otherSend.json() as { error: { code: string } }).error.code,
      "CONVERSATION_NOT_FOUND",
    );

    const firstMessage = await database.pool.query<{ id: string }>(
      "SELECT id FROM messages WHERE conversation_id = $1 ORDER BY server_sequence LIMIT 1",
      [firstPair.conversationId],
    );
    const guessedMessage = await app.inject({
      method: "GET",
      url:
        "/api/v1/conversations/"
        + secondPair.conversationId
        + "/messages/"
        + firstMessage.rows[0]?.id,
      headers: { cookie: carol.cookie },
    });
    assert.equal(guessedMessage.statusCode, 404, guessedMessage.body);
    assert.equal(
      (guessedMessage.json() as { error: { code: string } }).error.code,
      "MESSAGE_NOT_FOUND",
    );
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});
