import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApiApplication } from "../src/application.ts";
import { AuthKeyRing } from "../src/security/auth-key-ring.ts";
import {
  closeDatabasePool,
  consumeRateLimitBuckets,
  createDatabasePool,
  databaseConfigFromEnv,
  rotateSessionToken,
  withTransaction,
  type DatabasePool,
} from "@shawtie/db";
import type { ApiConfig } from "../src/config.ts";

function requireDisposableDatabase(): DatabasePool {
  if (process.env.DB_TEST_CONFIRM !== "1") {
    throw new Error("DB_TEST_CONFIRM=1 is required for disposable A1 acceptance tests");
  }
  return createDatabasePool({
    ...databaseConfigFromEnv(),
    applicationName: "shawtie-a1-acceptance-test",
    maxConnections: 12,
  });
}

const rootKey = Buffer.alloc(32, 7);
const config: ApiConfig = {
  environment: "test",
  appOrigin: "http://127.0.0.1:4173",
  allowInsecureLoopbackCookies: true,
  trustedProxy: false,
  authKeys: { activeVersion: 1, keys: new Map([[1, rootKey]]) },
};
const headers = {
  origin: config.appOrigin,
  "x-shawtie-csrf": "1",
  "content-type": "application/json",
};

type App = ReturnType<typeof createApiApplication>;

function cookieHeader(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers["set-cookie"];
  const values = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  return values.map((value) => value.split(";")[0]).join("; ");
}

function cookieValue(header: string, name: string): string {
  const part = header.split("; ").find((value) => value.startsWith(name + "="));
  if (!part) throw new Error("Missing cookie: " + name);
  return part.slice(name.length + 1);
}

async function reset(database: DatabasePool): Promise<void> {
  await database.pool.query(
    "TRUNCATE TABLE accounts, registration_intents, outbox_events, scheduled_actions, deletion_manifests CASCADE",
  );
  await database.pool.query("DELETE FROM security_rate_limit_buckets");
}

async function latestChallenge(
  database: DatabasePool,
  where: { registrationIntentId?: string; accountId?: string; purpose: string },
): Promise<{ id: string; code: string }> {
  const result = await database.pool.query<{
    id: string;
    purpose: string;
    challenge_nonce: Buffer;
    verifier_key_version: number;
  }>(
    "SELECT id, purpose, challenge_nonce, verifier_key_version " +
      "FROM email_verifications " +
      "WHERE purpose = $1 " +
      "AND ($2::uuid IS NULL OR registration_intent_id = $2) " +
      "AND ($3::uuid IS NULL OR account_id = $3) " +
      "AND consumed_at IS NULL AND superseded_at IS NULL " +
      "ORDER BY created_at DESC LIMIT 1",
    [where.purpose, where.registrationIntentId ?? null, where.accountId ?? null],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Missing active challenge");
  return {
    id: row.id,
    code: new AuthKeyRing(config.authKeys).deriveEmailCode(
      row.id,
      row.purpose,
      row.challenge_nonce,
      row.verifier_key_version,
    ),
  };
}

async function startRegistration(
  app: App,
  database: DatabasePool,
  input: {
    username: string;
    email: string;
    suffix: string;
    dateOfBirth?: string;
  },
): Promise<{ registrationIntentId: string; challengeId: string; code: string; password: string }> {
  const password = "very secure account password " + input.suffix;
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/registration/start",
    headers,
    payload: {
      username: input.username,
      displayName: "User " + input.suffix,
      dateOfBirth: input.dateOfBirth ?? "2000-01-01",
      email: input.email,
      password,
    },
  });
  assert.equal(response.statusCode, 200, response.body);
  const registrationIntentId = (response.json() as { registrationIntentId: string })
    .registrationIntentId;
  const challenge = await latestChallenge(database, {
    registrationIntentId,
    purpose: "registration",
  });
  return {
    registrationIntentId,
    challengeId: challenge.id,
    code: challenge.code,
    password,
  };
}

