import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  C1_SIGNALING_SUBPROTOCOL,
  callCreateSchema,
  callEndpointConnectedSchema,
  callHistoryQuerySchema,
  callIdParamsSchema,
  callVersionMutationSchema,
  idempotencyKeySchema,
  parseAtBoundary,
  pushSubscriptionSchema,
} from "@shawtie/contracts";
import {
  consumeRateLimitBuckets,
  getTransactionTimestamp,
  loadCallEndpointAuthorization,
  withTransaction,
  type DatabasePool,
} from "@shawtie/db";
import type { ApiConfig } from "../../config.ts";
import { ApiError } from "../../lib/api-error.ts";
import {
  requireAuthentication,
  type AuthContext,
} from "../../plugins/authentication.ts";
import type { AuthKeyRing } from "../../security/auth-key-ring.ts";
import type { CallingService } from "./calling-service.ts";
import type { CallSignalingHub } from "./signaling-hub.ts";

interface Dependencies {
  readonly database: DatabasePool;
  readonly config: ApiConfig;
  readonly keys: AuthKeyRing;
  readonly service: CallingService;
  readonly signalingHub: CallSignalingHub;
}

function privateNoStore(reply: { header(name: string, value: string): unknown }): void {
  reply.header("cache-control", "private, no-store");
}

function idempotency(headers: Record<string, unknown>): string {
  return parseAtBoundary(idempotencyKeySchema, headers["idempotency-key"]);
}

