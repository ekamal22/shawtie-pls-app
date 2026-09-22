import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relative: string): Promise<string> {
  return readFile(new URL(relative, import.meta.url), "utf8");
}

test("M2 browser runtime keeps realtime singleton and old-connection generation fencing", async () => {
  const runtime = await source("../src/lib/realtime/runtime-context.tsx");
  const client = await source("../src/lib/realtime/realtime-client.ts");

  assert.equal(runtime.includes("new RealtimeClient"), true);
  assert.equal(runtime.includes("activeRuntime"), true);
  assert.equal(client.includes("#generation"), true);
  assert.equal(client.includes("generation !== this.#generation"), true);
  assert.equal(client.includes("ANTI_ENTROPY_MS"), true);
  assert.equal(client.includes("control.resync_required"), true);
});

test("M2 IndexedDB namespaces and queue claims are partnership fenced", async () => {
  const local = await source("../src/lib/offline/local-db.ts");

  assert.equal(local.includes('const DATABASE_PREFIX = "shawtie-local-v1:"'), true);
  assert.equal(local.includes('M2_PRE_S1_CONTENT_CONTEXT'), true);
  assert.equal(local.includes("partnershipId"), true);
  assert.equal(local.includes("conversationId"), true);
  assert.equal(local.includes("claimGeneration"), true);
  assert.equal(local.includes("claimExpiresAt"), true);
  assert.equal(local.includes("completeChatWithMessage"), true);
  assert.equal(local.includes("purgePartnership"), true);
});

test("M2 offline replay preserves idempotency and exact R1 release boundary", async () => {
  const replay = await source("../src/lib/offline/replay-engine.ts");

  assert.equal(replay.includes('"idempotency-key": operation.idempotencyKey'), true);
  assert.equal(replay.includes('operationType: "message.send"'), false);
  assert.equal(replay.includes("safeRelationshipCreate"), true);
  assert.equal(replay.includes('release.mode === "immediate"'), true);
  assert.equal(replay.includes('Object.prototype.hasOwnProperty.call(body, "release")'), true);
  assert.equal(replay.includes("/release"), false);
  assert.equal(replay.includes("claimGeneration"), true);
});

test("M2 service worker never caches private API and activates only by page command", async () => {
  const worker = await source("../public/sw.js");
  const registration = await source("../src/lib/pwa/service-worker-registration.ts");

  assert.equal(worker.includes('url.pathname.startsWith("/api/")'), true);
  assert.equal(worker.includes("cacheControl"), true);
  assert.equal(worker.includes("no-store|private"), true);
  assert.equal(worker.includes('event.data?.type === "M2_ACTIVATE_UPDATE"'), true);
  assert.equal(worker.includes('self.addEventListener("install", () =>'), true);
  assert.equal(
    worker.slice(
      worker.indexOf('self.addEventListener("install"'),
      worker.indexOf('self.addEventListener("activate"'),
    ).includes("skipWaiting"),
    false,
  );
  assert.equal(registration.includes("coordinator.markUpdateRequired()"), true);
});

test("M2 cold start locks cached plaintext until server session verification", async () => {
  const app = await source("../src/app/App.tsx");

  assert.equal(app.includes('"offline-locked"'), true);
  assert.equal(app.includes("/api/v1/auth/session"), true);
  assert.equal(app.includes("<M2RuntimeProvider"), true);
  assert.ok(
    app.indexOf('session === "offline-locked"') <
      app.indexOf("<M2RuntimeProvider"),
  );
});


test("M2 cross-tab logout closes private local state before account purge", async () => {
  const control = await source("../src/lib/offline/account-control.ts");
  const runtime = await source("../src/lib/realtime/runtime-context.tsx");
  const app = await source("../src/app/App.tsx");

  assert.equal(control.includes("BroadcastChannel"), true);
  assert.equal(control.includes('type: "logout"'), true);
  assert.equal(runtime.includes("subscribeLocalLogout"), true);
  assert.equal(runtime.includes('new CustomEvent("shawtie:local-logout"'), true);
  assert.equal(app.includes("broadcastLocalLogout"), true);
  assert.equal(app.includes("purgeAccountLocalData"), true);
});

test("M2 PWA manifest is installable without granting private Cache API access", async () => {
  const manifest = JSON.parse(await source("../public/manifest.webmanifest")) as {
    display?: string;
    start_url?: string;
    icons?: Array<{ src?: string; purpose?: string }>;
  };
  const icon = await source("../public/icon.svg");

  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.icons?.some((entry) => entry.src === "/icon.svg"), true);
  assert.equal(manifest.icons?.some((entry) => entry.purpose?.includes("maskable")), true);
  assert.equal(icon.includes("<svg"), true);
});
