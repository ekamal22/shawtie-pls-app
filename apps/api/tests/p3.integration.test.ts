import assert from "node:assert/strict";
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
    throw new Error("DB_TEST_CONFIRM=1 is required for disposable P3 API tests");
  }
  return createDatabasePool({
    ...databaseConfigFromEnv(),
    applicationName: "shawtie-p3-api-test",
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
  readonly accountId: string;
  readonly cookie: string;
  readonly username: string;
  readonly password: string;
}

function jsonHeaders(cookie?: string): Record<string, string> {
  return {
    origin: config.appOrigin,
    "x-shawtie-csrf": "1",
    "content-type": "application/json",
    ...(cookie ? { cookie } : {}),
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
    "SELECT id, purpose, challenge_nonce, verifier_key_version FROM email_verifications WHERE account_id = $1 AND purpose = 'account_recovery' AND consumed_at IS NULL AND superseded_at IS NULL ORDER BY created_at DESC LIMIT 1",
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
  const username = "p3_" + suffix;
  const password = "very secure P3 password " + suffix;
  const start = await app.inject({
    method: "POST",
    url: "/api/v1/auth/registration/start",
    headers: jsonHeaders(),
    payload: {
      username,
      displayName: "P3 " + suffix,
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
    payload: { registrationIntentId, code, deviceName: "P3 Browser" },
  });
  assert.equal(verify.statusCode, 200, verify.body);
  return {
    accountId: (verify.json() as { accountId: string }).accountId,
    cookie: cookieHeader(verify),
    username,
    password,
  };
}

async function createRequest(app: App, sender: TestAccount, target: TestAccount, key: string) {
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
      relationshipStartDate: "2020-01-01",
    },
  });
}

