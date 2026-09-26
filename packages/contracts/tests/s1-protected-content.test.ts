import assert from "node:assert/strict";
import test from "node:test";
import {
  S1_CRYPTO_PROFILE,
  encryptedProtectedContentProjectionSchema,
  encryptedProtectedContentSchema,
} from "../src/index.ts";

const uuid = () => crypto.randomUUID();
const key = Buffer.alloc(32, 1).toString("base64url");
const nonce = Buffer.alloc(12, 2).toString("base64url");
const digest = Buffer.alloc(32, 3).toString("base64url");
const signature = Buffer.alloc(64, 4).toString("base64url");
const mlsMessage = Buffer.from("mls-key-distribution").toString("base64url");
const capsule = {
  accountId: uuid(),
  recoveryKeyVersion: 1,
  encapsulation: Buffer.alloc(32, 5).toString("base64url"),
  ciphertext: Buffer.from("recovery-capsule").toString("base64url"),
};

test("S1 protected write envelope keeps recovery material input-only", () => {
  const parsed = encryptedProtectedContentSchema.safeParse({
    ciphertext: Buffer.from("ciphertext").toString("base64url"),
    envelope: {
      cryptoProfile: S1_CRYPTO_PROFILE,
      groupGeneration: 1,
      mlsEpoch: 2,
      senderCryptoDeviceId: uuid(),
      contentKeyId: uuid(),
      nonce,
      ciphertextSha256: digest,
      keyDistributionMessage: mlsMessage,
      contentSignature: signature,
      recoveryCapsules: [capsule, { ...capsule, accountId: uuid() }],
    },
  });
  assert.equal(parsed.success, true);
});

test("S1 protected projection carries the exact authenticated content context", () => {
  const contentId = uuid();
  const parsed = encryptedProtectedContentProjectionSchema.safeParse({
    ciphertext: Buffer.from("ciphertext").toString("base64url"),
    envelope: {
      cryptoProfile: S1_CRYPTO_PROFILE,
      partnershipId: uuid(),
      contentType: "relationship_item",
      contentId,
      contentVersion: 7,
      payloadRole: "relationship_main",
      schemaVersion: 1,
      groupGeneration: 3,
      mlsEpoch: 11,
      senderCryptoDeviceId: uuid(),
      contentKeyId: uuid(),
      nonce,
      ciphertextSha256: digest,
      keyDistributionMessage: mlsMessage,
      contentSignature: signature,
      recoveryCapsule: capsule,
    },
  });
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data.envelope.contentId, contentId);
  assert.equal(parsed.data.envelope.contentVersion, 7);
  assert.equal(parsed.data.envelope.payloadRole, "relationship_main");
  assert.equal(parsed.data.envelope.schemaVersion, 1);
});

test("S1 protected projection rejects missing authenticated context", () => {
  assert.equal(
    encryptedProtectedContentProjectionSchema.safeParse({
      ciphertext: Buffer.from("ciphertext").toString("base64url"),
      envelope: {
        cryptoProfile: S1_CRYPTO_PROFILE,
        partnershipId: uuid(),
        groupGeneration: 1,
        mlsEpoch: 1,
        senderCryptoDeviceId: uuid(),
        contentKeyId: uuid(),
        nonce,
        ciphertextSha256: digest,
        keyDistributionMessage: mlsMessage,
        contentSignature: signature,
        recoveryCapsule: null,
      },
    }).success,
    false,
  );
});
