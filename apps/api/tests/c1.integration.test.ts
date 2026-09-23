import assert from "node:assert/strict";
import test from "node:test";
import type { RawData, WebSocket } from "ws";
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
    throw new Error("DB_TEST_CONFIRM=1 is required for disposable C1 integration tests");
  }
  return createDatabasePool({
    ...databaseConfigFromEnv(),
    applicationName: "shawtie-c1-api-test",
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
  calling: {
    enabled: true,
    transportEnabled: true,
    ringTimeoutMs: 60_000,
    connectTimeoutMs: 120_000,
    hardTimeoutMs: 60 * 60_000,
    turnUrls: ["turn:127.0.0.1:3478?transport=udp"],
    turnSharedSecret: "c1-test-turn-secret",
    turnCredentialTtlMs: 10 * 60_000,
    pushVapidPublicKey: null,
  },
};

type App = ReturnType<typeof createApiApplication>;

interface TestAccount {
  readonly accountId: string;
  readonly cookie: string;
  readonly username: string;
  readonly password: string;
}

interface CallProjection {
  readonly id: string;
  readonly partnershipId: string;
  readonly direction: "incoming" | "outgoing";
  readonly state: "ringing" | "accepted" | "connected" | "ended";
  readonly version: number;
  readonly outcome: string | null;
  readonly isThisDeviceSelectedEndpoint: boolean;
}

function jsonHeaders(cookie?: string, key?: string): Record<string, string> {
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
     WHERE registration_intent_id=$1
       AND purpose='registration'
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
  const username = "c1_" + suffix;
  const password = "very secure C1 password " + suffix;
  const start = await app.inject({
    method: "POST",
    url: "/api/v1/auth/registration/start",
    headers: jsonHeaders(),
    payload: {
      username,
      displayName: "C1 " + suffix,
      dateOfBirth: "2000-01-01",
      email: username + "@example.test",
      password,
    },
  });
  assert.equal(start.statusCode, 200, start.body);
  const registrationIntentId = (
    start.json() as { registrationIntentId: string }
  ).registrationIntentId;
  const code = await latestRegistrationCode(database, registrationIntentId);
  const verify = await app.inject({
    method: "POST",
    url: "/api/v1/auth/registration/verify",
    headers: jsonHeaders(),
    payload: {
      registrationIntentId,
      code,
      deviceName: "C1 Browser " + suffix,
    },
  });
  assert.equal(verify.statusCode, 200, verify.body);
  return {
    accountId: (verify.json() as { accountId: string }).accountId,
    cookie: cookieHeader(verify),
    username,
    password,
  };
}

async function login(app: App, account: TestAccount, deviceName: string): Promise<TestAccount> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: jsonHeaders(),
    payload: {
      identifier: account.username,
      password: account.password,
      deviceName,
    },
  });
  assert.equal(response.statusCode, 200, response.body);
  return { ...account, cookie: cookieHeader(response) };
}

async function formPartnership(
  app: App,
  sender: TestAccount,
  recipient: TestAccount,
  suffix: string,
): Promise<string> {
  const request = await app.inject({
    method: "POST",
    url: "/api/v1/partner-requests",
    headers: jsonHeaders(sender.cookie, "c1-request-" + suffix + "-0001"),
    payload: {
      recipientAccountId: recipient.accountId,
      expectedUsername: recipient.username,
      relationshipStartDate: "2020-01-01",
    },
  });
  assert.equal(request.statusCode, 201, request.body);
  const requestId = (request.json() as { requestId: string }).requestId;
  const accepted = await app.inject({
    method: "POST",
    url: "/api/v1/partner-requests/" + requestId + "/accept",
    headers: mutationHeaders(recipient.cookie),
  });
  assert.equal(accepted.statusCode, 200, accepted.body);
  return (accepted.json() as { partnershipId: string }).partnershipId;
}

async function createVoiceCall(
  app: App,
  caller: TestAccount,
  partnershipId: string,
  key: string,
): Promise<CallProjection> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/calls",
    headers: jsonHeaders(caller.cookie, key),
    payload: { expectedPartnershipId: partnershipId, kind: "voice" },
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json() as CallProjection;
}

function action(
  app: App,
  account: TestAccount,
  callId: string,
  name: "accept" | "reject" | "cancel" | "end",
  version: number,
  key: string,
) {
  return app.inject({
    method: "POST",
    url: "/api/v1/calls/" + callId + "/" + name,
    headers: jsonHeaders(account.cookie, key),
    payload: { expectedVersion: version },
  });
}

