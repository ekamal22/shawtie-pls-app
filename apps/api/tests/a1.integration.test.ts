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
    throw new Error("DB_TEST_CONFIRM=1 is required for disposable A1 integration tests");
  }
  return createDatabasePool({
    ...databaseConfigFromEnv(),
    applicationName: "shawtie-a1-api-test",
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

function cookieHeader(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers["set-cookie"];
  const values = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  return values.map((value) => value.split(";")[0]).join("; ");
}

async function reset(database: DatabasePool) {
  await database.pool.query("TRUNCATE TABLE accounts, registration_intents CASCADE");
  await database.pool.query("DELETE FROM security_rate_limit_buckets");
  await database.pool.query("DELETE FROM security_email_deliveries");
}

async function latestCode(
  database: DatabasePool,
  where: { registrationIntentId?: string; accountId?: string; purpose: string },
): Promise<string> {
  const result = await database.pool.query<{
    id: string;
    purpose: string;
    challenge_nonce: Buffer;
    verifier_key_version: number;
  }>(
    `SELECT id, purpose, challenge_nonce, verifier_key_version
     FROM email_verifications
     WHERE purpose = $1
       AND ($2::uuid IS NULL OR registration_intent_id = $2)
       AND ($3::uuid IS NULL OR account_id = $3)
       AND consumed_at IS NULL
       AND superseded_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [
      where.purpose,
      where.registrationIntentId ?? null,
      where.accountId ?? null,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Missing active challenge");
  return new AuthKeyRing(config.authKeys).deriveEmailCode(
    row.id,
    row.purpose,
    row.challenge_nonce,
    row.verifier_key_version,
  );
}

async function register(
  app: ReturnType<typeof createApiApplication>,
  database: DatabasePool,
  suffix: string,
) {
  const password = "very secure account password " + suffix;
  const start = await app.inject({
    method: "POST",
    url: "/api/v1/auth/registration/start",
    headers,
    payload: {
      username: "user_" + suffix,
      displayName: "User " + suffix,
      dateOfBirth: "2000-01-01",
      email: "user_" + suffix + "@example.test",
      password,
    },
  });
  assert.equal(start.statusCode, 200, start.body);
  const body = start.json() as { registrationIntentId: string };
  const code = await latestCode(database, {
    registrationIntentId: body.registrationIntentId,
    purpose: "registration",
  });
  const verify = await app.inject({
    method: "POST",
    url: "/api/v1/auth/registration/verify",
    headers,
    payload: { registrationIntentId: body.registrationIntentId, code, deviceName: "Test Browser" },
  });
  assert.equal(verify.statusCode, 200, verify.body);
  return {
    accountId: (verify.json() as { accountId: string }).accountId,
    cookie: cookieHeader(verify),
    password,
    username: "user_" + suffix,
    email: "user_" + suffix + "@example.test",
    registrationIntentId: body.registrationIntentId,
    code,
  };
}

test("A1 rejects underage registration using server time", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/registration/start",
      headers,
      payload: {
        username: "underage_user",
        displayName: "Underage",
        dateOfBirth: "2010-01-01",
        email: "underage@example.test",
        password: "a sufficiently long password",
      },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, "AGE_INELIGIBLE");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("registration consumes the challenge, scrubs intent hash, and session token is not stored raw", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const user = await register(app, database, "alpha");
    const intent = await database.pool.query<{ password_hash: string | null }>(
      "SELECT password_hash FROM registration_intents WHERE id = $1",
      [user.registrationIntentId],
    );
    assert.equal(intent.rows[0]?.password_hash, null);

    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/auth/registration/verify",
      headers,
      payload: {
        registrationIntentId: user.registrationIntentId,
        code: user.code,
      },
    });
    assert.equal(replay.statusCode, 409);

    const rawSession = user.cookie.split("=")[1] ?? "";
    const stored = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM account_sessions WHERE encode(token_verifier, 'escape') = $1",
      [rawSession],
    );
    assert.equal(stored.rows[0]?.count, "0");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("email change rotates current session, revokes other sessions, and queues old-email notice", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const user = await register(app, database, "emailchange");
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers,
      payload: { identifier: user.username, password: user.password, deviceName: "Second Browser" },
    });
    assert.equal(second.statusCode, 200, second.body);
    const secondCookie = cookieHeader(second);

    const reauth = await app.inject({
      method: "POST",
      url: "/api/v1/auth/reauthenticate",
      headers: { ...headers, cookie: user.cookie },
      payload: { password: user.password },
    });
    assert.equal(reauth.statusCode, 200, reauth.body);
    const reauthedCookie = cookieHeader(reauth);

    const start = await app.inject({
      method: "POST",
      url: "/api/v1/me/email-change/start",
      headers: { ...headers, cookie: reauthedCookie },
      payload: { email: "changed@example.test" },
    });
    assert.equal(start.statusCode, 200, start.body);

    const code = await latestCode(database, { accountId: user.accountId, purpose: "email_change" });
    const complete = await app.inject({
      method: "POST",
      url: "/api/v1/me/email-change/complete",
      headers: { ...headers, cookie: reauthedCookie },
      payload: { code },
    });
    assert.equal(complete.statusCode, 200, complete.body);

    const oldSession = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: { cookie: secondCookie },
    });
    assert.equal(oldSession.statusCode, 401);

    const notice = await database.pool.query<{ destination_email: string }>(
      `SELECT destination_email
       FROM security_email_deliveries
       WHERE template = 'email_changed_old_address'
       ORDER BY created_at DESC LIMIT 1`,
    );
    assert.equal(notice.rows[0]?.destination_email, user.email);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("password recovery revokes sessions and accepts only the new password", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const user = await register(app, database, "reset");
    const start = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password-recovery/start",
      headers,
      payload: { identifier: user.email },
    });
    assert.equal(start.statusCode, 202);
    const code = await latestCode(database, { accountId: user.accountId, purpose: "password_recovery" });
    const newPassword = "a completely different secure password";
    const complete = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password-recovery/complete",
      headers,
      payload: { identifier: user.email, code, newPassword },
    });
    assert.equal(complete.statusCode, 200, complete.body);

    const session = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: { cookie: user.cookie },
    });
    assert.equal(session.statusCode, 401);

    const oldLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers,
      payload: { identifier: user.email, password: user.password },
    });
    assert.equal(oldLogin.statusCode, 401);
    const newLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers,
      payload: { identifier: user.email, password: newPassword },
    });
    assert.equal(newLogin.statusCode, 200, newLogin.body);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("rejected underage DOB correction preserves the one-time correction", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const user = await register(app, database, "dob");
    const rejected = await app.inject({
      method: "POST",
      url: "/api/v1/me/date-of-birth-correction",
      headers: { ...headers, cookie: user.cookie },
      payload: { dateOfBirth: "2010-01-01" },
    });
    assert.equal(rejected.statusCode, 409);

    const accepted = await app.inject({
      method: "POST",
      url: "/api/v1/me/date-of-birth-correction",
      headers: { ...headers, cookie: user.cookie },
      payload: { dateOfBirth: "1999-01-01" },
    });
    assert.equal(accepted.statusCode, 200, accepted.body);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("account deletion immediately removes access and email recovery does not alter crypto material", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const user = await register(app, database, "delete");
    await database.pool.query(
      `INSERT INTO account_recovery_material (
         id, account_id, crypto_protocol_version, encrypted_material
       ) VALUES ($1,$2,'future-test',$3)`,
      ["a1000000-0000-4000-8000-000000000001", user.accountId, Buffer.from("ciphertext")],
    );

    const deletion = await app.inject({
      method: "POST",
      url: "/api/v1/me/account-deletion",
      headers: { ...headers, cookie: user.cookie },
      payload: {},
    });
    assert.equal(deletion.statusCode, 200, deletion.body);

    const session = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: { cookie: user.cookie },
    });
    assert.equal(session.statusCode, 401);

    const start = await app.inject({
      method: "POST",
      url: "/api/v1/auth/account-recovery/start",
      headers,
      payload: { identifier: user.email },
    });
    assert.equal(start.statusCode, 202);
    const code = await latestCode(database, { accountId: user.accountId, purpose: "account_recovery" });
    const complete = await app.inject({
      method: "POST",
      url: "/api/v1/auth/account-recovery/complete",
      headers,
      payload: { identifier: user.email, code },
    });
    assert.equal(complete.statusCode, 200, complete.body);

    const material = await database.pool.query<{ value: string }>(
      "SELECT encode(encrypted_material, 'escape') AS value FROM account_recovery_material WHERE account_id = $1",
      [user.accountId],
    );
    assert.equal(material.rows[0]?.value, "ciphertext");

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers,
      payload: { identifier: user.email, password: user.password },
    });
    assert.equal(login.statusCode, 200, login.body);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});
