import type { FastifyInstance } from "fastify";
import {
  anniversaryQuerySchema,
  idempotencyKeySchema,
  ourYearParamsSchema,
  parseAtBoundary,
  relationshipItemCreateSchema,
  relationshipItemDeleteSchema,
  relationshipItemIdParamsSchema,
  relationshipItemListQuerySchema,
  relationshipItemPatchSchema,
  relationshipItemReleaseSchema,
  thisDayQuerySchema,
} from "@shawtie/contracts";
import type { DatabasePool } from "@shawtie/db";
import type { ApiConfig } from "../../config.ts";
import { requireAuthentication } from "../../plugins/authentication.ts";
import type { AuthKeyRing } from "../../security/auth-key-ring.ts";
import type { RelationshipSpaceService } from "./relationship-space-service.ts";

interface RelationshipSpaceRouteDependencies {
  readonly database: DatabasePool;
  readonly config: ApiConfig;
  readonly keys: AuthKeyRing;
  readonly service: RelationshipSpaceService;
}

function privateNoStore(reply: { header(name: string, value: string): unknown }): void {
  reply.header("cache-control", "private, no-store");
}

function idempotencyKey(headers: Record<string, unknown>): string {
  return parseAtBoundary(idempotencyKeySchema, headers["idempotency-key"]);
}

export function registerRelationshipSpaceRoutes(
  app: FastifyInstance,
  deps: RelationshipSpaceRouteDependencies,
): void {
  const { database, config, keys, service } = deps;

  app.get("/api/v1/relationship-space", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    privateNoStore(reply);
    return service.home(auth);
  });

  app.get("/api/v1/relationship-space/items", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    privateNoStore(reply);
    const input = parseAtBoundary(relationshipItemListQuerySchema, request.query);
    return service.list(auth, input);
  });

  app.post("/api/v1/relationship-space/items", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    privateNoStore(reply);
    const input = parseAtBoundary(relationshipItemCreateSchema, request.body);
    const result = await service.create(auth, input, idempotencyKey(request.headers));
    void reply.status(result.statusCode);
    return result.body;
  });

  app.get("/api/v1/relationship-space/items/:itemId", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    privateNoStore(reply);
    const params = parseAtBoundary(relationshipItemIdParamsSchema, request.params);
    return service.get(auth, params.itemId);
  });

  app.patch("/api/v1/relationship-space/items/:itemId", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    privateNoStore(reply);
    const params = parseAtBoundary(relationshipItemIdParamsSchema, request.params);
    const input = parseAtBoundary(relationshipItemPatchSchema, request.body);
    const result = await service.patch(
      auth,
      params.itemId,
      input,
      idempotencyKey(request.headers),
    );
    void reply.status(result.statusCode);
    return result.body;
  });

  app.delete("/api/v1/relationship-space/items/:itemId", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    privateNoStore(reply);
    const params = parseAtBoundary(relationshipItemIdParamsSchema, request.params);
    const input = parseAtBoundary(relationshipItemDeleteSchema, request.body);
    await service.delete(
      auth,
      params.itemId,
      input.expectedVersion,
      idempotencyKey(request.headers),
    );
    return reply.status(204).send();
  });

  app.post("/api/v1/relationship-space/items/:itemId/release", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    privateNoStore(reply);
    const params = parseAtBoundary(relationshipItemIdParamsSchema, request.params);
    const input = parseAtBoundary(relationshipItemReleaseSchema, request.body);
    const result = await service.release(
      auth,
      params.itemId,
      input,
      idempotencyKey(request.headers),
    );
    privateNoStore(reply);
    void reply.status(result.statusCode);
    return result.body;
  });

  app.get("/api/v1/relationship-space/experiences/this-day", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    privateNoStore(reply);
    const input = parseAtBoundary(thisDayQuerySchema, request.query);
    return service.thisDay(auth, input);
  });

  app.get(
    "/api/v1/relationship-space/experiences/our-year/:year",
    async (request, reply) => {
      const auth = await requireAuthentication(request, database, config, keys);
      privateNoStore(reply);
      const params = parseAtBoundary(ourYearParamsSchema, request.params);
      return service.ourYear(auth, params);
    },
  );

  app.get("/api/v1/relationship-space/experiences/anniversary", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    privateNoStore(reply);
    const input = parseAtBoundary(anniversaryQuerySchema, request.query);
    return service.anniversary(auth, input);
  });
}
