import type { DatabasePool } from "@shawtie/db";
import { createAccountAuthDeletionHandler } from "./account-auth-deletion-handler.ts";
import { accountDeletionFinalizeHandler } from "./account-deletion-finalize-handler.ts";
import { accountDeletionBreakupPrecedenceHandler } from "./account-deletion-breakup-precedence-handler.ts";
import { DeletionHandlerRegistry } from "../deletion/deletion-handler-registry.ts";
import { ScheduledActionHandlerRegistry } from "../scheduled/scheduled-handler-registry.ts";
import { partnerRequestExpiryHandler } from "../partner-requests/expire-partner-request-handler.ts";
import { partnershipBreakupFinalizeHandler } from "../partnerships/breakup-finalize-handler.ts";
import { partnershipBreakupDeadlineReminderHandler } from "../partnerships/breakup-reminder-handler.ts";
import { createPartnershipRelationalDeletionHandler } from "../partnerships/partnership-relational-deletion-handler.ts";
import { createPartnershipCryptoDeletionHandler } from "../partnerships/partnership-crypto-deletion-handler.ts";
import { relationshipItemReleaseHandler } from "../relationship-space/relationship-item-release-handler.ts";

export function createDefaultScheduledHandlers(): ScheduledActionHandlerRegistry {
  const registry = new ScheduledActionHandlerRegistry();
  registry.register(accountDeletionBreakupPrecedenceHandler);
  registry.register(accountDeletionFinalizeHandler);
  registry.register(partnerRequestExpiryHandler);
  registry.register(partnershipBreakupFinalizeHandler);
  registry.register(partnershipBreakupDeadlineReminderHandler);
  registry.register(relationshipItemReleaseHandler);
  return registry;
}

export function createDefaultDeletionHandlers(database: DatabasePool): DeletionHandlerRegistry {
  const registry = new DeletionHandlerRegistry();
  registry.register(createAccountAuthDeletionHandler(database));
  registry.register(createPartnershipRelationalDeletionHandler(database));
  registry.register(createPartnershipCryptoDeletionHandler(database));
  return registry;
}
