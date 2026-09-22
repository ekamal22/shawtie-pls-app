import type { OutboxHandler } from "./outbox-handler.ts";

function key(eventType: string, payloadVersion: number): string {
  return `${eventType}:${payloadVersion}`;
}

export class OutboxHandlerRegistry {
  readonly #handlers = new Map<string, OutboxHandler>();

  get size(): number {
    return this.#handlers.size;
  }

  get eventTypes(): readonly string[] {
    return [...new Set([...this.#handlers.values()].map((handler) => handler.eventType))].sort();
  }

  register(handler: OutboxHandler): void {
    const handlerKey = key(handler.eventType, handler.payloadVersion);
    if (this.#handlers.has(handlerKey)) {
      throw new Error(`Duplicate outbox handler: ${handlerKey}`);
    }
    this.#handlers.set(handlerKey, handler);
  }

  get(eventType: string, payloadVersion: number): OutboxHandler | null {
    return this.#handlers.get(key(eventType, payloadVersion)) ?? null;
  }
}
