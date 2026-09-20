import type { ScheduledActionHandler } from "./scheduled-handler.ts";

function key(actionType: string, payloadVersion: number): string {
  return `${actionType}:${payloadVersion}`;
}

export class ScheduledActionHandlerRegistry {
  readonly #handlers = new Map<string, ScheduledActionHandler>();

  register(handler: ScheduledActionHandler): void {
    const handlerKey = key(handler.actionType, handler.payloadVersion);
    if (this.#handlers.has(handlerKey)) {
      throw new Error(`Duplicate scheduled handler: ${handlerKey}`);
    }
    this.#handlers.set(handlerKey, handler);
  }

  get(actionType: string, payloadVersion: number): ScheduledActionHandler | null {
    return this.#handlers.get(key(actionType, payloadVersion)) ?? null;
  }
}
