import assert from "node:assert/strict";
import test from "node:test";
import { createApiApplication } from "../src/application.ts";
import { AuthKeyRing } from "../src/security/auth-key-ring.ts";
import {
  closeDatabasePool,
  createDatabasePool,
  databaseConfigFromEnv,
  getTransactionTimestamp,
  lockAccounts,
  terminatePartnershipLifecycle,
  withTransaction,
  type DatabasePool,
} from "@shawtie/db";
import type { ApiConfig } from "../src/config.ts";
import { M2_REALTIME_NOTIFY_CHANNEL } from "@shawtie/contracts";
import type { RawData, WebSocket } from "ws";

function requireDisposableDatabase(): DatabasePool {
  if (process.env.DB_TEST_CONFIRM !== "1") {
    throw new Error("DB_TEST_CONFIRM=1 is required for disposable M2 integration tests");
  }
  return createDatabasePool({
    ...databaseConfigFromEnv(),
    applicationName: "shawtie-m2-api-test",
    maxConnections: 28,
  });
}

const rootKey = Buffer.alloc(32, 7);
const config: ApiConfig = {
  environment: "test",
  appOrigin: "http://127.0.0.1:4173",
  allowInsecureLoopbackCookies: true,
  trustedProxy: false,
  authKeys: { activeVersion: 1, keys: new Map([[1, rootKey]]) },
  partnerRequestMode: "paired",
};

type App = ReturnType<typeof createApiApplication>;

interface TestAccount {
  readonly accountId: string;
  readonly cookie: string;
  readonly username: string;
  readonly password: string;
}

function jsonHeaders(cookie?: string, key?: string): Record<string, string> {
  return {
    origin: config.appOrigin,
    "x-shawtie-csrf": "1",
    "content-type": "application/json",
    ...(cookie ? { cookie } : {}),
    ...(key ? { "idempotency-key": key } : {}),
  };
}

function mutationHeaders(cookie: string, key?: string): Record<string, string> {
  return {
    origin: config.appOrigin,
    "x-shawtie-csrf": "1",
    cookie,
    ...(key ? { "idempotency-key": key } : {}),
  };
}

function cookieHeader(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers["set-cookie"];
  const values = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  return values.map((value) => value.split(";")[0]).join("; ");
}

async function reset(database: DatabasePool): Promise<void> {
  await database.pool.query(
    "TRUNCATE TABLE accounts, partnerships, registration_intents, outbox_events, scheduled_actions, deletion_manifests CASCADE",
  );
  await database.pool.query("DELETE FROM security_rate_limit_buckets");
  await database.pool.query("DELETE FROM security_email_deliveries");
}

