import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApiApplication } from "../src/application.ts";
import { AuthKeyRing } from "../src/security/auth-key-ring.ts";
import {
  closeDatabasePool,
  createDatabasePool,
  databaseConfigFromEnv,
  type DatabasePool,
} from "@shawtie/db";
import type { ApiConfig } from "../src/config.ts";

function requireDisposableDatabase(): DatabasePool {
  if (process.env.DB_TEST_CONFIRM !== "1") {
    throw new Error("DB_TEST_CONFIRM=1 is required for disposable P1 integration tests");
  }
  return createDatabasePool({
    ...databaseConfigFromEnv(),
    applicationName: "shawtie-p1-api-test",
    maxConnections: 16,
  });
}

const rootKey = Buffer.alloc(32, 7);
const config: ApiConfig = {
  environment: "test",
  appOrigin: "http://127.0.0.1:4173",
  allowInsecureLoopbackCookies: true,
  trustedProxy: false,
  authKeys: { activeVersion: 1, keys: new Map([[1, rootKey]]) },
  partnerRequestMode: "request_only_test",
};

type App = ReturnType<typeof createApiApplication>;

function jsonHeaders(cookie?: string): Record<string, string> {
  return {
    origin: config.appOrigin,
    "x-shawtie-csrf": "1",
    "content-type": "application/json",
    ...(cookie ? { cookie } : {}),
  };
}

function mutationHeaders(cookie: string): Record<string, string> {
  return {
    origin: config.appOrigin,
    "x-shawtie-csrf": "1",
    cookie,
  };
}

function cookieHeader(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers["set-cookie"];
  const values = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  return values.map((value) => value.split(";")[0]).join("; ");
}

