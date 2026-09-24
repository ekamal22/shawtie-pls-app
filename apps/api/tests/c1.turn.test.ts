import assert from "node:assert/strict";
import test from "node:test";
import { HmacTurnCredentialProvider } from "../src/modules/calls/turn-credential-provider.ts";

const ACCOUNT = "10000000-0000-4000-8000-000000000001";
const CALL = "20000000-0000-4000-8000-000000000001";

test("C1 TURN credential subject is opaque and short-lived", async () => {
  const provider = new HmacTurnCredentialProvider(
    ["turn:127.0.0.1:3478?transport=udp"],
    "c1-turn-test-secret",
    10 * 60_000,
  );
  const now = new Date("2026-09-24T00:00:00.000Z");
  const credential = await provider.issue({
    accountId: ACCOUNT,
    callId: CALL,
    now,
  });

  assert.equal(credential.iceTransportPolicy, "relay");
  assert.equal(credential.expiresAt.toISOString(), "2026-09-24T00:10:00.000Z");
  assert.equal(credential.username.includes(ACCOUNT), false);
  assert.equal(credential.username.includes(CALL), false);
  assert.match(credential.username, /^\d+:[A-Za-z0-9_-]{32}$/);
  assert.ok(credential.credential.length > 10);
});

test("C1 TURN provider rejects non-TURN URLs and excessive credential lifetime", () => {
  assert.throws(
    () => new HmacTurnCredentialProvider(["https://relay.example.test"], "secret", 60_000),
    /TURN_PROVIDER_URLS_INVALID/,
  );
  assert.throws(
    () => new HmacTurnCredentialProvider(["turn:relay.example.test"], "secret", 16 * 60_000),
    /TURN_PROVIDER_TTL_INVALID/,
  );
});
