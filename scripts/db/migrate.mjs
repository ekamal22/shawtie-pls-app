import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const databaseUrl = process.env.DATABASE_URL;
const migrationsDir = path.join(root, "packages", "db", "migrations");
const NEWLINE = String.fromCharCode(10);

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

function runPsql(args = [], input) {
  const result = spawnSync(
    "psql",
    [
      "--dbname",
      databaseUrl,
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      ...args,
    ],
    {
      cwd: root,
      encoding: "utf8",
      input,
      stdio: input === undefined
        ? ["inherit", "pipe", "pipe"]
        : ["pipe", "pipe", "pipe"],
    },
  );

  if (result.error) {
    if (result.error.code === "ENOENT") {
      throw new Error(
        "psql was not found on PATH. Install PostgreSQL client tools or use the future local database container.",
      );
    }

    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(stderr || "psql exited with status " + result.status);
  }

  return result.stdout ?? "";
}

runPsql(
  [
    "-q",
    "-c",
    "CREATE TABLE IF NOT EXISTS _schema_migrations ("
      + "filename text PRIMARY KEY,"
      + "checksum text NOT NULL,"
      + "applied_at timestamptz NOT NULL DEFAULT now(),"
      + "CONSTRAINT schema_migrations_checksum_shape "
      + "CHECK (checksum ~ '^[0-9a-f]{64}$'));",
  ],
);

const appliedOutput = runPsql([
  "-A",
  "-t",
  "-F",
  "|",
  "-c",
  "SELECT filename, checksum FROM _schema_migrations ORDER BY filename",
]);

const applied = new Map();

for (const rawLine of appliedOutput.split(NEWLINE)) {
  const line = rawLine.trim();
  if (!line) continue;
  const [filename, checksum] = line.split("|");
  applied.set(filename, checksum);
}

const filenames = (await readdir(migrationsDir))
  .filter((name) => name.endsWith(".sql"))
  .sort();

let appliedCount = 0;

for (const filename of filenames) {
  const migrationContent = await readFile(path.join(migrationsDir, filename), "utf8");
  const checksum = createHash("sha256").update(migrationContent).digest("hex");
  const existingChecksum = applied.get(filename);

  if (existingChecksum) {
    if (existingChecksum !== checksum) {
      throw new Error(
        "Applied migration checksum mismatch for "
          + filename
          + ". Never edit an applied migration.",
      );
    }

    console.log("SKIP " + filename);
    continue;
  }

  const safeFilename = filename.replaceAll("'", "''");
  const script = [
    "SELECT pg_advisory_xact_lock(624197020260920);",
    "",
    "DO $migration_guard$",
    "BEGIN",
    "  IF EXISTS (",
    "    SELECT 1",
    "    FROM _schema_migrations",
    "    WHERE filename = '" + safeFilename + "'",
    "  ) THEN",
    "    RAISE EXCEPTION 'migration already applied concurrently: " + safeFilename + "';",
    "  END IF;",
    "END;",
    "$migration_guard$;",
    "",
    migrationContent,
    "",
    "INSERT INTO _schema_migrations (filename, checksum)",
    "VALUES ('" + safeFilename + "', '" + checksum + "');",
    "",
  ].join(NEWLINE);

  runPsql(
    ["--single-transaction", "-q", "-f", "-"],
    script,
  );

  console.log("APPLIED " + filename);
  appliedCount += 1;
}

console.log(
  "MIGRATION_RUN_PASS applied="
    + appliedCount
    + " total="
    + filenames.length,
);
