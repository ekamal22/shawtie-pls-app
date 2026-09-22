import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
    headers: mutationHeaders(bob.cookie),
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

async function moveBreakupPastRestoreBoundary(
  database: DatabasePool,
  breakupId: string,
): Promise<void> {
  const stamp = await database.pool.query<{ now: Date }>(
    "SELECT date_trunc('milliseconds', clock_timestamp()) AS now",
  );
  const now = stamp.rows[0]?.now;
  if (!now) throw new Error("PostgreSQL test clock unavailable");

  const initiatedAt = new Date(now.getTime() - 2 * 60 * 60_000);
  const initiatorCancelUntil = new Date(initiatedAt.getTime() + 60 * 60_000);
  const baseDeadline = new Date(initiatedAt.getTime() + 7 * 24 * 60 * 60_000);

  await database.pool.query(
    "UPDATE breakup_processes SET initiated_at = $2, initiator_cancel_until = $3, base_deadline = $4, final_deadline = $4 WHERE id = $1",
    [breakupId, initiatedAt, initiatorCancelUntil, baseDeadline],
  );
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
      headers: headers(alice.cookie, "r1-open-creator-0001"),
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

    const futureDate = new Date(Date.now() + 1_500);
    const future = futureDate.toISOString();
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

    const manual = await createItem(app, alice, "r1-pause-manual-open", {
      kind: "for_you",
      contentSchemaVersion: 1,
      preview: { title: "Manual", conditionLabel: "Open when ready" },
      content: { body: "Manual body" },
      occurrence: null,
      storyIncluded: false,
      release: { mode: "recipient_open", unlockAt: null },
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
      headers: mutationHeaders(reauthCookie),
    });
    assert.equal(deletion.statusCode, 200, deletion.body);

    const paused = await database.pool.query<{
      available_at: Date;
      execute_at: Date;
      expected_generation: string;
      recover_until: Date;
      unlock_at: Date;
      release_generation: string;
    }>(
      "SELECT action.available_at, action.execute_at, action.expected_generation::text AS expected_generation, request.recover_until, item.unlock_at, item.release_generation::text AS release_generation FROM scheduled_actions action JOIN account_deletion_requests request ON request.account_id = $1 AND request.status = 'pending' JOIN relationship_items item ON item.id = action.aggregate_id WHERE action.aggregate_id = $2 AND action.action_type = 'relationship_item_release'",
      [alice.accountId, created.itemId],
    );
    assert.ok(paused.rows[0]);
    assert.ok(paused.rows[0]!.available_at.getTime() >= paused.rows[0]!.recover_until.getTime());
    assert.equal(paused.rows[0]!.execute_at.toISOString(), futureDate.toISOString());
    assert.equal(paused.rows[0]!.unlock_at.toISOString(), futureDate.toISOString());
    assert.equal(paused.rows[0]!.expected_generation, "1");
    assert.equal(paused.rows[0]!.release_generation, "1");

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

    const deniedManualOpen = await app.inject({
      method: "POST",
      url: "/api/v1/relationship-space/items/" + manual.itemId + "/release",
      headers: headers(bob.cookie, "r1-pause-denied-open"),
      payload: { expectedVersion: 1 },
    });
    assert.equal(deniedManualOpen.statusCode, 409);
    assert.equal(
      (deniedManualOpen.json() as { error: { code: string } }).error.code,
      "RELATIONSHIP_SPACE_VIEW_ONLY",
    );

    const waitMs = Math.max(0, futureDate.getTime() - Date.now() + 100);
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));

    const startRecovery = await app.inject({
      method: "POST",
      url: "/api/v1/auth/account-recovery/start",
      headers: headers(),
      payload: { identifier: alice.username },
    });
    assert.equal(startRecovery.statusCode, 202);
    const code = await recoveryCode(database, alice.accountId);
    const complete = await app.inject({
      method: "POST",
      url: "/api/v1/auth/account-recovery/complete",
      headers: headers(),
      payload: { identifier: alice.username, code },
    });
    assert.equal(complete.statusCode, 200, complete.body);

    const woken = await database.pool.query<{
      due: boolean;
      execute_at: Date;
      expected_generation: string;
      unlock_at: Date;
      release_generation: string;
      partnership_id: string;
    }>(
      "SELECT action.available_at <= clock_timestamp() + interval '1 second' AS due, action.execute_at, action.expected_generation::text AS expected_generation, item.unlock_at, item.release_generation::text AS release_generation, item.partnership_id FROM scheduled_actions action JOIN relationship_items item ON item.id = action.aggregate_id WHERE action.aggregate_id = $1 AND action.action_type = 'relationship_item_release'",
      [created.itemId],
    );
    assert.equal(woken.rows[0]?.due, true);
    assert.equal(woken.rows[0]?.execute_at.toISOString(), futureDate.toISOString());
    assert.equal(woken.rows[0]?.unlock_at.toISOString(), futureDate.toISOString());
    assert.equal(woken.rows[0]?.expected_generation, "1");
    assert.equal(woken.rows[0]?.release_generation, "1");
    assert.equal(woken.rows[0]?.partnership_id, partnershipId);
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

    await createItem(
      app,
      alice,
      "r1-date-memory-0001",
      memoryPayload("September memory", "2020-09-22"),
    );

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
    assert.equal((anniversary.json() as { anniversaryDate: string }).anniversaryDate, "2025-02-28");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("R1 home keeps upcoming releases independent of the recent slice and reports saved anniversary curation", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "home_alice");
    const bob = await register(app, database, "home_bob");
    await formPartnership(app, alice, bob, "r1-home-form-0001", "2020-11-15");

    const future = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();
    const scheduled = await createItem(app, alice, "r1-home-scheduled", {
      kind: "future_us",
      contentSchemaVersion: 1,
      preview: { title: "Later", conditionLabel: null },
      content: { body: "Future content" },
      occurrence: null,
      storyIncluded: false,
      release: { mode: "scheduled", unlockAt: future },
      featureState: null,
      references: [],
      links: [],
    });

    for (let index = 0; index < 10; index += 1) {
      await createItem(
        app,
        alice,
        "r1-home-memory-" + index,
        memoryPayload("Recent " + index, "2020-09-22"),
      );
    }

    const firstHome = await app.inject({
      method: "GET",
      url: "/api/v1/relationship-space",
      headers: headers(alice.cookie),
    });
    assert.equal(firstHome.statusCode, 200, firstHome.body);
    const year = Number(
      (firstHome.json() as { space: { serverDate: string } }).space.serverDate.slice(0, 4),
    );

    const anniversary = await createItem(app, alice, "r1-home-anniversary", {
      kind: "anniversary",
      contentSchemaVersion: 1,
      preview: null,
      content: { title: "Our anniversary", note: null },
      occurrence: null,
      storyIncluded: false,
      release: null,
      featureState: {
        type: "curation",
        curationType: "anniversary",
        anchorYear: year,
      },
      references: [],
      links: [],
    });

    const home = await app.inject({
      method: "GET",
      url: "/api/v1/relationship-space",
      headers: headers(alice.cookie),
    });
    assert.equal(home.statusCode, 200, home.body);
    const body = home.json() as {
      space: {
        recentItems: Array<{ itemId: string }>;
        upcomingReleases: Array<{ itemId: string }>;
        anniversary: { savedCurationItemId: string | null };
      };
    };
    assert.equal(
      body.space.recentItems.some((item) => item.itemId === scheduled.itemId),
      false,
    );
    assert.equal(
      body.space.upcomingReleases.some((item) => item.itemId === scheduled.itemId),
      true,
    );
    assert.equal(body.space.anniversary.savedCurationItemId, anniversary.itemId);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("R1 deleting a linked target removes incoming links and increments surviving curation version", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "link_alice");
    const bob = await register(app, database, "link_bob");
    await formPartnership(app, alice, bob, "r1-link-form-0001");

    const target = await createItem(
      app,
      alice,
      "r1-link-target-0001",
      memoryPayload("Target", "2020-09-22"),
    );
    const curation = await createItem(app, alice, "r1-link-curation", {
      kind: "our_year",
      contentSchemaVersion: 1,
      preview: null,
      content: { title: "Our year", note: null },
      occurrence: null,
      storyIncluded: false,
      release: null,
      featureState: {
        type: "curation",
        curationType: "our_year",
        anchorYear: 2020,
      },
      references: [],
      links: [{ linkType: "curation", targetItemId: target.itemId, position: 0 }],
    });

    const removed = await app.inject({
      method: "DELETE",
      url: "/api/v1/relationship-space/items/" + target.itemId,
      headers: headers(alice.cookie, "r1-link-delete-target"),
      payload: { expectedVersion: 1 },
    });
    assert.equal(removed.statusCode, 204, removed.body);

    const owner = await app.inject({
      method: "GET",
      url: "/api/v1/relationship-space/items/" + curation.itemId,
      headers: headers(alice.cookie),
    });
    assert.equal(owner.statusCode, 200, owner.body);
    const ownerBody = owner.json() as { version: number; links: unknown[] };
    assert.equal(ownerBody.version, 2);
    assert.deepEqual(ownerBody.links, []);

    const remnants = await database.pool.query<{ event_count: string }>(
      "SELECT count(*)::text AS event_count FROM relationship_events WHERE item_id = $1",
      [target.itemId],
    );
    assert.equal(remnants.rows[0]?.event_count, "0");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("R1 unknown content schema versions fail closed", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "schema_alice");
    const bob = await register(app, database, "schema_bob");
    await formPartnership(app, alice, bob, "r1-schema-form-0001");
    const item = await createItem(
      app,
      alice,
      "r1-schema-item-0001",
      memoryPayload("Schema", "2020-09-22"),
    );

    await database.pool.query(
      "UPDATE relationship_items SET content_schema_version = 2 WHERE id = $1",
      [item.itemId],
    );

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/relationship-space/items/" + item.itemId,
      headers: headers(alice.cookie),
    });
    assert.equal(response.statusCode, 409);
    assert.equal(
      (response.json() as { error: { code: string } }).error.code,
      "UNSUPPORTED_CONTENT_SCHEMA_VERSION",
    );
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("R1 future partnership namespace cannot read or replay old relationship-space data", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "namespace_alice");
    const bob = await register(app, database, "namespace_bob");
    const oldPartnershipId = await formPartnership(app, alice, bob, "r1-namespace-form-0001");
    const key = "r1-namespace-old-create";
    const oldItem = await createItem(app, alice, key, memoryPayload("Old namespace", "2020-09-22"));
    await createItem(
      app,
      alice,
      "r1-namespace-old-second",
      memoryPayload("Old namespace second", "2020-09-23"),
    );
    const oldList = await app.inject({
      method: "GET",
      url: "/api/v1/relationship-space/items?limit=1&sort=created_desc",
      headers: headers(alice.cookie),
    });
    assert.equal(oldList.statusCode, 200, oldList.body);
    const oldCursor = (oldList.json() as { nextCursor: string | null }).nextCursor;
    assert.ok(oldCursor);

    const terminatedAt = new Date();
    await database.pool.query(
      "UPDATE partnerships SET lifecycle_state = 'terminated', terminated_at = $2, termination_reason = 'breakup', generation = generation + 1, updated_at = $2 WHERE id = $1",
      [oldPartnershipId, terminatedAt],
    );
    await database.pool.query(
      "UPDATE partnership_members SET released_at = $2 WHERE partnership_id = $1 AND released_at IS NULL",
      [oldPartnershipId, terminatedAt],
    );

    const terminatedReplay = await app.inject({
      method: "POST",
      url: "/api/v1/relationship-space/items",
      headers: headers(alice.cookie, key),
      payload: memoryPayload("Old namespace", "2020-09-22"),
    });
    assert.equal(terminatedReplay.statusCode, 409);
    assert.equal(
      (terminatedReplay.json() as { error: { code: string } }).error.code,
      "NO_CURRENT_PARTNERSHIP",
    );

    const newPartnershipId = randomUUID();
    const activatedAt = new Date();
    await database.pool.query(
      "INSERT INTO partnerships (id, relationship_start_date, lifecycle_state, version, generation, created_at, activated_at, updated_at) VALUES ($1, DATE '2026-01-01', 'active', 1, 1, $2, $2, $2)",
      [newPartnershipId, activatedAt],
    );
    await database.pool.query(
      "INSERT INTO partnership_members (partnership_id, account_id, joined_at) VALUES ($1,$2,$4),($1,$3,$4)",
      [newPartnershipId, alice.accountId, bob.accountId, new Date()],
    );

    const oldCursorReuse = await app.inject({
      method: "GET",
      url:
        "/api/v1/relationship-space/items?limit=1&sort=created_desc&cursor=" +
        encodeURIComponent(oldCursor),
      headers: headers(alice.cookie),
    });
    assert.equal(oldCursorReuse.statusCode, 400);
    assert.equal(
      (oldCursorReuse.json() as { error: { code: string } }).error.code,
      "INVALID_CURSOR",
    );

    const oldRead = await app.inject({
      method: "GET",
      url: "/api/v1/relationship-space/items/" + oldItem.itemId,
      headers: headers(alice.cookie),
    });
    assert.equal(oldRead.statusCode, 404);
    assert.equal(
      (oldRead.json() as { error: { code: string } }).error.code,
      "RELATIONSHIP_ITEM_NOT_FOUND",
    );

    const sameKeyNewNamespace = await app.inject({
      method: "POST",
      url: "/api/v1/relationship-space/items",
      headers: headers(alice.cookie, key),
      payload: memoryPayload("Old namespace", "2020-09-22"),
    });
    assert.equal(sameKeyNewNamespace.statusCode, 201, sameKeyNewNamespace.body);
    assert.notEqual((sameKeyNewNamespace.json() as { itemId: string }).itemId, oldItem.itemId);

    const persisted = await database.pool.query<{ partnership_id: string }>(
      "SELECT partnership_id FROM relationship_items WHERE id = $1",
      [oldItem.itemId],
    );
    assert.equal(persisted.rows[0]?.partnership_id, oldPartnershipId);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("R1 concurrent duplicate mutations replay exactly instead of degrading to conflicts", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "concurrent_alice");
    const bob = await register(app, database, "concurrent_bob");
    await formPartnership(app, alice, bob, "r1-concurrent-form-0001");

    const editable = await createItem(
      app,
      alice,
      "r1-concurrent-editable",
      memoryPayload("Concurrent edit", "2020-09-22"),
    );
    const patchRequest = () =>
      app.inject({
        method: "PATCH",
        url: "/api/v1/relationship-space/items/" + editable.itemId,
        headers: headers(alice.cookie, "r1-concurrent-patch-key"),
        payload: {
          expectedVersion: 1,
          content: { title: "Committed once", note: "same body" },
        },
      });
    const [patchA, patchB] = await Promise.all([patchRequest(), patchRequest()]);
    assert.equal(patchA.statusCode, 200, patchA.body);
    assert.equal(patchB.statusCode, 200, patchB.body);
    assert.deepEqual(patchA.json(), patchB.json());

    const openable = await createItem(app, alice, "r1-concurrent-openable", {
      kind: "for_you",
      contentSchemaVersion: 1,
      preview: { title: "Open", conditionLabel: "When you want" },
      content: { body: "Only one release transition" },
      occurrence: null,
      storyIncluded: false,
      release: { mode: "recipient_open", unlockAt: null },
      featureState: null,
      references: [],
      links: [],
    });
    const releaseRequest = () =>
      app.inject({
        method: "POST",
        url: "/api/v1/relationship-space/items/" + openable.itemId + "/release",
        headers: headers(bob.cookie, "r1-concurrent-release-key"),
        payload: { expectedVersion: 1 },
      });
    const [releaseA, releaseB] = await Promise.all([releaseRequest(), releaseRequest()]);
    assert.equal(releaseA.statusCode, 200, releaseA.body);
    assert.equal(releaseB.statusCode, 200, releaseB.body);
    assert.deepEqual(releaseA.json(), releaseB.json());

    const deletable = await createItem(
      app,
      alice,
      "r1-concurrent-deletable",
      memoryPayload("Concurrent delete", "2020-09-22"),
    );
    const deleteRequest = () =>
      app.inject({
        method: "DELETE",
        url: "/api/v1/relationship-space/items/" + deletable.itemId,
        headers: headers(alice.cookie, "r1-concurrent-delete-key"),
        payload: { expectedVersion: 1 },
      });
    const [deleteA, deleteB] = await Promise.all([deleteRequest(), deleteRequest()]);
    assert.equal(deleteA.statusCode, 204, deleteA.body);
    assert.equal(deleteB.statusCode, 204, deleteB.body);

    const releases = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM relationship_events WHERE item_id = $1 AND event_type = 'item_released'",
      [openable.itemId],
    );
    assert.equal(releases.rows[0]?.count, "1");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("R1 unreleased creator-private IDs are indistinguishable from random IDs", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "hidden_alice");
    const bob = await register(app, database, "hidden_bob");
    await formPartnership(app, alice, bob, "r1-hidden-form-0001");

    const hidden = await createItem(app, alice, "r1-hidden-create", {
      kind: "future_us",
      contentSchemaVersion: 1,
      preview: null,
      content: { body: "Not visible yet" },
      occurrence: null,
      storyIncluded: false,
      release: {
        mode: "scheduled",
        unlockAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      },
      featureState: null,
      references: [],
      links: [],
    });

    const guessed = await app.inject({
      method: "GET",
      url: "/api/v1/relationship-space/items/" + hidden.itemId,
      headers: headers(bob.cookie),
    });
    const random = await app.inject({
      method: "GET",
      url: "/api/v1/relationship-space/items/" + randomUUID(),
      headers: headers(bob.cookie),
    });
    assert.equal(guessed.statusCode, 404);
    assert.equal(random.statusCode, 404);
    assert.deepEqual(guessed.json(), random.json());

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/relationship-space/items",
      headers: headers(bob.cookie),
    });
    assert.equal(list.statusCode, 200);
    assert.equal(
      (list.json() as { items: Array<{ itemId: string }> }).items.some(
        (item) => item.itemId === hidden.itemId,
      ),
      false,
    );
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("R1 rejects M1 and M3 loose references until a verified resolver is registered", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "resolver_alice");
    const bob = await register(app, database, "resolver_bob");
    await formPartnership(app, alice, bob, "r1-resolver-form-0001");

    const remember = await app.inject({
      method: "POST",
      url: "/api/v1/relationship-space/items",
      headers: headers(alice.cookie, "r1-resolver-message"),
      payload: {
        kind: "remember_this",
        contentSchemaVersion: 1,
        preview: null,
        content: { title: "Snapshot", snapshotText: "Independent snapshot", note: null },
        occurrence: null,
        storyIncluded: false,
        release: null,
        featureState: null,
        references: [
          {
            referenceType: "message",
            referenceId: randomUUID(),
            role: "source",
            position: 0,
          },
        ],
        links: [],
      },
    });
    assert.equal(remember.statusCode, 409);
    assert.equal(
      (remember.json() as { error: { code: string } }).error.code,
      "REFERENCE_TYPE_UNAVAILABLE",
    );

    const voice = await app.inject({
      method: "POST",
      url: "/api/v1/relationship-space/items",
      headers: headers(alice.cookie, "r1-resolver-voice"),
      payload: {
        kind: "for_you",
        contentSchemaVersion: 1,
        preview: { title: "Voice", conditionLabel: null },
        content: { body: "Container text" },
        occurrence: null,
        storyIncluded: false,
        release: { mode: "recipient_open", unlockAt: null },
        featureState: null,
        references: [
          {
            referenceType: "media",
            referenceId: randomUUID(),
            role: "voice_letter",
            position: 0,
          },
        ],
        links: [],
      },
    });
    assert.equal(voice.statusCode, 409);
    assert.equal(
      (voice.json() as { error: { code: string } }).error.code,
      "REFERENCE_TYPE_UNAVAILABLE",
    );
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("R1 creator-reveal keeps Surprise main content sealed until the creator reveals it", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "surprise_alice");
    const bob = await register(app, database, "surprise_bob");
    await formPartnership(app, alice, bob, "r1-surprise-form-0001");

    const surprise = await createItem(app, alice, "r1-surprise-create", {
      kind: "surprise",
      contentSchemaVersion: 1,
      preview: { title: "Something for you" },
      content: {
        intro: "Private intro",
        steps: [
          { type: "text", text: "Step one" },
          { type: "text", text: "Step two" },
        ],
      },
      occurrence: null,
      storyIncluded: false,
      release: { mode: "creator_reveal", unlockAt: null },
      featureState: null,
      references: [],
      links: [],
    });

    const before = await app.inject({
      method: "GET",
      url: "/api/v1/relationship-space/items/" + surprise.itemId,
      headers: headers(bob.cookie),
    });
    assert.equal(before.statusCode, 200, before.body);
    assert.ok((before.json() as { preview: unknown }).preview);
    assert.equal((before.json() as { content: unknown }).content, null);

    const recipientReveal = await app.inject({
      method: "POST",
      url: "/api/v1/relationship-space/items/" + surprise.itemId + "/release",
      headers: headers(bob.cookie, "r1-surprise-recipient-reveal"),
      payload: { expectedVersion: 1 },
    });
    assert.equal(recipientReveal.statusCode, 409);

    const revealed = await app.inject({
      method: "POST",
      url: "/api/v1/relationship-space/items/" + surprise.itemId + "/release",
      headers: headers(alice.cookie, "r1-surprise-creator-reveal"),
      payload: { expectedVersion: 1 },
    });
    assert.equal(revealed.statusCode, 200, revealed.body);

    const after = await app.inject({
      method: "GET",
      url: "/api/v1/relationship-space/items/" + surprise.itemId,
      headers: headers(bob.cookie),
    });
    assert.equal(after.statusCode, 200, after.body);
    assert.ok((after.json() as { content: unknown }).content);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("R1 schedule edits advance release generation, cancel old work, and replay without duplication", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "schedule_alice");
    const bob = await register(app, database, "schedule_bob");
    await formPartnership(app, alice, bob, "r1-schedule-form-0001");

    const firstUnlock = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    const secondUnlock = new Date(Date.now() + 48 * 60 * 60_000).toISOString();
    const item = await createItem(app, alice, "r1-schedule-create", {
      kind: "future_us",
      contentSchemaVersion: 1,
      preview: { title: "Later", conditionLabel: null },
      content: { body: "Future body" },
      occurrence: null,
      storyIncluded: false,
      release: { mode: "scheduled", unlockAt: firstUnlock },
      featureState: null,
      references: [],
      links: [],
    });

    const before = await database.pool.query<{
      action_id: string;
      release_generation: string;
      expected_generation: string;
    }>(
      "SELECT action.id AS action_id, item.release_generation::text AS release_generation, action.expected_generation::text AS expected_generation FROM relationship_items item JOIN scheduled_actions action ON action.aggregate_id = item.id AND action.action_type = 'relationship_item_release' WHERE item.id = $1",
      [item.itemId],
    );
    const oldActionId = before.rows[0]?.action_id;
    assert.ok(oldActionId);
    assert.equal(before.rows[0]?.release_generation, "1");
    assert.equal(before.rows[0]?.expected_generation, "1");

    const key = "r1-schedule-reschedule";
    const patchBody = {
      expectedVersion: 1,
      release: { mode: "scheduled", unlockAt: secondUnlock },
    };
    const changed = await app.inject({
      method: "PATCH",
      url: "/api/v1/relationship-space/items/" + item.itemId,
      headers: headers(alice.cookie, key),
      payload: patchBody,
    });
    assert.equal(changed.statusCode, 200, changed.body);
    assert.equal((changed.json() as { version: number }).version, 2);

    const replay = await app.inject({
      method: "PATCH",
      url: "/api/v1/relationship-space/items/" + item.itemId,
      headers: headers(alice.cookie, key),
      payload: patchBody,
    });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.deepEqual(replay.json(), changed.json());

    const persisted = await database.pool.query<{
      id: string;
      status: string;
      expected_generation: string;
      execute_at: Date;
    }>(
      "SELECT id, status, expected_generation::text AS expected_generation, execute_at FROM scheduled_actions WHERE aggregate_id = $1 AND action_type = 'relationship_item_release' ORDER BY expected_generation",
      [item.itemId],
    );
    assert.equal(persisted.rowCount, 2);
    assert.equal(persisted.rows[0]?.id, oldActionId);
    assert.equal(persisted.rows[0]?.status, "cancelled");
    assert.equal(persisted.rows[0]?.expected_generation, "1");
    assert.equal(persisted.rows[1]?.status, "pending");
    assert.equal(persisted.rows[1]?.expected_generation, "2");
    assert.equal(persisted.rows[1]?.execute_at.toISOString(), secondUnlock);

    const root = await database.pool.query<{
      version: string;
      release_generation: string;
      unlock_at: Date;
    }>(
      "SELECT version::text AS version, release_generation::text AS release_generation, unlock_at FROM relationship_items WHERE id = $1",
      [item.itemId],
    );
    assert.equal(root.rows[0]?.version, "2");
    assert.equal(root.rows[0]?.release_generation, "2");
    assert.equal(root.rows[0]?.unlock_at.toISOString(), secondUnlock);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("R1 breakup restoration preserves item version, release generation, and scheduled action identity", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "restore_r1_alice");
    const bob = await register(app, database, "restore_r1_bob");
    const partnershipId = await formPartnership(app, alice, bob, "r1-restoration-form-0001");

    const unlockAt = new Date(Date.now() + 48 * 60 * 60_000).toISOString();
    const item = await createItem(app, alice, "r1-restoration-item", {
      kind: "future_us",
      contentSchemaVersion: 1,
      preview: { title: "After restoration", conditionLabel: null },
      content: { body: "Same scheduled content" },
      occurrence: null,
      storyIncluded: false,
      release: { mode: "scheduled", unlockAt },
      featureState: null,
      references: [],
      links: [],
    });

    const before = await database.pool.query<{
      action_id: string;
      item_version: string;
      release_generation: string;
      execute_at: Date;
    }>(
      "SELECT action.id AS action_id, item.version::text AS item_version, item.release_generation::text AS release_generation, action.execute_at FROM relationship_items item JOIN scheduled_actions action ON action.aggregate_id = item.id AND action.action_type = 'relationship_item_release' WHERE item.id = $1",
      [item.itemId],
    );
    const originalActionId = before.rows[0]?.action_id;
    assert.ok(originalActionId);

    const started = await app.inject({
      method: "POST",
      url: "/api/v1/partnerships/" + partnershipId + "/breakup",
      headers: mutationHeaders(alice.cookie, "r1-restoration-breakup"),
    });
    assert.equal(started.statusCode, 200, started.body);
    const breakupId = (started.json() as { breakupId: string }).breakupId;

    const deniedScheduleChange = await app.inject({
      method: "PATCH",
      url: "/api/v1/relationship-space/items/" + item.itemId,
      headers: headers(alice.cookie, "r1-restoration-denied-edit"),
      payload: {
        expectedVersion: 1,
        release: {
          mode: "scheduled",
          unlockAt: new Date(Date.now() + 72 * 60 * 60_000).toISOString(),
        },
      },
    });
    assert.equal(deniedScheduleChange.statusCode, 409);
    assert.equal(
      (deniedScheduleChange.json() as { error: { code: string } }).error.code,
      "RELATIONSHIP_SPACE_VIEW_ONLY",
    );

    await moveBreakupPastRestoreBoundary(database, breakupId);

    const firstIntent = await app.inject({
      method: "POST",
      url: "/api/v1/partnerships/" + partnershipId + "/breakups/" + breakupId + "/restore",
      headers: mutationHeaders(bob.cookie, "r1-restoration-intent-bob"),
    });
    assert.equal(firstIntent.statusCode, 200, firstIntent.body);
    assert.equal((firstIntent.json() as { restored: boolean }).restored, false);

    const secondIntent = await app.inject({
      method: "POST",
      url: "/api/v1/partnerships/" + partnershipId + "/breakups/" + breakupId + "/restore",
      headers: mutationHeaders(alice.cookie, "r1-restoration-intent-alice"),
    });
    assert.equal(secondIntent.statusCode, 200, secondIntent.body);
    assert.equal((secondIntent.json() as { restored: boolean }).restored, true);

    const after = await database.pool.query<{
      action_id: string;
      action_status: string;
      item_version: string;
      release_generation: string;
      execute_at: Date;
      lifecycle_state: string;
    }>(
      "SELECT action.id AS action_id, action.status AS action_status, item.version::text AS item_version, item.release_generation::text AS release_generation, action.execute_at, partnership.lifecycle_state FROM relationship_items item JOIN scheduled_actions action ON action.aggregate_id = item.id AND action.action_type = 'relationship_item_release' JOIN partnerships partnership ON partnership.id = item.partnership_id WHERE item.id = $1 AND action.expected_generation = 1",
      [item.itemId],
    );
    assert.equal(after.rows[0]?.action_id, originalActionId);
    assert.equal(after.rows[0]?.action_status, "pending");
    assert.equal(after.rows[0]?.item_version, "1");
    assert.equal(after.rows[0]?.release_generation, "1");
    assert.equal(after.rows[0]?.execute_at.toISOString(), unlockAt);
    assert.equal(after.rows[0]?.lifecycle_state, "active");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("R1 Our Story uses deterministic mixed-precision ordering and This Day uses exact day precision only", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "precision_alice");
    const bob = await register(app, database, "precision_bob");
    await formPartnership(app, alice, bob, "r1-precision-form-0001");

    const entries = [
      {
        key: "r1-precision-year",
        title: "Year only",
        occurrence: { precision: "year", year: 2025, month: null, day: null },
      },
      {
        key: "r1-precision-month",
        title: "Month only",
        occurrence: { precision: "month", year: 2025, month: 9, day: null },
      },
      {
        key: "r1-precision-day",
        title: "Exact day",
        occurrence: { precision: "day", year: 2025, month: 9, day: 22 },
      },
      {
        key: "r1-precision-unknown",
        title: "Undated",
        occurrence: { precision: "unknown", year: null, month: null, day: null },
      },
    ] as const;

    const ids: Record<string, string> = {};
    for (const entry of entries) {
      const created = await createItem(app, alice, entry.key, {
        kind: "memory",
        contentSchemaVersion: 1,
        preview: null,
        content: { title: entry.title, note: null },
        occurrence: entry.occurrence,
        storyIncluded: true,
        release: null,
        featureState: null,
        references: [],
        links: [],
      });
      ids[entry.title] = created.itemId;
    }

    const story = await app.inject({
      method: "GET",
      url: "/api/v1/relationship-space/items?storyOnly=true&sort=occurred_asc&limit=20",
      headers: headers(alice.cookie),
    });
    assert.equal(story.statusCode, 200, story.body);
    const storyIds = (story.json() as { items: Array<{ itemId: string }> }).items.map(
      (item) => item.itemId,
    );
    assert.deepEqual(storyIds, [
      ids["Year only"],
      ids["Month only"],
      ids["Exact day"],
      ids["Undated"],
    ]);

    const thisDay = await app.inject({
      method: "GET",
      url: "/api/v1/relationship-space/experiences/this-day?on=2026-09-22",
      headers: headers(alice.cookie),
    });
    assert.equal(thisDay.statusCode, 200, thisDay.body);
    assert.deepEqual(
      (thisDay.json() as { items: Array<{ itemId: string }> }).items.map((item) => item.itemId),
      [ids["Exact day"]],
    );
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("R1 rejects future historical occurrences and past reunion targets using trusted server date", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "date_rules_alice");
    const bob = await register(app, database, "date_rules_bob");
    await formPartnership(app, alice, bob, "r1-date-rules-form-0001");

    const futureHistory = await app.inject({
      method: "POST",
      url: "/api/v1/relationship-space/items",
      headers: headers(alice.cookie, "r1-future-history"),
      payload: {
        kind: "memory",
        contentSchemaVersion: 1,
        preview: null,
        content: { title: "Future memory", note: null },
        occurrence: { precision: "day", year: 9999, month: 1, day: 1 },
        storyIncluded: false,
        release: null,
        featureState: null,
        references: [],
        links: [],
      },
    });
    assert.equal(futureHistory.statusCode, 400);
    assert.equal(
      (futureHistory.json() as { error: { code: string } }).error.code,
      "INVALID_OCCURRENCE",
    );

    const pastReunion = await app.inject({
      method: "POST",
      url: "/api/v1/relationship-space/items",
      headers: headers(alice.cookie, "r1-past-reunion-0001"),
      payload: {
        kind: "reunion",
        contentSchemaVersion: 1,
        preview: null,
        content: { title: "Past reunion", note: null },
        occurrence: null,
        storyIncluded: false,
        release: null,
        featureState: { type: "reunion", targetDate: "2000-01-01" },
        references: [],
        links: [],
      },
    });
    assert.equal(pastReunion.statusCode, 422);
    assert.equal(
      (pastReunion.json() as { error: { code: string } }).error.code,
      "REUNION_DATE_INVALID",
    );
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("R1 snapshot cursors contain only operational metadata and reject query-shape reuse", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "cursor_alice");
    const bob = await register(app, database, "cursor_bob");
    await formPartnership(app, alice, bob, "r1-cursor-form-0001");

    await createItem(
      app,
      alice,
      "r1-cursor-a-0001",
      memoryPayload("Cursor private title alpha", "2020-09-22"),
    );
    await createItem(
      app,
      alice,
      "r1-cursor-b-0001",
      memoryPayload("Cursor private title beta", "2020-09-23"),
    );

    const first = await app.inject({
      method: "GET",
      url: "/api/v1/relationship-space/items?limit=1&sort=created_desc",
      headers: headers(alice.cookie),
    });
    assert.equal(first.statusCode, 200, first.body);
    const cursor = (first.json() as { nextCursor: string | null }).nextCursor;
    assert.ok(cursor);
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    assert.equal(decoded.includes("Cursor private title"), false);
    assert.equal(decoded.includes("private note"), false);
    const cursorObject = JSON.parse(decoded) as Record<string, unknown>;
    assert.deepEqual(
      Object.keys(cursorObject).sort(),
      ["binding", "createdAt", "itemId", "queryShape", "snapshotAt", "sort", "v"].sort(),
    );

    const mismatched = await app.inject({
      method: "GET",
      url:
        "/api/v1/relationship-space/items?limit=1&sort=created_desc&kind=memory&cursor=" +
        encodeURIComponent(cursor),
      headers: headers(alice.cookie),
    });
    assert.equal(mismatched.statusCode, 400);
    assert.equal((mismatched.json() as { error: { code: string } }).error.code, "INVALID_CURSOR");

    const tamperedObject = {
      ...cursorObject,
      binding:
        String(cursorObject.binding).slice(0, -1) +
        (String(cursorObject.binding).endsWith("A") ? "B" : "A"),
    };
    const tamperedCursor = Buffer.from(JSON.stringify(tamperedObject), "utf8").toString(
      "base64url",
    );
    const tampered = await app.inject({
      method: "GET",
      url:
        "/api/v1/relationship-space/items?limit=1&sort=created_desc&cursor=" +
        encodeURIComponent(tamperedCursor),
      headers: headers(alice.cookie),
    });
    assert.equal(tampered.statusCode, 400);
    assert.equal((tampered.json() as { error: { code: string } }).error.code, "INVALID_CURSOR");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("R1 Remember This works as an independent snapshot without an M1 source reference", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "remember_alice");
    const bob = await register(app, database, "remember_bob");
    await formPartnership(app, alice, bob, "r1-remember-form-0001");

    const created = await createItem(app, alice, "r1-remember-create", {
      kind: "remember_this",
      contentSchemaVersion: 1,
      preview: null,
      content: {
        title: "Saved moment",
        snapshotText: "This is the independent snapshot.",
        note: "No M1 dependency is required.",
      },
      occurrence: { precision: "month", year: 2025, month: 11, day: null },
      storyIncluded: true,
      release: null,
      featureState: null,
      references: [],
      links: [],
    });

    const read = await app.inject({
      method: "GET",
      url: "/api/v1/relationship-space/items/" + created.itemId,
      headers: headers(bob.cookie),
    });
    assert.equal(read.statusCode, 200, read.body);
    const body = read.json() as {
      content: { snapshotText?: string } | null;
      references: unknown[];
    };
    assert.equal(body.content?.snapshotText, "This is the independent snapshot.");
    assert.deepEqual(body.references, []);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("R1 PATCH validates schedule and reunion dates only when those fields change", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "patch_time_alice");
    const bob = await register(app, database, "patch_time_bob");
    await formPartnership(app, alice, bob, "r1-patch-time-form-0001");

    const scheduled = await createItem(app, alice, "r1-patch-time-scheduled", {
      kind: "future_us",
      contentSchemaVersion: 1,
      preview: { title: "Overdue", conditionLabel: null },
      content: { body: "Still pending" },
      occurrence: null,
      storyIncluded: false,
      release: {
        mode: "scheduled",
        unlockAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      },
      featureState: null,
      references: [],
      links: [],
    });
    await database.pool.query(
      "UPDATE relationship_items SET unlock_at = clock_timestamp() - interval '1 minute' WHERE id = $1",
      [scheduled.itemId],
    );

    const storyPatch = await app.inject({
      method: "PATCH",
      url: "/api/v1/relationship-space/items/" + scheduled.itemId,
      headers: headers(alice.cookie, "r1-patch-time-story"),
      payload: {
        expectedVersion: 1,
        storyIncluded: true,
      },
    });
    assert.equal(storyPatch.statusCode, 200, storyPatch.body);

    const home = await app.inject({
      method: "GET",
      url: "/api/v1/relationship-space",
      headers: headers(alice.cookie),
    });
    assert.equal(home.statusCode, 200, home.body);
    const today = (home.json() as { space: { serverDate: string } }).space.serverDate;

    const reunion = await createItem(app, alice, "r1-patch-time-reunion", {
      kind: "reunion",
      contentSchemaVersion: 1,
      preview: null,
      content: { title: "Reunion", note: "Original note" },
      occurrence: null,
      storyIncluded: false,
      release: null,
      featureState: { type: "reunion", targetDate: today },
      references: [],
      links: [],
    });
    await database.pool.query(
      "UPDATE relationship_reunion_state SET target_date = DATE '2000-01-01' WHERE item_id = $1",
      [reunion.itemId],
    );

    const contentPatch = await app.inject({
      method: "PATCH",
      url: "/api/v1/relationship-space/items/" + reunion.itemId,
      headers: headers(bob.cookie, "r1-patch-time-reunion-note"),
      payload: {
        expectedVersion: 1,
        content: { title: "Reunion", note: "Updated after target passed" },
      },
    });
    assert.equal(contentPatch.statusCode, 200, contentPatch.body);

    const invalidDateChange = await app.inject({
      method: "PATCH",
      url: "/api/v1/relationship-space/items/" + reunion.itemId,
      headers: headers(bob.cookie, "r1-patch-time-reunion-date"),
      payload: {
        expectedVersion: 2,
        featureState: { type: "reunion", targetDate: "2000-01-02" },
      },
    });
    assert.equal(invalidDateChange.statusCode, 422);
    assert.equal(
      (invalidDateChange.json() as { error: { code: string } }).error.code,
      "REUNION_DATE_INVALID",
    );
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("R1 saved curation creation is race-safe and shared edits use optimistic versioning", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "curation_alice");
    const bob = await register(app, database, "curation_bob");
    await formPartnership(app, alice, bob, "r1-curation-form-0001");

    const first = await createItem(
      app,
      alice,
      "r1-curation-target-a",
      memoryPayload("Curation target A", "2020-09-22"),
    );
    const second = await createItem(
      app,
      bob,
      "r1-curation-target-b",
      memoryPayload("Curation target B", "2020-09-23"),
    );

    const body = {
      kind: "our_year",
      contentSchemaVersion: 1,
      preview: null,
      content: { title: "Our Year 2020", note: null },
      occurrence: null,
      storyIncluded: false,
      release: null,
      featureState: {
        type: "curation",
        curationType: "our_year",
        anchorYear: 2020,
      },
      references: [],
      links: [{ linkType: "curation", targetItemId: first.itemId, position: 0 }],
    };

    const create = (account: TestAccount, key: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/relationship-space/items",
        headers: headers(account.cookie, key),
        payload: body,
      });

    const [left, right] = await Promise.all([
      create(alice, "r1-curation-race-a"),
      create(bob, "r1-curation-race-b"),
    ]);
    const responses = [left, right];
    assert.equal(responses.filter((response) => response.statusCode === 201).length, 1);
    assert.equal(responses.filter((response) => response.statusCode === 409).length, 1);
    const conflict = responses.find((response) => response.statusCode === 409);
    assert.equal(
      (conflict?.json() as { error: { code: string } }).error.code,
      "CURATION_ALREADY_EXISTS",
    );
    const winner = responses.find((response) => response.statusCode === 201);
    const curationId = (winner?.json() as { itemId: string }).itemId;

    const patch = (account: TestAccount, key: string, targetItemId: string) =>
      app.inject({
        method: "PATCH",
        url: "/api/v1/relationship-space/items/" + curationId,
        headers: headers(account.cookie, key),
        payload: {
          expectedVersion: 1,
          links: [{ linkType: "curation", targetItemId, position: 0 }],
        },
      });

    const [patchA, patchB] = await Promise.all([
      patch(alice, "r1-curation-edit-a", first.itemId),
      patch(bob, "r1-curation-edit-b", second.itemId),
    ]);
    const patchResponses = [patchA, patchB];
    assert.equal(patchResponses.filter((response) => response.statusCode === 200).length, 1);
    assert.equal(patchResponses.filter((response) => response.statusCode === 409).length, 1);
    const versionConflict = patchResponses.find((response) => response.statusCode === 409);
    assert.equal(
      (versionConflict?.json() as { error: { code: string } }).error.code,
      "VERSION_CONFLICT",
    );
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("R1 reunion supports prepared-content links while Surprise generic links are rejected", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "prepared_alice");
    const bob = await register(app, database, "prepared_bob");
    await formPartnership(app, alice, bob, "r1-prepared-form-0001");

    const target = await createItem(
      app,
      alice,
      "r1-prepared-target",
      memoryPayload("Prepared memory", "2020-09-22"),
    );
    const home = await app.inject({
      method: "GET",
      url: "/api/v1/relationship-space",
      headers: headers(alice.cookie),
    });
    assert.equal(home.statusCode, 200, home.body);
    const today = (home.json() as { space: { serverDate: string } }).space.serverDate;

    const reunion = await createItem(app, alice, "r1-prepared-reunion", {
      kind: "reunion",
      contentSchemaVersion: 1,
      preview: null,
      content: { title: "Reunion", note: null },
      occurrence: null,
      storyIncluded: false,
      release: null,
      featureState: { type: "reunion", targetDate: today },
      references: [],
      links: [
        {
          linkType: "prepared_content",
          targetItemId: target.itemId,
          position: 0,
        },
      ],
    });

    const reunionRead = await app.inject({
      method: "GET",
      url: "/api/v1/relationship-space/items/" + reunion.itemId,
      headers: headers(bob.cookie),
    });
    assert.equal(reunionRead.statusCode, 200, reunionRead.body);
    assert.deepEqual((reunionRead.json() as { links: unknown[] }).links, [
      {
        linkType: "prepared_content",
        targetItemId: target.itemId,
        position: 0,
      },
    ]);

    const surprise = await app.inject({
      method: "POST",
      url: "/api/v1/relationship-space/items",
      headers: headers(alice.cookie, "r1-prepared-surprise-invalid-link"),
      payload: {
        kind: "surprise",
        contentSchemaVersion: 1,
        preview: { title: "Private sequence" },
        content: {
          intro: null,
          steps: [{ type: "text", text: "Private step" }],
        },
        occurrence: null,
        storyIncluded: false,
        release: { mode: "creator_reveal", unlockAt: null },
        featureState: null,
        references: [],
        links: [
          {
            linkType: "prepared_content",
            targetItemId: target.itemId,
            position: 0,
          },
        ],
      },
    });
    assert.equal(surprise.statusCode, 400);
    assert.equal((surprise.json() as { error: { code: string } }).error.code, "INVALID_ITEM_LINK");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});
