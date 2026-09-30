import assert from "node:assert/strict";
import test from "node:test";
import {
  S1_COMMIT_BODY_LIMIT_BYTES,
  S1_CRYPTO_PROFILE,
  S1_DEVICE_ENROLL_BODY_LIMIT_BYTES,
  S1_KEY_PACKAGE_BATCH_MAX,
  S1_KEY_PACKAGE_UPLOAD_BODY_LIMIT_BYTES,
  S1_MAX_CONTROL_MESSAGE_BYTES,
  S1_MAX_KEY_PACKAGE_BYTES,
  S1_MAX_RECOVERY_BUNDLE_BYTES,
  S1_MLS_CIPHERSUITE,
  S1_RECOVERY_SETUP_BODY_LIMIT_BYTES,
  cryptoBootstrapSchema,
  cryptoCommitSchema,
  cryptoDeviceEnrollSchema,
  cryptoRecoverySetupSchema,
  cryptoResetProofText,
} from "../src/index.ts";

const key = Buffer.alloc(32, 7).toString("base64url");
const signature = Buffer.alloc(64, 9).toString("base64url");
const packageBytes = Buffer.from("synthetic-key-package").toString("base64url");

function maxEncoded(maxBytes: number): string {
  return "A".repeat(Math.ceil((maxBytes * 4) / 3) + 8);
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

test("S1 route body ceilings contain every contract-legal encoded maximum", () => {
  const maxPackages = Array.from({ length: S1_KEY_PACKAGE_BATCH_MAX }, () => ({
    keyPackageId: crypto.randomUUID(),
    keyPackage: maxEncoded(S1_MAX_KEY_PACKAGE_BYTES),
  }));
  const enrollBytes = jsonBytes({
    cryptoDeviceId: crypto.randomUUID(),
    cryptoProfile: S1_CRYPTO_PROFILE,
    mlsSigningPublicKey: maxEncoded(256),
    contentSigningPublicKey: maxEncoded(256),
    identityProofSignature: maxEncoded(512),
    keyPackages: maxPackages,
  });
  const uploadBytes = jsonBytes({ keyPackages: maxPackages });
  const commitBytes = jsonBytes({
    expectedGroupGeneration: 1,
    expectedEpoch: 1,
    newEpoch: 2,
    kind: "add",
    controlMessage: maxEncoded(S1_MAX_CONTROL_MESSAGE_BYTES),
    welcome: maxEncoded(S1_MAX_CONTROL_MESSAGE_BYTES),
    targetCryptoDeviceId: crypto.randomUUID(),
    targetLeafIndex: 1,
    keyPackageId: crypto.randomUUID(),
    resetGroupGeneration: null,
    resetGroupId: null,
    resetFounderLeafIndex: null,
    recoveryKeyVersion: null,
    recoverySignature: null,
  });
  const recoveryBytes = jsonBytes({
    cryptoProfile: S1_CRYPTO_PROFILE,
    recoveryKeyVersion: 1,
    recoveryHpkePublicKey: maxEncoded(512),
    recoveryAuthPublicKey: maxEncoded(512),
    encryptedBundle: maxEncoded(S1_MAX_RECOVERY_BUNDLE_BYTES),
  });

  assert.ok(enrollBytes > 1024 * 1024);
  assert.ok(uploadBytes > 1024 * 1024);
  assert.ok(commitBytes > 1024 * 1024);
  assert.ok(recoveryBytes > 1024 * 1024);

  assert.ok(enrollBytes <= S1_DEVICE_ENROLL_BODY_LIMIT_BYTES);
  assert.ok(uploadBytes <= S1_KEY_PACKAGE_UPLOAD_BODY_LIMIT_BYTES);
  assert.ok(commitBytes <= S1_COMMIT_BODY_LIMIT_BYTES);
  assert.ok(recoveryBytes <= S1_RECOVERY_SETUP_BODY_LIMIT_BYTES);

  for (const limit of [
    S1_DEVICE_ENROLL_BODY_LIMIT_BYTES,
    S1_KEY_PACKAGE_UPLOAD_BODY_LIMIT_BYTES,
    S1_COMMIT_BODY_LIMIT_BYTES,
    S1_RECOVERY_SETUP_BODY_LIMIT_BYTES,
  ]) {
    assert.ok(limit < 4 * 1024 * 1024);
  }
});

test("S1 device enrollment requires independent identity proof and KeyPackages", () => {
  assert.equal(
    cryptoDeviceEnrollSchema.safeParse({
      cryptoDeviceId: crypto.randomUUID(),
      cryptoProfile: S1_CRYPTO_PROFILE,
      mlsSigningPublicKey: key,
      contentSigningPublicKey: key,
      identityProofSignature: signature,
      keyPackages: [{ keyPackageId: crypto.randomUUID(), keyPackage: packageBytes }],
    }).success,
    true,
  );
  assert.equal(
    cryptoDeviceEnrollSchema.safeParse({
      cryptoDeviceId: crypto.randomUUID(),
      cryptoProfile: S1_CRYPTO_PROFILE,
      mlsSigningPublicKey: key,
      contentSigningPublicKey: key,
      keyPackages: [],
    }).success,
    false,
  );
});

test("S1 bootstrap pins the reviewed profile and ciphersuite", () => {
  assert.equal(
    cryptoBootstrapSchema.safeParse({
      cryptoProfile: S1_CRYPTO_PROFILE,
      ciphersuite: S1_MLS_CIPHERSUITE,
      groupGeneration: 1,
      groupId: Buffer.from("group").toString("base64url"),
      epoch: 0,
      founderLeafIndex: 0,
    }).success,
    true,
  );
  assert.equal(
    cryptoBootstrapSchema.safeParse({
      cryptoProfile: "unknown",
      ciphersuite: S1_MLS_CIPHERSUITE,
      groupGeneration: 1,
      groupId: Buffer.from("group").toString("base64url"),
      epoch: 0,
      founderLeafIndex: 0,
    }).success,
    false,
  );
});

test("S1 commits advance exactly one epoch and enforce add/remove shape", () => {
  const base = {
    expectedGroupGeneration: 1,
    expectedEpoch: 4,
    newEpoch: 5,
    controlMessage: Buffer.from("commit").toString("base64url"),
  };
  assert.equal(
    cryptoCommitSchema.safeParse({
      ...base,
      kind: "add",
      welcome: Buffer.from("welcome").toString("base64url"),
      targetCryptoDeviceId: crypto.randomUUID(),
      targetLeafIndex: 2,
      keyPackageId: crypto.randomUUID(),
    }).success,
    true,
  );
  assert.equal(
    cryptoCommitSchema.safeParse({
      ...base,
      newEpoch: 7,
      kind: "update",
      welcome: null,
      targetCryptoDeviceId: null,
      targetLeafIndex: null,
      keyPackageId: null,
    }).success,
    false,
  );
  assert.equal(
    cryptoCommitSchema.safeParse({
      ...base,
      kind: "remove",
      welcome: null,
      targetCryptoDeviceId: null,
      targetLeafIndex: null,
      keyPackageId: null,
    }).success,
    false,
  );
});

test("S1 group reset requires next generation and recovery authorization", () => {
  const resetGroupId = Buffer.from("reset-group").toString("base64url");
  const parsed = cryptoCommitSchema.safeParse({
    expectedGroupGeneration: 3,
    expectedEpoch: 9,
    newEpoch: 0,
    kind: "reset",
    controlMessage: Buffer.from("reset-marker").toString("base64url"),
    welcome: null,
    targetCryptoDeviceId: null,
    targetLeafIndex: null,
    keyPackageId: null,
    resetGroupGeneration: 4,
    resetGroupId,
    resetFounderLeafIndex: 0,
    recoveryKeyVersion: 2,
    recoverySignature: signature,
  });
  assert.equal(parsed.success, true);

  assert.equal(
    cryptoCommitSchema.safeParse({
      expectedGroupGeneration: 3,
      expectedEpoch: 9,
      newEpoch: 0,
      kind: "reset",
      controlMessage: Buffer.from("reset-marker").toString("base64url"),
      welcome: null,
      targetCryptoDeviceId: null,
      targetLeafIndex: null,
      keyPackageId: null,
      resetGroupGeneration: 5,
      resetGroupId,
      resetFounderLeafIndex: 0,
      recoveryKeyVersion: 2,
      recoverySignature: signature,
    }).success,
    false,
  );
});

test("S1 group reset recovery proof text is deterministic and context bound", () => {
  const accountId = crypto.randomUUID();
  const partnershipId = crypto.randomUUID();
  const cryptoDeviceId = crypto.randomUUID();
  const first = cryptoResetProofText({
    accountId,
    partnershipId,
    cryptoDeviceId,
    expectedGroupGeneration: 2,
    expectedEpoch: 7,
    resetGroupGeneration: 3,
    resetGroupId: Buffer.from("next-group").toString("base64url"),
    resetFounderLeafIndex: 0,
    recoveryKeyVersion: 4,
  });
  const second = cryptoResetProofText({
    accountId,
    partnershipId,
    cryptoDeviceId,
    expectedGroupGeneration: 2,
    expectedEpoch: 7,
    resetGroupGeneration: 3,
    resetGroupId: Buffer.from("next-group").toString("base64url"),
    resetFounderLeafIndex: 0,
    recoveryKeyVersion: 4,
  });
  assert.equal(first, second);
  assert.equal(first.startsWith("shawtie-group-reset-v1\0"), true);
  assert.equal(first.includes(partnershipId), true);
  assert.equal(first.includes(cryptoDeviceId), true);
});

test("S1 recovery setup carries ciphertext and public recovery material only", () => {
  assert.equal(
    cryptoRecoverySetupSchema.safeParse({
      cryptoProfile: S1_CRYPTO_PROFILE,
      recoveryKeyVersion: 1,
      recoveryHpkePublicKey: key,
      recoveryAuthPublicKey: key,
      encryptedBundle: Buffer.from("ciphertext-bundle").toString("base64url"),
    }).success,
    true,
  );
  assert.equal(
    cryptoRecoverySetupSchema.safeParse({
      cryptoProfile: S1_CRYPTO_PROFILE,
      recoveryKeyVersion: 0,
      recoveryHpkePublicKey: key,
      recoveryAuthPublicKey: key,
      encryptedBundle: Buffer.from("ciphertext-bundle").toString("base64url"),
    }).success,
    false,
  );
});
