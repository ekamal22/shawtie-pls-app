import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relative: string): Promise<string> {
  return readFile(new URL(relative, import.meta.url), "utf8");
}

test("S1 Talk encrypts protected mutations before durable replay", async () => {
  const messaging = await source("../src/features/messaging/MessagingPanel.tsx");
  const replay = await source("../src/lib/offline/replay-engine.ts");

  assert.equal(messaging.includes("cryptoRuntime.protectBytes"), true);
  assert.equal(messaging.includes("protectedBody"), true);
  assert.equal(messaging.includes("protectedReaction"), true);
  assert.equal(messaging.includes("protectedNickname"), true);
  assert.equal(replay.includes("S1_CONTENT_CONTEXT"), true);
  assert.equal(replay.includes("queued.contentContextKey !== S1_CONTENT_CONTEXT"), true);
  assert.equal(replay.includes("queued.contentContextKey === S1_CONTENT_CONTEXT"), true);
});

test("S1 browser decrypts only after verifying sender signature and digest", async () => {
  const runtime = await source("../src/lib/crypto/crypto-runtime.ts");

  assert.equal(runtime.includes("ciphertextSha256"), true);
  assert.equal(runtime.includes("verifyContent("), true);
  assert.equal(runtime.includes("CRYPTO_SIGNATURE_INVALID"), true);
  assert.equal(runtime.includes("CRYPTO_CIPHERTEXT_INVALID"), true);
  assert.equal(runtime.includes("sender.contentSigningPublicKey"), true);
});

test("S1 R1 keeps preview and sealed content in independent protected roles", async () => {
  const relationship = await source("../src/features/relationship-space/api.ts");

  assert.equal(relationship.includes('payloadRole: "relationship_preview"'), true);
  assert.equal(relationship.includes('payloadRole: "relationship_main"'), true);
  assert.equal(relationship.includes("protectedPreview"), true);
  assert.equal(relationship.includes("protectedContent"), true);
});

test("S1 crypto namespace revocation purges local crypto state", async () => {
  const realtime = await source("../src/lib/realtime/runtime-context.tsx");
  const cryptoContext = await source("../src/lib/crypto/runtime-context.tsx");
  const vault = await source("../../../packages/crypto/src/local-vault.ts");

  assert.equal(realtime.includes("shawtie:crypto-namespace-revoked"), true);
  assert.equal(cryptoContext.includes("runtime.purgePartnership(partnershipId)"), true);
  assert.equal(vault.includes("async purgePartnership(partnershipId: string)"), true);
  assert.equal(vault.includes('tx.objectStore("contentKeys").delete'), true);
});

test("S1 production media path has no static legacy test-crypto dependency", async () => {
  const runtime = await source("../src/lib/media/media-runtime.ts");

  assert.equal(runtime.includes('import { decryptMedia, encryptMedia } from "./crypto-port.ts"'), false);
  assert.equal(runtime.includes('import("./crypto-port.ts")'), true);
  assert.equal(runtime.includes("import.meta.env.DEV"), true);
  assert.equal(runtime.includes('VITE_M3_TEST_CRYPTO === "1"'), true);
  assert.equal(runtime.includes("CRYPTO_NOT_INITIALIZED"), true);
  assert.equal(runtime.includes("S1_CRYPTO_PROFILE"), true);
});

test("S1 local cache uses a dedicated content context boundary", async () => {
  const local = await source("../src/lib/offline/local-db.ts");
  const contracts = await source("../../../packages/contracts/src/realtime/m2.ts");

  assert.equal(contracts.includes('S1_CONTENT_CONTEXT = "shawtie.mls.v1"'), true);
  assert.equal(local.includes("ensureNamespaceContentContext"), true);
  assert.equal(local.includes("contentContextKey"), true);
  assert.equal(local.includes("purgePartnership(partnershipId)"), true);
});

test("S1 recovery never derives history access from account email recovery", async () => {
  const runtime = await source("../src/lib/crypto/crypto-runtime.ts");
  const recovery = await source("../../../packages/crypto/src/recovery.ts");

  assert.equal(runtime.includes("recoverWithMasterSecret"), true);
  assert.equal(runtime.includes("decodeRecoveryMasterSecret"), true);
  assert.equal(runtime.includes("createCryptoRecoveryChallenge"), true);
  assert.equal(runtime.includes("proveCryptoRecovery"), true);
  assert.equal(recovery.includes("generateRecoveryMasterSecret"), true);
});
