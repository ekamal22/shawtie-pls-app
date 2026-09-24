import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  idempotencyKeySchema,
  mediaIdParamsSchema,
  mediaPolicySchema,
  mediaUploadCreateSchema,
  mediaUploadGenerationSchema,
  parseAtBoundary,
} from "@shawtie/contracts";
import {
  consumeRateLimitBuckets,
  getTransactionTimestamp,
  withTransaction,
  type DatabasePool,
} from "@shawtie/db";
import type { ApiConfig } from "../../config.ts";
import { ApiError } from "../../lib/api-error.ts";
import { requireAuthentication, type AuthContext } from "../../plugins/authentication.ts";
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

const MEDIA_WRITE_RATE_LIMIT = 120;
const MEDIA_READ_RATE_LIMIT = 600;
const MEDIA_RATE_WINDOW_MS = 60 * 60_000;

async function consumeMediaRateLimit(
  request: FastifyRequest,
  auth: AuthContext,
  deps: Pick<MediaRouteDependencies, "database" | "keys">,
  kind: "write" | "read",
): Promise<void> {
  const limit = kind === "write" ? MEDIA_WRITE_RATE_LIMIT : MEDIA_READ_RATE_LIMIT;
  const decision = await withTransaction(deps.database, async (transaction) => {
    const now = await getTransactionTimestamp(transaction);
    const subjects = [
      { scope: "m3.media." + kind + ".account", subject: "account\0" + auth.session.accountId },
      { scope: "m3.media." + kind + ".device", subject: "device\0" + auth.session.deviceId },
      { scope: "m3.media." + kind + ".network", subject: "network\0" + request.ip },
    ];
    return consumeRateLimitBuckets(
      transaction,
      subjects.flatMap((item) =>
        deps.keys.versions.map((version) => ({
          scope: item.scope,
          keyVersion: version,
          keyHash: deps.keys.verifier("rate-limit-key", item.subject, version),
          windowMs: MEDIA_RATE_WINDOW_MS,
          limit,
          blockMs: MEDIA_RATE_WINDOW_MS,
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

export function registerMediaRoutes(app: FastifyInstance, deps: MediaRouteDependencies): void {
  const { database, config, keys, service } = deps;

  app.get("/api/v1/media/policy", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    await consumeMediaRateLimit(request, auth, deps, "read");
    parseAtBoundary(mediaPolicySchema, request.query ?? {});
    privateNoStore(reply);
    return service.policy();
  });

  app.post("/api/v1/media/uploads", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    await consumeMediaRateLimit(request, auth, deps, "write");
    const input = parseAtBoundary(mediaUploadCreateSchema, request.body);
    privateNoStore(reply);
    const result = await service.createUpload(auth, input, idempotencyKey(request.headers));
    void reply.status(201);
    return result;
  });

  app.post("/api/v1/media/:mediaId/refresh-upload", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    await consumeMediaRateLimit(request, auth, deps, "write");
    const params = parseAtBoundary(mediaIdParamsSchema, request.params);
    const input = parseAtBoundary(mediaUploadGenerationSchema, request.body);
    privateNoStore(reply);
    return service.refreshUpload(auth, params.mediaId, input);
  });

  app.post("/api/v1/media/:mediaId/complete", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    await consumeMediaRateLimit(request, auth, deps, "write");
    const params = parseAtBoundary(mediaIdParamsSchema, request.params);
    const input = parseAtBoundary(mediaUploadGenerationSchema, request.body);
    privateNoStore(reply);
    return service.completeUpload(auth, params.mediaId, input);
  });

  app.get("/api/v1/media/:mediaId", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    await consumeMediaRateLimit(request, auth, deps, "read");
    const params = parseAtBoundary(mediaIdParamsSchema, request.params);
    privateNoStore(reply);
    return service.metadata(auth, params.mediaId);
  });

  app.get("/api/v1/media/:mediaId/access", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    await consumeMediaRateLimit(request, auth, deps, "read");
    const params = parseAtBoundary(mediaIdParamsSchema, request.params);
    privateNoStore(reply);
    return service.access(auth, params.mediaId);
  });

  app.delete("/api/v1/media/:mediaId", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    await consumeMediaRateLimit(request, auth, deps, "write");
    const params = parseAtBoundary(mediaIdParamsSchema, request.params);
    privateNoStore(reply);
    await service.deleteUnbound(auth, params.mediaId);
    return reply.status(204).send();
  });
}
