import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { AuthKeyRing } from "../src/security/auth-key-ring.ts";
import { apiConfigFromEnv, type ApiConfig } from "../src/config.ts";
import { cookieNames, setSessionCookie } from "../src/security/cookies.ts";
import { normalizeEmail, networkPrefix } from "../src/security/normalization.ts";

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
