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

test("S1 Talk retries the crypto sync once the runtime becomes ready after a lost race", async () => {
  const messaging = await source("../src/features/messaging/MessagingPanel.tsx");

  // A cold start (WASM load, device enrollment) can make the S1 crypto runtime resolve
  // after Talk has already become active. Without a retry, syncChanges fails closed with
  // CRYPTO_UNAVAILABLE once and never runs again, leaving a permanent false "Protected
  // messaging is unavailable" banner in front of messages that in fact decrypt correctly.
  assert.equal(messaging.includes("cryptoRuntimeReadyRef"), true);
  assert.match(
    messaging,
    /becameReady = Boolean\(cryptoRuntime\) && !cryptoRuntimeReadyRef\.current/,
  );
  assert.match(
    messaging,
    /if \(becameReady && active && conversation\) \{\s*setError\(""\);\s*void syncChanges\(\)/,
  );
});

test("S1 Talk clears a stale crypto-unavailable error once loadInitial's own retry succeeds", async () => {
  const messaging = await source("../src/features/messaging/MessagingPanel.tsx");

  // loadInitial depends on cryptoRuntime, so React already reruns it once the S1 crypto
  // runtime finishes starting after Talk mounted first. But physical acceptance found the
  // retry's success never cleared the error the first, crypto-not-ready attempt had set,
  // leaving a permanent false "Protected messaging is unavailable" banner in front of
  // messages the retry in fact decrypted correctly.
  assert.match(
    messaging,
    /void loadInitial\(\)\s*\.then\(\(\) => setError\(""\)\)\s*\.catch\(\(caught\) => setError\(errorText\(caught\)\)\)/,
  );
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

test("pre-V1 account lifecycle wires destructive S1 account purge without wiping ordinary logout", async () => {
  const app = await source("../src/app/App.tsx");
  const us = await source("../src/features/ours/us/UsScreen.tsx");
  const accountControl = await source("../src/lib/offline/account-control.ts");
  const cryptoContext = await source("../src/lib/crypto/runtime-context.tsx");

  assert.equal(app.includes("purgeCryptoAccountData(accountId)"), true);
  assert.equal(app.includes("closeActiveS1CryptoRuntime(accountId)"), true);
  assert.equal(app.includes("pendingAccountDeletionExpired(accountId)"), true);
  assert.equal(app.includes("/api/v1/auth/device-local-state?deviceId="), true);
  assert.equal(app.includes('state.accountStatus === "active"'), true);
  assert.equal(app.includes('state.accountStatus === "deletion_pending"'), true);
  assert.equal(app.includes("!state.recognized || state.accountId !== accountId"), true);
  assert.equal(app.includes("previousDeviceId !== current.deviceId"), true);
  assert.equal(app.includes("purgeCryptoForAccount(previousAccountId)"), true);
  assert.equal(us.includes("onSignedOut({ purgeCrypto: true })"), true);
  assert.equal(
    us.includes("rememberPendingAccountDeletion(me.accountId, result.recoverUntil)"),
    true,
  );
  assert.equal(accountControl.includes("PENDING_DELETION_KEY"), true);
  assert.equal(accountControl.includes("LAST_CRYPTO_ACCOUNT_KEY"), true);
  assert.equal(app.includes("rememberedLastCryptoAccount()"), true);
  assert.equal(app.includes("rememberLastCryptoAccount(current.accountId)"), true);
  assert.equal(cryptoContext.includes("closeActiveS1CryptoRuntime"), true);
});

test("S1 production media path has no static legacy test-crypto dependency", async () => {
  const runtime = await source("../src/lib/media/media-runtime.ts");

  assert.equal(
    runtime.includes('import { decryptMedia, encryptMedia } from "./crypto-port.ts"'),
    false,
  );
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
