import type { FastifyInstance } from "fastify";
import {
  conversationIdParamsSchema,
  idempotencyKeySchema,
  messageChangeQuerySchema,
  messageEditSchema,
  messageHistoryQuerySchema,
  messageIdParamsSchema,
  messageReactionSchema,
  messageReceiptSchema,
  messageSendSchema,
  nicknameMutationSchema,
  nicknameSubjectParamsSchema,
  parseAtBoundary,
  presenceHeartbeatSchema,
  typingStateSchema,
} from "@shawtie/contracts";
import type { DatabasePool } from "@shawtie/db";
import type { ApiConfig } from "../../config.ts";
import { requireAuthentication } from "../../plugins/authentication.ts";
import type { AuthKeyRing } from "../../security/auth-key-ring.ts";
import type { MessagingService } from "./messaging-service.ts";

interface MessagingRouteDependencies {
  readonly database: DatabasePool;
  readonly config: ApiConfig;
  readonly keys: AuthKeyRing;
  readonly service: MessagingService;
}

function privateNoStore(reply: { header(name: string, value: string): unknown }): void {
  reply.header("cache-control", "private, no-store");
}

function idempotencyKey(headers: Record<string, unknown>): string {
  return parseAtBoundary(idempotencyKeySchema, headers["idempotency-key"]);
}

export function registerMessagingRoutes(
  app: FastifyInstance,
  deps: MessagingRouteDependencies,
): void {
  const { database, config, keys, service } = deps;

  app.get("/api/v1/conversations/current", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    privateNoStore(reply);
    return service.current(auth);
  });

  app.get("/api/v1/conversations/:conversationId/messages", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    const params = parseAtBoundary(conversationIdParamsSchema, request.params);
    const input = parseAtBoundary(messageHistoryQuerySchema, request.query);
    privateNoStore(reply);
    return service.listMessages(auth, params.conversationId, input);
  });

  app.get(
    "/api/v1/conversations/:conversationId/messages/:messageId",
    async (request, reply) => {
      const auth = await requireAuthentication(request, database, config, keys);
      const params = parseAtBoundary(messageIdParamsSchema, request.params);
      privateNoStore(reply);
      return service.message(auth, params.conversationId, params.messageId);
    },
  );

  app.get("/api/v1/conversations/:conversationId/changes", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    const params = parseAtBoundary(conversationIdParamsSchema, request.params);
    const input = parseAtBoundary(messageChangeQuerySchema, request.query);
    privateNoStore(reply);
    return service.listChanges(auth, params.conversationId, input);
  });

  app.post("/api/v1/conversations/:conversationId/messages", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    const params = parseAtBoundary(conversationIdParamsSchema, request.params);
    const input = parseAtBoundary(messageSendSchema, request.body);
    privateNoStore(reply);
    const result = await service.send(
      auth,
      params.conversationId,
      input,
      idempotencyKey(request.headers),
    );
    void reply.status(201);
    return result;
  });

  app.patch(
    "/api/v1/conversations/:conversationId/messages/:messageId",
    async (request, reply) => {
      const auth = await requireAuthentication(request, database, config, keys);
      const params = parseAtBoundary(messageIdParamsSchema, request.params);
      const input = parseAtBoundary(messageEditSchema, request.body);
      privateNoStore(reply);
      return service.edit(
        auth,
        params.conversationId,
        params.messageId,
        input,
        idempotencyKey(request.headers),
      );
    },
  );

  app.delete(
    "/api/v1/conversations/:conversationId/messages/:messageId",
    async (request, reply) => {
      const auth = await requireAuthentication(request, database, config, keys);
      const params = parseAtBoundary(messageIdParamsSchema, request.params);
      privateNoStore(reply);
      return service.delete(
        auth,
        params.conversationId,
        params.messageId,
        idempotencyKey(request.headers),
      );
    },
  );

  app.put(
    "/api/v1/conversations/:conversationId/messages/:messageId/reaction",
    async (request, reply) => {
      const auth = await requireAuthentication(request, database, config, keys);
      const params = parseAtBoundary(messageIdParamsSchema, request.params);
      const input = parseAtBoundary(messageReactionSchema, request.body);
      privateNoStore(reply);
      return service.setReaction(
        auth,
        params.conversationId,
        params.messageId,
        input,
        idempotencyKey(request.headers),
      );
    },
  );

  app.delete(
    "/api/v1/conversations/:conversationId/messages/:messageId/reaction",
    async (request, reply) => {
      const auth = await requireAuthentication(request, database, config, keys);
      const params = parseAtBoundary(messageIdParamsSchema, request.params);
      privateNoStore(reply);
      return service.removeReaction(
        auth,
        params.conversationId,
        params.messageId,
        idempotencyKey(request.headers),
      );
    },
  );

  app.post("/api/v1/conversations/:conversationId/receipt", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    const params = parseAtBoundary(conversationIdParamsSchema, request.params);
    const input = parseAtBoundary(messageReceiptSchema, request.body);
    privateNoStore(reply);
    return service.receipt(auth, params.conversationId, input);
  });

  app.post("/api/v1/conversations/:conversationId/typing", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    const params = parseAtBoundary(conversationIdParamsSchema, request.params);
    const input = parseAtBoundary(typingStateSchema, request.body);
    privateNoStore(reply);
    return service.typing(auth, params.conversationId, input);
  });

  app.post("/api/v1/presence/heartbeat", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    parseAtBoundary(presenceHeartbeatSchema, request.body ?? {});
    privateNoStore(reply);
    return service.presence(auth);
  });

  app.patch(
    "/api/v1/partnerships/:partnershipId/nicknames/:accountId",
    async (request, reply) => {
      const auth = await requireAuthentication(request, database, config, keys);
      const params = parseAtBoundary(nicknameSubjectParamsSchema, request.params);
      const input = parseAtBoundary(nicknameMutationSchema, request.body);
      privateNoStore(reply);
      return service.nickname(
        auth,
        params.partnershipId,
        params.accountId,
        input,
        idempotencyKey(request.headers),
      );
    },
  );
}
