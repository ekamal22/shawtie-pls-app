import type { FastifyInstance } from "fastify";
import { abuseReportCreateSchema, parseAtBoundary } from "@shawtie/contracts";
import type { DatabasePool } from "@shawtie/db";
import type { ApiConfig } from "../../config.ts";
import { requireAuthentication } from "../../plugins/authentication.ts";
import type { AuthKeyRing } from "../../security/auth-key-ring.ts";
import { networkPrefix } from "../../security/normalization.ts";
import type { SupportService } from "./support-service.ts";

interface SupportRouteDependencies {
  readonly database: DatabasePool;
  readonly config: ApiConfig;
  readonly keys: AuthKeyRing;
  readonly service: SupportService;
}

export function registerSupportRoutes(
  app: FastifyInstance,
  deps: SupportRouteDependencies,
): void {
  app.post("/api/v1/support/reports", async (request, reply) => {
    const auth = await requireAuthentication(
      request,
      deps.database,
      deps.config,
      deps.keys,
    );
    const input = parseAtBoundary(abuseReportCreateSchema, request.body);
    const result = await deps.service.createReport(auth, input, networkPrefix(request.ip));
    void reply.status(201);
    return result;
  });
}
