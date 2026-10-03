import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  closeDatabasePool,
  createDatabasePool,
  createPartnershipDeletionManifestIfAbsent,
  databaseConfigFromEnv,
  insertErasureTombstone,
  scrubAccountAuthenticationData,
  terminatePartnershipLifecycle,
  withTransaction,
} from "@shawtie/db";

const journalPath = process.argv[2] || process.env.R2_ERASURE_JOURNAL_FILE;
if (!journalPath) throw new Error("Erasure journal path is required");
if (process.env.R2_RESTORE_ISOLATED !== "1") {
  throw new Error("R2_RESTORE_ISOLATED=1 is required before applying an erasure journal");
}

const raw = await readFile(path.resolve(journalPath), "utf8");
const expectedPath = path.resolve(journalPath) + ".sha256";
const expectedRaw = await readFile(expectedPath, "utf8");
const expected = expectedRaw.trim().split(/\s+/)[0];
const actual = createHash("sha256").update(raw).digest("hex");
if (!expected || expected !== actual) throw new Error("Erasure journal checksum mismatch");

const journal = JSON.parse(raw);
if (journal?.schemaVersion !== 1 || !Array.isArray(journal.entries)) {
  throw new Error("Unsupported erasure journal");
}

const database = createDatabasePool({
  ...databaseConfigFromEnv(),
  applicationName: "shawtie-erasure-journal-apply",
});

try {
  for (const entry of journal.entries) {
    if (
      (entry.subjectType !== "account" && entry.subjectType !== "partnership") ||
      typeof entry.subjectId !== "string" ||
      typeof entry.reason !== "string" ||
      Number.isNaN(new Date(entry.erasedAt).getTime())
    ) {
      throw new Error("Invalid erasure journal entry");
    }

    await withTransaction(database, async (transaction) => {
      const erasedAt = new Date(entry.erasedAt);
      await insertErasureTombstone(transaction, {
        subjectType: entry.subjectType,
        subjectId: entry.subjectId,
        erasedAt,
        reason: entry.reason,
      });

      if (entry.subjectType === "account") {
        await transaction.query(
          "UPDATE accounts SET status = 'deleted', updated_at = GREATEST(updated_at, $2) WHERE id = $1",
          [entry.subjectId, erasedAt],
        );
        await scrubAccountAuthenticationData(transaction, entry.subjectId);
        return;
      }

      const generation = await terminatePartnershipLifecycle(transaction, {
        partnershipId: entry.subjectId,
        reason: entry.reason === "partner_account_deleted" ? "partner_account_deleted" : "breakup",
        effectiveAt: erasedAt,
      });
      await createPartnershipDeletionManifestIfAbsent(transaction, {
        id: randomUUID(),
        subjectType: "partnership",
        subjectId: entry.subjectId,
        reason: "restore_erasure_replay",
        accessRevokedAt: erasedAt,
        targets: [
          {
            id: randomUUID(),
            targetType: "partnership_relational_content",
            targetKey: entry.subjectId,
          },
          {
            id: randomUUID(),
            targetType: "partnership_media_objects",
            targetKey: entry.subjectId,
          },
          {
            id: randomUUID(),
            targetType: "partnership_crypto_state",
            targetKey: entry.subjectId,
          },
        ],
      });
      void generation;
    });
  }
  console.log("R2_ERASURE_JOURNAL_APPLY_PASS entries=" + journal.entries.length);
} finally {
  await closeDatabasePool(database);
}
