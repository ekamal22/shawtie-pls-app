import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  randomUUID,
  sign,
  type KeyObject,
} from "node:crypto";
import test from "node:test";
import {
  S1_CRYPTO_PROFILE,
  S1_MLS_CIPHERSUITE,
} from "@shawtie/contracts";
import {
  closeDatabasePool,
  createDatabasePool,
  databaseConfigFromEnv,
  type DatabasePool,
} from "@shawtie/db";
import {
  contentSignatureInput,
  envelopeContext,
} from "@shawtie/crypto";
import { createApiApplication } from "../src/application.ts";
import { AuthKeyRing } from "../src/security/auth-key-ring.ts";
import type { ApiConfig } from "../src/config.ts";

function requireDisposableDatabase(): DatabasePool {
  if (process.env.DB_TEST_CONFIRM !== "1") {
    throw new Error("DB_TEST_CONFIRM=1 is required for disposable S1 integration tests");
  }
  return createDatabasePool({
    ...databaseConfigFromEnv(),
    applicationName: "shawtie-s1-api-test",
    maxConnections: 24,
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

interface Account {
  readonly accountId: string;
  readonly cookie: string;
  readonly username: string;
  readonly deviceId: string;
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

async function register(
  app: App,
  database: DatabasePool,
  suffix: string,
): Promise<Account> {
  const username = "s1_" + suffix;
  const start = await app.inject({
    method: "POST",
    url: "/api/v1/auth/registration/start",
    headers: headers(),
    payload: {
      username,
      displayName: "S1 " + suffix,
      dateOfBirth: "2000-01-01",
      email: username + "@example.test",
      password: "very secure S1 password " + suffix,
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
    payload: {
      registrationIntentId,
      code,
      deviceName: "S1 Browser",
    },
  });
  assert.equal(verify.statusCode, 200, verify.body);
  const accountId = (verify.json() as { accountId: string }).accountId;
  const device = await database.pool.query<{ id: string }>(
    "SELECT id FROM account_devices WHERE account_id = $1 ORDER BY created_at LIMIT 1",
    [accountId],
  );
  if (!device.rows[0]) throw new Error("Missing account device");
  return {
    accountId,
    cookie: cookieHeader(verify),
    username,
    deviceId: device.rows[0].id,
  };
}

async function formPartnership(
  app: App,
  alice: Account,
  bob: Account,
): Promise<{ partnershipId: string; conversationId: string }> {
  const request = await app.inject({
    method: "POST",
    url: "/api/v1/partner-requests",
    headers: headers(alice.cookie, "s1-partner-request"),
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
    headers: headers(bob.cookie),
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
    current.json() as { conversation: { conversationId: string } }
  ).conversation.conversationId;
  return { partnershipId, conversationId };
}

function rawEd25519PublicKey(publicKey: KeyObject): Buffer {
  const spki = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  return spki.subarray(spki.length - 32);
}

async function seedCrypto(
  database: DatabasePool,
  partnershipId: string,
  alice: Account,
  bob: Account,
): Promise<{
  aliceCryptoDeviceId: string;
  alicePrivateKey: KeyObject;
}> {
  const aliceSigning = generateKeyPairSync("ed25519");
  const bobSigning = generateKeyPairSync("ed25519");
  const aliceCryptoDeviceId = randomUUID();
  const bobCryptoDeviceId = randomUUID();
  const now = new Date();

  await database.pool.query(
    `INSERT INTO device_crypto_identities (
       crypto_device_id, device_id, account_id, crypto_profile,
       mls_signing_public_key, content_signing_public_key,
       trust_state, approved_at, created_at
     ) VALUES
       ($1,$2,$3,$4,$5,$6,'trusted',$7,$7),
       ($8,$9,$10,$4,$11,$12,'trusted',$7,$7)`,
    [
      aliceCryptoDeviceId,
      alice.deviceId,
      alice.accountId,
      S1_CRYPTO_PROFILE,
      Buffer.alloc(32, 1),
      rawEd25519PublicKey(aliceSigning.publicKey),
      now,
      bobCryptoDeviceId,
      bob.deviceId,
      bob.accountId,
      Buffer.alloc(32, 2),
      rawEd25519PublicKey(bobSigning.publicKey),
    ],
  );

  await database.pool.query(
    `INSERT INTO account_crypto_recovery (
       id, account_id, crypto_profile, recovery_key_version,
       recovery_hpke_public_key, recovery_auth_public_key,
       encrypted_bundle, created_by_crypto_device_id, created_at
     ) VALUES
       ($1,$2,$3,1,$4,$5,$6,$7,$8),
       ($9,$10,$3,1,$11,$12,$13,$14,$8)`,
    [
      randomUUID(),
      alice.accountId,
      S1_CRYPTO_PROFILE,
      Buffer.alloc(32, 3),
      Buffer.alloc(32, 4),
      Buffer.from("alice-encrypted-recovery"),
      aliceCryptoDeviceId,
      now,
      randomUUID(),
      bob.accountId,
      Buffer.alloc(32, 5),
      Buffer.alloc(32, 6),
      Buffer.from("bob-encrypted-recovery"),
      bobCryptoDeviceId,
    ],
  );

  await database.pool.query(
    `INSERT INTO partnership_crypto_groups (
       partnership_id, group_generation, group_id, crypto_profile,
       ciphersuite, current_epoch, control_sequence, rekey_required,
       status, created_by_crypto_device_id, created_at
     ) VALUES ($1,1,$2,$3,$4,1,0,false,'active',$5,$6)`,
    [
      partnershipId,
      Buffer.from("synthetic-s1-group"),
      S1_CRYPTO_PROFILE,
      S1_MLS_CIPHERSUITE,
      aliceCryptoDeviceId,
      now,
    ],
  );

  await database.pool.query(
    `INSERT INTO partnership_crypto_members (
       partnership_id, group_generation, crypto_device_id, account_id,
       leaf_index, joined_epoch, joined_at
     ) VALUES
       ($1,1,$2,$3,0,0,$6),
       ($1,1,$4,$5,1,1,$6)`,
    [
      partnershipId,
      aliceCryptoDeviceId,
      alice.accountId,
      bobCryptoDeviceId,
      bob.accountId,
      now,
    ],
  );

  await database.pool.query(
    `UPDATE partnerships
     SET crypto_profile = $2,
         crypto_required_from = $3,
         crypto_group_generation = 1
     WHERE id = $1`,
    [partnershipId, S1_CRYPTO_PROFILE, now],
  );

  return {
    aliceCryptoDeviceId,
    alicePrivateKey: aliceSigning.privateKey,
  };
}

function protectedMessageInput(input: {
  partnershipId: string;
  messageId: string;
  senderCryptoDeviceId: string;
  privateKey: KeyObject;
  accountIds: readonly [string, string];
  tamperSignature?: boolean;
}) {
  const ciphertext = Buffer.from("opaque-s1-ciphertext");
  const digest = createHash("sha256").update(ciphertext).digest();
  const nonce = Buffer.alloc(12, 9);
  const contentKeyId = randomUUID();
  const context = envelopeContext({
    partnershipId: input.partnershipId,
    groupGeneration: 1,
    mlsEpoch: 1,
    contentType: "message",
    contentId: input.messageId,
    contentVersion: 1,
    payloadRole: "message_body",
    senderCryptoDeviceId: input.senderCryptoDeviceId,
    schemaVersion: 1,
  });
  let signature = sign(
    null,
    Buffer.from(contentSignatureInput(context, contentKeyId, nonce, digest)),
    input.privateKey,
  );
  if (input.tamperSignature) {
    signature = Buffer.from(signature);
    signature[0] = (signature[0] ?? 0) ^ 0xff;
  }
  return {
    messageId: input.messageId,
    body: null,
    protectedBody: {
      ciphertext: ciphertext.toString("base64url"),
      envelope: {
        cryptoProfile: S1_CRYPTO_PROFILE,
        groupGeneration: 1,
        mlsEpoch: 1,
        senderCryptoDeviceId: input.senderCryptoDeviceId,
        contentKeyId,
        nonce: nonce.toString("base64url"),
        ciphertextSha256: digest.toString("base64url"),
        keyDistributionMessage: Buffer.from("synthetic-mls-kdm").toString("base64url"),
        contentSignature: signature.toString("base64url"),
        recoveryCapsules: input.accountIds.map((accountId, index) => ({
          accountId,
          recoveryKeyVersion: 1,
          encapsulation: Buffer.alloc(32, 20 + index).toString("base64url"),
          ciphertext: Buffer.from("synthetic-recovery-" + index).toString("base64url"),
        })),
      },
    },
    replyToMessageId: null,
    attachments: [],
  };
}

test("S1 crypto-required messaging persists ciphertext only and rejects plaintext or bad signatures", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "alice");
    const bob = await register(app, database, "bob");
    const { partnershipId, conversationId } = await formPartnership(app, alice, bob);
    const cryptoState = await seedCrypto(database, partnershipId, alice, bob);

    const messageId = randomUUID();
    const protectedPayload = protectedMessageInput({
      partnershipId,
      messageId,
      senderCryptoDeviceId: cryptoState.aliceCryptoDeviceId,
      privateKey: cryptoState.alicePrivateKey,
      accountIds: [alice.accountId, bob.accountId],
    });

    const sent = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/" + conversationId + "/messages",
      headers: headers(alice.cookie, "s1-protected-send"),
      payload: protectedPayload,
    });
    assert.equal(sent.statusCode, 201, sent.body);

    const stored = await database.pool.query<{
      body_text: string | null;
      ciphertext: Buffer | null;
      body_content_key_id: string | null;
    }>(
      "SELECT body_text, ciphertext, body_content_key_id FROM messages WHERE id = $1",
      [messageId],
    );
    assert.equal(stored.rows[0]?.body_text, null);
    assert.deepEqual(stored.rows[0]?.ciphertext, Buffer.from("opaque-s1-ciphertext"));
    assert.equal(typeof stored.rows[0]?.body_content_key_id, "string");

    const recoveryCapsules = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM content_key_recovery_capsules WHERE content_key_id = $1",
      [stored.rows[0]!.body_content_key_id],
    );
    assert.equal(recoveryCapsules.rows[0]?.count, "2");

    const plaintext = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/" + conversationId + "/messages",
      headers: headers(alice.cookie, "s1-plaintext-send"),
      payload: {
        body: "plaintext must fail",
        replyToMessageId: null,
        attachments: [],
      },
    });
    assert.equal(plaintext.statusCode, 409, plaintext.body);
    assert.equal(
      (plaintext.json() as { error: { code: string } }).error.code,
      "CRYPTO_REQUIRED",
    );

    const tamperedMessageId = randomUUID();
    const tampered = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/" + conversationId + "/messages",
      headers: headers(alice.cookie, "s1-tampered-send"),
      payload: protectedMessageInput({
        partnershipId,
        messageId: tamperedMessageId,
        senderCryptoDeviceId: cryptoState.aliceCryptoDeviceId,
        privateKey: cryptoState.alicePrivateKey,
        accountIds: [alice.accountId, bob.accountId],
        tamperSignature: true,
      }),
    });
    assert.equal(tampered.statusCode, 403, tampered.body);
    assert.equal(
      (tampered.json() as { error: { code: string } }).error.code,
      "CRYPTO_SIGNATURE_INVALID",
    );

    const tamperedStored = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM messages WHERE id = $1",
      [tamperedMessageId],
    );
    assert.equal(tamperedStored.rows[0]?.count, "0");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});
