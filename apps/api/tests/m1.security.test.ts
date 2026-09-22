import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("M1 private request fingerprints are keyed and versioned", async () => {
  const ring = await readFile(
    new URL("../src/security/auth-key-ring.ts", import.meta.url),
    "utf8",
  );
  const service = await readFile(
    new URL("../src/modules/messages/messaging-service.ts", import.meta.url),
    "utf8",
  );
  const migration = await readFile(
    new URL("../../../packages/db/migrations/0011_messaging_core_runtime.sql", import.meta.url),
    "utf8",
  );

  assert.equal(ring.includes('"message-request-fingerprint"'), true);
  assert.equal(service.includes('activeVerifier("message-request-fingerprint"'), true);
  assert.equal(service.includes('verifier(\n        "message-request-fingerprint"'), true);
  assert.equal(service.includes('createHash('), false);
  assert.equal(migration.includes("request_fingerprint_version"), true);
});

test("M1 durable changes and outbox invalidations are content free", async () => {
  const service = await readFile(
    new URL("../src/modules/messages/messaging-service.ts", import.meta.url),
    "utf8",
  );
  const repository = await readFile(
    new URL("../../../packages/db/src/repositories/messaging.ts", import.meta.url),
    "utf8",
  );

  const queueStart = service.indexOf("async #queueInvalidation");
  const queueEnd = service.indexOf("\n  async edit(", queueStart);
  assert.ok(queueStart >= 0 && queueEnd > queueStart);
  const queueBlock = service.slice(queueStart, queueEnd);

  assert.equal(queueBlock.includes("body:"), false);
  assert.equal(queueBlock.includes("emoji:"), false);
  assert.equal(queueBlock.includes("nickname:"), false);
  assert.equal(queueBlock.includes("messageId"), true);
  assert.equal(queueBlock.includes("changeSequence"), true);

  const changeStart = repository.indexOf("export async function insertConversationChange");
  const changeEnd = repository.indexOf("\ninterface MessageProjectionRow", changeStart);
  assert.ok(changeStart >= 0 && changeEnd > changeStart);
  const changeBlock = repository.slice(changeStart, changeEnd);

  assert.equal(changeBlock.includes("body_text"), false);
  assert.equal(changeBlock.includes("emoji_text"), false);
  assert.equal(changeBlock.includes("nickname"), false);
});

test("M1 never writes plaintext edit history", async () => {
  const repository = await readFile(
    new URL("../../../packages/db/src/repositories/messaging.ts", import.meta.url),
    "utf8",
  );
  const migration = await readFile(
    new URL("../../../packages/db/migrations/0011_messaging_core_runtime.sql", import.meta.url),
    "utf8",
  );

  const editStart = repository.indexOf("export async function updateMessageBody");
  const editEnd = repository.indexOf("\nexport async function tombstoneMessage", editStart);
  const editBlock = repository.slice(editStart, editEnd);

  assert.equal(editBlock.includes("message_versions"), false);
  assert.equal(migration.includes("ALTER TABLE message_versions"), false);
  assert.equal(migration.includes("body_text"), true);
});

test("M1 sender device identity is session-derived", async () => {
  const service = await readFile(
    new URL("../src/modules/messages/messaging-service.ts", import.meta.url),
    "utf8",
  );
  const contracts = await readFile(
    new URL("../../../packages/contracts/src/messages/messaging.ts", import.meta.url),
    "utf8",
  );

  assert.equal(service.includes("senderDeviceId: auth.session.deviceId"), true);
  assert.equal(contracts.includes("senderDeviceId"), true);
  const sendStart = contracts.indexOf("export const messageSendSchema");
  const editStart = contracts.indexOf("export const messageEditSchema", sendStart);
  const sendBlock = contracts.slice(sendStart, editStart);
  assert.equal(sendBlock.includes("device"), false);
});

