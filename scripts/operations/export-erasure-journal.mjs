import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
const output = process.argv[2] || process.env.R2_ERASURE_JOURNAL_FILE;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!output) throw new Error("Erasure journal output path is required");

const client = new pg.Client({
  connectionString: databaseUrl,
  application_name: "shawtie-erasure-journal-export",
});
await client.connect();
try {
  const result = await client.query(
    `SELECT subject_type, subject_id, erased_at, reason
     FROM erasure_tombstones
     ORDER BY erased_at, subject_type, subject_id`,
  );
  const document = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    entries: result.rows.map((row) => ({
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      erasedAt: row.erased_at.toISOString(),
      reason: row.reason,
    })),
  };
  const serialized = JSON.stringify(document, null, 2) + "\n";
  const resolved = path.resolve(output);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, serialized, { mode: 0o600 });
  const digest = createHash("sha256").update(serialized).digest("hex");
  await writeFile(resolved + ".sha256", digest + "  " + path.basename(resolved) + "\n", {
    mode: 0o600,
  });
  console.log(
    "R2_ERASURE_JOURNAL_EXPORT_PASS entries=" +
      document.entries.length +
      " sha256=" +
      digest,
  );
} finally {
  await client.end();
}
