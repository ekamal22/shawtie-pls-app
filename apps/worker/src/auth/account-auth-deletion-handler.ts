import { scrubAccountAuthenticationData, type DatabasePool } from "@shawtie/db";
import type { DeletionHandler } from "../deletion/deletion-handler.ts";

export function createAccountAuthDeletionHandler(database: DatabasePool): DeletionHandler {
  return {
    targetType: "account_auth_data",
    async execute({ target }) {
      await scrubAccountAuthenticationData(database.pool, target.targetKey);
    },
  };
}