async function register(
  app: App,
  database: DatabasePool,
  suffix: string,
): Promise<{
  accountId: string;
  cookie: string;
  password: string;
  username: string;
  email: string;
}> {
  const username = "user_" + suffix;
  const email = "user_" + suffix + "@example.test";
  const started = await startRegistration(app, database, { username, email, suffix });
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/registration/verify",
    headers,
    payload: {
      registrationIntentId: started.registrationIntentId,
      code: started.code,
      deviceName: "Test Browser",
    },
  });
  assert.equal(response.statusCode, 200, response.body);
  return {
    accountId: (response.json() as { accountId: string }).accountId,
    cookie: cookieHeader(response),
    password: started.password,
    username,
    email,
  };
}

async function currentSession(
  app: App,
  cookie: string,
): Promise<{ sessionId: string; deviceId: string }> {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/auth/session",
    headers: { cookie },
  });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json() as { sessionId: string; deviceId: string };
  return { sessionId: body.sessionId, deviceId: body.deviceId };
}

test("A1 client-provided clock cannot bypass server age eligibility", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/registration/start",
      headers: { ...headers, "x-client-date": "2045-01-01T00:00:00.000Z" },
      payload: {
        username: "clock_bypass",
        displayName: "Clock Bypass",
        dateOfBirth: "2010-01-01",
        email: "clock-bypass@example.test",
        password: "a sufficiently long password",
      },
    });
    assert.equal(response.statusCode, 400);
    assert.equal((response.json() as { error: { code: string } }).error.code, "AGE_INELIGIBLE");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("A1 registration challenge rejects expiry and attempt exhaustion", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const expired = await startRegistration(app, database, {
      username: "expired_challenge",
      email: "expired-challenge@example.test",
      suffix: "expired",
    });
    await database.pool.query(
      "UPDATE email_verifications " +
        "SET created_at = clock_timestamp() - interval '20 minutes', " +
        "expires_at = clock_timestamp() - interval '10 minutes' " +
        "WHERE id = $1",
      [expired.challengeId],
    );
    const expiredResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/registration/verify",
      headers,
      payload: {
        registrationIntentId: expired.registrationIntentId,
        code: expired.code,
      },
    });
    assert.equal(expiredResponse.statusCode, 409);
    assert.equal(
      (expiredResponse.json() as { error: { code: string } }).error.code,
      "EMAIL_CHALLENGE_EXPIRED",
    );

    await reset(database);
    const exhausted = await startRegistration(app, database, {
      username: "exhausted_challenge",
      email: "exhausted-challenge@example.test",
      suffix: "exhausted",
    });
    const wrongCode = exhausted.code === "00000000" ? "00000001" : "00000000";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/registration/verify",
        headers,
        payload: {
          registrationIntentId: exhausted.registrationIntentId,
          code: wrongCode,
        },
      });
      assert.equal(response.statusCode, 409, response.body);
    }
    const correctAfterExhaustion = await app.inject({
      method: "POST",
      url: "/api/v1/auth/registration/verify",
      headers,
      payload: {
        registrationIntentId: exhausted.registrationIntentId,
        code: exhausted.code,
      },
    });
    assert.equal(correctAfterExhaustion.statusCode, 409);
    assert.equal(
      (correctAfterExhaustion.json() as { error: { code: string } }).error.code,
      "EMAIL_CHALLENGE_INVALID",
    );
    const attempts = await database.pool.query<{ attempt_count: number; max_attempts: number }>(
      "SELECT attempt_count, max_attempts FROM email_verifications WHERE id = $1",
      [exhausted.challengeId],
    );
    assert.equal(attempts.rows[0]?.attempt_count, 5);
    assert.equal(attempts.rows[0]?.max_attempts, 5);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("A1 registration resend supersedes the prior challenge and preserves one active challenge", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const started = await startRegistration(app, database, {
      username: "resend_user",
      email: "resend-user@example.test",
      suffix: "resend",
    });
    await database.pool.query(
      "UPDATE email_verifications SET created_at = created_at - interval '2 minutes' WHERE id = $1",
      [started.challengeId],
    );
    const resend = await app.inject({
      method: "POST",
      url: "/api/v1/auth/registration/resend",
      headers,
      payload: { registrationIntentId: started.registrationIntentId },
    });
    assert.equal(resend.statusCode, 200, resend.body);

    const rows = await database.pool.query<{
      id: string;
      consumed_at: Date | null;
      superseded_at: Date | null;
    }>(
      "SELECT id, consumed_at, superseded_at FROM email_verifications " +
        "WHERE registration_intent_id = $1 ORDER BY created_at, id",
      [started.registrationIntentId],
    );
    assert.equal(rows.rowCount, 2);
    assert.ok(rows.rows.find((row) => row.id === started.challengeId)?.superseded_at);
    const active = rows.rows.filter(
      (row) => row.consumed_at === null && row.superseded_at === null,
    );
    assert.equal(active.length, 1);
    assert.notEqual(active[0]?.id, started.challengeId);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("A1 PostgreSQL rate-limit bucket serializes concurrent consumers", async () => {
  const database = requireDisposableDatabase();
  try {
    await reset(database);
    const at = new Date();
    const keyHash = Buffer.alloc(32, 5);
    const decisions = await Promise.all(
      Array.from({ length: 6 }, () =>
        withTransaction(database, (transaction) =>
          consumeRateLimitBuckets(
            transaction,
            [
              {
                scope: "a1_acceptance_contention",
                keyVersion: 1,
                keyHash,
                windowMs: 60_000,
                limit: 5,
                blockMs: 60_000,
              },
            ],
            at,
          ),
        ),
      ),
    );
    assert.equal(decisions.filter((decision) => decision.allowed).length, 5);
    assert.equal(decisions.filter((decision) => !decision.allowed).length, 1);

    const bucket = await database.pool.query<{
      attempt_count: number;
      blocked_until: Date | null;
    }>(
      "SELECT attempt_count, blocked_until FROM security_rate_limit_buckets " +
        "WHERE scope = 'a1_acceptance_contention' AND key_version = 1 AND key_hash = $1",
      [keyHash],
    );
    assert.equal(bucket.rows[0]?.attempt_count, 6);
    assert.ok(bucket.rows[0]?.blocked_until);
  } finally {
    await closeDatabasePool(database);
  }
});

test("A1 concurrent registration completion creates one account", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const started = await startRegistration(app, database, {
      username: "completion_race",
      email: "completion-race@example.test",
      suffix: "completion",
    });
    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/v1/auth/registration/verify",
        headers,
        payload: { registrationIntentId: started.registrationIntentId, code: started.code },
      }),
      app.inject({
        method: "POST",
        url: "/api/v1/auth/registration/verify",
        headers,
        payload: { registrationIntentId: started.registrationIntentId, code: started.code },
      }),
    ]);
    assert.deepEqual(
      responses.map((response) => response.statusCode).sort((a, b) => a - b),
      [200, 409],
    );
    const accounts = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM accounts WHERE username_normalized = 'completion_race'",
    );
    assert.equal(accounts.rows[0]?.count, "1");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("A1 username and verified-email ownership races fail safely", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);

    const emailFirst = await startRegistration(app, database, {
      username: "email_race_one",
      email: "shared-race@example.test",
      suffix: "email-race-one",
    });
    const emailSecond = await startRegistration(app, database, {
      username: "email_race_two",
      email: "shared-race@example.test",
      suffix: "email-race-two",
    });
    const emailResponses = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/v1/auth/registration/verify",
        headers,
        payload: {
          registrationIntentId: emailFirst.registrationIntentId,
          code: emailFirst.code,
        },
      }),
      app.inject({
        method: "POST",
        url: "/api/v1/auth/registration/verify",
        headers,
        payload: {
          registrationIntentId: emailSecond.registrationIntentId,
          code: emailSecond.code,
        },
      }),
    ]);
    assert.deepEqual(
      emailResponses.map((response) => response.statusCode).sort((a, b) => a - b),
      [200, 409],
    );
    const emailOwners = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM account_emails " +
        "WHERE email_normalized = 'shared-race@example.test' " +
        "AND is_current AND verified_at IS NOT NULL AND released_at IS NULL",
    );
    assert.equal(emailOwners.rows[0]?.count, "1");

    await reset(database);

    const usernameFirst = await startRegistration(app, database, {
      username: "shared_username",
      email: "username-race-one@example.test",
      suffix: "username-race-one",
    });
    const usernameSecond = await startRegistration(app, database, {
      username: "shared_username",
      email: "username-race-two@example.test",
      suffix: "username-race-two",
    });
    const usernameResponses = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/v1/auth/registration/verify",
        headers,
        payload: {
          registrationIntentId: usernameFirst.registrationIntentId,
          code: usernameFirst.code,
        },
      }),
      app.inject({
        method: "POST",
        url: "/api/v1/auth/registration/verify",
        headers,
        payload: {
          registrationIntentId: usernameSecond.registrationIntentId,
          code: usernameSecond.code,
        },
      }),
    ]);
    assert.deepEqual(
      usernameResponses.map((response) => response.statusCode).sort((a, b) => a - b),
      [200, 409],
    );
    const usernameOwners = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM accounts WHERE username_normalized = 'shared_username'",
    );
    assert.equal(usernameOwners.rows[0]?.count, "1");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("A1 logout, absolute expiry, idle expiry, and reauthentication rotation revoke old sessions", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const user = await register(app, database, "session_acceptance");

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers,
      payload: {
        identifier: user.username,
        password: user.password,
        deviceName: "Logout Browser",
      },
    });
    assert.equal(login.statusCode, 200, login.body);
    const logoutCookie = cookieHeader(login);
    const logout = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { ...headers, cookie: logoutCookie },
      payload: {},
    });
    assert.equal(logout.statusCode, 200, logout.body);
    const revoked = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: { cookie: logoutCookie },
    });
    assert.equal(revoked.statusCode, 401);

    const absolute = await currentSession(app, user.cookie);
    await database.pool.query(
      "UPDATE account_sessions SET " +
        "created_at = clock_timestamp() - interval '31 days', " +
        "expires_at = clock_timestamp() - interval '1 day', " +
        "idle_expires_at = clock_timestamp() + interval '1 day' " +
        "WHERE id = $1",
      [absolute.sessionId],
    );
    const absoluteExpired = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: { cookie: user.cookie },
    });
    assert.equal(absoluteExpired.statusCode, 401);

    const idleLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers,
      payload: {
        identifier: user.username,
        password: user.password,
        deviceName: "Idle Browser",
      },
    });
    assert.equal(idleLogin.statusCode, 200, idleLogin.body);
    const idleCookie = cookieHeader(idleLogin);
    const idle = await currentSession(app, idleCookie);
    await database.pool.query(
      "UPDATE account_sessions SET " +
        "created_at = clock_timestamp() - interval '8 days', " +
        "expires_at = clock_timestamp() + interval '1 day', " +
        "idle_expires_at = clock_timestamp() - interval '1 second' " +
        "WHERE id = $1",
      [idle.sessionId],
    );
    const idleExpired = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: { cookie: idleCookie },
    });
    assert.equal(idleExpired.statusCode, 401);

    const rotationLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers,
      payload: {
        identifier: user.username,
        password: user.password,
        deviceName: "Rotation Browser",
      },
    });
    assert.equal(rotationLogin.statusCode, 200, rotationLogin.body);
    const oldRotationCookie = cookieHeader(rotationLogin);
    const reauth = await app.inject({
      method: "POST",
      url: "/api/v1/auth/reauthenticate",
      headers: { ...headers, cookie: oldRotationCookie },
      payload: { password: user.password },
    });
    assert.equal(reauth.statusCode, 200, reauth.body);
    const newRotationCookie = cookieHeader(reauth);
    assert.notEqual(newRotationCookie, oldRotationCookie);

    const oldAfterRotation = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: { cookie: oldRotationCookie },
    });
    assert.equal(oldAfterRotation.statusCode, 401);
    const newAfterRotation = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: { cookie: newRotationCookie },
    });
    assert.equal(newAfterRotation.statusCode, 200, newAfterRotation.body);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("A1 session-token generation fences concurrent rotations", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const user = await register(app, database, "rotation_fence");
    const session = await currentSession(app, user.cookie);
    const ring = new AuthKeyRing(config.authKeys);
    const first = ring.activeVerifier("session-verifier", "rotation-token-one");
    const second = ring.activeVerifier("session-verifier", "rotation-token-two");
    const at = new Date();

    const results = await Promise.all([
      withTransaction(database, (transaction) =>
        rotateSessionToken(transaction, {
          sessionId: session.sessionId,
          expectedGeneration: 1n,
          verifier: first.value,
          keyVersion: first.version,
          at,
        }),
      ),
      withTransaction(database, (transaction) =>
        rotateSessionToken(transaction, {
          sessionId: session.sessionId,
          expectedGeneration: 1n,
          verifier: second.value,
          keyVersion: second.version,
          at,
        }),
      ),
    ]);
    assert.equal(results.filter((result) => result !== null).length, 1);
    assert.equal(results.filter((result) => result === null).length, 1);

    const stored = await database.pool.query<{ token_generation: string }>(
      "SELECT token_generation::text FROM account_sessions WHERE id = $1",
      [session.sessionId],
    );
    assert.equal(stored.rows[0]?.token_generation, "2");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("A1 email change requires recent reauthentication", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const user = await register(app, database, "reauth_requirement");
    const session = await currentSession(app, user.cookie);
    await database.pool.query(
      "UPDATE account_sessions SET reauthenticated_at = clock_timestamp() - interval '11 minutes' WHERE id = $1",
      [session.sessionId],
    );

    const denied = await app.inject({
      method: "POST",
      url: "/api/v1/me/email-change/start",
      headers: { ...headers, cookie: user.cookie },
      payload: { email: "reauth-required@example.test" },
    });
    assert.equal(denied.statusCode, 403);
    assert.equal((denied.json() as { error: { code: string } }).error.code, "REAUTH_REQUIRED");

    const reauth = await app.inject({
      method: "POST",
      url: "/api/v1/auth/reauthenticate",
      headers: { ...headers, cookie: user.cookie },
      payload: { password: user.password },
    });
    assert.equal(reauth.statusCode, 200, reauth.body);
    const reauthedCookie = cookieHeader(reauth);

    const allowed = await app.inject({
      method: "POST",
      url: "/api/v1/me/email-change/start",
      headers: { ...headers, cookie: reauthedCookie },
      payload: { email: "reauth-required@example.test" },
    });
    assert.equal(allowed.statusCode, 200, allowed.body);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("A1 username API enforces annual cooldown and releases the old username", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const user = await register(app, database, "username_rules");

    const changed = await app.inject({
      method: "POST",
      url: "/api/v1/me/username",
      headers: { ...headers, cookie: user.cookie },
      payload: { username: "renamed_username" },
    });
    assert.equal(changed.statusCode, 200, changed.body);

    const secondChange = await app.inject({
      method: "POST",
      url: "/api/v1/me/username",
      headers: { ...headers, cookie: user.cookie },
      payload: { username: "another_username" },
    });
    assert.equal(secondChange.statusCode, 409);
    assert.equal(
      (secondChange.json() as { error: { code: string } }).error.code,
      "USERNAME_CHANGE_NOT_ALLOWED",
    );

    const oldReleased = await app.inject({
      method: "POST",
      url: "/api/v1/auth/registration/start",
      headers,
      payload: {
        username: user.username,
        displayName: "Reused Username",
        dateOfBirth: "2000-01-01",
        email: "reused-username@example.test",
        password: "a sufficiently long reused username password",
      },
    });
    assert.equal(oldReleased.statusCode, 200, oldReleased.body);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("A1 username API is blocked during active and breakup-pending partnership occupancy", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const user = await register(app, database, "occupied_username");
    const partner = await register(app, database, "occupied_partner");
    const partnershipId = randomUUID();
    await database.pool.query(
      "INSERT INTO partnerships (" +
        "id, relationship_start_date, lifecycle_state, generation, version, activated_at, created_at, updated_at" +
        ") VALUES ($1, DATE '2026-01-01', 'active', 1, 1, clock_timestamp(), clock_timestamp(), clock_timestamp())",
      [partnershipId],
    );
    await database.pool.query(
      "INSERT INTO partnership_members (partnership_id, account_id, joined_at) " +
        "VALUES ($1,$2,clock_timestamp()), ($1,$3,clock_timestamp())",
      [partnershipId, user.accountId, partner.accountId],
    );

    const activeDenied = await app.inject({
      method: "POST",
      url: "/api/v1/me/username",
      headers: { ...headers, cookie: user.cookie },
      payload: { username: "blocked_while_active" },
    });
    assert.equal(activeDenied.statusCode, 409);
    assert.equal(
      (activeDenied.json() as { error: { code: string } }).error.code,
      "USERNAME_CHANGE_NOT_ALLOWED",
    );

    await database.pool.query(
      "UPDATE partnerships SET lifecycle_state = 'breakup_pending', updated_at = clock_timestamp() WHERE id = $1",
      [partnershipId],
    );
    const breakupDenied = await app.inject({
      method: "POST",
      url: "/api/v1/me/username",
      headers: { ...headers, cookie: user.cookie },
      payload: { username: "blocked_while_breakup" },
    });
    assert.equal(breakupDenied.statusCode, 409);
    assert.equal(
      (breakupDenied.json() as { error: { code: string } }).error.code,
      "USERNAME_CHANGE_NOT_ALLOWED",
    );
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("A1 device API lists, renames, revokes, and refuses silent revival of a revoked device", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const user = await register(app, database, "devices_acceptance");
    const firstSession = await currentSession(app, user.cookie);
    const rawDeviceHandle = cookieValue(user.cookie, "shawtie-device-dev");
    const rawHandleMatches = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM account_devices " +
        "WHERE account_id = $1 AND encode(handle_verifier, 'escape') = $2",
      [user.accountId, rawDeviceHandle],
    );
    assert.equal(rawHandleMatches.rows[0]?.count, "0");

    const secondLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers,
      payload: {
        identifier: user.username,
        password: user.password,
        deviceName: "Second Device",
      },
    });
    assert.equal(secondLogin.statusCode, 200, secondLogin.body);
    const secondCookie = cookieHeader(secondLogin);
    const secondSession = await currentSession(app, secondCookie);
    assert.notEqual(secondSession.deviceId, firstSession.deviceId);

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/me/devices",
      headers: { cookie: user.cookie },
    });
    assert.equal(list.statusCode, 200, list.body);
    const devices = (
      list.json() as {
        devices: Array<{
          id: string;
          displayName: string;
          isCurrent: boolean;
          activeSessionCount: number;
        }>;
      }
    ).devices;
    assert.equal(devices.length, 2);
    assert.equal(devices.find((device) => device.id === firstSession.deviceId)?.isCurrent, true);
    assert.equal(
      devices.find((device) => device.id === secondSession.deviceId)?.activeSessionCount,
      1,
    );

    const rename = await app.inject({
      method: "PATCH",
      url: "/api/v1/me/devices/" + secondSession.deviceId,
      headers: { ...headers, cookie: user.cookie },
      payload: { displayName: "Renamed Device" },
    });
    assert.equal(rename.statusCode, 200, rename.body);

    const revokeSecond = await app.inject({
      method: "DELETE",
      url: "/api/v1/me/devices/" + secondSession.deviceId,
      headers: {
        origin: config.appOrigin,
        "x-shawtie-csrf": "1",
        cookie: user.cookie,
      },
    });
    assert.equal(revokeSecond.statusCode, 200, revokeSecond.body);
    const secondRevoked = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: { cookie: secondCookie },
    });
    assert.equal(secondRevoked.statusCode, 401);

    const loginWithRevokedHandle = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { ...headers, cookie: secondCookie },
      payload: {
        identifier: user.username,
        password: user.password,
        deviceName: "Replacement Device",
      },
    });
    assert.equal(loginWithRevokedHandle.statusCode, 200, loginWithRevokedHandle.body);
    const replacementCookie = cookieHeader(loginWithRevokedHandle);
    const replacementSession = await currentSession(app, replacementCookie);
    assert.notEqual(replacementSession.deviceId, secondSession.deviceId);

    const renamedRow = await database.pool.query<{ display_name: string; revoked_at: Date | null }>(
      "SELECT display_name, revoked_at FROM account_devices WHERE id = $1",
      [secondSession.deviceId],
    );
    assert.equal(renamedRow.rows[0]?.display_name, "Renamed Device");
    assert.ok(renamedRow.rows[0]?.revoked_at);

    const revokeCurrent = await app.inject({
      method: "DELETE",
      url: "/api/v1/me/devices/" + firstSession.deviceId,
      headers: {
        origin: config.appOrigin,
        "x-shawtie-csrf": "1",
        cookie: user.cookie,
      },
    });
    assert.equal(revokeCurrent.statusCode, 200, revokeCurrent.body);
    const currentRevoked = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: { cookie: user.cookie },
    });
    assert.equal(currentRevoked.statusCode, 401);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("A1 account recovery rejects the exact seven-day deadline", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const user = await register(app, database, "recovery_deadline");
    const deletion = await app.inject({
      method: "POST",
      url: "/api/v1/me/account-deletion",
      headers: { ...headers, cookie: user.cookie },
      payload: {},
    });
    assert.equal(deletion.statusCode, 200, deletion.body);

    const start = await app.inject({
      method: "POST",
      url: "/api/v1/auth/account-recovery/start",
      headers,
      payload: { identifier: user.email },
    });
    assert.equal(start.statusCode, 202, start.body);
    const challenge = await latestChallenge(database, {
      accountId: user.accountId,
      purpose: "account_recovery",
    });

    await database.pool.query(
      "UPDATE account_deletion_requests SET " +
        "requested_at = transaction_timestamp() - interval '7 days', " +
        "recover_until = transaction_timestamp() " +
        "WHERE account_id = $1 AND status = 'pending'",
      [user.accountId],
    );
    const complete = await app.inject({
      method: "POST",
      url: "/api/v1/auth/account-recovery/complete",
      headers,
      payload: {
        identifier: user.email,
        code: challenge.code,
      },
    });
    assert.equal(complete.statusCode, 409);
    assert.equal((complete.json() as { error: { code: string } }).error.code, "ACCOUNT_LOCKED");
    const account = await database.pool.query<{ status: string }>(
      "SELECT status FROM accounts WHERE id = $1",
      [user.accountId],
    );
    assert.equal(account.rows[0]?.status, "deletion_pending");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("A1 concurrent fifth challenge attempt cannot exceed max attempts", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const started = await startRegistration(app, database, {
      username: "challenge_race",
      email: "challenge-race@example.test",
      suffix: "challenge-race",
    });
    await database.pool.query("UPDATE email_verifications SET attempt_count = 4 WHERE id = $1", [
      started.challengeId,
    ]);
    const wrongCode = started.code === "00000000" ? "00000001" : "00000000";
    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/v1/auth/registration/verify",
        headers,
        payload: {
          registrationIntentId: started.registrationIntentId,
          code: wrongCode,
        },
      }),
      app.inject({
        method: "POST",
        url: "/api/v1/auth/registration/verify",
        headers,
        payload: {
          registrationIntentId: started.registrationIntentId,
          code: wrongCode,
        },
      }),
    ]);
    assert.deepEqual(
      responses.map((response) => response.statusCode).sort((a, b) => a - b),
      [409, 409],
    );
    const challenge = await database.pool.query<{ attempt_count: number; max_attempts: number }>(
      "SELECT attempt_count, max_attempts FROM email_verifications WHERE id = $1",
      [started.challengeId],
    );
    assert.equal(challenge.rows[0]?.attempt_count, 5);
    assert.equal(challenge.rows[0]?.max_attempts, 5);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("A1 concurrent email changes cannot claim the same verified email", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const first = await register(app, database, "email_owner_one");
    const second = await register(app, database, "email_owner_two");
    const target = "shared-email-change@example.test";

    const firstStart = await app.inject({
      method: "POST",
      url: "/api/v1/me/email-change/start",
      headers: { ...headers, cookie: first.cookie },
      payload: { email: target },
    });
    const secondStart = await app.inject({
      method: "POST",
      url: "/api/v1/me/email-change/start",
      headers: { ...headers, cookie: second.cookie },
      payload: { email: target },
    });
    assert.equal(firstStart.statusCode, 200, firstStart.body);
    assert.equal(secondStart.statusCode, 200, secondStart.body);

    const firstChallenge = await latestChallenge(database, {
      accountId: first.accountId,
      purpose: "email_change",
    });
    const secondChallenge = await latestChallenge(database, {
      accountId: second.accountId,
      purpose: "email_change",
    });
    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/v1/me/email-change/complete",
        headers: { ...headers, cookie: first.cookie },
        payload: { code: firstChallenge.code },
      }),
      app.inject({
        method: "POST",
        url: "/api/v1/me/email-change/complete",
        headers: { ...headers, cookie: second.cookie },
        payload: { code: secondChallenge.code },
      }),
    ]);
    assert.deepEqual(
      responses.map((response) => response.statusCode).sort((a, b) => a - b),
      [200, 409],
    );

    const owners = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM account_emails " +
        "WHERE email_normalized = $1 AND is_current AND verified_at IS NOT NULL AND released_at IS NULL",
      [target],
    );
    assert.equal(owners.rows[0]?.count, "1");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("A1 failed login and recovery start keep generic response shapes", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const user = await register(app, database, "generic_auth");

    const wrongPassword = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers,
      payload: {
        identifier: user.email,
        password: "a wrong but sufficiently long password",
      },
    });
    const missingAccount = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers,
      payload: {
        identifier: "missing-account@example.test",
        password: "a wrong but sufficiently long password",
      },
    });
    assert.equal(wrongPassword.statusCode, 401);
    assert.equal(missingAccount.statusCode, 401);
    assert.deepEqual(wrongPassword.json(), missingAccount.json());

    const existingRecovery = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password-recovery/start",
      headers,
      payload: { identifier: user.email },
    });
    const missingRecovery = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password-recovery/start",
      headers,
      payload: { identifier: "missing-recovery@example.test" },
    });
    assert.equal(existingRecovery.statusCode, 202);
    assert.equal(missingRecovery.statusCode, 202);
    assert.deepEqual(existingRecovery.json(), missingRecovery.json());
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("A1 concurrent registration resend preserves one active challenge", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const started = await startRegistration(app, database, {
      username: "resend_race",
      email: "resend-race@example.test",
      suffix: "resend-race",
    });
    await database.pool.query(
      "UPDATE email_verifications SET created_at = created_at - interval '2 minutes' WHERE id = $1",
      [started.challengeId],
    );

    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/v1/auth/registration/resend",
        headers,
        payload: { registrationIntentId: started.registrationIntentId },
      }),
      app.inject({
        method: "POST",
        url: "/api/v1/auth/registration/resend",
        headers,
        payload: { registrationIntentId: started.registrationIntentId },
      }),
    ]);
    assert.deepEqual(
      responses.map((response) => response.statusCode).sort((a, b) => a - b),
      [200, 429],
    );

    const active = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM email_verifications " +
        "WHERE registration_intent_id = $1 AND consumed_at IS NULL AND superseded_at IS NULL",
      [started.registrationIntentId],
    );
    assert.equal(active.rows[0]?.count, "1");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("A1 registration start enforces the durable per-email rate limit", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const statuses: number[] = [];
    for (let index = 1; index <= 4; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/registration/start",
        headers,
        payload: {
          username: "rate_user_" + index,
          displayName: "Rate User " + index,
          dateOfBirth: "2000-01-01",
          email: "rate-limited-registration@example.test",
          password: "a sufficiently long rate limit password " + index,
        },
      });
      statuses.push(response.statusCode);
      if (index === 4) {
        assert.equal((response.json() as { error: { code: string } }).error.code, "RATE_LIMITED");
        assert.ok(Number(response.headers["retry-after"]) >= 1);
      }
    }
    assert.deepEqual(statuses, [200, 200, 200, 429]);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});
