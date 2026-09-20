import type { DatabasePool } from "@shawtie/db";
import { createAccountAuthDeletionHandler } from "./account-auth-deletion-handler.ts";
import { accountDeletionFinalizeHandler } from "./account-deletion-finalize-handler.ts";
import { accountDeletionBreakupPrecedenceHandler } from "./account-deletion-breakup-precedence-handler.ts";
import { DeletionHandlerRegistry } from "../deletion/deletion-handler-registry.ts";
import { ScheduledActionHandlerRegistry } from "../scheduled/scheduled-handler-registry.ts";

export function createDefaultScheduledHandlers(): ScheduledActionHandlerRegistry {
  const registry = new ScheduledActionHandlerRegistry();
  registry.register(accountDeletionBreakupPrecedenceHandler);
  registry.register(accountDeletionFinalizeHandler);
  return registry;
}

export function createDefaultDeletionHandlers(database: DatabasePool): DeletionHandlerRegistry {
  const registry = new DeletionHandlerRegistry();
  registry.register(createAccountAuthDeletionHandler(database));
  return registry;
}
