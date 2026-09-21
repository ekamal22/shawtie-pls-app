import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import Fastify, { type FastifyInstance } from "fastify";
import type { DatabasePool } from "@shawtie/db";
import type { ApiConfig } from "./config.ts";
import { AccountService } from "./modules/accounts/account-service.ts";
import {
  PartnerRequestService,
  type PartnershipFormationCoordinator,
} from "./modules/partner-requests/partner-request-service.ts";
import { registerPartnerRequestRoutes } from "./modules/partner-requests/routes.ts";
import { registerAccountRoutes } from "./modules/auth/routes.ts";
import { NotificationService } from "./modules/notifications/notification-service.ts";
import { registerNotificationRoutes } from "./modules/notifications/routes.ts";
import { createP2PartnershipFormationCoordinator } from "./modules/partnerships/partnership-formation-coordinator.ts";
import { PartnershipService } from "./modules/partnerships/partnership-service.ts";
import { registerPartnershipRoutes } from "./modules/partnerships/routes.ts";
import { installErrorHandler } from "./plugins/errors.ts";
import { installMutationSecurity } from "./plugins/request-security.ts";
import { AuthKeyRing } from "./security/auth-key-ring.ts";
import { PasswordHasher } from "./security/password-hasher.ts";

export interface ApiApplicationDependencies {
  readonly database: DatabasePool;
  readonly config: ApiConfig;
  readonly partnershipFormationCoordinator?: PartnershipFormationCoordinator;
}

export function createApiApplication(dependencies?: ApiApplicationDependencies): FastifyInstance {
  const app = Fastify({
    logger: false,
    trustProxy: dependencies?.config.trustedProxy ?? false,
  });

  app.get("/health", async () => ({ status: "ok" }));
  if (!dependencies) return app;

  app.register(cookie);
  app.register(helmet);
  installErrorHandler(app);
  installMutationSecurity(app, dependencies.config);

  const keys = new AuthKeyRing(dependencies.config.authKeys);
  const service = new AccountService(dependencies.database, keys, new PasswordHasher());
  registerAccountRoutes(app, {
    database: dependencies.database,
    config: dependencies.config,
    keys,
    service,
  });

  const partnerRequestMode = dependencies.config.partnerRequestMode ?? "disabled";
  const builtInFormationCoordinator = createP2PartnershipFormationCoordinator();
  const partnerRequestService = new PartnerRequestService(dependencies.database, service, {
    mode: partnerRequestMode,
    coordinator: dependencies.partnershipFormationCoordinator ?? builtInFormationCoordinator,
  });
  registerPartnerRequestRoutes(app, {
    database: dependencies.database,
    config: dependencies.config,
    keys,
    service: partnerRequestService,
    mode: partnerRequestMode,
  });

  const partnershipService = new PartnershipService(dependencies.database);
  registerPartnershipRoutes(app, {
    database: dependencies.database,
    config: dependencies.config,
    keys,
    service: partnershipService,
  });

  const notificationService = new NotificationService(dependencies.database);
  registerNotificationRoutes(app, {
    database: dependencies.database,
    config: dependencies.config,
    keys,
    service: notificationService,
  });

  return app;
}
