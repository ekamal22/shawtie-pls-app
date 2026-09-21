import type { FastifyInstance } from "fastify";
import {
  parseAtBoundary,
  partnerRequestAcceptBodySchema,
  partnerRequestAcceptParamsSchema,
  partnershipIdParamsSchema,
  relationshipStartDateUpdateSchema,
} from "@shawtie/contracts";
import type { DatabasePool } from "@shawtie/db";
import type { ApiConfig } from "../../config.ts";
import { requireAuthentication } from "../../plugins/authentication.ts";
import type { AuthKeyRing } from "../../security/auth-key-ring.ts";
import type { PartnershipService } from "./partnership-service.ts";

interface PartnershipRouteDependencies {
  readonly database: DatabasePool;
  readonly config: ApiConfig;
  readonly keys: AuthKeyRing;
  readonly service: PartnershipService;
}

function privateNoStore(reply: { header(name: string, value: string): unknown }): void {
  reply.header("cache-control", "private, no-store");
}

export function registerPartnershipRoutes(
  app: FastifyInstance,
  deps: PartnershipRouteDependencies,
): void {
  const { database, config, keys, service } = deps;

  app.post("/api/v1/partner-requests/:requestId/accept", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    const params = parseAtBoundary(partnerRequestAcceptParamsSchema, request.params);
    parseAtBoundary(partnerRequestAcceptBodySchema, request.body);
    privateNoStore(reply);
    return service.accept(auth, params.requestId);
  });

  app.get("/api/v1/partnerships/current", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    privateNoStore(reply);
    return service.current(auth);
  });

  app.patch(
    "/api/v1/partnerships/:partnershipId/relationship-start-date",
    async (request, reply) => {
      const auth = await requireAuthentication(request, database, config, keys);
      const params = parseAtBoundary(partnershipIdParamsSchema, request.params);
      const input = parseAtBoundary(relationshipStartDateUpdateSchema, request.body);
      privateNoStore(reply);
      return service.updateRelationshipStartDate(auth, params.partnershipId, input);
    },
  );
}
