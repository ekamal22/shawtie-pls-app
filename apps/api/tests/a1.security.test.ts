import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { AuthKeyRing } from "../src/security/auth-key-ring.ts";
import { apiConfigFromEnv, type ApiConfig } from "../src/config.ts";
import { cookieNames, setSessionCookie } from "../src/security/cookies.ts";
import { normalizeEmail, networkPrefix } from "../src/security/normalization.ts";
import { installMutationSecurity } from "../src/plugins/request-security.ts";
import { installErrorHandler } from "../src/plugins/errors.ts";

function key(byte: number): Buffer {
  return Buffer.alloc(32, byte);
}

test("A1 key ring supports active and older verifier versions", () => {
  const ring = new AuthKeyRing({
    activeVersion: 2,
    keys: new Map([
      [1, key(1)],
      [2, key(2)],
    ]),
  });
  assert.deepEqual(ring.versions, [1, 2]);
  assert.equal(ring.activeVerifier("session-verifier", "token").version, 2);
  assert.notDeepEqual(
    ring.verifier("session-verifier", "token", 1),
    ring.verifier("session-verifier", "token", 2),
  );
});

test("production config rejects insecure origin and unsafe proxy shortcuts", () => {
  const base = {
    NODE_ENV: "production",
    AUTH_HMAC_KEYS: `1:${key(1).toString("base64")}`,
    AUTH_HMAC_ACTIVE_VERSION: "1",
  };
  assert.throws(() => apiConfigFromEnv({ ...base, APP_ORIGIN: "http://example.com" }));
  assert.throws(() =>
    apiConfigFromEnv({ ...base, APP_ORIGIN: "https://example.com", TRUSTED_PROXY: "*" }),
  );
});