async function latestRegistrationCode(
  database: DatabasePool,
  registrationIntentId: string,
): Promise<string> {
  const result = await database.pool.query<{
    id: string;
    purpose: string;
    challenge_nonce: Buffer;
    verifier_key_version: number;
  }>(
    `SELECT id, purpose, challenge_nonce, verifier_key_version
     FROM email_verifications
     WHERE registration_intent_id = $1
       AND purpose = 'registration'
       AND consumed_at IS NULL
       AND superseded_at IS NULL
     LIMIT 1`,
    [registrationIntentId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Missing registration challenge");
  return new AuthKeyRing(config.authKeys).deriveEmailCode(
    row.id,
    row.purpose,
    row.challenge_nonce,
    row.verifier_key_version,
  );
}

async function latestAccountRecoveryCode(
  database: DatabasePool,
  accountId: string,
): Promise<string> {
  const result = await database.pool.query<{
    id: string;
    purpose: string;
    challenge_nonce: Buffer;
    verifier_key_version: number;
  }>(
    `SELECT id, purpose, challenge_nonce, verifier_key_version
     FROM email_verifications
     WHERE account_id = $1
       AND purpose = 'account_recovery'
       AND consumed_at IS NULL
       AND superseded_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [accountId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Missing account recovery challenge");
  return new AuthKeyRing(config.authKeys).deriveEmailCode(
    row.id,
    row.purpose,
    row.challenge_nonce,
    row.verifier_key_version,
  );
}

async function register(app: App, database: DatabasePool, suffix: string): Promise<TestAccount> {
  const username = "m1_" + suffix;
  const password = "very secure M1 password " + suffix;
  const start = await app.inject({
    method: "POST",
    url: "/api/v1/auth/registration/start",
    headers: jsonHeaders(),
    payload: {
      username,
      displayName: "M1 " + suffix,
      dateOfBirth: "2000-01-01",
      email: username + "@example.test",
      password,
    },
  });
  assert.equal(start.statusCode, 200, start.body);
  const registrationIntentId = (start.json() as { registrationIntentId: string })
    .registrationIntentId;
  const code = await latestRegistrationCode(database, registrationIntentId);
  const verify = await app.inject({
    method: "POST",
    url: "/api/v1/auth/registration/verify",
    headers: jsonHeaders(),
    payload: { registrationIntentId, code, deviceName: "M1 Browser" },
  });
  assert.equal(verify.statusCode, 200, verify.body);
  return {
    accountId: (verify.json() as { accountId: string }).accountId,
    cookie: cookieHeader(verify),
    username,
    password,
  };
}

async function login(app: App, account: TestAccount): Promise<TestAccount> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: jsonHeaders(),
    payload: {
      identifier: account.username,
      password: account.password,
      deviceName: "M1 Recovery Browser",
    },
  });
  assert.equal(response.statusCode, 200, response.body);
  return { ...account, cookie: cookieHeader(response) };
}

async function formPartnership(
  app: App,
  sender: TestAccount,
  recipient: TestAccount,
  suffix: string,
): Promise<{ partnershipId: string; conversationId: string }> {
  const request = await app.inject({
    method: "POST",
    url: "/api/v1/partner-requests",
    headers: jsonHeaders(sender.cookie, "m1-request-" + suffix + "-0001"),
    payload: {
      recipientAccountId: recipient.accountId,
      expectedUsername: recipient.username,
      relationshipStartDate: "2020-01-01",
    },
  });
  assert.equal(request.statusCode, 201, request.body);
  const requestId = (request.json() as { requestId: string }).requestId;

  const accepted = await app.inject({
    method: "POST",
    url: "/api/v1/partner-requests/" + requestId + "/accept",
    headers: mutationHeaders(recipient.cookie),
  });
  assert.equal(accepted.statusCode, 200, accepted.body);
  const partnershipId = (accepted.json() as { partnershipId: string }).partnershipId;

  const current = await app.inject({
    method: "GET",
    url: "/api/v1/conversations/current",
    headers: { cookie: sender.cookie },
  });
  assert.equal(current.statusCode, 200, current.body);
  const conversation = (
    current.json() as {
      conversation: { conversationId: string; partnershipId: string } | null;
    }
  ).conversation;
  assert.ok(conversation);
  assert.equal(conversation.partnershipId, partnershipId);

  return { partnershipId, conversationId: conversation.conversationId };
}

async function sendMessage(
  app: App,
  account: TestAccount,
  conversationId: string,
  body: string,
  key: string,
  replyToMessageId: string | null = null,
) {
  return app.inject({
    method: "POST",
    url: "/api/v1/conversations/" + conversationId + "/messages",
    headers: jsonHeaders(account.cookie, key),
    payload: { body, replyToMessageId },
  });
}

async function reauthenticate(app: App, account: TestAccount): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/reauthenticate",
    headers: jsonHeaders(account.cookie),
    payload: { password: account.password },
  });
  assert.equal(response.statusCode, 200, response.body);
  return cookieHeader(response);
}


function waitForFrame(
  socket: WebSocket,
  type: string,
  timeoutMs = 5_000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("Timed out waiting for realtime frame " + type));
    }, timeoutMs);

    function onMessage(data: RawData) {
      let frame: unknown;
      try {
        frame = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (
        frame !== null &&
        typeof frame === "object" &&
        "type" in frame &&
        frame.type === type
      ) {
        clearTimeout(timeout);
        socket.off("message", onMessage);
        resolve(frame as Record<string, unknown>);
      }
    }

    socket.on("message", onMessage);
  });
}

test("M2 authenticated websocket receives ready and PostgreSQL realtime invalidation", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "m2alice");
    const bob = await register(app, database, "m2bob");
    const formed = await formPartnership(app, alice, bob, "m2realtime");

    const socket = await app.injectWS("/api/v1/realtime", {
      headers: {
        origin: config.appOrigin,
        cookie: alice.cookie,
        "sec-websocket-protocol": "shawtie.realtime.v1",
      },
    });

    try {
      const ready = await waitForFrame(socket, "control.ready");
      const readyPayload = ready.payload as Record<string, unknown>;
      assert.equal(readyPayload.accountId, alice.accountId);
      assert.equal(readyPayload.partnershipId, formed.partnershipId);
      assert.equal(readyPayload.conversationId, formed.conversationId);

      const sent = await sendMessage(
        app,
        bob,
        formed.conversationId,
        "M2 notify bridge",
        "m2-notify-send-0001",
      );
      assert.equal(sent.statusCode, 201, sent.body);
      const created = sent.json() as {
        messageId: string;
        serverSequence: number;
        contentVersion: number;
        changeSequence: number;
      };

      const eventId = "70000000-0000-4000-8000-000000000001";
      const framePromise = waitForFrame(socket, "message.changed");
      await database.pool.query("SELECT pg_notify($1, $2)", [
        M2_REALTIME_NOTIFY_CHANNEL,
        JSON.stringify({
          v: 1,
          kind: "message.changed",
          scope: { conversationId: formed.conversationId },
          data: {
            eventId,
            conversationId: formed.conversationId,
            messageId: created.messageId,
            mutation: "created",
            changeSequence: created.changeSequence,
            serverSequence: created.serverSequence,
            contentVersion: created.contentVersion,
          },
        }),
      ]);

      const changed = await framePromise;
      const changedPayload = changed.payload as Record<string, unknown>;
      assert.equal(changedPayload.eventId, eventId);
      assert.equal(changedPayload.messageId, created.messageId);
      assert.equal(changedPayload.changeSequence, created.changeSequence);
      assert.equal(changedPayload.serverSequence, created.serverSequence);
      assert.equal("body" in changedPayload, false);
    } finally {
      socket.terminate();
    }
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("M2 websocket rejects a foreign Origin before connection authorization", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "m2origin");

    await assert.rejects(
      () =>
        app.injectWS("/api/v1/realtime", {
          headers: {
            origin: "https://evil.example",
            cookie: alice.cookie,
            "sec-websocket-protocol": "shawtie.realtime.v1",
          },
        }),
    );
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});
