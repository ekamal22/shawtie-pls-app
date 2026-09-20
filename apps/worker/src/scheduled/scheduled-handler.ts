import type {
  QueryExecutor,
  ScheduledAction,
} from "@shawtie/db";

export interface ScheduledActionHandlerContext {
  readonly transaction: QueryExecutor;
  readonly action: ScheduledAction;
  readonly now: Date;
}

export interface ScheduledActionHandler {
  readonly actionType: string;
  readonly payloadVersion: number;
  readonly loadCurrentGeneration?: (
    transaction: QueryExecutor,
    action: ScheduledAction,
  ) => Promise<bigint>;
  execute(context: ScheduledActionHandlerContext): Promise<void>;
}
