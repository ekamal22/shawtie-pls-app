import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { MediaDownloadGrant, MediaObjectStore, MediaUploadGrant } from "@shawtie/media-storage";
import {
  closeDatabasePool,
  createDatabasePool,
  createPartnershipDeletionManifestIfAbsent,
  databaseConfigFromEnv,
  insertAccount,
  insertAccountProfile,
  insertCurrentEmail,
  insertMediaUpload,
  insertScheduledAction,
  loadMediaObject,
  markMediaDeletionPending,
  markMediaReady,
  type DatabasePool,
} from "@shawtie/db";
import {
  createDefaultDeletionHandlers,
  createDefaultScheduledHandlers,
} from "../src/auth/default-account-handlers.ts";
import { runDeletionBatch } from "../src/deletion/deletion-consumer.ts";
import { defaultRetryPolicy } from "../src/runtime/retry-policy.ts";
import { runScheduledBatch } from "../src/scheduled/scheduled-consumer.ts";

class FakeMediaStore implements MediaObjectStore {
  readonly deleted: string[] = [];
  async createUploadGrant(input: {
    readonly objectKey: string;
    readonly sha256: string;
    readonly expiresAt: Date;
  }): Promise<MediaUploadGrant> {
    return { url: "https://invalid/" + input.objectKey, expiresAt: input.expiresAt, requiredHeaders: {} };
  }
  async verifyObject(): Promise<boolean> {
    return true;
  }
  async createDownloadGrant(input: {
    readonly objectKey: string;
    readonly expiresAt: Date;
  }): Promise<MediaDownloadGrant> {
    return { url: "https://invalid/" + input.objectKey, expiresAt: input.expiresAt };
  }
  async deleteObject(objectKey: string): Promise<void> {
    this.deleted.push(objectKey);
  }
}

function requireDisposableDatabase(): DatabasePool {
  if (process.env.DB_TEST_CONFIRM !== "1") {
    throw new Error("DB_TEST_CONFIRM=1 is required for disposable M3 worker tests");
  }
  return createDatabasePool({
    ...databaseConfigFromEnv(),
    applicationName: "shawtie-m3-worker-test",
    maxConnections: 16,
  });
}

async function reset(database: DatabasePool): Promise<void> {
  await database.pool.query(
    "TRUNCATE TABLE accounts, partnerships, outbox_events, scheduled_actions, deletion_manifests CASCADE",
  );
}

async function account(database: DatabasePool, username: string, at: Date): Promise<string> {
  const accountId = randomUUID();
  await insertAccount(database.pool, {
    id: accountId,
    usernameNormalized: username,
    usernameDisplay: username,
    dateOfBirth: "2000-01-01",
    createdAt: at,
  });
  await insertAccountProfile(database.pool, { accountId, displayName: username, at });
  await insertCurrentEmail(database.pool, {
    id: randomUUID(),
    accountId,
    emailNormalized: username + "@example.test",
    emailDisplay: username + "@example.test",
    at,
  });
  return accountId;
}

async function partnership(
  database: DatabasePool,
  firstAccountId: string,
  secondAccountId: string,
  at: Date,
): Promise<string> {
  const partnershipId = randomUUID();
  await database.pool.query(
    "INSERT INTO partnerships (id, relationship_start_date, lifecycle_state, generation, version, activated_at, created_at, updated_at) VALUES ($1, DATE '2024-01-01', 'active', 1, 1, $2, $2, $2)",
    [partnershipId, at],
  );
  await database.pool.query(
    "INSERT INTO partnership_members (partnership_id, account_id, joined_at) VALUES ($1,$2,$4),($1,$3,$4)",
    [partnershipId, firstAccountId, secondAccountId, at],
  );
  return partnershipId;
}

async function media(
  database: DatabasePool,
  input: {
    readonly partnershipId: string;
    readonly uploaderAccountId: string;
    readonly objectKey: string;
    readonly at: Date;
    readonly expiresAt: Date;
  },
): Promise<string> {
  const mediaId = randomUUID();
  await insertMediaUpload(database.pool, {
    id: mediaId,
    partnershipId: input.partnershipId,
    uploaderAccountId: input.uploaderAccountId,
    uploaderDeviceId: null,
    storageObjectKey: input.objectKey,
    mediaKind: "image",
    formatCode: "webp",
    ciphertextSize: 128n,
    ciphertextSha256: "a".repeat(64),
    cryptoProtocolVersion: "m3-test-aes-gcm-v1",
    durationSeconds: null,
    uploadExpiresAt: input.expiresAt,
    createdAt: input.at,
  });
  return mediaId;
}

