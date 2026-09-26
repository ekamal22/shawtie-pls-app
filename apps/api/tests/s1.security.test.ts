import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relative: string): Promise<string> {
  return readFile(new URL(relative, import.meta.url), "utf8");
}

test("S1 API verifies protected write authorization without decrypting content", async () => {
  const protectedContent = await source("../src/modules/crypto/protected-content.ts");

  assert.equal(protectedContent.includes("loadPartnershipCryptoPolicy"), true);
  assert.equal(protectedContent.includes("loadActivePartnershipCryptoGroup"), true);
  assert.equal(protectedContent.includes("cryptoDeviceIsActiveGroupMember"), true);
  assert.equal(protectedContent.includes("verifyRawEd25519"), true);
  assert.equal(protectedContent.includes("CRYPTO_SIGNATURE_INVALID"), true);
  assert.equal(protectedContent.includes("CRYPTO_EPOCH_CONFLICT"), true);
  assert.equal(protectedContent.includes("CRYPTO_REKEY_REQUIRED"), true);
});

test("S1 message writes reject plaintext after the crypto cutoff", async () => {
  const messaging = await source("../src/modules/messages/messaging-service.ts");

  assert.equal(messaging.includes("loadPartnershipCryptoPolicy"), true);
  assert.equal(messaging.includes('throw new ApiError(409, "CRYPTO_REQUIRED")'), true);
  assert.equal(messaging.includes("requireCryptoProtectedWrite"), true);
  assert.equal(messaging.includes("deleteProtectedContentKey"), true);
});

test("S1 relationship projections withhold sealed main ciphertext until R1 visibility allows it", async () => {
  const relationship = await source("../src/modules/relationship-space/relationship-space-service.ts");

  assert.equal(relationship.includes("isFullItemVisible"), true);
  assert.equal(relationship.includes("protectedContent"), true);
  assert.equal(relationship.includes("full && item.encryptedPayload"), true);
  assert.equal(relationship.includes("relationship_preview"), true);
  assert.equal(relationship.includes("relationship_main"), true);
});

test("S1 media requires protected key metadata after crypto activation", async () => {
  const media = await source("../src/modules/media/media-service.ts");

  assert.equal(media.includes("loadPartnershipCryptoPolicy"), true);
  assert.equal(media.includes("S1_CRYPTO_PROFILE"), true);
  assert.equal(media.includes("input.contentEnvelope"), true);
  assert.equal(media.includes("requireCryptoProtectedWrite"), true);
  assert.equal(media.includes('throw new ApiError(409, "CRYPTO_REQUIRED")'), true);
});

test("S1 crypto state exposes device public identities but no private recovery material", async () => {
  const service = await source("../src/modules/crypto/crypto-service.ts");

  assert.equal(service.includes("contentSigningPublicKey"), true);
  assert.equal(service.includes("recoveryHpkePublicKey"), true);
  assert.equal(service.includes("recoveryAuthPublicKey"), true);
  assert.equal(service.includes("recoveryHpkePrivateKey"), false);
  assert.equal(service.includes("recoveryAuthPrivateKey"), false);
});
