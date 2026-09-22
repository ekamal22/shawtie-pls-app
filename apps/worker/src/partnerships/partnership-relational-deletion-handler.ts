import {
  deletePartnershipMessagingContent,
  deletePartnershipRelationalContent,
  type DatabasePool,
} from "@shawtie/db";
import type { DeletionHandler } from "../deletion/deletion-handler.ts";

export function createPartnershipRelationalDeletionHandler(
  database: DatabasePool,
): DeletionHandler {
  return {
    targetType: "partnership_relational_content",
    async execute({ target }) {
      await deletePartnershipMessagingContent(database.pool, target.targetKey);
      await deletePartnershipRelationalContent(database.pool, target.targetKey);
    },
  };
}