function offeredProtocols(request: FastifyRequest): readonly string[] {
  const value = request.headers["sec-websocket-protocol"];
  const raw = Array.isArray(value) ? value.join(",") : (value ?? "");
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

async function rateLimit(
  request: FastifyRequest,
  auth: AuthContext,
  deps: Dependencies,
  scope: string,
  limit: number,
): Promise<void> {
  const decision = await withTransaction(deps.database, async (transaction) => {
    const now = await getTransactionTimestamp(transaction);
    return consumeRateLimitBuckets(
      transaction,
      [
        {
          scope: `c1.${scope}.account`,
          keyVersion: deps.keys.activeVersion,
          keyHash: deps.keys.verifier(
            "rate-limit-key",
            `account\0${auth.session.accountId}`,
            deps.keys.activeVersion,
          ),
          windowMs: 60_000,
          limit,
          blockMs: 60_000,
        },
        {
          scope: `c1.${scope}.network`,
          keyVersion: deps.keys.activeVersion,
          keyHash: deps.keys.verifier(
            "rate-limit-key",
            `network\0${request.ip}`,
            deps.keys.activeVersion,
          ),
          windowMs: 60_000,
          limit: limit * 2,
          blockMs: 60_000,
        },
      ],
      now,
    );
  });
  if (!decision.allowed) {
    throw new ApiError(
      429,
      "RATE_LIMITED",
      "RATE_LIMITED",
      Math.max(1, Math.ceil(decision.retryAfterMs / 1000)),
    );
  }
}

export function registerCallingRoutes(app: FastifyInstance, deps: Dependencies): void {
  app.get("/api/v1/calls/current", async (request, reply) => {
    const auth = await requireAuthentication(request, deps.database, deps.config, deps.keys);
    privateNoStore(reply);
    return deps.service.current(auth);
  });

  app.get("/api/v1/calls", async (request, reply) => {
    const auth = await requireAuthentication(request, deps.database, deps.config, deps.keys);
    privateNoStore(reply);
    const query = parseAtBoundary(callHistoryQuerySchema, request.query);
    return deps.service.history(auth, query);
  });

  app.post("/api/v1/calls", async (request, reply) => {
    const auth = await requireAuthentication(request, deps.database, deps.config, deps.keys);
    await rateLimit(request, auth, deps, "call.create", 12);
    const input = parseAtBoundary(callCreateSchema, request.body);
    const result = await deps.service.create(auth, input, idempotency(request.headers));
    privateNoStore(reply);
    void reply.status(201);
    return result;
  });

  app.get("/api/v1/calls/:callId", async (request, reply) => {
    const auth = await requireAuthentication(request, deps.database, deps.config, deps.keys);
    const params = parseAtBoundary(callIdParamsSchema, request.params);
    privateNoStore(reply);
    return deps.service.get(auth, params.callId);
  });

  for (const action of ["accept", "reject", "cancel", "end"] as const) {
    app.post(`/api/v1/calls/:callId/${action}`, async (request, reply) => {
      const auth = await requireAuthentication(request, deps.database, deps.config, deps.keys);
      const params = parseAtBoundary(callIdParamsSchema, request.params);
      const input = parseAtBoundary(callVersionMutationSchema, request.body);
      const key = idempotency(request.headers);
      privateNoStore(reply);
      return deps.service[action](auth, params.callId, input, key);
    });
  }

  app.post("/api/v1/calls/:callId/endpoint-connected", async (request, reply) => {
    const auth = await requireAuthentication(request, deps.database, deps.config, deps.keys);
    const params = parseAtBoundary(callIdParamsSchema, request.params);
    parseAtBoundary(callEndpointConnectedSchema, request.body ?? {});
    privateNoStore(reply);
    return deps.service.endpointConnected(auth, params.callId, idempotency(request.headers));
  });

  app.post("/api/v1/calls/:callId/turn-credentials", async (request, reply) => {
    const auth = await requireAuthentication(request, deps.database, deps.config, deps.keys);
    await rateLimit(request, auth, deps, "turn.issue", 60);
    const params = parseAtBoundary(callIdParamsSchema, request.params);
    privateNoStore(reply);
    return deps.service.turn(auth, params.callId);
  });

  app.get("/api/v1/push/config", async (request, reply) => {
    await requireAuthentication(request, deps.database, deps.config, deps.keys);
    privateNoStore(reply);
    return {
      enabled: Boolean(deps.config.calling.pushVapidPublicKey),
      applicationServerKey: deps.config.calling.pushVapidPublicKey,
    };
  });

  app.post("/api/v1/push/subscriptions", async (request, reply) => {
    const auth = await requireAuthentication(request, deps.database, deps.config, deps.keys);
    await rateLimit(request, auth, deps, "push.register", 20);
    const input = parseAtBoundary(pushSubscriptionSchema, request.body);
    await deps.service.savePushSubscription(auth, input);
    privateNoStore(reply);
    return { ok: true };
  });

  app.delete("/api/v1/push/subscriptions/current", async (request, reply) => {
    const auth = await requireAuthentication(request, deps.database, deps.config, deps.keys);
    await deps.service.removePushSubscription(auth);
    privateNoStore(reply);
    return reply.status(204).send();
  });

  const authenticated = new WeakMap<
    FastifyRequest,
    { auth: AuthContext; callId: string; authorization: { partnershipId: string; role: "caller" | "callee" } }
  >();

  app.get(
    "/api/v1/calls/:callId/signal",
    {
      websocket: true,
      preValidation: async (request) => {
        if (!deps.config.calling.transportEnabled) {
          throw new ApiError(503, "CALL_TRANSPORT_UNAVAILABLE");
        }
        if (request.headers.origin !== deps.config.appOrigin) {
          throw new ApiError(403, "CALL_SIGNAL_ORIGIN_REJECTED");
        }
        const offered = offeredProtocols(request);
        if (offered.length !== 1 || offered[0] !== C1_SIGNALING_SUBPROTOCOL) {
          throw new ApiError(400, "CALL_SIGNAL_PROTOCOL_REQUIRED");
        }
        const auth = await requireAuthentication(request, deps.database, deps.config, deps.keys);
        await rateLimit(request, auth, deps, "signal.connect", 30);
        if (!auth.session.deviceId) throw new ApiError(404, "CALL_NOT_FOUND");
        const params = parseAtBoundary(callIdParamsSchema, request.params);
        const authorization = await loadCallEndpointAuthorization(deps.database.pool, {
          callId: params.callId,
          accountId: auth.session.accountId,
          deviceId: auth.session.deviceId,
        });
        if (!authorization) throw new ApiError(404, "CALL_NOT_FOUND");
        authenticated.set(request, {
          auth,
          callId: params.callId,
          authorization: {
            partnershipId: authorization.partnershipId,
            role: authorization.role,
          },
        });
      },
    },
    (socket, request) => {
      const context = authenticated.get(request);
      authenticated.delete(request);
      if (!context || socket.protocol !== C1_SIGNALING_SUBPROTOCOL) {
        socket.close(1008, "Call signaling authorization required");
        return;
      }
      deps.signalingHub.accept(
        socket,
        context.auth,
        context.callId,
        context.authorization,
      );
    },
  );
}
