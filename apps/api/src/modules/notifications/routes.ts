import type { FastifyInstance } from "fastify";
import {
  notificationIdParamsSchema,
  notificationListQuerySchema,
  notificationReadBodySchema,
  parseAtBoundary,
} from "@shawtie/contracts";
import type { DatabasePool } from "@shawtie/db";
import type { ApiConfig } from "../../config.ts";
import { requireAuthentication } from "../../plugins/authentication.ts";
import type { AuthKeyRing } from "../../security/auth-key-ring.ts";
import type { NotificationService } from "./notification-service.ts";

interface NotificationRouteDependencies {
  readonly database: DatabasePool;
  readonly config: ApiConfig;
  readonly keys: AuthKeyRing;
  readonly service: NotificationService;
}

function privateNoStore(reply: { header(name: string, value: string): unknown }): void {
  reply.header("cache-control", "private, no-store");
}

export function registerNotificationRoutes(
  app: FastifyInstance,
  deps: NotificationRouteDependencies,
): void {
  const { database, config, keys, service } = deps;

  app.get("/api/v1/notifications", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    const input = parseAtBoundary(notificationListQuerySchema, request.query);
    privateNoStore(reply);
    return service.list(auth, input);
  });

  app.post("/api/v1/notifications/:notificationId/read", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    const params = parseAtBoundary(notificationIdParamsSchema, request.params);
    parseAtBoundary(notificationReadBodySchema, request.body);
    privateNoStore(reply);
    return service.markRead(auth, params.notificationId);
  });
}
