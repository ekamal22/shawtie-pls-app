import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("M2 websocket registration is authenticated, origin-bound, and content-free", async () => {
  const application = await readFile(new URL("../src/application.ts", import.meta.url), "utf8");
  const routes = await readFile(
    new URL("../src/modules/realtime/routes.ts", import.meta.url),
    "utf8",
  );
  const hub = await readFile(
    new URL("../src/modules/realtime/realtime-hub.ts", import.meta.url),
    "utf8",
  );
  const contracts = await readFile(
    new URL("../../../packages/contracts/src/realtime/m2.ts", import.meta.url),
    "utf8",
  );

  assert.ok(
    application.indexOf("app.register(websocket") <
      application.indexOf("app.register(async function realtimeRoutes"),
  );
  assert.equal(application.includes("registerRealtimeRoutes(realtimeApp"), true);
  assert.equal(application.includes("perMessageDeflate: false"), true);
  assert.equal(application.includes("M2_REALTIME_MAX_FRAME_BYTES"), true);
  assert.equal(routes.includes("request.headers.origin !== dependencies.config.appOrigin"), true);
  assert.equal(routes.includes("requireAuthentication("), true);
  assert.equal(routes.includes("M2_REALTIME_SUBPROTOCOL"), true);
  assert.equal(routes.includes("subscribe"), false);

  assert.equal(hub.includes("if (isBinary)"), true);
  assert.equal(hub.includes("connection.socket.bufferedAmount > MAX_BUFFERED_BYTES"), true);
  assert.equal(hub.includes("authenticateSessionToken("), true);
  assert.equal(hub.includes('reason: "scope_changed"'), true);
  assert.equal(hub.includes("sameIdentity(scope, connection)"), true);
  assert.equal(contracts.includes('"message.send"'), false);
  assert.equal(contracts.includes("bodyText"), false);
});

test("M2 LISTEN reset and worker publication remain correctness hints", async () => {
  const listener = await readFile(
    new URL("../src/modules/realtime/realtime-listener.ts", import.meta.url),
    "utf8",
  );
  const dbListener = await readFile(
    new URL("../../../packages/db/src/realtime/postgres-notifications.ts", import.meta.url),
    "utf8",
  );
  const workerPublisher = await readFile(
    new URL("../../worker/src/realtime/realtime-publisher.ts", import.meta.url),
    "utf8",
  );
  const handler = await readFile(
    new URL("../../worker/src/messages/messaging-invalidation-handler.ts", import.meta.url),
    "utf8",
  );
  const workerMain = await readFile(new URL("../../worker/src/main.ts", import.meta.url), "utf8");

  assert.equal(listener.includes('hub.requestResyncAll("listener_reset")'), true);
  assert.equal(dbListener.includes("LISTEN"), true);
  assert.equal(dbListener.includes("scheduleReconnect"), true);
  assert.equal(workerPublisher.includes("SELECT pg_notify($1, $2)"), true);
  assert.equal(workerPublisher.includes("M2_INTERNAL_NOTIFY_MAX_BYTES"), true);
  assert.equal(handler.includes("body:"), false);
  assert.equal(handler.includes("emoji:"), false);
  assert.equal(handler.includes("nickname:"), false);
  assert.equal(workerMain.includes("createDefaultOutboxHandlers(database)"), true);
});

test("M2 cross-feature durable invalidations cover interaction, lifecycle, R1, and security changes", async () => {
  const messaging = await readFile(
    new URL("../src/modules/messages/messaging-service.ts", import.meta.url),
    "utf8",
  );
  const partnerships = await readFile(
    new URL("../src/modules/partnerships/partnership-service.ts", import.meta.url),
    "utf8",
  );
  const relationship = await readFile(
    new URL("../src/modules/relationship-space/relationship-space-service.ts", import.meta.url),
    "utf8",
  );
  const accounts = await readFile(
    new URL("../src/modules/accounts/account-service.ts", import.meta.url),
    "utf8",
  );
  const workerHandler = await readFile(
    new URL("../../worker/src/realtime/realtime-outbox-handler.ts", import.meta.url),
    "utf8",
  );

  assert.equal(messaging.includes("queueRealtimeReceiptChanged"), true);
  assert.equal(messaging.includes("queueRealtimeNicknameChanged"), true);
  assert.equal(partnerships.includes("queueRealtimePartnershipChanged"), true);
  assert.equal(relationship.includes("queueRealtimeRelationshipChanged"), true);
  assert.equal(accounts.includes("queueRealtimeAccountSecurityChanged"), true);
  assert.equal(workerHandler.includes("m2.relationship.changed"), true);
  assert.equal(workerHandler.includes("m2.partnership.changed"), true);
  assert.equal(workerHandler.includes("privateNote"), false);
});

test("M2 realtime applies durable connection and per-socket frame rate limits", async () => {
  const routes = await readFile(
    new URL("../src/modules/realtime/routes.ts", import.meta.url),
    "utf8",
  );
  const hub = await readFile(
    new URL("../src/modules/realtime/realtime-hub.ts", import.meta.url),
    "utf8",
  );

  assert.equal(routes.includes("consumeRateLimitBuckets"), true);
  assert.equal(routes.includes('"m2.realtime.connect.account"'), true);
  assert.equal(routes.includes('"m2.realtime.connect.network"'), true);
  assert.equal(routes.includes("REALTIME_CONNECT_RATE_LIMIT"), true);
  assert.equal(hub.includes("MAX_CLIENT_FRAMES_PER_WINDOW"), true);
  assert.equal(hub.includes("frameWindowCount += 1"), true);
  assert.equal(hub.includes('"Rate limited"'), true);
});

test("M2 advertised HTTP compatibility versions fail closed on mismatch", async () => {
  const security = await readFile(
    new URL("../src/plugins/request-security.ts", import.meta.url),
    "utf8",
  );
  const application = await readFile(new URL("../src/application.ts", import.meta.url), "utf8");

  assert.equal(security.includes("installM2Compatibility"), true);
  assert.equal(security.includes("M2_CLIENT_PROTOCOL_HEADER"), true);
  assert.equal(security.includes("M2_LOCAL_SCHEMA_HEADER"), true);
  assert.equal(security.includes('"CLIENT_UPDATE_REQUIRED"'), true);
  assert.ok(
    application.indexOf("installM2Compatibility(app)") <
      application.indexOf("registerAccountRoutes(app"),
  );
});
