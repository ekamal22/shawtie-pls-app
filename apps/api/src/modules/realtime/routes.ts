import { M2_REALTIME_SUBPROTOCOL, type M2RealtimeClientFrame } from "@shawtie/contracts";
import {
  consumeRateLimitBuckets,
  getTransactionTimestamp,
  withTransaction,
  type DatabasePool,
} from "@shawtie/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ApiConfig } from "../../config.ts";
import { ApiError } from "../../lib/api-error.ts";
import type { MessagingService } from "../messages/messaging-service.ts";
import { requireAuthentication, type AuthContext } from "../../plugins/authentication.ts";
import type { AuthKeyRing } from "../../security/auth-key-ring.ts";
import type {
  RealtimeClientFrameHandler,
  RealtimeConnectionContext,
  RealtimeHub,
} from "./realtime-hub.ts";
import type { RealtimeTransientPublisher } from "./transient-publisher.ts";

const REALTIME_CONNECT_RATE_LIMIT = 30;
const REALTIME_CONNECT_RATE_WINDOW_MS = 60_000;

async function consumeRealtimeConnectionRateLimit(
  request: FastifyRequest,
  auth: AuthContext,
  dependencies: {
    readonly database: DatabasePool;
    readonly keys: AuthKeyRing;
  },
): Promise<void> {
  const decision = await withTransaction(dependencies.database, async (transaction) => {
    const now = await getTransactionTimestamp(transaction);
    const subjects = [
      {
        scope: "m2.realtime.connect.account",
        subject: "account\0" + auth.session.accountId,
      },
      {
        scope: "m2.realtime.connect.network",
        subject: "network\0" + request.ip,
      },
    ];
    return consumeRateLimitBuckets(
      transaction,
      subjects.flatMap((item) =>
        dependencies.keys.versions.map((version) => ({
          scope: item.scope,
          keyVersion: version,
          keyHash: dependencies.keys.verifier("rate-limit-key", item.subject, version),
          windowMs: REALTIME_CONNECT_RATE_WINDOW_MS,
          limit: REALTIME_CONNECT_RATE_LIMIT,
          blockMs: REALTIME_CONNECT_RATE_WINDOW_MS,
        })),
      ),
      now,
    );
  });

  if (!decision.allowed) {
    throw new ApiError(
      429,
      "RATE_LIMITED",
      "RATE_LIMITED",
      Math.max(1, Math.ceil(decision.retryAfterMs / 1_000)),
    );
  }
}

function offeredProtocols(request: FastifyRequest): readonly string[] {
  const value = request.headers["sec-websocket-protocol"];
  const raw = Array.isArray(value) ? value.join(",") : (value ?? "");
  return raw
    .split(",")
    .map((protocol) => protocol.trim())
    .filter(Boolean);
}

function presenceResult(value: unknown): { online: boolean } {
  if (
    value !== null &&
    typeof value === "object" &&
    "online" in value &&
    typeof value.online === "boolean"
  ) {
    return { online: value.online };
  }
  throw new Error("Invalid presence result");
}

function typingResult(value: unknown): { typing: boolean; expiresAt: string | null } {
  if (
    value !== null &&
    typeof value === "object" &&
    "typing" in value &&
    typeof value.typing === "boolean" &&
    "expiresAt" in value &&
    (typeof value.expiresAt === "string" || value.expiresAt === null)
  ) {
    return { typing: value.typing, expiresAt: value.expiresAt };
  }
  throw new Error("Invalid typing result");
}

export function createRealtimeClientFrameHandler(
  messaging: MessagingService,
  publisher: RealtimeTransientPublisher,
): RealtimeClientFrameHandler {
  return async (
    connection: RealtimeConnectionContext,
    frame: M2RealtimeClientFrame,
  ): Promise<void> => {
    if (frame.type === "presence.heartbeat") {
      const result = presenceResult(await messaging.presence(connection.auth));
      await publisher.presence({
        partnershipId: connection.partnershipId,
        accountId: connection.accountId,
        online: result.online,
      });
      return;
    }

    if (frame.type === "typing.set") {
      if (!connection.conversationId) throw new Error("No current conversation");
      const result = typingResult(
        await messaging.typing(connection.auth, connection.conversationId, {
          typing: frame.payload.typing,
        }),
      );
      await publisher.typing({
        conversationId: connection.conversationId,
        accountId: connection.accountId,
        typing: result.typing,
        expiresAt: result.expiresAt,
      });
    }
  };
}

export function registerRealtimeRoutes(
  app: FastifyInstance,
  dependencies: {
    readonly database: DatabasePool;
    readonly config: ApiConfig;
    readonly keys: AuthKeyRing;
    readonly hub: RealtimeHub;
  },
): void {
  const authenticated = new WeakMap<FastifyRequest, AuthContext>();

  app.get(
    "/api/v1/realtime",
    {
      websocket: true,
      preValidation: async (request) => {
        if (request.headers.origin !== dependencies.config.appOrigin) {
          throw new ApiError(403, "REALTIME_ORIGIN_REJECTED");
        }
        if (!offeredProtocols(request).includes(M2_REALTIME_SUBPROTOCOL)) {
          throw new ApiError(400, "REALTIME_PROTOCOL_REQUIRED");
        }
        const auth = await requireAuthentication(
          request,
          dependencies.database,
          dependencies.config,
          dependencies.keys,
        );
        await consumeRealtimeConnectionRateLimit(request, auth, dependencies);
        authenticated.set(request, auth);
      },
    },
    (socket, request) => {
      const auth = authenticated.get(request);
      authenticated.delete(request);
      if (!auth) {
        socket.close(1008, "Authentication required");
        return;
      }
      dependencies.hub.accept(socket, auth);
    },
  );
}
