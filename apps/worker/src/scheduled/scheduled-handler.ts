import type { QueryExecutor, ScheduledAction } from "@shawtie/db";

export interface ScheduledActionHandlerContext {
  readonly transaction: QueryExecutor;
  readonly action: ScheduledAction;
  readonly now: Date;
}

export type ScheduledActionHandlerResult =
  | void
  | { readonly outcome: "stale" }
  | { readonly outcome: "reschedule"; readonly availableAt: Date };

export interface ScheduledActionHandler {
  readonly actionType: string;
  readonly payloadVersion: number;
  readonly loadCurrentGeneration?: (
    transaction: QueryExecutor,
    action: ScheduledAction,
  ) => Promise<bigint>;
  execute(context: ScheduledActionHandlerContext): Promise<ScheduledActionHandlerResult>;
}
