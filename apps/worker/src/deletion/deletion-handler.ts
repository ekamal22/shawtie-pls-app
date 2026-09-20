import type { DeletionTarget } from "@shawtie/db";

export interface DeletionHandlerContext {
  readonly target: DeletionTarget;
  readonly signal: AbortSignal;
  renewLease(): Promise<boolean>;
}

export interface DeletionHandler {
  readonly targetType: string;
  execute(context: DeletionHandlerContext): Promise<void>;
}