test("M1 presence projection is bounded by current partnership activation", async () => {
  const repository = await readFile(
    new URL("../../../packages/db/src/repositories/messaging.ts", import.meta.url),
    "utf8",
  );

  assert.equal(
    repository.includes(
      "partner_presence.last_seen_at >= partnership.activated_at",
    ),
    true,
  );
  assert.equal(repository.includes("CREATE TABLE account_presence"), false);
});

test("M1 routes protect all messaging mutations with authentication and request security", async () => {
  const routes = await readFile(
    new URL("../src/modules/messages/routes.ts", import.meta.url),
    "utf8",
  );
  const security = await readFile(
    new URL("../src/plugins/request-security.ts", import.meta.url),
    "utf8",
  );

  for (const method of ["app.post(", "app.patch(", "app.put(", "app.delete("]) {
    assert.equal(routes.includes(method), true);
  }
  assert.equal(routes.includes("requireAuthentication"), true);
  assert.equal(routes.includes("idempotencyKey(request.headers)"), true);
  assert.equal(
    security.includes('["POST", "PUT", "PATCH", "DELETE"]'),
    true,
  );
});

test("M1 relationship-space ownership remains untouched by messaging cleanup", async () => {
  const messaging = await readFile(
    new URL("../../../packages/db/src/repositories/messaging.ts", import.meta.url),
    "utf8",
  );
  const deletion = await readFile(
    new URL("../../worker/src/partnerships/partnership-relational-deletion-handler.ts", import.meta.url),
    "utf8",
  );

  const cleanupStart = messaging.indexOf("export async function deletePartnershipMessagingContent");
  const cleanupEnd = messaging.indexOf("\nexport async function deleteAccountPresence", cleanupStart);
  const cleanup = messaging.slice(cleanupStart, cleanupEnd);

  assert.equal(cleanup.includes("relationship_items"), false);
  assert.equal(cleanup.includes("relationship_events"), false);
  assert.equal(deletion.includes("deletePartnershipMessagingContent"), true);
  assert.equal(deletion.includes("deletePartnershipRelationalContent"), true);
});


test("M1 browser exposes the required chat affordances and advances receipts only after reconciliation", async () => {
  const panel = await readFile(
    new URL("../../web/src/features/messaging/MessagingPanel.tsx", import.meta.url),
    "utf8",
  );

  assert.equal(
    panel.includes('const defaultReactions = ["❤️", "😂", "😭", "😮", "😡", "👍"]'),
    true,
  );
  assert.equal(panel.includes('window.prompt("Emoji reaction")'), true);
  assert.equal(panel.includes("message.editedAt"), true);
  assert.equal(panel.includes('body: { type: "delivered", throughSequence }'), true);
  assert.equal(panel.includes('body: { type: "read", throughSequence }'), true);
  assert.equal(panel.includes('"/typing"'), true);
  assert.equal(panel.includes('"/nicknames/"'), true);
  assert.equal(panel.includes("M1_VISIBLE_CHANGE_POLL_MS"), true);
  assert.equal(panel.includes("M1_PRESENCE_HEARTBEAT_MIN_MS"), true);

  const refreshIndex = panel.indexOf(
    "const message = await refreshMessage(summary.conversationId, change.messageId)",
  );
  const cursorIndex = panel.indexOf("changeCursorRef.current = cursor", refreshIndex);
  assert.ok(refreshIndex >= 0 && cursorIndex > refreshIndex);
  assert.equal(panel.includes("refreshed.latestServerSequence"), false);
});

test("M1 messaging request handlers do not log private request content", async () => {
  const service = await readFile(
    new URL("../src/modules/messages/messaging-service.ts", import.meta.url),
    "utf8",
  );
  const routes = await readFile(
    new URL("../src/modules/messages/routes.ts", import.meta.url),
    "utf8",
  );

  assert.equal(service.includes("console."), false);
  assert.equal(routes.includes("console."), false);
  assert.equal(routes.includes("request.log"), false);
});