async function scheduled(database: DatabasePool, store: MediaObjectStore): Promise<number> {
  return runScheduledBatch(
    database,
    "m3-worker",
    createDefaultScheduledHandlers(store),
    {
      batchSize: 20,
      concurrency: 1,
      leaseMs: 60_000,
      retryPolicy: defaultRetryPolicy,
    },
  );
}

test("M3 abandoned upload expiry deletes ciphertext and metadata", async () => {
  const database = requireDisposableDatabase();
  const store = new FakeMediaStore();
  try {
    await reset(database);
    const now = new Date();
    const alice = await account(database, "m3_expire_a", now);
    const bob = await account(database, "m3_expire_b", now);
    const partnershipId = await partnership(database, alice, bob, now);
    const mediaId = await media(database, {
      partnershipId,
      uploaderAccountId: alice,
      objectKey: "media/v1/expire",
      at: new Date(now.getTime() - 60_000),
      expiresAt: new Date(now.getTime() - 1_000),
    });
    await insertScheduledAction(database.pool, {
      id: randomUUID(),
      actionType: "m3.media_upload_expire",
      aggregateType: "media_object",
      aggregateId: mediaId,
      executeAt: new Date(now.getTime() - 1_000),
      expectedGeneration: 1n,
      deduplicationKey: "m3-test-expire:" + mediaId,
      payload: {},
      payloadVersion: 1,
    });

    assert.equal(await scheduled(database, store), 1);
    assert.deepEqual(store.deleted, ["media/v1/expire"]);
    assert.equal(await loadMediaObject(database.pool, mediaId), null);
  } finally {
    await closeDatabasePool(database);
  }
});

test("M3 individual deletion is idempotent around object-first cleanup", async () => {
  const database = requireDisposableDatabase();
  const store = new FakeMediaStore();
  try {
    await reset(database);
    const now = new Date();
    const alice = await account(database, "m3_delete_a", now);
    const bob = await account(database, "m3_delete_b", now);
    const partnershipId = await partnership(database, alice, bob, now);
    const mediaId = await media(database, {
      partnershipId,
      uploaderAccountId: alice,
      objectKey: "media/v1/delete",
      at: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    assert.equal(
      await markMediaReady(database.pool, mediaId, 1n, now, new Date(now.getTime() + 60_000)),
      true,
    );
    const generation = await markMediaDeletionPending(database.pool, mediaId, now);
    assert.ok(generation);
    await insertScheduledAction(database.pool, {
      id: randomUUID(),
      actionType: "m3.media_delete",
      aggregateType: "media_object",
      aggregateId: mediaId,
      executeAt: now,
      expectedGeneration: generation as bigint,
      deduplicationKey: "m3-test-delete:" + mediaId,
      payload: {},
      payloadVersion: 1,
    });

    assert.equal(await scheduled(database, store), 1);
    assert.deepEqual(store.deleted, ["media/v1/delete"]);
    assert.equal(await loadMediaObject(database.pool, mediaId), null);
    assert.equal(await scheduled(database, store), 0);
  } finally {
    await closeDatabasePool(database);
  }
});

test("M3 partnership deletion target removes every object before metadata", async () => {
  const database = requireDisposableDatabase();
  const store = new FakeMediaStore();
  try {
    await reset(database);
    const now = new Date();
    const alice = await account(database, "m3_manifest_a", now);
    const bob = await account(database, "m3_manifest_b", now);
    const partnershipId = await partnership(database, alice, bob, now);
    const first = await media(database, {
      partnershipId,
      uploaderAccountId: alice,
      objectKey: "media/v1/manifest-a",
      at: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    const second = await media(database, {
      partnershipId,
      uploaderAccountId: bob,
      objectKey: "media/v1/manifest-b",
      at: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });

    await createPartnershipDeletionManifestIfAbsent(database.pool, {
      id: randomUUID(),
      subjectType: "partnership",
      subjectId: partnershipId,
      reason: "breakup_dissolution",
      accessRevokedAt: now,
      targets: [{
        id: randomUUID(),
        targetType: "partnership_media_objects",
        targetKey: partnershipId,
      }],
    });

    const processed = await runDeletionBatch(
      database,
      "m3-media-manifest",
      createDefaultDeletionHandlers(database, store),
      new AbortController().signal,
      {
        batchSize: 20,
        concurrency: 1,
        leaseMs: 60_000,
        retryPolicy: defaultRetryPolicy,
      },
    );
    assert.equal(processed, 1);
    assert.deepEqual(store.deleted.sort(), ["media/v1/manifest-a", "media/v1/manifest-b"]);
    assert.equal(await loadMediaObject(database.pool, first), null);
    assert.equal(await loadMediaObject(database.pool, second), null);
  } finally {
    await closeDatabasePool(database);
  }
});
