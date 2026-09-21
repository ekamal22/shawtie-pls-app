import { deletePartnershipCryptoState, type DatabasePool } from "@shawtie/db";
import type { DeletionHandler } from "../deletion/deletion-handler.ts";

export function createPartnershipCryptoDeletionHandler(database: DatabasePool): DeletionHandler {
  return {
    targetType: "partnership_crypto_state",
    async execute({ target }) {
      await deletePartnershipCryptoState(database.pool, target.targetKey);
    },
  };
}
