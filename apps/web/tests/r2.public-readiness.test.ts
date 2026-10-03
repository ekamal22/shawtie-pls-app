import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("R2 service worker cache is release scoped and does not globally match old caches", async () => {
  const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.equal(source.includes('searchParams.get("release")'), true);
  assert.equal(source.includes('"shawtie-shell-" + safeReleaseId'), true);
  assert.equal(source.includes('const cached = await caches.match("/")'), false);
  assert.equal(source.includes("await cache.match(request)"), true);
  assert.equal(source.includes('url.pathname.startsWith("/api/")'), true);
  assert.equal(source.includes("isPrivateApi(url)"), true);
});

test("R2 generic push payload display never reads message plaintext", async () => {
  const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.equal(source.includes('"message_changed"'), true);
  assert.equal(source.includes('"notification_changed"'), true);
  assert.equal(source.includes("payload.message"), false);
  assert.equal(source.includes("payload.body"), false);
  assert.equal(source.includes("notificationPreviewEnabled"), false);
  assert.equal(source.includes("R2_NOTIFICATION_PREVIEW"), false);
});

test("R2 registration links the published privacy and terms surfaces", async () => {
  const app = await readFile(new URL("../src/app/App.tsx", import.meta.url), "utf8");
  const privacy = await readFile(new URL("../public/privacy.html", import.meta.url), "utf8");
  const terms = await readFile(new URL("../public/terms.html", import.meta.url), "utf8");
  assert.equal(app.includes('href="/privacy.html"'), true);
  assert.equal(app.includes('href="/terms.html"'), true);
  assert.equal(app.includes("CURRENT_LEGAL_POLICY_VERSION"), true);
  assert.equal(privacy.includes("2026-10-03"), true);
  assert.equal(terms.includes("2026-10-03"), true);
  assert.equal(privacy.includes("<style>"), false);
  assert.equal(terms.includes("<style>"), false);
  assert.equal(privacy.includes('href="/legal.css"'), true);
  assert.equal(terms.includes('href="/legal.css"'), true);
});

test("R2 notification preview remains server-authoritative and content free", async () => {
  const us = await readFile(
    new URL("../src/features/ours/us/UsScreen.tsx", import.meta.url),
    "utf8",
  );
  const worker = await readFile(
    new URL("../../../worker/src/messages/messaging-invalidation-handler.ts", import.meta.url),
    "utf8",
  );
  assert.equal(us.includes("messagePreviewEnabled"), true);
  assert.equal(us.includes("protected message content is never sent"), true);
  assert.equal(worker.includes("loadNotificationPreferences"), true);
  assert.equal(worker.includes('"message_changed" : "notification_changed"'), true);
});
