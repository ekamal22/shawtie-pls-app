import type { DeletionHandler } from "./deletion-handler.ts";

export class DeletionHandlerRegistry {
  readonly #handlers = new Map<string, DeletionHandler>();

  get size(): number {
    return this.#handlers.size;
  }

  register(handler: DeletionHandler): void {
    if (this.#handlers.has(handler.targetType)) {
      throw new Error(`Duplicate deletion handler: ${handler.targetType}`);
    }
    this.#handlers.set(handler.targetType, handler);
  }

  get(targetType: string): DeletionHandler | null {
    return this.#handlers.get(targetType) ?? null;
  }
}
