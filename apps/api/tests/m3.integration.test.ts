import assert from "node:assert/strict";
import test from "node:test";
import type {
  MediaObjectStore,
  MediaUploadGrant,
  MediaDownloadGrant,
} from "@shawtie/media-storage";
import {
  closeDatabasePool,
  createDatabasePool,
  databaseConfigFromEnv,
  getTransactionTimestamp,
  lockAccounts,
  terminatePartnershipLifecycle,
  type DatabasePool,
  withTransaction,
} from "@shawtie/db";
import { createApiApplication } from "../src/application.ts";
import { AuthKeyRing } from "../src/security/auth-key-ring.ts";
import type { ApiConfig } from "../src/config.ts";

function requireDisposableDatabase(): DatabasePool {
  if (process.env.DB_TEST_CONFIRM !== "1") {
    throw new Error("DB_TEST_CONFIRM=1 is required for disposable M3 integration tests");
  }
  return createDatabasePool({
    ...databaseConfigFromEnv(),
    applicationName: "shawtie-m3-api-test",
    maxConnections: 28,
  });
}

class FakeMediaStore implements MediaObjectStore {
  readonly grants = new Map<string, string>();
  readonly deleted: string[] = [];
  failVerification = false;

  async createUploadGrant(input: {
    readonly objectKey: string;
    readonly sha256: string;
    readonly expiresAt: Date;
  }): Promise<MediaUploadGrant> {
    this.grants.set(input.objectKey, input.sha256);
    return {
      url: "https://media.invalid/upload/" + encodeURIComponent(input.objectKey),
      expiresAt: input.expiresAt,
      requiredHeaders: {
        "content-type": "application/octet-stream",
        "if-none-match": "*",
        "x-amz-meta-sha256": input.sha256,
      },
    };
  }

  async verifyObject(input: {
    readonly objectKey: string;
    readonly expectedBytes: bigint;
    readonly sha256: string;
  }): Promise<boolean> {
    if (this.failVerification) throw new Error("MEDIA_STORAGE_HEAD_FAILED_503");
    return input.expectedBytes > 0n && this.grants.get(input.objectKey) === input.sha256;
  }

  async createDownloadGrant(input: {
    readonly objectKey: string;
    readonly expiresAt: Date;
  }): Promise<MediaDownloadGrant> {
    return {
      url: "https://media.invalid/download/" + encodeURIComponent(input.objectKey),
      expiresAt: input.expiresAt,
    };
  }