async function reset(database: DatabasePool): Promise<void> {
  await database.pool.query(
    "TRUNCATE TABLE accounts, registration_intents, outbox_events, scheduled_actions, deletion_manifests CASCADE",
  );
  await database.pool.query("DELETE FROM security_rate_limit_buckets");
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

async function register(
  app: App,
  database: DatabasePool,
  suffix: string,
): Promise<{ accountId: string; cookie: string; username: string; password: string }> {
  const username = "p1_" + suffix;
  const password = "very secure P1 password " + suffix;
  const start = await app.inject({
    method: "POST",
    url: "/api/v1/auth/registration/start",
    headers: jsonHeaders(),
    payload: {
      username,
      displayName: "P1 " + suffix,
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
    payload: { registrationIntentId, code, deviceName: "P1 Browser" },
  });
  assert.equal(verify.statusCode, 200, verify.body);
  return {
    accountId: (verify.json() as { accountId: string }).accountId,
    cookie: cookieHeader(verify),
    username,
    password,
  };
}

async function createRequest(
  app: App,
  sender: { cookie: string },
  target: { accountId: string; username: string },
  key: string,
  relationshipStartDate = "2025-01-01",
) {
  return app.inject({
    method: "POST",
    url: "/api/v1/partner-requests",
    headers: {
      ...jsonHeaders(sender.cookie),
      "idempotency-key": key,
    },
    payload: {
      recipientAccountId: target.accountId,
      expectedUsername: target.username,
      relationshipStartDate,
    },
  });
}

test("P1 exact discovery is authenticated, normalized, minimized, and hides a blocking target", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "alice");
    const bob = await register(app, database, "bob");

    const unauthenticated = await app.inject({
      method: "POST",
      url: "/api/v1/discovery/username",
      headers: jsonHeaders(),
      payload: { username: bob.username },
    });
    assert.equal(unauthenticated.statusCode, 401);

    const found = await app.inject({
      method: "POST",
      url: "/api/v1/discovery/username",
      headers: jsonHeaders(alice.cookie),
      payload: { username: bob.username.toUpperCase() },
    });
    assert.equal(found.statusCode, 200, found.body);
    const result = (found.json() as { result: Record<string, unknown> | null }).result;
    assert.ok(result);
    assert.equal(result.accountId, bob.accountId);
    assert.equal(result.username, bob.username);
    assert.equal(typeof result.age, "number");
    assert.equal("email" in result, false);
    assert.equal("dateOfBirth" in result, false);
    assert.equal(found.headers["cache-control"], "private, no-store");

    const self = await app.inject({
      method: "POST",
      url: "/api/v1/discovery/username",
      headers: jsonHeaders(alice.cookie),
      payload: { username: alice.username },
    });
    assert.deepEqual(self.json(), { result: null });

    await database.pool.query(
      `INSERT INTO partnership_blocks (
         id, blocker_account_id, blocked_account_id, created_at
       ) VALUES ($1,$2,$3,clock_timestamp())`,
      [randomUUID(), bob.accountId, alice.accountId],
    );
    const hidden = await app.inject({
      method: "POST",
      url: "/api/v1/discovery/username",
      headers: jsonHeaders(alice.cookie),
      payload: { username: bob.username },
    });
    assert.deepEqual(hidden.json(), { result: null });
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("P1 create is idempotent, lists both directions, and cancel is owner-safe", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "create_alice");
    const bob = await register(app, database, "create_bob");
    const key = "p1-create-idem-0001";

    const created = await createRequest(app, alice, bob, key);
    assert.equal(created.statusCode, 201, created.body);
    const createdBody = created.json() as { outcome: string; requestId: string; expiresAt: string };
    assert.equal(createdBody.outcome, "created");

    const replay = await createRequest(app, alice, bob, key);
    assert.equal(replay.statusCode, 201, replay.body);
    assert.deepEqual(replay.json(), createdBody);

    const changedFingerprint = await createRequest(
      app,
      alice,
      bob,
      key,
      "2024-01-01",
    );
    assert.equal(changedFingerprint.statusCode, 409);
    assert.equal(
      (changedFingerprint.json() as { error: { code: string } }).error.code,
      "IDEMPOTENCY_KEY_REUSED",
    );

    const outgoing = await app.inject({
      method: "GET",
      url: "/api/v1/partner-requests?direction=outgoing&limit=25",
      headers: { cookie: alice.cookie },
    });
    assert.equal(outgoing.statusCode, 200, outgoing.body);
    const outgoingBody = outgoing.json() as { items: Array<{ requestId: string }> };
    assert.equal(outgoingBody.items.length, 1);
    assert.equal(outgoingBody.items[0]?.requestId, createdBody.requestId);

    const incoming = await app.inject({
      method: "GET",
      url: "/api/v1/partner-requests?direction=incoming&limit=25",
      headers: { cookie: bob.cookie },
    });
    assert.equal(incoming.statusCode, 200, incoming.body);
    assert.equal((incoming.json() as { items: unknown[] }).items.length, 1);

    const wrongOwner = await app.inject({
      method: "POST",
      url: "/api/v1/partner-requests/" + createdBody.requestId + "/cancel",
      headers: mutationHeaders(bob.cookie),
    });
    assert.equal(wrongOwner.statusCode, 404);

    const cancelled = await app.inject({
      method: "POST",
      url: "/api/v1/partner-requests/" + createdBody.requestId + "/cancel",
      headers: mutationHeaders(alice.cookie),
    });
    assert.equal(cancelled.statusCode, 200, cancelled.body);
    assert.equal((cancelled.json() as { status: string }).status, "cancelled");

    const replayCancel = await app.inject({
      method: "POST",
      url: "/api/v1/partner-requests/" + createdBody.requestId + "/cancel",
      headers: mutationHeaders(alice.cookie),
    });
    assert.equal((replayCancel.json() as { status: string }).status, "cancelled");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("P1 decline creates no block and enforces the exact same-pair cooldown", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "decline_alice");
    const bob = await register(app, database, "decline_bob");

    const created = await createRequest(app, alice, bob, "p1-decline-0000001");
    const requestId = (created.json() as { requestId: string }).requestId;
    const declined = await app.inject({
      method: "POST",
      url: "/api/v1/partner-requests/" + requestId + "/decline",
      headers: mutationHeaders(bob.cookie),
    });
    assert.equal(declined.statusCode, 200, declined.body);
    assert.equal((declined.json() as { status: string }).status, "declined");

    const blocks = await database.pool.query(
      "SELECT 1 FROM partnership_blocks WHERE blocker_account_id = $1 AND blocked_account_id = $2",
      [bob.accountId, alice.accountId],
    );
    assert.equal(blocks.rowCount, 0);

    const blockedByCooldown = await createRequest(
      app,
      alice,
      bob,
      "p1-decline-0000002",
    );
    assert.equal(blockedByCooldown.statusCode, 409);
    assert.equal(
      (blockedByCooldown.json() as { error: { code: string } }).error.code,
      "REQUEST_DECLINE_COOLDOWN",
    );

    await database.pool.query(
      "UPDATE partner_requests SET declined_at = clock_timestamp() - interval '1 hour' WHERE id = $1",
      [requestId],
    );
    const atBoundary = await createRequest(app, alice, bob, "p1-decline-0000003");
    assert.equal(atBoundary.statusCode, 201, atBoundary.body);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("P1 rolling monthly limit counts successful sends even after cancellation", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "monthly_alice");
    const bob = await register(app, database, "monthly_bob");

    for (let index = 1; index <= 3; index += 1) {
      const response = await createRequest(
        app,
        alice,
        bob,
        "p1-monthly-key-" + String(index).padStart(4, "0"),
      );
      assert.equal(response.statusCode, 201, response.body);
      const requestId = (response.json() as { requestId: string }).requestId;
      const cancel = await app.inject({
        method: "POST",
        url: "/api/v1/partner-requests/" + requestId + "/cancel",
        headers: mutationHeaders(alice.cookie),
      });
      assert.equal(cancel.statusCode, 200, cancel.body);
    }

    const fourth = await createRequest(app, alice, bob, "p1-monthly-key-0004");
    assert.equal(fourth.statusCode, 409);
    assert.equal(
      (fourth.json() as { error: { code: string } }).error.code,
      "REQUEST_MONTHLY_LIMIT",
    );
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("P1 opposite-direction race emits one reciprocal-ready outcome and no duplicate direction", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "race_alice");
    const bob = await register(app, database, "race_bob");

    const [aToB, bToA] = await Promise.all([
      createRequest(app, alice, bob, "p1-opposite-key-001"),
      createRequest(app, bob, alice, "p1-opposite-key-002"),
    ]);
    assert.equal(aToB.statusCode, 201, aToB.body);
    assert.equal(bToA.statusCode, 201, bToA.body);
    const outcomes = [
      (aToB.json() as { outcome: string }).outcome,
      (bToA.json() as { outcome: string }).outcome,
    ].sort();
    assert.deepEqual(outcomes, ["created", "reciprocal_pair_ready"]);

    const pending = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM partner_requests WHERE status = 'pending'",
    );
    assert.equal(pending.rows[0]?.count, "2");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("P1 same-direction race produces one request and one duplicate denial", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "same_alice");
    const bob = await register(app, database, "same_bob");
    const responses = await Promise.all([
      createRequest(app, alice, bob, "p1-same-key-000001"),
      createRequest(app, alice, bob, "p1-same-key-000002"),
    ]);
    assert.deepEqual(
      responses.map((response) => response.statusCode).sort((a, b) => a - b),
      [201, 409],
    );
    const denied = responses.find((response) => response.statusCode === 409);
    assert.equal(
      (denied?.json() as { error: { code: string } }).error.code,
      "REQUEST_ALREADY_PENDING",
    );
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("P1 list cursor is snapshot-bound and excludes later inserts", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const bob = await register(app, database, "page_bob");
    const alice = await register(app, database, "page_alice");
    const charlie = await register(app, database, "page_charlie");
    const dave = await register(app, database, "page_dave");

    assert.equal((await createRequest(app, alice, bob, "p1-page-key-000001")).statusCode, 201);
    assert.equal((await createRequest(app, charlie, bob, "p1-page-key-000002")).statusCode, 201);

    const pageOne = await app.inject({
      method: "GET",
      url: "/api/v1/partner-requests?direction=incoming&limit=1",
      headers: { cookie: bob.cookie },
    });
    assert.equal(pageOne.statusCode, 200, pageOne.body);
    const first = pageOne.json() as { items: Array<{ requestId: string }>; nextCursor: string };
    assert.equal(first.items.length, 1);
    assert.ok(first.nextCursor);

    assert.equal((await createRequest(app, dave, bob, "p1-page-key-000003")).statusCode, 201);

    const pageTwo = await app.inject({
      method: "GET",
      url:
        "/api/v1/partner-requests?direction=incoming&limit=10&cursor=" +
        encodeURIComponent(first.nextCursor),
      headers: { cookie: bob.cookie },
    });
    assert.equal(pageTwo.statusCode, 200, pageTwo.body);
    const second = pageTwo.json() as {
      items: Array<{ counterpart: { accountId: string } }>;
    };
    assert.equal(second.items.some((item) => item.counterpart.accountId === dave.accountId), false);
    assert.equal(second.items.length, 1);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("P1 future relationship date and recipient-side block map to safe denials", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "safe_alice");
    const bob = await register(app, database, "safe_bob");

    const future = await createRequest(
      app,
      alice,
      bob,
      "p1-future-key-00001",
      "2999-01-01",
    );
    assert.equal(future.statusCode, 409);
    assert.equal(
      (future.json() as { error: { code: string } }).error.code,
      "RELATIONSHIP_DATE_FUTURE",
    );

    await database.pool.query(
      `INSERT INTO partnership_blocks (
         id, blocker_account_id, blocked_account_id, created_at
       ) VALUES ($1,$2,$3,clock_timestamp())`,
      [randomUUID(), bob.accountId, alice.accountId],
    );
    const unavailable = await createRequest(app, alice, bob, "p1-block-key-000001");
    assert.equal(unavailable.statusCode, 409);
    assert.equal(
      (unavailable.json() as { error: { code: string } }).error.code,
      "TARGET_UNAVAILABLE",
    );
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("P1 account deletion invalidates pending incoming and outgoing requests atomically", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "delete_alice");
    const bob = await register(app, database, "delete_bob");
    const charlie = await register(app, database, "delete_charlie");

    assert.equal((await createRequest(app, alice, bob, "p1-delete-key-0001")).statusCode, 201);
    assert.equal((await createRequest(app, charlie, alice, "p1-delete-key-0002")).statusCode, 201);

    const reauth = await app.inject({
      method: "POST",
      url: "/api/v1/auth/reauthenticate",
      headers: jsonHeaders(alice.cookie),
      payload: { password: alice.password },
    });
    assert.equal(reauth.statusCode, 200, reauth.body);
    const reauthedCookie = cookieHeader(reauth);

    const deletion = await app.inject({
      method: "POST",
      url: "/api/v1/me/account-deletion",
      headers: jsonHeaders(reauthedCookie),
      payload: {},
    });
    assert.equal(deletion.statusCode, 200, deletion.body);

    const rows = await database.pool.query<{ status: string; invalidated_reason: string }>(
      `SELECT status, invalidated_reason
       FROM partner_requests
       WHERE sender_account_id = $1 OR recipient_account_id = $1`,
      [alice.accountId],
    );
    assert.equal(rows.rowCount, 2);
    assert.ok(
      rows.rows.every(
        (row) => row.status === "invalidated" && row.invalidated_reason === "account_unavailable",
      ),
    );
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("P1 create abuse limit is durable and returns 429 after thirty attempts", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "limit_alice");
    const missingAccountId = randomUUID();

    for (let index = 1; index <= 30; index += 1) {
      const response = await createRequest(
        app,
        alice,
        { accountId: missingAccountId, username: "missing_user" },
        "p1-abuse-key-" + String(index).padStart(6, "0"),
      );
      assert.equal(response.statusCode, 409, response.body);
    }
    const limited = await createRequest(
      app,
      alice,
      { accountId: missingAccountId, username: "missing_user" },
      "p1-abuse-key-000031",
    );
    assert.equal(limited.statusCode, 429, limited.body);
    assert.equal(
      (limited.json() as { error: { code: string } }).error.code,
      "RATE_LIMITED",
    );
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});


