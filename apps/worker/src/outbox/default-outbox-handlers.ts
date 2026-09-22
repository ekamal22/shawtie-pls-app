import type { DatabasePool } from "@shawtie/db";
import { createM1MessagingInvalidationHandlers } from "../messages/messaging-invalidation-handler.ts";
import { PostgresRealtimeInvalidationPublisher } from "../realtime/realtime-publisher.ts";
import { OutboxHandlerRegistry } from "./outbox-handler-registry.ts";

export function createDefaultOutboxHandlers(database?: DatabasePool): OutboxHandlerRegistry {
  const registry = new OutboxHandlerRegistry();
  const publisher = database ? new PostgresRealtimeInvalidationPublisher(database) : undefined;
  for (const handler of createM1MessagingInvalidationHandlers(publisher)) {
    registry.register(handler);
  }
  return registry;
}
