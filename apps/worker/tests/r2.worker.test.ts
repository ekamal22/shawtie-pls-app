import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { webPushConfigFromEnv } from "../src/calls/web-push.ts";

async function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("R2 generic push payloads contain routing type only", async () => {
  const generic = await source("../src/notifications/generic-push-handler.ts");
  const messaging = await source("../src/messages/messaging-invalidation-handler.ts");
  assert.equal(generic.includes('{ v: 1, type: "notification_changed" }'), true);
  assert.equal(messaging.includes("loadNotificationPreferences"), true);
  assert.equal(messaging.includes('"message_changed" : "notification_changed"'), true);
  for (const privateField of ["body", "ciphertext", "displayName", "username", "media"]) {
    assert.equal(generic.includes("payload." + privateField), false);
  }
});

test("R2 message preview routing is account-backed and defaults hidden", async () => {
  const preferences = await source("../../../packages/db/src/repositories/notification-preferences.ts");
  const messaging = await source("../src/messages/messaging-invalidation-handler.ts");
  assert.equal(preferences.includes(": { messagePreviewEnabled: false, updatedAt: null }"), true);
  assert.equal(messaging.includes("previewByAccount.get(accountId)"), true);
});

test("R2 default worker registers serious email and generic push handlers", async () => {
  const defaults = await source("../src/outbox/default-outbox-handlers.ts");
  assert.equal(defaults.includes("createSecurityEmailOutboxHandler"), true);
  assert.equal(defaults.includes("createGenericPushHandlers"), true);
  assert.equal(defaults.includes("createM1MessagingInvalidationHandlers(publisher, database, pushConfig)"), true);
});

test("R2 message push recipient lookup fails closed after partnership release", async () => {
  const messagingRepo = await source("../../../packages/db/src/repositories/messaging.ts");
  const handler = await source("../src/messages/messaging-invalidation-handler.ts");
  assert.equal(messagingRepo.includes("member.released_at IS NULL"), true);
  assert.equal(handler.includes("if (!participants || !message) return;"), true);
});

test("R2 production worker refuses missing Web Push configuration", () => {
  assert.throws(
    () => webPushConfigFromEnv({ NODE_ENV: "production" }),
    /Web Push configuration is required in production/,
  );
  assert.equal(webPushConfigFromEnv({ NODE_ENV: "test" }), null);
});

test("R2 device revocation retains push-subscription revocation", async () => {
  const accounts = await source("../../api/src/modules/accounts/account-service.ts");
  assert.equal(accounts.includes("revokePushSubscriptionForDevice"), true);
});
