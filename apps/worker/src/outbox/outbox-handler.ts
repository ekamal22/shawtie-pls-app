import type { OutboxEvent } from "@shawtie/db";

export interface OutboxHandlerContext {
  readonly event: OutboxEvent;
  readonly signal: AbortSignal;
  renewLease(): Promise<boolean>;
}

export interface OutboxHandler {
  readonly eventType: string;
  readonly payloadVersion: number;
  deliver(context: OutboxHandlerContext): Promise<void>;
}
