import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Client } = pg;
const root = process.cwd();
const databaseUrl = process.env.DATABASE_URL;
const migrationsDir = path.join(root, "packages", "db", "migrations");
const advisoryLockId = "624197020260920";

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const client = new Client({
  connectionString: databaseUrl,
  application_name: "shawtie-migrate",
});

await client.connect();

try {
  await client.query(
    `CREATE TABLE IF NOT EXISTS _schema_migrations (
       filename text PRIMARY KEY,
       checksum text NOT NULL,
       applied_at timestamptz NOT NULL DEFAULT now(),
       CONSTRAINT schema_migrations_checksum_shape
         CHECK (checksum ~ '^[0-9a-f]{64}$')
     )`,
  );

  const filenames = (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  let appliedCount = 0;

  for (const filename of filenames) {
    const migrationContent = await readFile(
      path.join(migrationsDir, filename),
      "utf8",
    );
    const checksum = createHash("sha256")
      .update(migrationContent)
      .digest("hex");

    await client.query("BEGIN");

    try {
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
        advisoryLockId,
      ]);

      const existing = await client.query(
        `SELECT checksum
         FROM _schema_migrations
         WHERE filename = $1`,
        [filename],
      );

      const existingChecksum = existing.rows[0]?.checksum;

      if (existingChecksum !== undefined) {
        if (existingChecksum !== checksum) {
          throw new Error(
            "Applied migration checksum mismatch for "
              + filename
              + ". Never edit an applied migration.",
          );
        }

        await client.query("COMMIT");
        console.log("SKIP " + filename);
        continue;
      }

      await client.query(migrationContent);

      await client.query(
        `INSERT INTO _schema_migrations (filename, checksum)
         VALUES ($1, $2)`,
        [filename, checksum],
      );

      await client.query("COMMIT");
      console.log("APPLIED " + filename);
      appliedCount += 1;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original migration failure.
      }
      throw error;
    }
  }

  console.log(
    "MIGRATION_RUN_PASS applied="
      + appliedCount
      + " total="
      + filenames.length,
  );
} finally {
  await client.end();
}
