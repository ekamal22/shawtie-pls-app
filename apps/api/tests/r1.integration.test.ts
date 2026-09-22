import assert from "node:assert/strict";
import test from "node:test";
import {
  closeDatabasePool,
  createDatabasePool,
  databaseConfigFromEnv,
  type DatabasePool,
} from "@shawtie/db";
import { createApiApplication } from "../src/application.ts";
import type { ApiConfig } from "../src/config.ts";
import { AuthKeyRing } from "../src/security/auth-key-ring.ts";

function requireDisposableDatabase(): DatabasePool {
  if (process.env.DB_TEST_CONFIRM !== "1") {
    throw new Error("DB_TEST_CONFIRM=1 is required for disposable R1 API tests");
  }
  return createDatabasePool({
    ...databaseConfigFromEnv(),
    applicationName: "shawtie-r1-api-test",
    maxConnections: 24,
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
  accountId: string;
  cookie: string;
  username: string;
  password: string;
  email: string;
}

function headers(cookie?: string, key?: string): Record<string, string> {
  return {
    origin: config.appOrigin,
    "x-shawtie-csrf": "1",
    "content-type": "application/json",
    ...(cookie ? { cookie } : {}),
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
  await database.pool.query("DELETE FROM idempotency_records");
}

async function registrationCode(
  database: DatabasePool,
  registrationIntentId: string,
): Promise<string> {
  const result = await database.pool.query<{
    id: string;
    purpose: string;
    challenge_nonce: Buffer;
    verifier_key_version: number;
  }>(
    "SELECT id, purpose, challenge_nonce, verifier_key_version FROM email_verifications WHERE registration_intent_id = $1 AND purpose = 'registration' AND consumed_at IS NULL AND superseded_at IS NULL LIMIT 1",
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

async function recoveryCode(database: DatabasePool, accountId: string): Promise<string> {
  const result = await database.pool.query<{
    id: string;
    purpose: string;
    challenge_nonce: Buffer;
    verifier_key_version: number;
  }>(
    "SELECT id, purpose, challenge_nonce, verifier_key_version FROM email_verifications WHERE account_id = $1 AND purpose = 'account_recovery' AND consumed_at IS NULL AND superseded_at IS NULL ORDER BY created_at DESC LIMIT 1",
    [accountId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Missing recovery challenge");
  return new AuthKeyRing(config.authKeys).deriveEmailCode(
    row.id,
    row.purpose,
    row.challenge_nonce,
    row.verifier_key_version,
  );
}

async function register(app: App, database: DatabasePool, suffix: string): Promise<TestAccount> {
  const username = "r1_" + suffix;
  const password = "very secure R1 password " + suffix;
  const email = username + "@example.test";
  const start = await app.inject({
    method: "POST",
    url: "/api/v1/auth/registration/start",
    headers: headers(),
    payload: {
      username,
      displayName: "R1 " + suffix,
      dateOfBirth: "2000-01-01",
      email,
      password,
    },
  });
  assert.equal(start.statusCode, 200, start.body);
  const registrationIntentId = (start.json() as { registrationIntentId: string })
    .registrationIntentId;
  const code = await registrationCode(database, registrationIntentId);
  const verify = await app.inject({
    method: "POST",
    url: "/api/v1/auth/registration/verify",
    headers: headers(),
    payload: { registrationIntentId, code, deviceName: "R1 Browser" },
  });
  assert.equal(verify.statusCode, 200, verify.body);
  return {
    accountId: (verify.json() as { accountId: string }).accountId,
    cookie: cookieHeader(verify),
    username,
    password,
    email,
  };
}

async function formPartnership(
  app: App,
  alice: TestAccount,
  bob: TestAccount,
  key: string,
  relationshipStartDate = "2020-01-01",
): Promise<string> {
  const request = await app.inject({
    method: "POST",
    url: "/api/v1/partner-requests",
    headers: headers(alice.cookie, key),
    payload: {
      recipientAccountId: bob.accountId,
      expectedUsername: bob.username,
      relationshipStartDate,
    },
  });
  assert.equal(request.statusCode, 201, request.body);
  const requestId = (request.json() as { requestId: string }).requestId;
  const accepted = await app.inject({
    method: "POST",
    url: "/api/v1/partner-requests/" + requestId + "/accept",
    headers: headers(bob.cookie),
  });
  assert.equal(accepted.statusCode, 200, accepted.body);
  return (accepted.json() as { partnershipId: string }).partnershipId;
}

async function createItem(
  app: App,
  account: TestAccount,
  key: string,
  payload: unknown,
): Promise<{ itemId: string; version: number }> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/relationship-space/items",
    headers: headers(account.cookie, key),
    payload,
  });
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.headers["cache-control"], "private, no-store");
  return response.json() as { itemId: string; version: number };
}

function memoryPayload(title: string, date = "2020-09-22") {
  const [year, month, day] = date.split("-").map(Number);
  return {
    kind: "memory",
    contentSchemaVersion: 1,
    preview: null,
    content: { title, note: "private note" },
    occurrence: { precision: "day", year, month, day },
    storyIncluded: false,
    release: null,
    featureState: null,
    references: [],
    links: [],
  };
}

test("R1 creator ownership, exact mutation replay, version conflicts, and hard delete", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "crud_alice");
    const bob = await register(app, database, "crud_bob");
    await formPartnership(app, alice, bob, "r1-crud-form-0001");

    const key = "r1-memory-create-0001";
    const created = await createItem(app, alice, key, memoryPayload("First title"));

    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/relationship-space/items",
      headers: headers(alice.cookie, key),
      payload: memoryPayload("First title"),
    });
    assert.equal(replay.statusCode, 201);
    assert.equal((replay.json() as { itemId: string }).itemId, created.itemId);

    const changedReuse = await app.inject({
      method: "POST",
      url: "/api/v1/relationship-space/items",
      headers: headers(alice.cookie, key),
      payload: memoryPayload("Different private text"),
    });
    assert.equal(changedReuse.statusCode, 409);
    assert.equal(
      (changedReuse.json() as { error: { code: string } }).error.code,
      "IDEMPOTENCY_KEY_REUSED",
    );

    const partnerEdit = await app.inject({
      method: "PATCH",
      url: "/api/v1/relationship-space/items/" + created.itemId,
      headers: headers(bob.cookie, "r1-memory-partner-edit"),
      payload: {
        expectedVersion: 1,
        content: { title: "Nope", note: null },
      },
    });
    assert.equal(partnerEdit.statusCode, 403);
    assert.equal(partnerEdit.headers["cache-control"], "private, no-store");

    const editKey = "r1-memory-owner-edit";
    const edited = await app.inject({
      method: "PATCH",
      url: "/api/v1/relationship-space/items/" + created.itemId,
      headers: headers(alice.cookie, editKey),
      payload: {
        expectedVersion: 1,
        content: { title: "Changed", note: "new note" },
      },
    });
    assert.equal(edited.statusCode, 200, edited.body);
    assert.equal((edited.json() as { version: number }).version, 2);

    const editReplay = await app.inject({
      method: "PATCH",
      url: "/api/v1/relationship-space/items/" + created.itemId,
      headers: headers(alice.cookie, editKey),
      payload: {
        expectedVersion: 1,
        content: { title: "Changed", note: "new note" },
      },
    });
    assert.deepEqual(editReplay.json(), edited.json());

    const stale = await app.inject({
      method: "PATCH",
      url: "/api/v1/relationship-space/items/" + created.itemId,
      headers: headers(alice.cookie, "r1-memory-stale-edit"),
      payload: {
        expectedVersion: 1,
        storyIncluded: true,
      },
    });
    assert.equal(stale.statusCode, 409);
    assert.equal((stale.json() as { error: { code: string } }).error.code, "VERSION_CONFLICT");

    const deleteKey = "r1-memory-delete-0001";
    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/v1/relationship-space/items/" + created.itemId,
      headers: headers(alice.cookie, deleteKey),
      payload: { expectedVersion: 2 },
    });
    assert.equal(deleted.statusCode, 204);

    const deleteReplay = await app.inject({
      method: "DELETE",
      url: "/api/v1/relationship-space/items/" + created.itemId,
      headers: headers(alice.cookie, deleteKey),
      payload: { expectedVersion: 2 },
    });
    assert.equal(deleteReplay.statusCode, 204);

    const missing = await app.inject({
      method: "GET",
      url: "/api/v1/relationship-space/items/" + created.itemId,
      headers: headers(bob.cookie),
    });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.headers["cache-control"], "private, no-store");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("R1 recipient-open exposes preview before release and sealed content after release", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "open_alice");
    const bob = await register(app, database, "open_bob");
    await formPartnership(app, alice, bob, "r1-open-form-0001");

    const created = await createItem(app, alice, "r1-open-create-0001", {
      kind: "for_you",
      contentSchemaVersion: 1,
      preview: { title: "For a hard day", conditionLabel: "Open when you need reassurance" },
      content: { body: "You are loved." },
      occurrence: null,
      storyIncluded: false,
      release: { mode: "recipient_open", unlockAt: null },
      featureState: null,
      references: [],
      links: [],
    });

    const before = await app.inject({
      method: "GET",
      url: "/api/v1/relationship-space/items/" + created.itemId,
      headers: headers(bob.cookie),
    });
    assert.equal(before.statusCode, 200, before.body);
    const beforeBody = before.json() as { preview: unknown; content: unknown; version: number };
    assert.ok(beforeBody.preview);
    assert.equal(beforeBody.content, null);

    const creatorOpen = await app.inject({
      method: "POST",
      url: "/api/v1/relationship-space/items/" + created.itemId + "/release",
      headers: headers(alice.cookie, "r1-open-creator"),
      payload: { expectedVersion: beforeBody.version },
    });
    assert.equal(creatorOpen.statusCode, 409);

    const opened = await app.inject({
      method: "POST",
      url: "/api/v1/relationship-space/items/" + created.itemId + "/release",
      headers: headers(bob.cookie, "r1-open-recipient"),
      payload: { expectedVersion: beforeBody.version },
    });
    assert.equal(opened.statusCode, 200, opened.body);

    const after = await app.inject({
      method: "GET",
      url: "/api/v1/relationship-space/items/" + created.itemId,
      headers: headers(bob.cookie),
    });
    assert.equal(after.statusCode, 200);
    assert.deepEqual((after.json() as { content: unknown }).content, { body: "You are loved." });
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("R1 account deletion pauses scheduled release work and recovery wakes overdue work", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "pause_alice");
    const bob = await register(app, database, "pause_bob");
    const partnershipId = await formPartnership(app, alice, bob, "r1-pause-form-0001");

    const future = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    const created = await createItem(app, alice, "r1-pause-create-0001", {
      kind: "future_us",
      contentSchemaVersion: 1,
      preview: { title: "Tomorrow", conditionLabel: null },
      content: { body: "Future content" },
      occurrence: null,
      storyIncluded: false,
      release: { mode: "scheduled", unlockAt: future },
      featureState: null,
      references: [],
      links: [],
    });

    const reauth = await app.inject({
      method: "POST",
      url: "/api/v1/auth/reauthenticate",
      headers: headers(alice.cookie),
      payload: { password: alice.password },
    });
    assert.equal(reauth.statusCode, 200, reauth.body);
    const reauthCookie = cookieHeader(reauth);

    const deletion = await app.inject({
      method: "POST",
      url: "/api/v1/me/account-deletion",
      headers: headers(reauthCookie),
    });
    assert.equal(deletion.statusCode, 200, deletion.body);

    const paused = await database.pool.query<{
      available_at: Date;
      recover_until: Date;
    }>(
      "SELECT action.available_at, request.recover_until FROM scheduled_actions action JOIN account_deletion_requests request ON request.account_id = $1 AND request.status = 'pending' WHERE action.aggregate_id = $2 AND action.action_type = 'relationship_item_release'",
      [alice.accountId, created.itemId],
    );
    assert.ok(paused.rows[0]);
    assert.ok(paused.rows[0]!.available_at.getTime() >= paused.rows[0]!.recover_until.getTime());

    const bobHome = await app.inject({
      method: "GET",
      url: "/api/v1/relationship-space",
      headers: headers(bob.cookie),
    });
    assert.equal(bobHome.statusCode, 200);
    assert.equal(
      (bobHome.json() as { space: { mode: string } }).space.mode,
      "account_deletion_view_only",
    );

    const deniedCreate = await app.inject({
      method: "POST",
      url: "/api/v1/relationship-space/items",
      headers: headers(bob.cookie, "r1-pause-denied-create"),
      payload: memoryPayload("Blocked"),
    });
    assert.equal(deniedCreate.statusCode, 409);

    await database.pool.query(
      "UPDATE scheduled_actions SET execute_at = clock_timestamp() - interval '1 minute' WHERE aggregate_id = $1 AND action_type = 'relationship_item_release'",
      [created.itemId],
    );

    const startRecovery = await app.inject({
      method: "POST",
      url: "/api/v1/auth/account-recovery/start",
      headers: headers(),
      payload: { identifier: alice.username },
    });
    assert.equal(startRecovery.statusCode, 200);
    const code = await recoveryCode(database, alice.accountId);
    const complete = await app.inject({
      method: "POST",
      url: "/api/v1/auth/account-recovery/complete",
      headers: headers(),
      payload: { identifier: alice.username, code },
    });
    assert.equal(complete.statusCode, 200, complete.body);

    const woken = await database.pool.query<{ due: boolean }>(
      "SELECT available_at <= clock_timestamp() + interval '1 second' AS due FROM scheduled_actions WHERE aggregate_id = $1 AND action_type = 'relationship_item_release'",
      [created.itemId],
    );
    assert.equal(woken.rows[0]?.due, true);

    const persisted = await database.pool.query<{ partnership_id: string }>(
      "SELECT partnership_id FROM relationship_items WHERE id = $1",
      [created.itemId],
    );
    assert.equal(persisted.rows[0]?.partnership_id, partnershipId);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("R1 derived experiences preserve dates and leap-day anniversary rule", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "date_alice");
    const bob = await register(app, database, "date_bob");
    await formPartnership(app, alice, bob, "r1-date-form-0001", "2020-02-29");

    await createItem(app, alice, "r1-date-memory", memoryPayload("September memory", "2020-09-22"));

    const thisDay = await app.inject({
      method: "GET",
      url: "/api/v1/relationship-space/experiences/this-day?on=2026-09-22",
      headers: headers(alice.cookie),
    });
    assert.equal(thisDay.statusCode, 200);
    assert.equal((thisDay.json() as { items: unknown[] }).items.length, 1);

    const ourYear = await app.inject({
      method: "GET",
      url: "/api/v1/relationship-space/experiences/our-year/2020",
      headers: headers(alice.cookie),
    });
    assert.equal(ourYear.statusCode, 200);
    assert.equal((ourYear.json() as { candidates: unknown[] }).candidates.length, 1);

    const anniversary = await app.inject({
      method: "GET",
      url: "/api/v1/relationship-space/experiences/anniversary?on=2025-02-28",
      headers: headers(alice.cookie),
    });
    assert.equal(anniversary.statusCode, 200);
    assert.equal(
      (anniversary.json() as { anniversaryDate: string }).anniversaryDate,
      "2025-02-28",
    );
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});