function waitForFrame(
  socket: WebSocket,
  type: string,
  timeoutMs = 5_000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("Timed out waiting for C1 signaling frame " + type));
    }, timeoutMs);

    function onMessage(data: RawData) {
      let frame: unknown;
      try {
        frame = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (
        frame !== null
        && typeof frame === "object"
        && "type" in frame
        && frame.type === type
      ) {
        clearTimeout(timeout);
        socket.off("message", onMessage);
        resolve(frame as Record<string, unknown>);
      }
    }

    socket.on("message", onMessage);
  });
}

function waitForClose(
  socket: WebSocket,
  timeoutMs = 5_000,
): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    if (socket.readyState === 3) {
      resolve({ code: 1006, reason: "already closed" });
      return;
    }
    const timeout = setTimeout(() => {
      socket.off("close", onClose);
      reject(new Error("Timed out waiting for C1 signaling close"));
    }, timeoutMs);
    function onClose(code: number, reason: Buffer) {
      clearTimeout(timeout);
      resolve({ code, reason: reason.toString("utf8") });
    }
    socket.once("close", onClose);
  });
}


test("C1 simultaneous initiation creates exactly one non-terminal call", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "init_alice");
    const bob = await register(app, database, "init_bob");
    const partnershipId = await formPartnership(app, alice, bob, "init");

    const [aliceCreate, bobCreate] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/v1/calls",
        headers: jsonHeaders(alice.cookie, "c1-init-alice-0001"),
        payload: { expectedPartnershipId: partnershipId, kind: "voice" },
      }),
      app.inject({
        method: "POST",
        url: "/api/v1/calls",
        headers: jsonHeaders(bob.cookie, "c1-init-bob-0001"),
        payload: { expectedPartnershipId: partnershipId, kind: "voice" },
      }),
    ]);

    const responses = [aliceCreate, bobCreate];
    assert.equal(responses.filter((response) => response.statusCode === 201).length, 1);
    assert.equal(responses.filter((response) => response.statusCode === 409).length, 1);
    const loser = responses.find((response) => response.statusCode === 409);
    assert.ok(loser);
    assert.equal(
      (loser.json() as { error: { code: string } }).error.code,
      "CALL_IN_PROGRESS",
    );

    const count = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM call_sessions WHERE partnership_id=$1 AND status <> 'ended'",
      [partnershipId],
    );
    assert.equal(count.rows[0]?.count, "1");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("C1 first-accept-wins, selected signaling, endpoint convergence, TURN, and history", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "race_alice");
    const bob = await register(app, database, "race_bob");
    const bobSecond = await login(app, bob, "C1 Bob second device");
    const partnershipId = await formPartnership(app, alice, bob, "race");

    const created = await createVoiceCall(
      app,
      alice,
      partnershipId,
      "c1-create-race-0001",
    );
    assert.equal(created.state, "ringing");
    assert.equal(created.version, 1);
    assert.equal(created.direction, "outgoing");
    assert.equal(created.isThisDeviceSelectedEndpoint, true);

    const replay = await createVoiceCall(
      app,
      alice,
      partnershipId,
      "c1-create-race-0001",
    );
    assert.equal(replay.id, created.id);
    assert.equal(replay.version, 1);

    const incoming = await app.inject({
      method: "GET",
      url: "/api/v1/calls/current",
      headers: { cookie: bob.cookie },
    });
    assert.equal(incoming.statusCode, 200, incoming.body);
    assert.equal(
      (incoming.json() as { call: CallProjection }).call.direction,
      "incoming",
    );

    const [first, second] = await Promise.all([
      action(app, bob, created.id, "accept", 1, "c1-accept-first-0001"),
      action(app, bobSecond, created.id, "accept", 1, "c1-accept-second-0001"),
    ]);
    const responses = [
      { response: first, account: bob },
      { response: second, account: bobSecond },
    ];
    const winner = responses.find((item) => item.response.statusCode === 200);
    const loser = responses.find((item) => item.response.statusCode === 409);
    assert.ok(winner, first.body + "\n" + second.body);
    assert.ok(loser, first.body + "\n" + second.body);
    assert.equal(
      (loser.response.json() as { error: { code: string } }).error.code,
      "CALL_ANSWERED_ELSEWHERE",
    );
    const accepted = winner.response.json() as CallProjection;
    assert.equal(accepted.state, "accepted");
    assert.equal(accepted.version, 2);
    assert.equal(accepted.isThisDeviceSelectedEndpoint, true);

    const turnWinner = await app.inject({
      method: "POST",
      url: "/api/v1/calls/" + created.id + "/turn-credentials",
      headers: mutationHeaders(winner.account.cookie),
    });
    assert.equal(turnWinner.statusCode, 200, turnWinner.body);
    assert.equal(turnWinner.json().iceTransportPolicy, "relay");

    const turnLoser = await app.inject({
      method: "POST",
      url: "/api/v1/calls/" + created.id + "/turn-credentials",
      headers: mutationHeaders(loser.account.cookie),
    });
    assert.equal(turnLoser.statusCode, 404, turnLoser.body);

    const callerSignal = await app.injectWS(
      "/api/v1/calls/" + created.id + "/signal",
      {
        headers: {
          origin: config.appOrigin,
          cookie: alice.cookie,
          "sec-websocket-protocol": "shawtie.call.v1",
        },
      },
    );
    const calleeSignal = await app.injectWS(
      "/api/v1/calls/" + created.id + "/signal",
      {
        headers: {
          origin: config.appOrigin,
          cookie: winner.account.cookie,
          "sec-websocket-protocol": "shawtie.call.v1",
        },
      },
    );
    try {
      const callerReady = await waitForFrame(callerSignal, "control.ready");
      const calleeReady = await waitForFrame(calleeSignal, "control.ready");
      assert.equal(
        (callerReady.payload as { polite: boolean }).polite,
        false,
      );
      assert.equal(
        (calleeReady.payload as { polite: boolean }).polite,
        true,
      );
      const peerDescription = waitForFrame(calleeSignal, "signal.description");
      callerSignal.send(
        JSON.stringify({
          v: 1,
          type: "signal.description",
          generation: callerReady.generation,
          payload: {
            descriptionType: "offer",
            sdp: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n",
          },
        }),
      );
      const forwarded = await peerDescription;
      assert.equal(forwarded.generation, calleeReady.generation);
      assert.equal(
        (forwarded.payload as { descriptionType: string }).descriptionType,
        "offer",
      );
    } finally {
      callerSignal.terminate();
      calleeSignal.terminate();
    }

    const callerConnected = await app.inject({
      method: "POST",
      url: "/api/v1/calls/" + created.id + "/endpoint-connected",
      headers: jsonHeaders(alice.cookie, "c1-connected-caller-0001"),
      payload: {},
    });
    assert.equal(callerConnected.statusCode, 200, callerConnected.body);
    assert.equal((callerConnected.json() as CallProjection).state, "accepted");
    assert.equal((callerConnected.json() as CallProjection).version, 2);

    const calleeConnected = await app.inject({
      method: "POST",
      url: "/api/v1/calls/" + created.id + "/endpoint-connected",
      headers: jsonHeaders(winner.account.cookie, "c1-connected-callee-0001"),
      payload: {},
    });
    assert.equal(calleeConnected.statusCode, 200, calleeConnected.body);
    assert.equal((calleeConnected.json() as CallProjection).state, "connected");
    assert.equal((calleeConnected.json() as CallProjection).version, 3);

    const ended = await action(
      app,
      winner.account,
      created.id,
      "end",
      3,
      "c1-end-race-0001",
    );
    assert.equal(ended.statusCode, 200, ended.body);
    const endedCall = ended.json() as CallProjection;
    assert.equal(endedCall.state, "ended");
    assert.equal(endedCall.outcome, "completed");
    assert.equal(endedCall.version, 4);

    const detail = await app.inject({
      method: "GET",
      url: "/api/v1/calls/" + created.id,
      headers: { cookie: alice.cookie },
    });
    assert.equal(detail.statusCode, 200, detail.body);
    assert.equal((detail.json() as CallProjection).outcome, "completed");

    const history = await app.inject({
      method: "GET",
      url: "/api/v1/calls?limit=20",
      headers: { cookie: alice.cookie },
    });
    assert.equal(history.statusCode, 200, history.body);
    const items = history.json().items as Array<{ id: string; outcome: string | null }>;
    assert.equal(items[0]?.id, created.id);
    assert.equal(items[0]?.outcome, "completed");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("C1 signaling fails closed for hostile frames and non-voice media", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "signal_alice");
    const bob = await register(app, database, "signal_bob");
    const partnershipId = await formPartnership(app, alice, bob, "signal");
    const created = await createVoiceCall(
      app,
      alice,
      partnershipId,
      "c1-create-signal-0001",
    );
    const accepted = await action(
      app,
      bob,
      created.id,
      "accept",
      created.version,
      "c1-accept-signal-0001",
    );
    assert.equal(accepted.statusCode, 200, accepted.body);

    async function callerSocket(): Promise<{ socket: WebSocket; generation: number }> {
      const socket = await app.injectWS(
        "/api/v1/calls/" + created.id + "/signal",
        {
          headers: {
            origin: config.appOrigin,
            cookie: alice.cookie,
            "sec-websocket-protocol": "shawtie.call.v1",
          },
        },
      );
      const ready = await waitForFrame(socket, "control.ready");
      assert.equal((ready.payload as { polite: boolean }).polite, false);
      return { socket, generation: ready.generation as number };
    }

    {
      const { socket } = await callerSocket();
      const closed = waitForClose(socket);
      socket.send(Buffer.from("binary is forbidden", "utf8"));
      assert.equal((await closed).code, 1003);
    }

    {
      const { socket } = await callerSocket();
      const closed = waitForClose(socket);
      socket.send("x".repeat(64 * 1024 + 1));
      assert.equal((await closed).code, 1009);
    }

    {
      const { socket, generation } = await callerSocket();
      const closed = waitForClose(socket);
      socket.send(
        JSON.stringify({
          v: 1,
          type: "signal.unknown",
          generation,
          payload: {},
        }),
      );
      assert.equal((await closed).code, 1008);
    }

    for (const sdp of [
      "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n",
      "v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n",
      "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n",
      "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=candidate:1 1 udp 1 192.0.2.1 5000 typ host\r\n",
    ]) {
      const { socket, generation } = await callerSocket();
      const closed = waitForClose(socket);
      socket.send(
        JSON.stringify({
          v: 1,
          type: "signal.description",
          generation,
          payload: { descriptionType: "offer", sdp },
        }),
      );
      assert.equal((await closed).code, 1008);
    }

    for (const candidate of [
      "candidate:1 1 udp 2122260223 192.168.1.10 54321 typ host",
      "candidate:2 1 udp 1686052607 203.0.113.10 3478 typ srflx",
      "candidate:3 1 udp 1677730815 198.51.100.10 40000 typ prflx",
      "candidate:4 1 udp 1677729535 203.0.113.20 50000 typ relay raddr 192.168.1.10 rport 54321",
      "not-a-candidate",
    ]) {
      const { socket, generation } = await callerSocket();
      const closed = waitForClose(socket);
      socket.send(
        JSON.stringify({
          v: 1,
          type: "signal.ice_candidate",
          generation,
          payload: { candidate },
        }),
      );
      assert.equal((await closed).code, 1008);
    }
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("C1 logout terminalizes a selected session and removes future call authority", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "logout_alice");
    const bob = await register(app, database, "logout_bob");
    const partnershipId = await formPartnership(app, alice, bob, "logout");
    const created = await createVoiceCall(
      app,
      alice,
      partnershipId,
      "c1-create-logout-0001",
    );
    const acceptedResponse = await action(
      app,
      bob,
      created.id,
      "accept",
      1,
      "c1-accept-logout-0001",
    );
    assert.equal(acceptedResponse.statusCode, 200, acceptedResponse.body);

    const logout = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: mutationHeaders(bob.cookie),
    });
    assert.equal(logout.statusCode, 200, logout.body);

    const detail = await app.inject({
      method: "GET",
      url: "/api/v1/calls/" + created.id,
      headers: { cookie: alice.cookie },
    });
    assert.equal(detail.statusCode, 200, detail.body);
    const ended = detail.json() as CallProjection;
    assert.equal(ended.state, "ended");
    assert.equal(ended.outcome, "unavailable");

    const turn = await app.inject({
      method: "POST",
      url: "/api/v1/calls/" + created.id + "/turn-credentials",
      headers: mutationHeaders(alice.cookie),
    });
    assert.equal(turn.statusCode, 404, turn.body);
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("C1 account-deletion start terminalizes the partnership call before view-only state", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "delete_alice");
    const bob = await register(app, database, "delete_bob");
    const partnershipId = await formPartnership(app, alice, bob, "delete");
    const created = await createVoiceCall(
      app,
      alice,
      partnershipId,
      "c1-create-delete-0001",
    );
    const accepted = await action(
      app,
      bob,
      created.id,
      "accept",
      1,
      "c1-accept-delete-0001",
    );
    assert.equal(accepted.statusCode, 200, accepted.body);

    const reauthenticated = await app.inject({
      method: "POST",
      url: "/api/v1/auth/reauthenticate",
      headers: jsonHeaders(bob.cookie),
      payload: { password: bob.password },
    });
    assert.equal(reauthenticated.statusCode, 200, reauthenticated.body);
    const reauthCookie = cookieHeader(reauthenticated);

    const deletion = await app.inject({
      method: "POST",
      url: "/api/v1/me/account-deletion",
      headers: mutationHeaders(reauthCookie),
    });
    assert.equal(deletion.statusCode, 200, deletion.body);

    const detail = await app.inject({
      method: "GET",
      url: "/api/v1/calls/" + created.id,
      headers: { cookie: alice.cookie },
    });
    assert.equal(detail.statusCode, 200, detail.body);
    const ended = detail.json() as CallProjection;
    assert.equal(ended.state, "ended");
    assert.equal(ended.outcome, "unavailable");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});