  async deleteObject(objectKey: string): Promise<void> {
    this.deleted.push(objectKey);
    this.grants.delete(objectKey);
  }
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

interface Account {
  readonly accountId: string;
  readonly cookie: string;
  readonly username: string;
}

function headers(cookie?: string, key?: string): Record<string, string> {
  return {
    origin: config.appOrigin,
    "x-shawtie-csrf": "1",
    "content-type": "application/json",
    ...(cookie ? { cookie } : {}),
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
  await database.pool.query("DELETE FROM idempotency_records");
}

async function registrationCode(
  database: DatabasePool,
  registrationIntentId: string,
): Promise<string> {
  const result = await database.pool.query<{
    id: string;
    purpose: string;
    challenge_nonce: Buffer;
    verifier_key_version: number;
  }>(
    "SELECT id, purpose, challenge_nonce, verifier_key_version FROM email_verifications WHERE registration_intent_id = $1 AND purpose = 'registration' AND consumed_at IS NULL AND superseded_at IS NULL LIMIT 1",
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

async function register(app: App, database: DatabasePool, suffix: string): Promise<Account> {
  const username = "m3_" + suffix;
  const start = await app.inject({
    method: "POST",
    url: "/api/v1/auth/registration/start",
    headers: headers(),
    payload: {
      username,
      displayName: "M3 " + suffix,
      dateOfBirth: "2000-01-01",
      email: username + "@example.test",
      password: "very secure M3 password " + suffix,
    },
  });
  assert.equal(start.statusCode, 200, start.body);
  const registrationIntentId = (start.json() as { registrationIntentId: string })
    .registrationIntentId;
  const code = await registrationCode(database, registrationIntentId);
  const verify = await app.inject({
    method: "POST",
    url: "/api/v1/auth/registration/verify",
    headers: headers(),
    payload: { registrationIntentId, code, deviceName: "M3 Browser" },
  });
  assert.equal(verify.statusCode, 200, verify.body);
  return {
    accountId: (verify.json() as { accountId: string }).accountId,
    cookie: cookieHeader(verify),
    username,
  };
}

async function formPartnership(
  app: App,
  alice: Account,
  bob: Account,
  suffix: string,
): Promise<{ partnershipId: string; conversationId: string }> {
  const request = await app.inject({
    method: "POST",
    url: "/api/v1/partner-requests",
    headers: headers(alice.cookie, "m3-partner-" + suffix),
    payload: {
      recipientAccountId: bob.accountId,
      expectedUsername: bob.username,
      relationshipStartDate: "2020-01-01",
    },
  });
  assert.equal(request.statusCode, 201, request.body);
  const requestId = (request.json() as { requestId: string }).requestId;
  const accepted = await app.inject({
    method: "POST",
    url: "/api/v1/partner-requests/" + requestId + "/accept",
    headers: {
      origin: config.appOrigin,
      "x-shawtie-csrf": "1",
      cookie: bob.cookie,
    },
  });
  assert.equal(accepted.statusCode, 200, accepted.body);
  const partnershipId = (accepted.json() as { partnershipId: string }).partnershipId;
  const current = await app.inject({
    method: "GET",
    url: "/api/v1/conversations/current",
    headers: { cookie: alice.cookie },
  });
  assert.equal(current.statusCode, 200, current.body);
  const conversationId = (
    current.json() as {
      conversation: { conversationId: string };
    }
  ).conversation.conversationId;
  return { partnershipId, conversationId };
}

async function readyMedia(
  app: App,
  account: Account,
  input: {
    readonly kind: "image" | "voice";
    readonly formatCode: "webp" | "webm_opus";
    readonly durationSeconds: number | null;
    readonly key: string;
  },
): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/media/uploads",
    headers: headers(account.cookie, input.key),
    payload: {
      kind: input.kind,
      formatCode: input.formatCode,
      ciphertextBytes: 128,
      ciphertextSha256: "a".repeat(64),
      cryptoProtocolVersion: "m3-test-aes-gcm-v1",
      durationSeconds: input.durationSeconds,
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  const body = created.json() as {
    mediaId: string;
    uploadGeneration: number;
    uploadUrl: string;
  };
  assert.equal(typeof body.uploadUrl, "string");

  const replay = await app.inject({
    method: "POST",
    url: "/api/v1/media/uploads",
    headers: headers(account.cookie, input.key),
    payload: {
      kind: input.kind,
      formatCode: input.formatCode,
      ciphertextBytes: 128,
      ciphertextSha256: "a".repeat(64),
      cryptoProtocolVersion: "m3-test-aes-gcm-v1",
      durationSeconds: input.durationSeconds,
    },
  });
  assert.equal(replay.statusCode, 201, replay.body);
  assert.equal((replay.json() as { mediaId: string }).mediaId, body.mediaId);

  const completed = await app.inject({
    method: "POST",
    url: "/api/v1/media/" + body.mediaId + "/complete",
    headers: headers(account.cookie),
    payload: { expectedUploadGeneration: body.uploadGeneration },
  });
  assert.equal(completed.statusCode, 200, completed.body);
  assert.equal((completed.json() as { state: string }).state, "ready_unbound");
  return body.mediaId;
}

test("M3 upload idempotency replay cannot cross into a future partnership", async () => {
  const database = requireDisposableDatabase();
  const store = new FakeMediaStore();
  const app = createApiApplication({ database, config, mediaObjectStore: store });
  try {
    await reset(database);
    const alice = await register(app, database, "future_a");
    const bob = await register(app, database, "future_b");
    const carol = await register(app, database, "future_c");
    const first = await formPartnership(app, alice, bob, "future_first");
    const idempotencyKey = "m3-future-upload-0001";
    const payload = {
      kind: "image" as const,
      formatCode: "webp" as const,
      ciphertextBytes: 128,
      ciphertextSha256: "c".repeat(64),
      cryptoProtocolVersion: "m3-test-aes-gcm-v1",
      durationSeconds: null,
    };

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/media/uploads",
      headers: headers(alice.cookie, idempotencyKey),
      payload,
    });
    assert.equal(created.statusCode, 201, created.body);
    const firstMedia = created.json() as { mediaId: string; uploadUrl: string };
    assert.equal(typeof firstMedia.uploadUrl, "string");

    await withTransaction(database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      await lockAccounts(transaction, [alice.accountId, bob.accountId]);
      const generation = await terminatePartnershipLifecycle(transaction, {
        partnershipId: first.partnershipId,
        reason: "breakup",
        effectiveAt: now,
      });
      assert.ok(generation !== null);
    });

    const second = await formPartnership(app, alice, carol, "future_second");
    assert.notEqual(second.partnershipId, first.partnershipId);
    const grantsBeforeReplay = new Map(store.grants);

    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/media/uploads",
      headers: headers(alice.cookie, idempotencyKey),
      payload,
    });
    assert.equal(replay.statusCode, 409, replay.body);
    assert.equal(
      (replay.json() as { error: { code: string } }).error.code,
      "IDEMPOTENCY_KEY_REUSED",
    );
    assert.equal(replay.body.includes(firstMedia.mediaId), false);
    assert.deepEqual(store.grants, grantsBeforeReplay);

    const persisted = await database.pool.query<{
      partnership_id: string;
      storage_object_key: string;
    }>("SELECT partnership_id, storage_object_key FROM media_objects WHERE id = $1", [
      firstMedia.mediaId,
    ]);
    assert.equal(persisted.rows[0]?.partnership_id, first.partnershipId);
    assert.equal(replay.body.includes(persisted.rows[0]?.storage_object_key ?? ""), false);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("M3 upload binds atomically to M1 and message deletion revokes partner access", async () => {
  const database = requireDisposableDatabase();
  const store = new FakeMediaStore();
  const app = createApiApplication({ database, config, mediaObjectStore: store });
  try {
    await reset(database);
    const alice = await register(app, database, "message_a");
    const bob = await register(app, database, "message_b");
    const { conversationId } = await formPartnership(app, alice, bob, "message");

    const mediaId = await readyMedia(app, alice, {
      kind: "image",
      formatCode: "webp",
      durationSeconds: null,
      key: "m3-image-upload-0001",
    });

    const sent = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/" + conversationId + "/messages",
      headers: headers(alice.cookie, "m3-message-send-0001"),
      payload: {
        body: "photo",
        replyToMessageId: null,
        attachments: [{ mediaId, role: "attachment", position: 0 }],
      },
    });
    assert.equal(sent.statusCode, 201, sent.body);
    const messageId = (sent.json() as { messageId: string }).messageId;

    const projected = await app.inject({
      method: "GET",
      url: "/api/v1/conversations/" + conversationId + "/messages/" + messageId,
      headers: { cookie: bob.cookie },
    });
    assert.equal(projected.statusCode, 200, projected.body);
    const attachments = (projected.json() as { attachments: Array<{ mediaId: string }> })
      .attachments;
    assert.deepEqual(
      attachments.map((entry) => entry.mediaId),
      [mediaId],
    );

    const partnerAccess = await app.inject({
      method: "GET",
      url: "/api/v1/media/" + mediaId + "/access",
      headers: { cookie: bob.cookie },
    });
    assert.equal(partnerAccess.statusCode, 200, partnerAccess.body);

    const reused = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/" + conversationId + "/messages",
      headers: headers(alice.cookie, "m3-message-send-0002"),
      payload: {
        body: null,
        replyToMessageId: null,
        attachments: [{ mediaId, role: "attachment", position: 0 }],
      },
    });
    assert.equal(reused.statusCode, 409, reused.body);

    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/v1/conversations/" + conversationId + "/messages/" + messageId,
      headers: {
        origin: config.appOrigin,
        "x-shawtie-csrf": "1",
        cookie: alice.cookie,
        "idempotency-key": "m3-message-delete-0001",
      },
    });
    assert.equal(deleted.statusCode, 200, deleted.body);

    const afterDelete = await app.inject({
      method: "GET",
      url: "/api/v1/media/" + mediaId + "/access",
      headers: { cookie: bob.cookie },
    });
    assert.equal(afterDelete.statusCode, 404, afterDelete.body);

    const persisted = await database.pool.query<{ state: string; deleted_at: Date | null }>(
      "SELECT state, deleted_at FROM media_objects WHERE id = $1",
      [mediaId],
    );
    assert.equal(persisted.rows[0]?.state, "deletion_pending");
    assert.ok(persisted.rows[0]?.deleted_at);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("M3 Voice Letter inherits sealed R1 visibility until recipient release", async () => {
  const database = requireDisposableDatabase();
  const store = new FakeMediaStore();
  const app = createApiApplication({ database, config, mediaObjectStore: store });
  try {
    await reset(database);
    const alice = await register(app, database, "letter_a");
    const bob = await register(app, database, "letter_b");
    await formPartnership(app, alice, bob, "letter");

    const mediaId = await readyMedia(app, alice, {
      kind: "voice",
      formatCode: "webm_opus",
      durationSeconds: 5,
      key: "m3-letter-upload-0001",
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/relationship-space/items",
      headers: headers(alice.cookie, "m3-letter-create-0001"),
      payload: {
        kind: "future_us",
        contentSchemaVersion: 1,
        preview: { title: "Later", conditionLabel: "When you want to hear me" },
        content: { body: "A sealed voice letter." },
        occurrence: null,
        storyIncluded: false,
        release: { mode: "recipient_open", unlockAt: null },
        featureState: null,
        references: [
          {
            referenceType: "media",
            referenceId: mediaId,
            role: "voice_letter",
            position: 0,
          },
        ],
        links: [],
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    const itemId = (created.json() as { itemId: string }).itemId;

    const before = await app.inject({
      method: "GET",
      url: "/api/v1/media/" + mediaId + "/access",
      headers: { cookie: bob.cookie },
    });
    assert.equal(before.statusCode, 404, before.body);

    const opened = await app.inject({
      method: "POST",
      url: "/api/v1/relationship-space/items/" + itemId + "/release",
      headers: headers(bob.cookie, "m3-letter-release-0001"),
      payload: { expectedVersion: 1 },
    });
    assert.equal(opened.statusCode, 200, opened.body);

    const after = await app.inject({
      method: "GET",
      url: "/api/v1/media/" + mediaId + "/access",
      headers: { cookie: bob.cookie },
    });
    assert.equal(after.statusCode, 200, after.body);
    assert.equal((after.json() as { media: { binding: { id: string } } }).media.binding.id, itemId);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("M3 unbound media is uploader-only and refresh rotates generation", async () => {
  const database = requireDisposableDatabase();
  const store = new FakeMediaStore();
  const app = createApiApplication({ database, config, mediaObjectStore: store });
  try {
    await reset(database);
    const alice = await register(app, database, "private_a");
    const bob = await register(app, database, "private_b");
    await formPartnership(app, alice, bob, "private");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/media/uploads",
      headers: headers(alice.cookie, "m3-private-upload-0001"),
      payload: {
        kind: "image",
        formatCode: "webp",
        ciphertextBytes: 128,
        ciphertextSha256: "b".repeat(64),
        cryptoProtocolVersion: "m3-test-aes-gcm-v1",
        durationSeconds: null,
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    const media = created.json() as { mediaId: string; uploadGeneration: number };

    const hidden = await app.inject({
      method: "GET",
      url: "/api/v1/media/" + media.mediaId + "/access",
      headers: { cookie: bob.cookie },
    });
    assert.equal(hidden.statusCode, 404, hidden.body);

    const refreshed = await app.inject({
      method: "POST",
      url: "/api/v1/media/" + media.mediaId + "/refresh-upload",
      headers: headers(alice.cookie),
      payload: { expectedUploadGeneration: media.uploadGeneration },
    });
    assert.equal(refreshed.statusCode, 200, refreshed.body);
    assert.equal(
      (refreshed.json() as { uploadGeneration: number }).uploadGeneration,
      media.uploadGeneration + 1,
    );
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("M3 provider outage during completion fails closed as MEDIA_UNAVAILABLE and stays retryable", async () => {
  const database = requireDisposableDatabase();
  const store = new FakeMediaStore();
  const app = createApiApplication({ database, config, mediaObjectStore: store });
  try {
    await reset(database);
    const alice = await register(app, database, "outage_a");
    const bob = await register(app, database, "outage_b");
    await formPartnership(app, alice, bob, "outage");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/media/uploads",
      headers: headers(alice.cookie, "m3-outage-upload-0001"),
      payload: {
        kind: "image",
        formatCode: "webp",
        ciphertextBytes: 128,
        ciphertextSha256: "c".repeat(64),
        cryptoProtocolVersion: "m3-test-aes-gcm-v1",
        durationSeconds: null,
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    const media = created.json() as { mediaId: string; uploadGeneration: number };

    store.failVerification = true;
    const outage = await app.inject({
      method: "POST",
      url: "/api/v1/media/" + media.mediaId + "/complete",
      headers: headers(alice.cookie),
      payload: { expectedUploadGeneration: media.uploadGeneration },
    });
    assert.equal(outage.statusCode, 503, outage.body);
    assert.equal((outage.json() as { error: { code: string } }).error.code, "MEDIA_UNAVAILABLE");
    const stillUploading = await database.pool.query<{ state: string }>(
      "SELECT state FROM media_objects WHERE id = $1",
      [media.mediaId],
    );
    assert.equal(stillUploading.rows[0]?.state, "uploading");

    store.failVerification = false;
    const recovered = await app.inject({
      method: "POST",
      url: "/api/v1/media/" + media.mediaId + "/complete",
      headers: headers(alice.cookie),
      payload: { expectedUploadGeneration: media.uploadGeneration },
    });
    assert.equal(recovered.statusCode, 200, recovered.body);
    assert.equal((recovered.json() as { state: string }).state, "ready_unbound");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});