test("production session cookie uses __Host prefix and secure attributes", async () => {
  const config: ApiConfig = {
    environment: "production",
    appOrigin: "https://example.test",
    allowInsecureLoopbackCookies: false,
    trustedProxy: false,
    authKeys: { activeVersion: 1, keys: new Map([[1, key(1)]]) },
  };
  assert.equal(cookieNames(config).session, "__Host-shawtie-session");

  const app = Fastify();
  app.register(cookie);
  app.get("/", async (_request, reply) => {
    setSessionCookie(reply, config, "token");
    return { ok: true };
  });
  const response = await app.inject({ method: "GET", url: "/" });
  const header = String(response.headers["set-cookie"]);
  assert.match(header, /__Host-shawtie-session=token/);
  assert.match(header, /Secure/i);
  assert.match(header, /HttpOnly/i);
  assert.match(header, /SameSite=Strict/i);
  assert.match(header, /Path=\//i);
  assert.doesNotMatch(header, /Domain=/i);
  await app.close();
});

test("normalization avoids provider-specific rewriting and network key uses prefixes", () => {
  assert.deepEqual(normalizeEmail("User.Name+tag@EXAMPLE.com"), {
    display: "User.Name+tag@EXAMPLE.com",
    normalized: "user.name+tag@example.com",
  });
  assert.equal(networkPrefix("192.168.10.44"), "192.168.10.0/24");
});

test("local development session cookie uses a separate insecure loopback name", async () => {
  const config: ApiConfig = {
    environment: "test",
    appOrigin: "http://127.0.0.1:4173",
    allowInsecureLoopbackCookies: true,
    trustedProxy: false,
    authKeys: { activeVersion: 1, keys: new Map([[1, key(1)]]) },
  };
  assert.equal(cookieNames(config).session, "shawtie-session-dev");

  const app = Fastify();
  app.register(cookie);
  app.get("/", async (_request, reply) => {
    setSessionCookie(reply, config, "token");
    return { ok: true };
  });
  const response = await app.inject({ method: "GET", url: "/" });
  const header = String(response.headers["set-cookie"]);
  assert.match(header, /shawtie-session-dev=token/);
  assert.match(header, /HttpOnly/i);
  assert.match(header, /SameSite=Strict/i);
  assert.doesNotMatch(header, /;\s*Secure/i);
  await app.close();
});

test("authentication key ring fails closed for unknown key versions", () => {
  const ring = new AuthKeyRing({
    activeVersion: 1,
    keys: new Map([[1, key(1)]]),
  });
  assert.throws(
    () => ring.verifier("session-verifier", "token", 99),
    /Unknown authentication key version/,
  );
  assert.throws(
    () => ring.deriveEmailCode("challenge", "registration", Buffer.alloc(32), 99),
    /Unknown authentication key version/,
  );
});

test("mutation security rejects cross-site, wrong-origin, missing-CSRF, and non-JSON mutations", async () => {
  const config: ApiConfig = {
    environment: "test",
    appOrigin: "http://127.0.0.1:4173",
    allowInsecureLoopbackCookies: true,
    trustedProxy: false,
    authKeys: { activeVersion: 1, keys: new Map([[1, key(1)]]) },
  };
  const app = Fastify();
  installErrorHandler(app);
  installMutationSecurity(app, config);
  app.post("/mutation", async () => ({ ok: true }));
  app.get("/read-only", async () => ({ ok: true }));

  const crossSite = await app.inject({
    method: "POST",
    url: "/mutation",
    headers: {
      origin: config.appOrigin,
      "sec-fetch-site": "cross-site",
      "x-shawtie-csrf": "1",
      "content-type": "application/json",
    },
    payload: {},
  });
  assert.equal(crossSite.statusCode, 403);
  assert.equal((crossSite.json() as { error: { code: string } }).error.code, "CSRF_REJECTED");

  const wrongOrigin = await app.inject({
    method: "POST",
    url: "/mutation",
    headers: {
      origin: "http://evil.example",
      "x-shawtie-csrf": "1",
      "content-type": "application/json",
    },
    payload: {},
  });
  assert.equal(wrongOrigin.statusCode, 403);

  const missingOrigin = await app.inject({
    method: "POST",
    url: "/mutation",
    headers: {
      "x-shawtie-csrf": "1",
      "content-type": "application/json",
    },
    payload: {},
  });
  assert.equal(missingOrigin.statusCode, 403);

  const missingCsrf = await app.inject({
    method: "POST",
    url: "/mutation",
    headers: {
      origin: config.appOrigin,
      "content-type": "application/json",
    },
    payload: {},
  });
  assert.equal(missingCsrf.statusCode, 403);

  const nonJson = await app.inject({
    method: "POST",
    url: "/mutation",
    headers: {
      origin: config.appOrigin,
      "x-shawtie-csrf": "1",
      "content-type": "text/plain",
    },
    payload: "plain",
  });
  assert.equal(nonJson.statusCode, 415);

  const accepted = await app.inject({
    method: "POST",
    url: "/mutation",
    headers: {
      origin: config.appOrigin,
      "x-shawtie-csrf": "1",
      "content-type": "application/json",
    },
    payload: {},
  });
  assert.equal(accepted.statusCode, 200);

  const readOnly = await app.inject({ method: "GET", url: "/read-only" });
  assert.equal(readOnly.statusCode, 200);
  await app.close();
});

test("untrusted forwarded-for cannot choose request IP while an explicit trusted proxy can", async () => {
  const forwarded = "203.0.113.44";

  const untrusted = Fastify({ trustProxy: false });
  untrusted.get("/", async (request) => ({ ip: request.ip }));
  const untrustedResponse = await untrusted.inject({
    method: "GET",
    url: "/",
    headers: { "x-forwarded-for": forwarded },
  });
  assert.notEqual((untrustedResponse.json() as { ip: string }).ip, forwarded);
  await untrusted.close();

  const trusted = Fastify({ trustProxy: ["127.0.0.1"] });
  trusted.get("/", async (request) => ({ ip: request.ip }));
  const trustedResponse = await trusted.inject({
    method: "GET",
    url: "/",
    headers: { "x-forwarded-for": forwarded },
  });
  assert.equal((trustedResponse.json() as { ip: string }).ip, forwarded);
  await trusted.close();
});