async function formPartnership(
  app: App,
  alice: TestAccount,
  bob: TestAccount,
  key: string,
): Promise<string> {
  const request = await createRequest(app, alice, bob, key);
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

test("P3 breakup cancellation is replay-safe and preserves metadata version", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "cancel_alice");
    const bob = await register(app, database, "cancel_bob");
    const partnershipId = await formPartnership(app, alice, bob, "p3-cancel-form-0001");

    const key = "p3-breakup-cancel-start";
    const started = await app.inject({
      method: "POST",
      url: "/api/v1/partnerships/" + partnershipId + "/breakup",
      headers: mutationHeaders(alice.cookie, key),
    });
    assert.equal(started.statusCode, 200, started.body);
    const startedBody = started.json() as { breakupId: string; generation: number };
    assert.equal(startedBody.generation, 2);

    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/partnerships/" + partnershipId + "/breakup",
      headers: mutationHeaders(alice.cookie, key),
    });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.deepEqual(replay.json(), started.json());

    const wrongActor = await app.inject({
      method: "POST",
      url:
        "/api/v1/partnerships/" + partnershipId + "/breakups/" + startedBody.breakupId + "/cancel",
      headers: mutationHeaders(bob.cookie, "p3-cancel-wrong-actor"),
    });
    assert.equal(wrongActor.statusCode, 409);
    assert.equal(
      (wrongActor.json() as { error: { code: string } }).error.code,
      "NOT_BREAKUP_INITIATOR",
    );

    const cancelled = await app.inject({
      method: "POST",
      url:
        "/api/v1/partnerships/" + partnershipId + "/breakups/" + startedBody.breakupId + "/cancel",
      headers: mutationHeaders(alice.cookie, "p3-cancel-owner-key"),
    });
    assert.equal(cancelled.statusCode, 200, cancelled.body);
    assert.equal((cancelled.json() as { generation: number }).generation, 3);

    const persisted = await database.pool.query<{
      lifecycle_state: string;
      version: string;
      generation: string;
      cancelled_at: Date | null;
      pending_actions: string;
    }>(
      "SELECT partnership.lifecycle_state, partnership.version::text AS version, partnership.generation::text AS generation, breakup.cancelled_at, (SELECT count(*)::text FROM scheduled_actions action WHERE action.aggregate_id = breakup.id AND action.status = 'pending') AS pending_actions FROM partnerships partnership JOIN breakup_processes breakup ON breakup.partnership_id = partnership.id WHERE breakup.id = $1",
      [startedBody.breakupId],
    );
    assert.equal(persisted.rows[0]?.lifecycle_state, "active");
    assert.equal(persisted.rows[0]?.version, "1");
    assert.equal(persisted.rows[0]?.generation, "3");
    assert.ok(persisted.rows[0]?.cancelled_at);
    assert.equal(persisted.rows[0]?.pending_actions, "0");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("P3 first restore extends once to day ten and mutual intent restores without cooldown", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "restore_alice");
    const bob = await register(app, database, "restore_bob");
    const partnershipId = await formPartnership(app, alice, bob, "p3-restore-form-0001");

    const started = await app.inject({
      method: "POST",
      url: "/api/v1/partnerships/" + partnershipId + "/breakup",
      headers: mutationHeaders(alice.cookie, "p3-restore-breakup"),
    });
    assert.equal(started.statusCode, 200, started.body);
    const breakupId = (started.json() as { breakupId: string }).breakupId;

    const early = await app.inject({
      method: "POST",
      url: "/api/v1/partnerships/" + partnershipId + "/breakups/" + breakupId + "/restore",
      headers: mutationHeaders(bob.cookie, "p3-restore-too-early"),
    });
    assert.equal(early.statusCode, 409);
    assert.equal(
      (early.json() as { error: { code: string } }).error.code,
      "RESTORE_WINDOW_NOT_OPEN",
    );

    await moveBreakupPastRestoreBoundary(database, breakupId);

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/partnerships/" + partnershipId + "/breakups/" + breakupId + "/restore",
      headers: mutationHeaders(bob.cookie, "p3-restore-first"),
    });
    assert.equal(first.statusCode, 200, first.body);
    assert.equal((first.json() as { restored: boolean }).restored, false);
    assert.equal((first.json() as { generation: number }).generation, 3);

    const firstPersisted = await database.pool.query<{
      exact_extension: boolean;
      intent_count: string;
      finalize_count: string;
      reminder_count: string;
    }>(
      "SELECT breakup.final_deadline = breakup.initiated_at + interval '10 days' AS exact_extension, (SELECT count(*)::text FROM breakup_restore_intents intent WHERE intent.breakup_process_id = breakup.id) AS intent_count, (SELECT count(*)::text FROM scheduled_actions action WHERE action.aggregate_id = breakup.id AND action.action_type = 'partnership_breakup_finalize' AND action.status = 'pending') AS finalize_count, (SELECT count(*)::text FROM scheduled_actions action WHERE action.aggregate_id = breakup.id AND action.action_type = 'partnership_breakup_deadline_reminder' AND action.status = 'pending') AS reminder_count FROM breakup_processes breakup WHERE breakup.id = $1",
      [breakupId],
    );
    assert.equal(firstPersisted.rows[0]?.exact_extension, true);
    assert.equal(firstPersisted.rows[0]?.intent_count, "1");
    assert.equal(firstPersisted.rows[0]?.finalize_count, "1");
    assert.equal(firstPersisted.rows[0]?.reminder_count, "1");

    const duplicateDifferentKey = await app.inject({
      method: "POST",
      url: "/api/v1/partnerships/" + partnershipId + "/breakups/" + breakupId + "/restore",
      headers: mutationHeaders(bob.cookie, "p3-restore-duplicate-new-key"),
    });
    assert.equal(duplicateDifferentKey.statusCode, 409);
    assert.equal(
      (duplicateDifferentKey.json() as { error: { code: string } }).error.code,
      "RESTORE_INTENT_ALREADY_SUBMITTED",
    );

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/partnerships/" + partnershipId + "/breakups/" + breakupId + "/restore",
      headers: mutationHeaders(alice.cookie, "p3-restore-second"),
    });
    assert.equal(second.statusCode, 200, second.body);
    assert.equal((second.json() as { restored: boolean }).restored, true);
    assert.equal((second.json() as { generation: number }).generation, 4);

    const persisted = await database.pool.query<{
      lifecycle_state: string;
      version: string;
      generation: string;
      restored_at: Date | null;
      intent_count: string;
      cooldown_count: string;
    }>(
      "SELECT partnership.lifecycle_state, partnership.version::text AS version, partnership.generation::text AS generation, breakup.restored_at, (SELECT count(*)::text FROM breakup_restore_intents intent WHERE intent.breakup_process_id = breakup.id) AS intent_count, (SELECT count(*)::text FROM account_partner_eligibility eligibility WHERE eligibility.source_partnership_id = partnership.id) AS cooldown_count FROM partnerships partnership JOIN breakup_processes breakup ON breakup.partnership_id = partnership.id WHERE breakup.id = $1",
      [breakupId],
    );
    assert.equal(persisted.rows[0]?.lifecycle_state, "active");
    assert.equal(persisted.rows[0]?.version, "1");
    assert.equal(persisted.rows[0]?.generation, "4");
    assert.ok(persisted.rows[0]?.restored_at);
    assert.equal(persisted.rows[0]?.intent_count, "2");
    assert.equal(persisted.rows[0]?.cooldown_count, "0");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("P3 concurrent restore intents serialize to one restored partnership", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "restore_race_alice");
    const bob = await register(app, database, "restore_race_bob");
    const partnershipId = await formPartnership(app, alice, bob, "p3-restore-race-form");

    const started = await app.inject({
      method: "POST",
      url: "/api/v1/partnerships/" + partnershipId + "/breakup",
      headers: mutationHeaders(alice.cookie, "p3-restore-race-breakup"),
    });
    assert.equal(started.statusCode, 200, started.body);
    const breakupId = (started.json() as { breakupId: string }).breakupId;
    await moveBreakupPastRestoreBoundary(database, breakupId);

    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/v1/partnerships/" + partnershipId + "/breakups/" + breakupId + "/restore",
        headers: mutationHeaders(alice.cookie, "p3-restore-race-a"),
      }),
      app.inject({
        method: "POST",
        url: "/api/v1/partnerships/" + partnershipId + "/breakups/" + breakupId + "/restore",
        headers: mutationHeaders(bob.cookie, "p3-restore-race-b"),
      }),
    ]);
    assert.deepEqual(
      responses.map((response) => response.statusCode).sort((a, b) => a - b),
      [200, 200],
      responses.map((response) => response.body).join("\n"),
    );
    assert.equal(
      responses.filter((response) => (response.json() as { restored: boolean }).restored).length,
      1,
    );

    const state = await database.pool.query<{
      lifecycle_state: string;
      intent_count: string;
      restored_count: string;
    }>(
      "SELECT partnership.lifecycle_state, (SELECT count(*)::text FROM breakup_restore_intents intent WHERE intent.breakup_process_id = $2) AS intent_count, (SELECT count(*)::text FROM partnership_lifecycle_events event WHERE event.partnership_id = $1 AND event.event_type = 'partnership_restored') AS restored_count FROM partnerships partnership WHERE partnership.id = $1",
      [partnershipId, breakupId],
    );
    assert.equal(state.rows[0]?.lifecycle_state, "active");
    assert.equal(state.rows[0]?.intent_count, "2");
    assert.equal(state.rows[0]?.restored_count, "1");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("P3 account deletion overlay is view-only and recovery preserves the same partnership", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "overlay_alice");
    const bob = await register(app, database, "overlay_bob");
    const partnershipId = await formPartnership(app, alice, bob, "p3-overlay-form-0001");
    const reauthedCookie = await reauthenticate(app, alice);

    const deletion = await app.inject({
      method: "POST",
      url: "/api/v1/me/account-deletion",
      headers: jsonHeaders(reauthedCookie),
      payload: {},
    });
    assert.equal(deletion.statusCode, 200, deletion.body);

    const current = await app.inject({
      method: "GET",
      url: "/api/v1/partnerships/current",
      headers: { cookie: bob.cookie },
    });
    assert.equal(current.statusCode, 200, current.body);
    const currentBody = current.json() as {
      partnership: {
        partnershipId: string;
        interactionMode: string;
        accountDeletion: { deletingMember: string; recoverUntil: string } | null;
        capabilities: {
          initiateBreakup: boolean;
          submitRestoreIntent: boolean;
          changeRelationshipStartDate: boolean;
          viewSharedData: boolean;
        };
      };
    };
    assert.equal(currentBody.partnership.partnershipId, partnershipId);
    assert.equal(currentBody.partnership.interactionMode, "account_deletion_view_only");
    assert.equal(currentBody.partnership.accountDeletion?.deletingMember, "partner");
    assert.equal(currentBody.partnership.capabilities.initiateBreakup, false);
    assert.equal(currentBody.partnership.capabilities.submitRestoreIntent, false);
    assert.equal(currentBody.partnership.capabilities.changeRelationshipStartDate, false);
    assert.equal(currentBody.partnership.capabilities.viewSharedData, true);

    const obsoletePrecedence = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM scheduled_actions WHERE action_type = 'account_deletion_breakup_precedence_finalize'",
    );
    assert.equal(obsoletePrecedence.rows[0]?.count, "0");

    const notice = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM account_notifications WHERE recipient_account_id = $1 AND partnership_id = $2 AND event_type = 'partner_account_deletion_started'",
      [bob.accountId, partnershipId],
    );
    assert.equal(notice.rows[0]?.count, "1");

    const recoveryStart = await app.inject({
      method: "POST",
      url: "/api/v1/auth/account-recovery/start",
      headers: jsonHeaders(),
      payload: { identifier: alice.username },
    });
    assert.equal(recoveryStart.statusCode, 202, recoveryStart.body);
    assert.deepEqual(recoveryStart.json(), { accepted: true });
    const code = await latestAccountRecoveryCode(database, alice.accountId);
    const recovered = await app.inject({
      method: "POST",
      url: "/api/v1/auth/account-recovery/complete",
      headers: jsonHeaders(),
      payload: { identifier: alice.username, code },
    });
    assert.equal(recovered.statusCode, 200, recovered.body);

    const after = await app.inject({
      method: "GET",
      url: "/api/v1/partnerships/current",
      headers: { cookie: bob.cookie },
    });
    assert.equal(after.statusCode, 200, after.body);
    assert.equal(
      (after.json() as { partnership: { partnershipId: string; interactionMode: string } })
        .partnership.partnershipId,
      partnershipId,
    );
    assert.equal(
      (after.json() as { partnership: { interactionMode: string } }).partnership.interactionMode,
      "normal",
    );

    const recoveryNotice = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM account_notifications WHERE recipient_account_id = $1 AND partnership_id = $2 AND event_type = 'partner_account_recovered'",
      [bob.accountId, partnershipId],
    );
    assert.equal(recoveryNotice.rows[0]?.count, "1");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("P3 former-partner block is private and a request race cannot leave an unsafe pending request", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "block_alice");
    const bob = await register(app, database, "block_bob");
    const partnershipId = await formPartnership(app, alice, bob, "p3-block-form-0001");
    const endedAt = new Date();

    await database.pool.query(
      "UPDATE partnerships SET lifecycle_state = 'terminated', terminated_at = $2, termination_reason = 'breakup', generation = generation + 1, updated_at = $2 WHERE id = $1",
      [partnershipId, endedAt],
    );
    await database.pool.query(
      "UPDATE partnership_members SET released_at = $2 WHERE partnership_id = $1",
      [partnershipId, endedAt],
    );

    const former = await app.inject({
      method: "GET",
      url: "/api/v1/partnerships/former?limit=25",
      headers: { cookie: alice.cookie },
    });
    assert.equal(former.statusCode, 200, former.body);
    assert.equal(former.headers["cache-control"], "private, no-store");
    assert.equal((former.json() as { items: unknown[] }).items.length, 1);

    const [block, request] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/v1/partnerships/" + partnershipId + "/block",
        headers: mutationHeaders(alice.cookie, "p3-block-race-key"),
      }),
      createRequest(app, bob, alice, "p3-block-request-race"),
    ]);
    assert.equal(block.statusCode, 200, block.body);
    assert.ok(request.statusCode === 201 || request.statusCode === 409);

    const terminal = await database.pool.query<{
      block_count: string;
      pending_count: string;
    }>(
      "SELECT (SELECT count(*)::text FROM partnership_blocks WHERE blocker_account_id = $1 AND blocked_account_id = $2 AND source_partnership_id = $3 AND removed_at IS NULL) AS block_count, (SELECT count(*)::text FROM partner_requests WHERE ((sender_account_id = $1 AND recipient_account_id = $2) OR (sender_account_id = $2 AND recipient_account_id = $1)) AND status = 'pending') AS pending_count",
      [alice.accountId, bob.accountId, partnershipId],
    );
    assert.equal(terminal.rows[0]?.block_count, "1");
    assert.equal(terminal.rows[0]?.pending_count, "0");

    const discovery = await app.inject({
      method: "POST",
      url: "/api/v1/discovery/username",
      headers: jsonHeaders(bob.cookie),
      payload: { username: alice.username },
    });
    assert.equal(discovery.statusCode, 200, discovery.body);
    assert.equal((discovery.json() as { result: unknown }).result, null);

    const blockNoticeLeak = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM account_notifications WHERE recipient_account_id = $1 AND created_at >= $2 AND event_type NOT IN ('partnership_formed')",
      [bob.accountId, endedAt],
    );
    assert.equal(blockNoticeLeak.rows[0]?.count, "0");

    const unblock = await app.inject({
      method: "DELETE",
      url: "/api/v1/partnerships/" + partnershipId + "/block",
      headers: mutationHeaders(alice.cookie, "p3-unblock-key-0001"),
    });
    assert.equal(unblock.statusCode, 200, unblock.body);
    assert.equal((unblock.json() as { blocked: boolean }).blocked, false);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});