test("P1 self request is rejected and retained as explicit attempt evidence", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "self_alice");

    const response = await createRequest(
      app,
      alice,
      { accountId: alice.accountId, username: alice.username },
      "p1-self-key-000001",
    );
    assert.equal(response.statusCode, 409, response.body);
    assert.equal(
      (response.json() as { error: { code: string } }).error.code,
      "REQUEST_SELF",
    );

    const attempts = await database.pool.query<{ outcome: string }>(
      "SELECT outcome FROM partner_request_attempts " +
        "WHERE sender_account_id = $1 AND recipient_account_id = $1",
      [alice.accountId],
    );
    assert.equal(attempts.rowCount, 1);
    assert.equal(attempts.rows[0]?.outcome, "self_request");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("P1 expected denial is replayed from idempotency even after hidden target state changes", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "denial_alice");
    const bob = await register(app, database, "denial_bob");
    const blockId = randomUUID();
    await database.pool.query(
      "INSERT INTO partnership_blocks (" +
        "id, blocker_account_id, blocked_account_id, created_at" +
        ") VALUES ($1,$2,$3,clock_timestamp())",
      [blockId, bob.accountId, alice.accountId],
    );

    const key = "p1-denial-replay-001";
    const denied = await createRequest(app, alice, bob, key);
    assert.equal(denied.statusCode, 409, denied.body);
    assert.equal(
      (denied.json() as { error: { code: string } }).error.code,
      "TARGET_UNAVAILABLE",
    );

    await database.pool.query(
      "UPDATE partnership_blocks SET removed_at = clock_timestamp() WHERE id = $1",
      [blockId],
    );

    const replay = await createRequest(app, alice, bob, key);
    assert.equal(replay.statusCode, 409, replay.body);
    assert.deepEqual(replay.json(), denied.json());

    const requests = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM partner_requests",
    );
    assert.equal(requests.rows[0]?.count, "0");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("P1 concurrent same-idempotency retries create one logical request", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "idem_race_alice");
    const bob = await register(app, database, "idem_race_bob");
    const key = "p1-idem-race-000001";

    const [first, second] = await Promise.all([
      createRequest(app, alice, bob, key),
      createRequest(app, alice, bob, key),
    ]);
    assert.equal(first.statusCode, 201, first.body);
    assert.equal(second.statusCode, 201, second.body);
    assert.deepEqual(first.json(), second.json());

    const requests = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM partner_requests WHERE status = 'pending'",
    );
    const attempts = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM partner_request_attempts WHERE outcome = 'created'",
    );
    assert.equal(requests.rows[0]?.count, "1");
    assert.equal(attempts.rows[0]?.count, "1");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("P1 direct create API cannot bypass recipient partnership occupancy", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "occupied_alice");
    const bob = await register(app, database, "occupied_bob");
    const charlie = await register(app, database, "occupied_charlie");
    const partnershipId = randomUUID();

    await database.pool.query(
      "INSERT INTO partnerships (" +
        "id, relationship_start_date, lifecycle_state, generation, version, " +
        "activated_at, created_at, updated_at" +
        ") VALUES ($1,DATE '2025-01-01','active',1,1," +
        "clock_timestamp(),clock_timestamp(),clock_timestamp())",
      [partnershipId],
    );
    await database.pool.query(
      "INSERT INTO partnership_members (partnership_id, account_id, joined_at) " +
        "VALUES ($1,$2,clock_timestamp()),($1,$3,clock_timestamp())",
      [partnershipId, bob.accountId, charlie.accountId],
    );

    const response = await createRequest(
      app,
      alice,
      bob,
      "p1-occupied-key-001",
    );
    assert.equal(response.statusCode, 409, response.body);
    assert.equal(
      (response.json() as { error: { code: string } }).error.code,
      "TARGET_UNAVAILABLE",
    );
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});
