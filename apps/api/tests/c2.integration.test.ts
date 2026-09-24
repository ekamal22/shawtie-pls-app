import assert from "node:assert/strict";
import test from "node:test";
import type { RawData, WebSocket } from "ws";
import { C2_VIDEO_MEDIA_PROFILE } from "@shawtie/contracts";
import {
  closeDatabasePool,
  createDatabasePool,
  databaseConfigFromEnv,
  type DatabasePool,
} from "@shawtie/db";
import { createApiApplication } from "../src/application.ts";
import type { ApiConfig } from "../src/config.ts";
import { AuthKeyRing } from "../src/security/auth-key-ring.ts";

function requireDisposableDatabase(): DatabasePool {
  if (process.env.DB_TEST_CONFIRM !== "1") {
    throw new Error("DB_TEST_CONFIRM=1 is required for disposable C2 integration tests");
  }
  return createDatabasePool({
    ...databaseConfigFromEnv(),
    applicationName: "shawtie-c2-api-test",
    maxConnections: 16,
  });
}

const rootKey = Buffer.alloc(32, 8);
const config: ApiConfig = {
  environment: "test",
  appOrigin: "http://127.0.0.1:4175",
  allowInsecureLoopbackCookies: true,
  trustedProxy: false,
  authKeys: { activeVersion: 1, keys: new Map([[1, rootKey]]) },
  partnerRequestMode: "paired",
  calling: {
    enabled: true,
    transportEnabled: true,
    videoEnabled: true,
    ringTimeoutMs: 60_000,
    connectTimeoutMs: 120_000,
    hardTimeoutMs: 60 * 60_000,
    turnUrls: ["turn:127.0.0.1:3478?transport=udp"],
    turnSharedSecret: "c2-test-turn-secret",
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
  readonly kind: "voice" | "video";
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
  if (!row) throw new Error("Missing C2 registration challenge");
  return new AuthKeyRing(config.authKeys).deriveEmailCode(
    row.id,
    row.purpose,
    row.challenge_nonce,
    row.verifier_key_version,
  );
}

async function register(app: App, database: DatabasePool, suffix: string): Promise<TestAccount> {
  const username = "c2_" + suffix;
  const password = "very secure C2 password " + suffix;
  const start = await app.inject({
    method: "POST",
    url: "/api/v1/auth/registration/start",
    headers: jsonHeaders(),
    payload: {
      username,
      displayName: "C2 " + suffix,
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
    payload: {
      registrationIntentId,
      code,
      deviceName: "C2 Browser " + suffix,
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

async function formPartnership(
  app: App,
  sender: TestAccount,
  recipient: TestAccount,
  suffix: string,
): Promise<string> {
  const request = await app.inject({
    method: "POST",
    url: "/api/v1/partner-requests",
    headers: jsonHeaders(sender.cookie, "c2-request-" + suffix + "-0001"),
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

function waitForFrame(
  socket: WebSocket,
  type: string,
  timeoutMs = 5_000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("Timed out waiting for C2 signaling frame " + type));
    }, timeoutMs);

    function onMessage(data: RawData) {
      let frame: unknown;
      try {
        frame = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (frame !== null && typeof frame === "object" && "type" in frame && frame.type === type) {
        clearTimeout(timeout);
        socket.off("message", onMessage);
        resolve(frame as Record<string, unknown>);
      }
    }

    socket.on("message", onMessage);
  });
}

async function openVideoSignaling(
  app: App,
  callId: string,
  account: TestAccount,
): Promise<{ socket: WebSocket; ready: Record<string, unknown> }> {
  let readyPromise: Promise<Record<string, unknown>> | undefined;
  const socket = await app.injectWS(
    "/api/v1/calls/" + callId + "/signal",
    {
      headers: {
        origin: config.appOrigin,
        cookie: account.cookie,
        "sec-websocket-protocol": "shawtie.call.v2",
      },
    },
    {
      onInit(candidate) {
        readyPromise = waitForFrame(candidate, "control.ready");
      },
    },
  );
  if (!readyPromise) throw new Error("C2 signaling listener was not initialized");
  return { socket, ready: await readyPromise };
}

test("C2 video admission, stale-client fencing, v2 signaling and relay ICE work end to end", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "alice");
    const bob = await register(app, database, "bob");
    const partnershipId = await formPartnership(app, alice, bob, "video");

    const missingProfile = await app.inject({
      method: "POST",
      url: "/api/v1/calls",
      headers: jsonHeaders(alice.cookie, "c2-create-missing-profile-0001"),
      payload: { expectedPartnershipId: partnershipId, kind: "video" },
    });
    assert.equal(missingProfile.statusCode, 409, missingProfile.body);
    assert.equal(
      (missingProfile.json() as { error: { code: string } }).error.code,
      "CALL_MEDIA_PROFILE_UNSUPPORTED",
    );

    const createdResponse = await app.inject({
      method: "POST",
      url: "/api/v1/calls",
      headers: jsonHeaders(alice.cookie, "c2-create-video-0001"),
      payload: {
        expectedPartnershipId: partnershipId,
        kind: "video",
        clientMediaProfile: C2_VIDEO_MEDIA_PROFILE,
      },
    });
    assert.equal(createdResponse.statusCode, 201, createdResponse.body);
    const created = createdResponse.json() as CallProjection;
    assert.equal(created.kind, "video");
    assert.equal(created.state, "ringing");

    const stored = await database.pool.query<{ call_type: string }>(
      "SELECT call_type FROM call_sessions WHERE id=$1",
      [created.id],
    );
    assert.equal(stored.rows[0]?.call_type, "video");

    const staleAccept = await app.inject({
      method: "POST",
      url: "/api/v1/calls/" + created.id + "/accept",
      headers: jsonHeaders(bob.cookie, "c2-accept-stale-0001"),
      payload: { expectedVersion: created.version },
    });
    assert.equal(staleAccept.statusCode, 409, staleAccept.body);
    assert.equal(
      (staleAccept.json() as { error: { code: string } }).error.code,
      "CALL_MEDIA_PROFILE_UNSUPPORTED",
    );

    const acceptedResponse = await app.inject({
      method: "POST",
      url: "/api/v1/calls/" + created.id + "/accept",
      headers: jsonHeaders(bob.cookie, "c2-accept-video-0001"),
      payload: {
        expectedVersion: created.version,
        clientMediaProfile: C2_VIDEO_MEDIA_PROFILE,
      },
    });
    assert.equal(acceptedResponse.statusCode, 200, acceptedResponse.body);
    const accepted = acceptedResponse.json() as CallProjection;
    assert.equal(accepted.kind, "video");
    assert.equal(accepted.state, "accepted");

    const callerConnection = await openVideoSignaling(app, created.id, alice);
    const calleeConnection = await openVideoSignaling(app, created.id, bob);
    try {
      const offerForwarded = waitForFrame(calleeConnection.socket, "signal.description");
      callerConnection.socket.send(
        JSON.stringify({
          v: 2,
          type: "signal.description",
          generation: callerConnection.ready.generation,
          payload: {
            descriptionType: "offer",
            sdp:
              "v=0\r\n"
              + "m=audio 9 UDP/TLS/RTP/SAVPF 111\r\n"
              + "m=video 9 UDP/TLS/RTP/SAVPF 96\r\n",
          },
        }),
      );
      const offer = await offerForwarded;
      assert.equal(offer.generation, calleeConnection.ready.generation);

      const candidateForwarded = waitForFrame(calleeConnection.socket, "signal.ice_candidate");
      callerConnection.socket.send(
        JSON.stringify({
          v: 2,
          type: "signal.ice_candidate",
          generation: callerConnection.ready.generation,
          payload: {
            candidate:
              "candidate:relay 1 udp 1677734910 203.0.113.5 50000 typ relay raddr 0.0.0.0 rport 0",
            sdpMid: "1",
            sdpMLineIndex: 1,
          },
        }),
      );
      const candidate = await candidateForwarded;
      const payload = candidate.payload as {
        candidate: string;
        sdpMid: string | null;
        sdpMLineIndex: number | null;
      };
      assert.equal(payload.sdpMid, "1");
      assert.equal(payload.sdpMLineIndex, 1);

      const endForwarded = waitForFrame(calleeConnection.socket, "signal.end_of_candidates");
      callerConnection.socket.send(
        JSON.stringify({
          v: 2,
          type: "signal.end_of_candidates",
          generation: callerConnection.ready.generation,
          payload: {},
        }),
      );
      await endForwarded;
    } finally {
      callerConnection.socket.terminate();
      calleeConnection.socket.terminate();
    }

    const turn = await app.inject({
      method: "POST",
      url: "/api/v1/calls/" + created.id + "/turn-credentials",
      headers: mutationHeaders(alice.cookie),
    });
    assert.equal(turn.statusCode, 200, turn.body);
    assert.equal(turn.json().iceTransportPolicy, "relay");
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});

test("C2 video admission flag blocks ringing acceptance without affecting voice configuration", async () => {
  const database = requireDisposableDatabase();
  const app = createApiApplication({ database, config });
  try {
    await reset(database);
    const alice = await register(app, database, "flag_alice");
    const bob = await register(app, database, "flag_bob");
    const partnershipId = await formPartnership(app, alice, bob, "flag");

    const createdResponse = await app.inject({
      method: "POST",
      url: "/api/v1/calls",
      headers: jsonHeaders(alice.cookie, "c2-create-flag-0001"),
      payload: {
        expectedPartnershipId: partnershipId,
        kind: "video",
        clientMediaProfile: C2_VIDEO_MEDIA_PROFILE,
      },
    });
    assert.equal(createdResponse.statusCode, 201, createdResponse.body);
    const created = createdResponse.json() as CallProjection;

    const mutableCalling = config.calling as { videoEnabled: boolean };
    mutableCalling.videoEnabled = false;
    try {
      const accept = await app.inject({
        method: "POST",
        url: "/api/v1/calls/" + created.id + "/accept",
        headers: jsonHeaders(bob.cookie, "c2-accept-disabled-0001"),
        payload: {
          expectedVersion: created.version,
          clientMediaProfile: C2_VIDEO_MEDIA_PROFILE,
        },
      });
      assert.equal(accept.statusCode, 409, accept.body);
      assert.equal((accept.json() as { error: { code: string } }).error.code, "FEATURE_NOT_AVAILABLE");
    } finally {
      mutableCalling.videoEnabled = true;
    }
  } finally {
    await app.close();
    await closeDatabasePool(database);
  }
});
