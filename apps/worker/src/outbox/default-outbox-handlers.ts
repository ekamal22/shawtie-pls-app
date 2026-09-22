import { createM1MessagingInvalidationHandlers } from "../messages/messaging-invalidation-handler.ts";
import { OutboxHandlerRegistry } from "./outbox-handler-registry.ts";

export function createDefaultOutboxHandlers(): OutboxHandlerRegistry {
  const registry = new OutboxHandlerRegistry();
  for (const handler of createM1MessagingInvalidationHandlers()) {
    registry.register(handler);
  }
  return registry;
}
