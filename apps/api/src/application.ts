import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import Fastify, { type FastifyInstance } from "fastify";
import type { DatabasePool } from "@shawtie/db";
import type { ApiConfig } from "./config.ts";
import { AccountService } from "./modules/accounts/account-service.ts";
import { registerAccountRoutes } from "./modules/auth/routes.ts";
import { installErrorHandler } from "./plugins/errors.ts";
import { installMutationSecurity } from "./plugins/request-security.ts";
import { AuthKeyRing } from "./security/auth-key-ring.ts";
import { PasswordHasher } from "./security/password-hasher.ts";

export interface ApiApplicationDependencies {
  readonly database: DatabasePool;
  readonly config: ApiConfig;
}

export function createApiApplication(
  dependencies?: ApiApplicationDependencies,
): FastifyInstance {
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
  const service = new AccountService(
    dependencies.database,
    keys,
    new PasswordHasher(),
  );
  registerAccountRoutes(app, {
    database: dependencies.database,
    config: dependencies.config,
    keys,
    service,
  });

  return app;
}
