import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relative: string): Promise<string> {
  return readFile(new URL(relative, import.meta.url), "utf8");
}

test("M3 browser crypto adapter is test-only and production unavailable before S1", async () => {
  const cryptoPort = await source("../src/lib/media/crypto-port.ts");
  assert.equal(cryptoPort.includes('value.MODE !== "production"'), true);
  assert.equal(cryptoPort.includes('VITE_M3_TEST_CRYPTO === "1"'), true);
  assert.equal(cryptoPort.includes('"m3-test-aes-gcm-v1"'), true);
  assert.equal(cryptoPort.includes("S1"), true);
});

test("M3 local drafts persist ciphertext only and are account/partnership/feature fenced", async () => {
  const types = await source("../src/lib/media/media-types.ts");
  const local = await source("../src/lib/media/media-local-db.ts");
  assert.equal(local.includes('const PREFIX = "shawtie-media-v1:"'), true);
  assert.equal(types.includes('ownerContext: "chat" | "relationship"'), true);
  assert.equal(types.includes("ciphertext: Blob"), true);
  assert.equal(types.includes("plaintext"), false);
  assert.equal(local.includes("partnershipId"), true);
  assert.equal(local.includes("ownerContext"), true);
});

test("M3 purge composes with M2 account and namespace revocation", async () => {
  const local = await source("../src/lib/offline/local-db.ts");
  const runtime = await source("../src/lib/realtime/runtime-context.tsx");
  assert.equal(local.includes("purgeMediaAccountData"), true);
  assert.equal(runtime.includes("purgeMediaPartnershipData"), true);
  assert.equal(runtime.includes('case "namespace.revoked"'), true);
});

test("M3 chat queues only small binding mutation after upload, never a Blob", async () => {
  const messaging = await source("../src/features/messaging/MessagingPanel.tsx");
  assert.equal(messaging.includes("uploadMediaDraft"), true);
  assert.equal(messaging.includes('operationType: "message.send"'), true);
  assert.equal(messaging.includes("requestBody"), true);
  const queueBlock = messaging.slice(
    messaging.indexOf('operationType: "message.send"'),
    messaging.indexOf("setNotice(", messaging.indexOf('operationType: "message.send"')),
  );
  assert.equal(queueBlock.includes("ciphertext"), false);
  assert.equal(queueBlock.includes("Blob"), false);
});

test("M3 R1 media remains online-only under M2 replay safety policy", async () => {
  const replay = await source("../src/lib/offline/replay-engine.ts");
  const relationship = await source(
    "../src/features/relationship-space/RelationshipSpacePanel.tsx",
  );
  assert.equal(replay.includes('reference.referenceType === "message"'), true);
  assert.equal(relationship.includes("OFFLINE_OPERATION_REQUIRES_CONNECTION"), true);
  assert.equal(relationship.includes('role: "voice_letter"'), true);
  assert.equal(relationship.includes("position,"), true);
});

test("M3 voice recorder previews before send and releases microphone tracks", async () => {
  const recorder = await source("../src/features/media/VoiceRecorder.tsx");
  assert.equal(recorder.includes("getTracks().forEach((track) => track.stop())"), true);
  assert.equal(recorder.includes('"preview"'), true);
  assert.equal(recorder.includes("Preview before sending"), true);
  assert.equal(recorder.includes("URL.createObjectURL"), true);
  assert.equal(recorder.includes("URL.revokeObjectURL"), true);
  assert.equal(recorder.includes("10 * 60_000"), true);
});

test("M3 failed upload retry probes completion then rotates the grant", async () => {
  const runtime = await source("../src/lib/media/media-runtime.ts");
  const messaging = await source("../src/features/messaging/MessagingPanel.tsx");
  assert.ok(runtime.indexOf("completeMediaUpload") < runtime.indexOf("refreshMediaUpload"));
  assert.equal(runtime.includes("refreshMediaUpload(draft.mediaId"), true);
  assert.equal(messaging.includes("Retry upload"), true);
});

test("M3 image re-encoding prefers a worker and keeps a metadata-stripping fallback", async () => {
  const runtime = await source("../src/lib/media/media-runtime.ts");
  const worker = await source("../src/lib/media/image-worker.ts");
  assert.equal(runtime.includes('new Worker(new URL("./image-worker.ts"'), true);
  assert.equal(worker.includes("OffscreenCanvas"), true);
  assert.equal(worker.includes('type: "image/webp"'), true);
  assert.equal(runtime.includes("processImageOnMainThread"), true);
});

test("M3 downloaded plaintext is short-lived and format revalidated", async () => {
  const runtime = await source("../src/lib/media/media-runtime.ts");
  const attachment = await source("../src/features/media/MediaAttachment.tsx");
  assert.equal(runtime.includes("validateMagic"), true);
  assert.equal(runtime.includes("URL.createObjectURL"), true);
  assert.equal(runtime.includes("URL.revokeObjectURL"), true);
  assert.equal(attachment.includes("value.revoke()"), true);
});

test("M3 create-only upload retry proceeds to server-side completion verification", async () => {
  const api = await source("../src/lib/media/media-api.ts");
  assert.equal(api.includes("response.status === 412"), true);
  assert.equal(api.includes("MEDIA_STORAGE_UPLOAD_FAILED_"), true);
});

test("M3 account purge fails closed instead of swallowing media-database deletion errors", async () => {
  const local = await source("../src/lib/offline/local-db.ts");
  const mediaLocal = await source("../src/lib/media/media-local-db.ts");
  assert.equal(local.includes("await purgeMediaAccountData(accountId);"), true);
  assert.equal(local.includes("purgeMediaAccountData(accountId).catch"), false);
  assert.equal(mediaLocal.includes("Media database purge is blocked by another tab"), true);
});
