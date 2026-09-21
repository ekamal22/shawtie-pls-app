import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  discoveryUsernameSchema,
  idempotencyKeySchema,
  parseAtBoundary,
  partnerRequestCreateSchema,
  partnerRequestIdParamsSchema,
  partnerRequestListQuerySchema,
} from "@shawtie/contracts";
import type { DatabasePool } from "@shawtie/db";
import type { ApiConfig } from "../../config.ts";
import { ApiError } from "../../lib/api-error.ts";
import { requireAuthentication } from "../../plugins/authentication.ts";
import type { AuthKeyRing } from "../../security/auth-key-ring.ts";
import { networkPrefix } from "../../security/normalization.ts";
import type { PartnerRequestService, PartnerRequestMode } from "./partner-request-service.ts";

interface PartnerRequestRouteDependencies {
  readonly database: DatabasePool;
  readonly config: ApiConfig;
  readonly keys: AuthKeyRing;
  readonly service: PartnerRequestService;
  readonly mode: PartnerRequestMode;
}

function network(request: FastifyRequest): string {
  return networkPrefix(request.ip);
}

function privateNoStore(reply: { header(name: string, value: string): unknown }): void {
  reply.header("cache-control", "private, no-store");
}

export function registerPartnerRequestRoutes(
  app: FastifyInstance,
  deps: PartnerRequestRouteDependencies,
): void {
  const { database, config, keys, service, mode } = deps;

  app.post("/api/v1/discovery/username", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    const input = parseAtBoundary(discoveryUsernameSchema, request.body);
    privateNoStore(reply);
    return service.discover(auth, input.username, network(request));
  });

  app.get("/api/v1/partner-requests", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    const input = parseAtBoundary(partnerRequestListQuerySchema, request.query);
    privateNoStore(reply);
    return service.list(auth, input);
  });

  if (mode !== "disabled") {
    app.post("/api/v1/partner-requests", async (request, reply) => {
      const auth = await requireAuthentication(request, database, config, keys);
      const input = parseAtBoundary(partnerRequestCreateSchema, request.body);
      const idempotencyKey = parseAtBoundary(
        idempotencyKeySchema,
        request.headers["idempotency-key"],
      );
      const result = await service.create(auth, input, idempotencyKey, network(request));
      privateNoStore(reply);
      void reply.status(result.statusCode);
      return result.body;
    });
  }

  app.post("/api/v1/partner-requests/:requestId/cancel", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    const params = parseAtBoundary(partnerRequestIdParamsSchema, request.params);
    privateNoStore(reply);
    return service.cancel(auth, params.requestId);
  });

  app.post("/api/v1/partner-requests/:requestId/decline", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    const params = parseAtBoundary(partnerRequestIdParamsSchema, request.params);
    privateNoStore(reply);
    return service.decline(auth, params.requestId);
  });

  if (config.environment === "production" && mode === "request_only_test") {
    throw new ApiError(500, "INVALID_CONFIGURATION");
  }
}
