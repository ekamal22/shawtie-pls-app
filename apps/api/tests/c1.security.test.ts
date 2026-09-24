import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  validateCallDescription,
  validateCallRelayCandidate,
} from "../src/modules/calls/signaling-validation.ts";

async function source(relative: string): Promise<string> {
  return readFile(new URL(relative, import.meta.url), "utf8");
}

test("C1 signaling is isolated, voice-only, relay-only, and session-bound", async () => {
  const application = await source("../src/application.ts");
  const routes = await source("../src/modules/calls/routes.ts");
  const hub = await source("../src/modules/calls/signaling-hub.ts");
  const validation = await source("../src/modules/calls/signaling-validation.ts");
  const repository = await source("../../../packages/db/src/repositories/calls.ts");

  assert.equal(application.includes("C1_SIGNALING_SUBPROTOCOL"), true);
  assert.equal(application.includes("perMessageDeflate: false"), true);
  assert.equal(application.includes("M2_REALTIME_MAX_FRAME_BYTES"), true);
  assert.equal(routes.includes("CALL_SIGNAL_ORIGIN_REJECTED"), true);
  assert.equal(routes.includes("offered.length !== 1"), true);
  assert.equal(routes.includes("sessionId: auth.session.sessionId"), true);
  assert.equal(routes.includes("getCurrentPartnershipForAccount"), true);
  assert.equal(routes.includes("scope: `c1.${scope}.partnership`"), true);
  assert.equal(validation.includes("/^m=audio\\s/i"), true);
  assert.equal(validation.includes("media.length === 1"), true);
  assert.equal(validation.includes('candidateType !== "relay"'), true);
  assert.equal(validation.includes("extensions.length % 2 !== 0"), true);
  assert.equal(validation.includes('transport === "tcp" && !sawTcpType'), true);
  assert.equal(validation.includes('name === "raddr"'), true);
  assert.equal(validation.includes("/^candidate:[A-Za-z0-9+/_-]{1,64}$/"), true);
  assert.equal(validation.includes("4_294_967_295n"), true);
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
  assert.equal(baseRelationalMigration.includes("call_sessions_id_partnership_unique"), true);
  assert.equal(migration.includes("call_sessions_id_partnership_unique"), false);
  assert.equal(baseRelationalMigration.includes("ADD COLUMN partnership_id uuid"), true);
  assert.equal(migration.includes("ADD COLUMN partnership_id uuid"), false);
  assert.equal(baseRelationalMigration.includes("call_participants_member_fk"), true);
  assert.equal(migration.includes("call_participants_member_fk"), false);
  assert.equal(baseRelationalMigration.includes("call_events_session_partnership_fk"), true);
  assert.equal(migration.includes("call_events_partnership_fk"), false);
  assert.equal(migration.includes("account_sessions_endpoint_identity_unique"), true);
  assert.equal(
    migration.includes("FOREIGN KEY (endpoint_session_id, account_id, endpoint_device_id)"),
    true,
  );
  assert.equal(migration.includes("ON DELETE SET NULL (endpoint_session_id)"), true);
  assert.equal(migration.includes("ON DELETE SET NULL (endpoint_device_id)"), true);
  assert.equal(migration.includes("WHEN 'ringing' THEN 'failed'"), true);
  assert.equal(migration.includes("WHEN 'accepted' THEN 'failed'"), true);
  assert.equal(migration.includes("status = 'ended'"), true);
});

test("C1 SDP and ICE validators enforce voice-only candidate-free relay signaling", () => {
  assert.equal(
    validateCallDescription(
      "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\n",
    ),
    true,
  );
  assert.equal(validateCallDescription("v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n"), false);
  assert.equal(
    validateCallDescription(
      "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nm=application 9 DTLS/SCTP 5000\r\n",
    ),
    false,
  );
  assert.equal(
    validateCallDescription(
      "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=candidate:relay 1 udp 1 203.0.113.5 50000 typ relay\r\n",
    ),
    false,
  );

  const relay =
    "candidate:relay 1 udp 1677734910 203.0.113.5 50000 typ relay raddr 0.0.0.0 rport 0";
  assert.equal(validateCallRelayCandidate(relay), true);
  assert.equal(validateCallRelayCandidate(relay.replace("typ relay", "typ host")), false);
  assert.equal(validateCallRelayCandidate(relay.replace("1677734910", "not-a-number")), false);
  assert.equal(
    validateCallRelayCandidate(relay.replace("raddr 0.0.0.0", "raddr 192.168.1.5")),
    false,
  );
  assert.equal(
    validateCallRelayCandidate(
      "candidate:relay 1 tcp 1677734910 203.0.113.5 443 typ relay tcptype passive",
    ),
    true,
  );
  assert.equal(
    validateCallRelayCandidate("candidate:relay 1 tcp 1677734910 203.0.113.5 443 typ relay"),
    false,
  );
});

test("C1 TURN credentials avoid raw account and call identifiers", async () => {
  const provider = await source("../src/modules/calls/turn-credential-provider.ts");
  assert.equal(provider.includes('createHash("sha256")'), true);
  assert.equal(provider.includes('input.accountId + "\\0" + input.callId'), true);
  assert.equal(provider.includes("${input.accountId}:${input.callId}"), false);
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
  const callingService = await source("../src/modules/calls/calling-service.ts");
  assert.equal(callingService.includes('"push-endpoint-fingerprint"'), true);
  assert.equal(callingService.includes("endpointFingerprint.value"), true);
  assert.equal(callingService.includes("endpointKeyVersion: endpointFingerprint.version"), true);
  assert.equal(dissolution.includes("terminalizeCurrentCallForPartnership"), true);
  assert.equal(dissolution.includes('"partnership_terminated"'), true);
});

test("C1 integrated closure requires real M3 coverage and valid database invariants", async () => {
  const closure = await source("../../../scripts/ci/test-c1-closure.mjs");
  const invariants = await source("../../../packages/db/tests/invariants.sql");

  assert.equal(
    closure.includes("C1 integrated closure forbids SHAWTIE_MIGRATION_RESERVATIONS"),
    true,
  );
  const m3Step = closure.indexOf('step("m3-local"');
  const c1Step = closure.indexOf('step("c1-local"');
  assert.equal(m3Step >= 0, true);
  assert.equal(c1Step > m3Step, true);
  assert.doesNotMatch(invariants, /DO \$(?:\r?\n)/);
  assert.doesNotMatch(invariants, /^\$;$/m);
});
