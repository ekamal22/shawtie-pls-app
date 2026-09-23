import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relative: string): Promise<string> {
  return readFile(new URL(relative, import.meta.url), "utf8");
}

test("C1 signaling is isolated, voice-only, relay-only, and session-bound", async () => {
  const application = await source("../src/application.ts");
  const routes = await source("../src/modules/calls/routes.ts");
  const hub = await source("../src/modules/calls/signaling-hub.ts");
  const repository = await source("../../../packages/db/src/repositories/calls.ts");

  assert.equal(application.includes("C1_SIGNALING_SUBPROTOCOL"), true);
  assert.equal(application.includes("perMessageDeflate: false"), true);
  assert.equal(application.includes("M2_REALTIME_MAX_FRAME_BYTES"), true);
  assert.equal(routes.includes("CALL_SIGNAL_ORIGIN_REJECTED"), true);
  assert.equal(routes.includes("offered.length !== 1"), true);
  assert.equal(routes.includes("sessionId: auth.session.sessionId"), true);
  assert.equal(hub.includes('/^m=audio\\s/i'), true);
  assert.equal(hub.includes('media.length === 1'), true);
  assert.equal(hub.includes('candidateType !== "relay"'), true);
  assert.equal(hub.includes('token.toLowerCase() === "raddr"'), true);
  assert.equal(hub.includes('foundation.startsWith("candidate:")'), true);
  assert.equal(hub.includes("4_294_967_295n"), true);
  assert.equal(hub.includes("fromGeneration"), true);
  assert.equal(hub.includes("source.generation !== item.fromGeneration"), true);
  assert.equal(hub.includes("sessionId: session.sessionId"), true);
  assert.equal(hub.includes("const valid = await this.#revalidate(state)"), true);
  assert.equal(hub.includes("session.sessionId !== state.auth.session.sessionId"), true);
  assert.equal(hub.includes("endpoint_session_id=$4"), false);
  assert.equal(repository.includes("endpoint_session.revoked_at IS NULL"), true);
  assert.equal(repository.includes("endpoint_session.idle_expires_at"), true);
  const baseRelationalMigration = await source(
    "../../../packages/db/migrations/0005_relational_integrity.sql",
  );
  const migration = await source("../../../packages/db/migrations/0017_calling_runtime.sql");
  assert.equal(baseRelationalMigration.includes("account_devices_id_account_unique"), true);
  assert.equal(migration.includes("account_devices_id_account_unique"), false);
  assert.equal(migration.includes("account_sessions_endpoint_identity_unique"), true);
  assert.equal(
    migration.includes("FOREIGN KEY (endpoint_session_id, account_id, endpoint_device_id)"),
    true,
  );
  assert.equal(migration.includes("ON DELETE SET NULL (endpoint_session_id)"), true);
  assert.equal(migration.includes("ON DELETE SET NULL (endpoint_device_id)"), true);
});

test("C1 TURN credentials avoid raw account and call identifiers", async () => {
  const provider = await source("../src/modules/calls/turn-credential-provider.ts");
  assert.equal(provider.includes('createHash("sha256")'), true);
  assert.equal(provider.includes('input.accountId + "\\0" + input.callId'), true);
  assert.equal(provider.includes('${input.accountId}:${input.callId}'), false);
});

test("C1 durable authority never stores SDP, ICE, TURN secrets, or public raw terminal causes", async () => {
  const migration = await source("../../../packages/db/migrations/0017_calling_runtime.sql");
  const service = await source("../src/modules/calls/calling-service.ts");
  const contracts = await source("../../../packages/contracts/src/calls/http.ts");

  assert.equal(migration.includes("sdp"), false);
  assert.equal(migration.includes("ice_candidate"), false);
  assert.equal(migration.includes("turn_credential"), false);
  assert.equal(service.includes("publicCallOutcome"), true);
  assert.equal(contracts.includes("terminalReason"), false);
  assert.equal(contracts.includes("outcome"), true);
});

test("C1 account and partnership authority changes synchronously terminalize calls", async () => {
  const accounts = await source("../src/modules/accounts/account-service.ts");
  const dissolution = await source("../../worker/src/partnerships/dissolution.ts");

  assert.equal(accounts.includes("terminalizeCallsByEndpointSession"), true);
  assert.equal(accounts.includes("terminalizeCallsByEndpointDevice"), true);
  assert.equal(accounts.includes("terminalizeCurrentCallForPartnership"), true);
  assert.equal(accounts.includes("revokePushSubscriptionForDevice"), true);
  assert.equal(dissolution.includes("terminalizeCurrentCallForPartnership"), true);
  assert.equal(dissolution.includes('"partnership_terminated"'), true);
});
