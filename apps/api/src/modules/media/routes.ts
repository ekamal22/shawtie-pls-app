import type { FastifyInstance } from "fastify";
import {
  idempotencyKeySchema,
  mediaIdParamsSchema,
  mediaPolicySchema,
  mediaUploadCreateSchema,
  mediaUploadGenerationSchema,
  parseAtBoundary,
} from "@shawtie/contracts";
import type { DatabasePool } from "@shawtie/db";
import type { ApiConfig } from "../../config.ts";
import { requireAuthentication } from "../../plugins/authentication.ts";
import type { AuthKeyRing } from "../../security/auth-key-ring.ts";
import type { MediaService } from "./media-service.ts";

interface MediaRouteDependencies {
  readonly database: DatabasePool;
  readonly config: ApiConfig;
  readonly keys: AuthKeyRing;
  readonly service: MediaService;
}

function privateNoStore(reply: { header(name: string, value: string): unknown }): void {
  reply.header("cache-control", "private, no-store");
}

function idempotencyKey(headers: Record<string, unknown>): string {
  return parseAtBoundary(idempotencyKeySchema, headers["idempotency-key"]);
}

export function registerMediaRoutes(app: FastifyInstance, deps: MediaRouteDependencies): void {
  const { database, config, keys, service } = deps;

  app.get("/api/v1/media/policy", async (request, reply) => {
    await requireAuthentication(request, database, config, keys);
    parseAtBoundary(mediaPolicySchema, request.query ?? {});
    privateNoStore(reply);
    return service.policy();
  });

  app.post("/api/v1/media/uploads", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    const input = parseAtBoundary(mediaUploadCreateSchema, request.body);
    privateNoStore(reply);
    const result = await service.createUpload(auth, input, idempotencyKey(request.headers));
    void reply.status(201);
    return result;
  });

  app.post("/api/v1/media/:mediaId/refresh-upload", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    const params = parseAtBoundary(mediaIdParamsSchema, request.params);
    const input = parseAtBoundary(mediaUploadGenerationSchema, request.body);
    privateNoStore(reply);
    return service.refreshUpload(auth, params.mediaId, input);
  });

  app.post("/api/v1/media/:mediaId/complete", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    const params = parseAtBoundary(mediaIdParamsSchema, request.params);
    const input = parseAtBoundary(mediaUploadGenerationSchema, request.body);
    privateNoStore(reply);
    return service.completeUpload(auth, params.mediaId, input);
  });

  app.get("/api/v1/media/:mediaId", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    const params = parseAtBoundary(mediaIdParamsSchema, request.params);
    privateNoStore(reply);
    return service.metadata(auth, params.mediaId);
  });

  app.get("/api/v1/media/:mediaId/access", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    const params = parseAtBoundary(mediaIdParamsSchema, request.params);
    privateNoStore(reply);
    return service.access(auth, params.mediaId);
  });

  app.delete("/api/v1/media/:mediaId", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    const params = parseAtBoundary(mediaIdParamsSchema, request.params);
    privateNoStore(reply);
    await service.deleteUnbound(auth, params.mediaId);
    return reply.status(204).send();
  });
}
