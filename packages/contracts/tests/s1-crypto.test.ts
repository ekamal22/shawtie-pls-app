import assert from "node:assert/strict";
import test from "node:test";
import {
  S1_CRYPTO_PROFILE,
  S1_MLS_CIPHERSUITE,
  cryptoBootstrapSchema,
  cryptoCommitSchema,
  cryptoDeviceEnrollSchema,
  cryptoRecoverySetupSchema,
  cryptoResetProofText,
} from "../src/index.ts";

const key = Buffer.alloc(32, 7).toString("base64url");
const signature = Buffer.alloc(64, 9).toString("base64url");
const packageBytes = Buffer.from("synthetic-key-package").toString("base64url");

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
