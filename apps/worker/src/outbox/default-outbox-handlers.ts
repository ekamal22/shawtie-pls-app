import type { DatabasePool } from "@shawtie/db";
import { createM1MessagingInvalidationHandlers } from "../messages/messaging-invalidation-handler.ts";
import { PostgresRealtimeInvalidationPublisher } from "../realtime/realtime-publisher.ts";
import { createM2RealtimeOutboxHandlers } from "../realtime/realtime-outbox-handler.ts";
import { OutboxHandlerRegistry } from "./outbox-handler-registry.ts";
import { createC1CallOutboxHandlers } from "../calls/call-outbox-handler.ts";
import { webPushConfigFromEnv } from "../calls/web-push.ts";

export function createDefaultOutboxHandlers(database?: DatabasePool): OutboxHandlerRegistry {
  const registry = new OutboxHandlerRegistry();
  const publisher = database ? new PostgresRealtimeInvalidationPublisher(database) : undefined;
  for (const handler of createM1MessagingInvalidationHandlers(publisher)) {
    registry.register(handler);
  }
  for (const handler of createM2RealtimeOutboxHandlers(publisher)) {
    registry.register(handler);
  }
  if (database && publisher) {
    for (const handler of createC1CallOutboxHandlers(
      database,
      publisher,
      webPushConfigFromEnv(),
    )) {
      registry.register(handler);
    }
  }
  return registry;
}
