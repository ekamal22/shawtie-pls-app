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


test("M2 account switch closes active IndexedDB before deleting old account data", async () => {
  const app = await source("../src/app/App.tsx");
  const runtime = await source("../src/lib/realtime/runtime-context.tsx");

  assert.equal(app.includes("broadcastLocalLogout"), true);
  assert.equal(app.includes("closeActiveM2Runtime"), true);
  assert.ok(
    app.indexOf("await closeActiveM2Runtime(previousAccountId)") <
      app.indexOf("await purgeAccountLocalData(previousAccountId)"),
  );
  assert.ok(
    app.indexOf("await closeActiveM2Runtime(signedOutAccountId)") <
      app.indexOf("await purgeAccountLocalData(signedOutAccountId)"),
  );
  assert.equal(runtime.includes("export async function closeActiveM2Runtime"), true);
});

test("M2 replay distinguishes network loss from invariant failures and wakes delayed retries", async () => {
  const client = await source("../src/lib/api-client.ts");
  const replay = await source("../src/lib/offline/replay-engine.ts");

  assert.equal(client.includes("export class ApiNetworkError"), true);
  assert.equal(client.includes("throw new ApiNetworkError(error)"), true);
  assert.equal(replay.includes("error instanceof ApiNetworkError"), true);
  assert.equal(replay.includes("if (!(error instanceof ApiClientError)) return false"), true);
  assert.equal(replay.includes("#scheduleRetry"), true);
  assert.equal(replay.includes("window.setTimeout"), true);
  assert.equal(replay.includes("this.requestSync()"), true);
  assert.equal(replay.includes("dispose(): void"), true);
});


test("M2 blocked queues expose retry and discard conflict recovery", async () => {
  const local = await source("../src/lib/offline/local-db.ts");
  const runtime = await source("../src/lib/realtime/runtime-context.tsx");
  const app = await source("../src/app/App.tsx");

  assert.equal(local.includes("retryChatOperation"), true);
  assert.equal(local.includes("discardChatOperation"), true);
  assert.equal(local.includes("retryRelationshipOperation"), true);
  assert.equal(local.includes("discardRelationshipOperation"), true);
  assert.equal(runtime.includes("export function M2QueueStatus"), true);
  assert.equal(runtime.includes("Attempted text is still stored locally"), true);
  assert.equal(runtime.includes("retryQueuedOperation"), true);
  assert.equal(runtime.includes("discardQueuedOperation"), true);
  assert.equal(app.includes("<M2QueueStatus />"), true);
});


test("M2 browser advertises HTTP compatibility and pauses replay on update-required", async () => {
  const client = await source("../src/lib/api-client.ts");
  const runtime = await source("../src/lib/realtime/runtime-context.tsx");

  assert.equal(client.includes("M2_CLIENT_PROTOCOL_HEADER"), true);
  assert.equal(client.includes("M2_LOCAL_SCHEMA_HEADER"), true);
  assert.equal(client.includes('"CLIENT_UPDATE_REQUIRED"'), true);
  assert.equal(client.includes('"shawtie:update-required"'), true);
  assert.equal(runtime.includes('"shawtie:update-required"'), true);
  assert.equal(runtime.includes("markUpdateRequired"), true);
});

test("M2 canonical caches are bounded without evicting offline queues", async () => {
  const local = await source("../src/lib/offline/local-db.ts");

  assert.equal(
    local.includes("M2_MAX_CACHED_MESSAGES_PER_CONVERSATION = 500"),
    true,
  );
  assert.equal(
    local.includes("M2_MAX_CACHED_RELATIONSHIP_ITEMS_PER_PARTNERSHIP = 500"),
    true,
  );
  assert.equal(local.includes("retainedHistoryStartSequence: retainedStart"), true);
  assert.equal(local.includes("partnershipItems.slice("), true);
  assert.equal(
    local.includes('const tx = this.#database.transaction(["chatOutbox"]'),
    true,
  );
});

test("M2 receipt high-water is persisted before HTTP acknowledgement", async () => {
  const local = await source("../src/lib/offline/local-db.ts");
  const messaging = await source(
    "../src/features/messaging/MessagingPanel.tsx",
  );

  assert.equal(local.includes("advancePendingReceipts"), true);
  assert.equal(local.includes("pendingDeliveredThrough: Math.max("), true);
  assert.ok(
    messaging.indexOf("advancePendingReceipts") <
      messaging.indexOf('body: { type: "delivered"'),
  );
  assert.equal(messaging.includes("ApiNetworkError"), true);
  assert.equal(messaging.includes("pendingReadThrough"), true);
});
