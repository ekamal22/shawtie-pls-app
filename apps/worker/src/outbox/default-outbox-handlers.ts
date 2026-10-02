import type { DatabasePool } from "@shawtie/db";
import {
  createEmailChallengeOutboxHandler,
  createSecurityEmailOutboxHandler,
} from "../auth/auth-email-handlers.ts";
import type { EmailDeliveryPort } from "../auth/email-delivery-port.ts";
import type { WorkerAuthKeyRing } from "../auth/worker-auth-key-ring.ts";
import { createM1MessagingInvalidationHandlers } from "../messages/messaging-invalidation-handler.ts";
import { PostgresRealtimeInvalidationPublisher } from "../realtime/realtime-publisher.ts";
import { createM2RealtimeOutboxHandlers } from "../realtime/realtime-outbox-handler.ts";
import { OutboxHandlerRegistry } from "./outbox-handler-registry.ts";
import { createC1CallOutboxHandlers } from "../calls/call-outbox-handler.ts";
import { webPushConfigFromEnv } from "../calls/web-push.ts";
import { createGenericPushHandlers } from "../notifications/generic-push-handler.ts";

export interface DefaultOutboxHandlerOptions {
  readonly email?: EmailDeliveryPort;
  readonly authKeys?: WorkerAuthKeyRing;
}

export function createDefaultOutboxHandlers(
  database?: DatabasePool,
  options: DefaultOutboxHandlerOptions = {},
): OutboxHandlerRegistry {
  if (Boolean(options.email) !== Boolean(options.authKeys)) {
    throw new Error("Auth email delivery requires both email provider and auth key ring");
  }

  const registry = new OutboxHandlerRegistry();
  const publisher = database ? new PostgresRealtimeInvalidationPublisher(database) : undefined;
  const pushConfig = webPushConfigFromEnv();
  for (const handler of createM1MessagingInvalidationHandlers(publisher, database, pushConfig)) {
    registry.register(handler);
  }
  for (const handler of createM2RealtimeOutboxHandlers(publisher)) {
    registry.register(handler);
  }
  if (database && options.email && options.authKeys) {
    registry.register(createEmailChallengeOutboxHandler(database, options.email, options.authKeys));
    registry.register(createSecurityEmailOutboxHandler(database, options.email));
  }
  if (database) {
    for (const handler of createGenericPushHandlers(database, pushConfig)) {
      registry.register(handler);
    }
  }
  if (database && publisher) {
    for (const handler of createC1CallOutboxHandlers(database, publisher, pushConfig)) {
      registry.register(handler);
    }
  }
  return registry;
}
