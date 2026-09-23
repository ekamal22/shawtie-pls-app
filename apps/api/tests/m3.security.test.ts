import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relative: string): Promise<string> {
  return readFile(new URL(relative, import.meta.url), "utf8");
}

test("M3 media routes are authenticated and private no-store", async () => {
  const routes = await source("../src/modules/media/routes.ts");
  assert.equal(routes.includes("requireAuthentication"), true);
  assert.equal(routes.includes('"cache-control", "private, no-store"'), true);
  assert.equal(routes.includes("idempotencyKey(request.headers)"), true);
  assert.equal(routes.includes("consumeMediaRateLimit"), true);
  assert.equal(routes.includes('"m3.media." + kind + ".account"'), true);
  assert.equal(routes.includes('"m3.media." + kind + ".device"'), true);
  assert.equal(routes.includes('"m3.media." + kind + ".network"'), true);
  assert.equal(routes.includes('"rate-limit-key"'), true);
  assert.equal(routes.includes("console."), false);
  assert.equal(routes.includes("request.log"), false);
});

test("M3 production rejects synthetic crypto protocol and server never accepts keys", async () => {
  const service = await source("../src/modules/media/media-service.ts");
  const contracts = await source("../../../packages/contracts/src/media/media.ts");
  assert.equal(service.includes('protocol.startsWith("m3-test-")'), true);
  assert.equal(service.includes("MEDIA_CRYPTO_PROTOCOL_UNAVAILABLE"), true);
  assert.equal(contracts.includes("mediaKey"), false);
  assert.equal(contracts.includes("keyEnvelope"), false);
  assert.equal(service.includes("originalFilename"), false);
});

test("M3 media object keys are opaque and invalidations contain no media payload", async () => {
  const service = await source("../src/modules/media/media-service.ts");
  const messaging = await source("../src/modules/messages/messaging-service.ts");
  const relationship = await source("../src/modules/relationship-space/relationship-space-service.ts");
  assert.equal(service.includes('"media/v1/" + randomBytes(24).toString("hex")'), true);

  const messageInvalidation = messaging.slice(
    messaging.indexOf("async #queueInvalidation"),
    messaging.indexOf("\n  async edit(", messaging.indexOf("async #queueInvalidation")),
  );
  assert.equal(messageInvalidation.includes("uploadUrl"), false);
  assert.equal(messageInvalidation.includes("ciphertext"), false);
  assert.equal(messageInvalidation.includes("storageObjectKey"), false);

  assert.equal(relationship.includes("queueRealtimeRelationshipChanged"), true);
  assert.equal(relationship.includes("uploadUrl"), false);
});

test("M3 deletion removes object before partnership media metadata", async () => {
  const handlers = await source("../../worker/src/media/media-handlers.ts");
  const relational = await source(
    "../../worker/src/partnerships/partnership-relational-deletion-handler.ts",
  );
  assert.ok(handlers.indexOf("await store.deleteObject") < handlers.indexOf("deletePartnershipMediaObjectMetadata"));
  assert.equal(relational.includes("media_objects"), false);
});

test("M3 service worker cannot cache API/private responses", async () => {
  const worker = await readFile(
    new URL("../../web/public/sw.js", import.meta.url),
    "utf8",
  );
  assert.equal(worker.includes('url.pathname.startsWith("/api/")'), true);
  assert.equal(worker.includes("no-store|private"), true);
});
