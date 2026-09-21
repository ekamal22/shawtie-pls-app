import assert from "node:assert/strict";
import test from "node:test";
import { createApiApplication } from "../src/application.ts";
import { AuthKeyRing } from "../src/security/auth-key-ring.ts";
import {
  closeDatabasePool,
  createDatabasePool,
  databaseConfigFromEnv,
  setPartnerRequestExpired,
  withTransaction,
  type DatabasePool,
} from "@shawtie/db";
import type { ApiConfig } from "../src/config.ts";

function requireDisposableDatabase(): DatabasePool {
  if (process.env.DB_TEST_CONFIRM !== "1") {
    throw new Error("DB_TEST_CONFIRM=1 is required for disposable P2 integration tests");
  }
  return createDatabasePool({
    ...databaseConfigFromEnv(),
    applicationName: "shawtie-p2-api-test",
    maxConnections: 20,
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
}

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
): Promise<TestAccount> {
  const username = "p2_" + suffix;
  const password = "very secure P2 password " + suffix;
  const start = await app.inject({
    method: "POST",
    url: "/api/v1/auth/registration/start",
    headers: jsonHeaders(),
    payload: {
      username,
      displayName: "P2 " + suffix,
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
    payload: { registrationIntentId, code, deviceName: "P2 Browser" },
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
  sender: TestAccount,
  target: TestAccount,
  key: string,
  relationshipStartDate = "2020-01-01",
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

async function acceptRequest(app: App, account: TestAccount, requestId: string) {
  return app.inject({
    method: "POST",
    url: "/api/v1/partner-requests/" + requestId + "/accept",
    headers: mutationHeaders(account.cookie),
  });
}

async function currentPartnership(app: App, account: TestAccount) {
  return app.inject({
    method: "GET",
    url: "/api/v1/partnerships/current",
    headers: { cookie: account.cookie },
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

test("P2 migration keeps notification storage minimal and legacy-safe", async () => {
  const database = requireDisposableDatabase();
  try {
    await reset(database);

    const columns = await database.pool.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'account_notifications'
       ORDER BY ordinal_position`,
    );
    assert.deepEqual(
      columns.rows.map((row) => row.column_name),
      [
        "id",
        "recipient_account_id",
        "actor_account_id",
        "partnership_id",
        "event_type",
        "deduplication_key",
        "created_at",
        "read_at",
      ],
    );

    const constraints = await database.pool.query<{
      conname: string;
      convalidated: boolean;
    }>(
      `SELECT conname, convalidated
       FROM pg_constraint
       WHERE conname IN (
         'partner_requests_accepted_link_required',
         'partner_requests_accepted_link_terminal_only'
       )
       ORDER BY conname`,
    );
    assert.deepEqual(constraints.rows, [
      {
        conname: "partner_requests_accepted_link_required",
        convalidated: false,
      },
      {
        conname: "partner_requests_accepted_link_terminal_only",
        convalidated: false,
      },
    ]);
  } finally {
    await closeDatabasePool(database);
  }
});

test("P2 explicit accept forms, invalidates, and replays", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "explicit_alice");
    const bob = await register(app, database, "explicit_bob");
    const charlie = await register(app, database, "explicit_charlie");
    const dave = await register(app, database, "explicit_dave");

    const primary = await createRequest(app, alice, bob, "p2-explicit-primary");
    assert.equal(primary.statusCode, 201, primary.body);
    const requestId = (primary.json() as { requestId: string }).requestId;

    const beforeAccept = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM partnerships",
    );
    assert.equal(beforeAccept.rows[0]?.count, "0");

    assert.equal((await createRequest(app, charlie, bob, "p2-explicit-incoming")).statusCode, 201);
    assert.equal((await createRequest(app, bob, dave, "p2-explicit-outgoing")).statusCode, 201);

    const senderCannotAccept = await acceptRequest(app, alice, requestId);
    assert.equal(senderCannotAccept.statusCode, 404);

    const wrongAccount = await acceptRequest(app, charlie, requestId);
    assert.equal(wrongAccount.statusCode, 404);

    const accepted = await acceptRequest(app, bob, requestId);
    assert.equal(accepted.statusCode, 200, accepted.body);
    const acceptedBody = accepted.json() as {
      outcome: string;
      partnershipId: string;
    };
    assert.equal(acceptedBody.outcome, "formed");

    const request = await database.pool.query<{
      status: string;
      accepted_partnership_id: string | null;
    }>(
      "SELECT status, accepted_partnership_id FROM partner_requests WHERE id = $1",
      [requestId],
    );
    assert.equal(request.rows[0]?.status, "accepted");
    assert.equal(request.rows[0]?.accepted_partnership_id, acceptedBody.partnershipId);

    const members = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM partnership_members WHERE partnership_id = $1",
      [acceptedBody.partnershipId],
    );
    assert.equal(members.rows[0]?.count, "2");

    const invalidated = await database.pool.query<{
      status: string;
      invalidated_reason: string | null;
    }>(
      `SELECT status, invalidated_reason
       FROM partner_requests
       WHERE id <> $1
       ORDER BY id`,
      [requestId],
    );
    assert.equal(invalidated.rows.length, 2);
    assert.ok(
      invalidated.rows.every(
        (row) => row.status === "invalidated" && row.invalidated_reason === "partnership_formed",
      ),
    );

    const expiry = await database.pool.query<{ status: string }>(
      "SELECT status FROM scheduled_actions WHERE deduplication_key = $1",
      ["partner-request-expire:" + requestId],
    );
    assert.equal(expiry.rows[0]?.status, "cancelled");

    const workerNoOp = await setPartnerRequestExpired(
      database.pool,
      requestId,
      new Date("2999-01-01T00:00:00.000Z"),
    );
    assert.equal(workerNoOp, "terminal");

    const notification = await database.pool.query<{
      recipient_account_id: string;
      actor_account_id: string | null;
      event_type: string;
    }>(
      `SELECT recipient_account_id, actor_account_id, event_type
       FROM account_notifications
       WHERE partnership_id = $1`,
      [acceptedBody.partnershipId],
    );
    assert.deepEqual(notification.rows[0], {
      recipient_account_id: alice.accountId,
      actor_account_id: bob.accountId,
      event_type: "partnership_formed",
    });

    const replay = await acceptRequest(app, bob, requestId);
    assert.equal(replay.statusCode, 200, replay.body);
    assert.deepEqual(replay.json(), {
      outcome: "already_accepted",
      partnershipId: acceptedBody.partnershipId,
    });

    const current = await currentPartnership(app, bob);
    assert.equal(current.statusCode, 200, current.body);
    assert.equal(current.headers["cache-control"], "private, no-store");
    const currentBody = current.json() as {
      partnership: Record<string, unknown> & {
        otherMember: Record<string, unknown>;
      };
    };
    assert.equal(currentBody.partnership.partnershipId, acceptedBody.partnershipId);
    assert.equal("email" in currentBody.partnership.otherMember, false);
    assert.equal("dateOfBirth" in currentBody.partnership.otherMember, false);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("P2 accept races with cancel and decline without split-brain state", async () => {
  for (const action of ["cancel", "decline"] as const) {
    const database = requireDisposableDatabase();
    const app = createApiApplication({ database, config });
    try {
      await reset(database);
      const alice = await register(app, database, "terminal_" + action + "_alice");
      const bob = await register(app, database, "terminal_" + action + "_bob");

      const created = await createRequest(
        app,
        alice,
        bob,
        "p2-terminal-race-" + action,
      );
      assert.equal(created.statusCode, 201, created.body);
      const requestId = (created.json() as { requestId: string }).requestId;

      const transitionActor = action === "cancel" ? alice : bob;
      const [accepted, terminal] = await Promise.all([
        acceptRequest(app, bob, requestId),
        app.inject({
          method: "POST",
          url: "/api/v1/partner-requests/" + requestId + "/" + action,
          headers: mutationHeaders(transitionActor.cookie),
        }),
      ]);

      assert.equal(terminal.statusCode, 200, terminal.body);
      assert.ok(accepted.statusCode === 200 || accepted.statusCode === 409);

      const row = await database.pool.query<{
        status: string;
        accepted_partnership_id: string | null;
      }>(
        "SELECT status, accepted_partnership_id FROM partner_requests WHERE id = $1",
        [requestId],
      );
      const request = row.rows[0];
      assert.ok(request);

      const partnerships = await database.pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM partnerships",
      );

      if (request.status === "accepted") {
        assert.equal(accepted.statusCode, 200);
        assert.ok(request.accepted_partnership_id);
        assert.equal(partnerships.rows[0]?.count, "1");
        assert.equal(
          (terminal.json() as { status: string }).status,
          "accepted",
        );
      } else {
        assert.equal(request.status, action === "cancel" ? "cancelled" : "declined");
        assert.equal(request.accepted_partnership_id, null);
        assert.equal(accepted.statusCode, 409);
        assert.equal(partnerships.rows[0]?.count, "0");
      }
    } finally {
      await app.close();
      await closeDatabasePool(database);
    }
  }
});

test("P2 formation fences an already-processing expiry claim", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "expiry_alice");
    const bob = await register(app, database, "expiry_bob");

    const created = await createRequest(app, alice, bob, "p2-expiry-processing");
    assert.equal(created.statusCode, 201, created.body);
    const requestId = (created.json() as { requestId: string }).requestId;

    await database.pool.query(
      `UPDATE scheduled_actions
       SET status = 'processing',
           claimed_at = clock_timestamp(),
           claimed_by = 'p2-test-worker',
           lease_expires_at = clock_timestamp() + interval '1 hour',
           claim_version = claim_version + 1
       WHERE deduplication_key = $1
         AND status = 'pending'`,
      ["partner-request-expire:" + requestId],
    );

    const accepted = await acceptRequest(app, bob, requestId);
    assert.equal(accepted.statusCode, 200, accepted.body);

    const action = await database.pool.query<{
      status: string;
      claimed_by: string | null;
    }>(
      `SELECT status, claimed_by
       FROM scheduled_actions
       WHERE deduplication_key = $1`,
      ["partner-request-expire:" + requestId],
    );
    assert.deepEqual(action.rows[0], {
      status: "processing",
      claimed_by: "p2-test-worker",
    });

    const terminal = await withTransaction(database, (transaction) =>
      setPartnerRequestExpired(
        transaction,
        requestId,
        new Date("2999-01-01T00:00:00.000Z"),
      ),
    );
    assert.equal(terminal, "terminal");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("P2 reciprocal request uses the triggering date and stable replay", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "reciprocal_alice");
    const bob = await register(app, database, "reciprocal_bob");

    const first = await createRequest(
      app,
      alice,
      bob,
      "p2-reciprocal-first",
      "2019-05-10",
    );
    assert.equal(first.statusCode, 201, first.body);
    assert.equal((first.json() as { outcome: string }).outcome, "created");

    const second = await createRequest(
      app,
      bob,
      alice,
      "p2-reciprocal-second",
      "2020-06-20",
    );
    assert.equal(second.statusCode, 201, second.body);
    const paired = second.json() as {
      outcome: string;
      requestId: string;
      partnershipId: string;
    };
    assert.equal(paired.outcome, "paired");

    const partnership = await database.pool.query<{
      relationship_start_date: string;
    }>(
      "SELECT relationship_start_date::text FROM partnerships WHERE id = $1",
      [paired.partnershipId],
    );
    assert.equal(partnership.rows[0]?.relationship_start_date, "2020-06-20");

    const accepted = await database.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM partner_requests
       WHERE accepted_partnership_id = $1
         AND status = 'accepted'`,
      [paired.partnershipId],
    );
    assert.equal(accepted.rows[0]?.count, "2");

    const cancelledExpiry = await database.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM scheduled_actions
       WHERE aggregate_type = 'partner_request'
         AND status = 'cancelled'`,
    );
    assert.equal(cancelledExpiry.rows[0]?.count, "2");

    const notification = await database.pool.query<{
      recipient_account_id: string;
      actor_account_id: string | null;
    }>(
      `SELECT recipient_account_id, actor_account_id
       FROM account_notifications
       WHERE partnership_id = $1
         AND event_type = 'partnership_formed'`,
      [paired.partnershipId],
    );
    assert.deepEqual(notification.rows[0], {
      recipient_account_id: alice.accountId,
      actor_account_id: bob.accountId,
    });

    const epochs = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM partnership_crypto_epochs WHERE partnership_id = $1",
      [paired.partnershipId],
    );
    assert.equal(epochs.rows[0]?.count, "0");

    const replay = await createRequest(
      app,
      bob,
      alice,
      "p2-reciprocal-second",
      "2020-06-20",
    );
    assert.equal(replay.statusCode, 201, replay.body);
    assert.deepEqual(replay.json(), paired);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("P2 relationship date updates version, notify once, and isolate reads", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "date_alice");
    const bob = await register(app, database, "date_bob");
    const charlie = await register(app, database, "date_charlie");

    const created = await createRequest(app, alice, bob, "p2-date-request");
    const requestId = (created.json() as { requestId: string }).requestId;
    const accepted = await acceptRequest(app, bob, requestId);
    const partnershipId = (accepted.json() as { partnershipId: string }).partnershipId;

    const aliceCurrent = await currentPartnership(app, alice);
    const initial = (aliceCurrent.json() as {
      partnership: {
        metadataVersion: number;
        capabilities: { changeRelationshipStartDate: boolean };
      };
    }).partnership;
    assert.equal(initial.metadataVersion, 1);
    assert.equal(initial.capabilities.changeRelationshipStartDate, true);

    const changed = await app.inject({
      method: "PATCH",
      url: "/api/v1/partnerships/" + partnershipId + "/relationship-start-date",
      headers: jsonHeaders(alice.cookie),
      payload: {
        relationshipStartDate: "2018-02-03",
        expectedMetadataVersion: 1,
      },
    });
    assert.equal(changed.statusCode, 200, changed.body);
    assert.deepEqual(changed.json(), {
      partnershipId,
      relationshipStartDate: "2018-02-03",
      metadataVersion: 2,
      changed: true,
    });

    const retry = await app.inject({
      method: "PATCH",
      url: "/api/v1/partnerships/" + partnershipId + "/relationship-start-date",
      headers: jsonHeaders(alice.cookie),
      payload: {
        relationshipStartDate: "2018-02-03",
        expectedMetadataVersion: 1,
      },
    });
    assert.equal(retry.statusCode, 200, retry.body);
    assert.deepEqual(retry.json(), {
      partnershipId,
      relationshipStartDate: "2018-02-03",
      metadataVersion: 2,
      changed: false,
    });

    const dateNotifications = await database.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM account_notifications
       WHERE partnership_id = $1
         AND event_type = 'relationship_start_date_changed'`,
      [partnershipId],
    );
    assert.equal(dateNotifications.rows[0]?.count, "1");

    const future = await app.inject({
      method: "PATCH",
      url: "/api/v1/partnerships/" + partnershipId + "/relationship-start-date",
      headers: jsonHeaders(bob.cookie),
      payload: {
        relationshipStartDate: "2999-01-01",
        expectedMetadataVersion: 2,
      },
    });
    assert.equal(future.statusCode, 409);
    assert.equal(
      (future.json() as { error: { code: string } }).error.code,
      "RELATIONSHIP_DATE_FUTURE",
    );

    const guessed = await app.inject({
      method: "PATCH",
      url: "/api/v1/partnerships/" + partnershipId + "/relationship-start-date",
      headers: jsonHeaders(charlie.cookie),
      payload: {
        relationshipStartDate: "2017-01-01",
        expectedMetadataVersion: 2,
      },
    });
    assert.equal(guessed.statusCode, 404);

    const bobNotifications = await app.inject({
      method: "GET",
      url: "/api/v1/notifications?limit=25",
      headers: { cookie: bob.cookie },
    });
    assert.equal(bobNotifications.statusCode, 200, bobNotifications.body);
    assert.equal(bobNotifications.headers["cache-control"], "private, no-store");
    const bobItems = (
      bobNotifications.json() as {
        items: Array<{
          notificationId: string;
          eventType: string;
          readAt: string | null;
        }>;
      }
    ).items;
    const dateNotice = bobItems.find(
      (item) => item.eventType === "relationship_start_date_changed",
    );
    assert.ok(dateNotice);
    assert.equal("relationshipStartDate" in dateNotice, false);

    const crossAccountRead = await app.inject({
      method: "POST",
      url: "/api/v1/notifications/" + dateNotice.notificationId + "/read",
      headers: mutationHeaders(alice.cookie),
    });
    assert.equal(crossAccountRead.statusCode, 404);

    const markRead = await app.inject({
      method: "POST",
      url: "/api/v1/notifications/" + dateNotice.notificationId + "/read",
      headers: mutationHeaders(bob.cookie),
    });
    assert.equal(markRead.statusCode, 200, markRead.body);
    const firstReadAt = (markRead.json() as { readAt: string }).readAt;

    const replayRead = await app.inject({
      method: "POST",
      url: "/api/v1/notifications/" + dateNotice.notificationId + "/read",
      headers: mutationHeaders(bob.cookie),
    });
    assert.equal(replayRead.statusCode, 200, replayRead.body);
    assert.equal((replayRead.json() as { readAt: string }).readAt, firstReadAt);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("P2 notification pagination is snapshot-bound", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "notification_page_alice");
    const bob = await register(app, database, "notification_page_bob");

    const created = await createRequest(app, alice, bob, "p2-notification-page-request");
    const requestId = (created.json() as { requestId: string }).requestId;
    const accepted = await acceptRequest(app, bob, requestId);
    const partnershipId = (accepted.json() as { partnershipId: string }).partnershipId;

    const firstChange = await app.inject({
      method: "PATCH",
      url: "/api/v1/partnerships/" + partnershipId + "/relationship-start-date",
      headers: jsonHeaders(bob.cookie),
      payload: {
        relationshipStartDate: "2019-01-01",
        expectedMetadataVersion: 1,
      },
    });
    assert.equal(firstChange.statusCode, 200, firstChange.body);

    const pageOne = await app.inject({
      method: "GET",
      url: "/api/v1/notifications?limit=1",
      headers: { cookie: alice.cookie },
    });
    assert.equal(pageOne.statusCode, 200, pageOne.body);
    const firstPage = pageOne.json() as {
      items: Array<{ eventType: string; notificationId: string }>;
      nextCursor: string | null;
    };
    assert.equal(firstPage.items.length, 1);
    assert.equal(firstPage.items[0]?.eventType, "relationship_start_date_changed");
    assert.ok(firstPage.nextCursor);

    const secondChange = await app.inject({
      method: "PATCH",
      url: "/api/v1/partnerships/" + partnershipId + "/relationship-start-date",
      headers: jsonHeaders(bob.cookie),
      payload: {
        relationshipStartDate: "2018-01-01",
        expectedMetadataVersion: 2,
      },
    });
    assert.equal(secondChange.statusCode, 200, secondChange.body);

    const pageTwo = await app.inject({
      method: "GET",
      url: "/api/v1/notifications?limit=25&cursor=" +
        encodeURIComponent(firstPage.nextCursor ?? ""),
      headers: { cookie: alice.cookie },
    });
    assert.equal(pageTwo.statusCode, 200, pageTwo.body);
    const secondPage = pageTwo.json() as {
      items: Array<{ eventType: string; notificationId: string }>;
    };
    assert.deepEqual(
      secondPage.items.map((item) => item.eventType),
      ["partnership_formed"],
    );
    assert.equal(
      secondPage.items.some(
        (item) => item.notificationId === firstPage.items[0]?.notificationId,
      ),
      false,
    );
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("P2 competing accepts create exactly one partnership", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "race_accept_alice");
    const bob = await register(app, database, "race_accept_bob");
    const charlie = await register(app, database, "race_accept_charlie");

    const aToB = await createRequest(app, alice, bob, "p2-race-accept-b");
    const aToC = await createRequest(app, alice, charlie, "p2-race-accept-c");
    const requestB = (aToB.json() as { requestId: string }).requestId;
    const requestC = (aToC.json() as { requestId: string }).requestId;

    const responses = await Promise.all([
      acceptRequest(app, bob, requestB),
      acceptRequest(app, charlie, requestC),
    ]);
    assert.deepEqual(
      responses.map((response) => response.statusCode).sort((a, b) => a - b),
      [200, 409],
    );

    const partnerships = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM partnerships",
    );
    assert.equal(partnerships.rows[0]?.count, "1");

    const currentMemberships = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM partnership_members WHERE released_at IS NULL",
    );
    assert.equal(currentMemberships.rows[0]?.count, "2");

    const requestStates = await database.pool.query<{
      status: string;
      accepted_partnership_id: string | null;
      invalidated_reason: string | null;
    }>(
      `SELECT status, accepted_partnership_id, invalidated_reason
       FROM partner_requests
       WHERE id = ANY($1::uuid[])
       ORDER BY id`,
      [[requestB, requestC]],
    );
    assert.deepEqual(
      requestStates.rows.map((row) => row.status).sort(),
      ["accepted", "invalidated"],
    );
    const acceptedRequest = requestStates.rows.find((row) => row.status === "accepted");
    const invalidatedRequest = requestStates.rows.find((row) => row.status === "invalidated");
    assert.ok(acceptedRequest?.accepted_partnership_id);
    assert.equal(invalidatedRequest?.invalidated_reason, "partnership_formed");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("P2 explicit accept versus reciprocal create converges on one partnership", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "race_reciprocal_alice");
    const bob = await register(app, database, "race_reciprocal_bob");

    const first = await createRequest(app, alice, bob, "p2-race-reciprocal-first");
    const requestId = (first.json() as { requestId: string }).requestId;

    const [accept, reciprocal] = await Promise.all([
      acceptRequest(app, bob, requestId),
      createRequest(app, bob, alice, "p2-race-reciprocal-second"),
    ]);
    assert.equal(accept.statusCode, 200, accept.body);
    assert.ok(reciprocal.statusCode === 201 || reciprocal.statusCode === 409);

    const partnerships = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM partnerships",
    );
    assert.equal(partnerships.rows[0]?.count, "1");

    const occupied = await database.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM partnership_members
       WHERE account_id = $1
         AND released_at IS NULL`,
      [alice.accountId],
    );
    assert.equal(occupied.rows[0]?.count, "1");

    const requests = await database.pool.query<{
      status: string;
      accepted_partnership_id: string | null;
    }>(
      `SELECT status, accepted_partnership_id
       FROM partner_requests
       WHERE sender_account_id IN ($1,$2)
         AND recipient_account_id IN ($1,$2)
       ORDER BY created_at, id`,
      [alice.accountId, bob.accountId],
    );

    if (reciprocal.statusCode === 201) {
      assert.equal((reciprocal.json() as { outcome: string }).outcome, "paired");
      assert.equal(requests.rows.length, 2);
      assert.ok(requests.rows.every((row) => row.status === "accepted"));
      assert.equal(
        new Set(requests.rows.map((row) => row.accepted_partnership_id)).size,
        1,
      );
    } else {
      assert.equal(requests.rows.length, 1);
      assert.equal(requests.rows[0]?.status, "accepted");
      assert.ok(requests.rows[0]?.accepted_partnership_id);
    }
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("P2 concurrent relationship-date writes allow one version winner", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "race_date_alice");
    const bob = await register(app, database, "race_date_bob");

    const created = await createRequest(app, alice, bob, "p2-race-date-request");
    const requestId = (created.json() as { requestId: string }).requestId;
    const accepted = await acceptRequest(app, bob, requestId);
    const partnershipId = (accepted.json() as { partnershipId: string }).partnershipId;

    const responses = await Promise.all([
      app.inject({
        method: "PATCH",
        url: "/api/v1/partnerships/" + partnershipId + "/relationship-start-date",
        headers: jsonHeaders(alice.cookie),
        payload: {
          relationshipStartDate: "2016-01-01",
          expectedMetadataVersion: 1,
        },
      }),
      app.inject({
        method: "PATCH",
        url: "/api/v1/partnerships/" + partnershipId + "/relationship-start-date",
        headers: jsonHeaders(bob.cookie),
        payload: {
          relationshipStartDate: "2017-01-01",
          expectedMetadataVersion: 1,
        },
      }),
    ]);
    assert.deepEqual(
      responses.map((response) => response.statusCode).sort((a, b) => a - b),
      [200, 409],
    );

    const row = await database.pool.query<{ version: string }>(
      "SELECT version::text FROM partnerships WHERE id = $1",
      [partnershipId],
    );
    assert.equal(row.rows[0]?.version, "2");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("P2 formation and account deletion serialize without bypassing view-only state", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "race_delete_alice");
    const bob = await register(app, database, "race_delete_bob");

    const created = await createRequest(app, alice, bob, "p2-race-delete-request");
    const requestId = (created.json() as { requestId: string }).requestId;
    const reauthedAliceCookie = await reauthenticate(app, alice);

    const [accept, deletion] = await Promise.all([
      acceptRequest(app, bob, requestId),
      app.inject({
        method: "POST",
        url: "/api/v1/me/account-deletion",
        headers: jsonHeaders(reauthedAliceCookie),
        payload: {},
      }),
    ]);
    assert.equal(deletion.statusCode, 200, deletion.body);
    assert.ok(accept.statusCode === 200 || accept.statusCode === 409);

    const rows = await database.pool.query<{
      partnership_count: string;
      alice_status: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM partnerships) AS partnership_count,
         (SELECT status FROM accounts WHERE id = $1) AS alice_status`,
      [alice.accountId],
    );
    assert.equal(rows.rows[0]?.alice_status, "deletion_pending");
    assert.ok(
      rows.rows[0]?.partnership_count === "0" || rows.rows[0]?.partnership_count === "1",
    );

    const requestState = await database.pool.query<{
      status: string;
      invalidated_reason: string | null;
      accepted_partnership_id: string | null;
    }>(
      `SELECT status, invalidated_reason, accepted_partnership_id
       FROM partner_requests
       WHERE id = $1`,
      [requestId],
    );

    if (accept.statusCode === 200) {
      assert.equal(rows.rows[0]?.partnership_count, "1");
      assert.equal(requestState.rows[0]?.status, "accepted");
      assert.ok(requestState.rows[0]?.accepted_partnership_id);

      const current = await currentPartnership(app, bob);
      assert.equal(current.statusCode, 200, current.body);
      const capability = (current.json() as {
        partnership: {
          capabilities: { changeRelationshipStartDate: boolean };
        };
      }).partnership.capabilities.changeRelationshipStartDate;
      assert.equal(capability, false);
    } else {
      assert.equal(rows.rows[0]?.partnership_count, "0");
      assert.equal(requestState.rows[0]?.status, "invalidated");
      assert.equal(requestState.rows[0]?.invalidated_reason, "account_unavailable");
      assert.equal(requestState.rows[0]?.accepted_partnership_id, null);
    }
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});
