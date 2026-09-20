import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const migrationsDir = path.join(root, "packages", "db", "migrations");
const EM_DASH = "\\u2014";

const entries = (await readdir(migrationsDir))
  .filter((name) => name.endsWith(".sql"))
  .sort();

if (entries.length === 0) {
  throw new Error("No database migrations found");
}

let expectedVersion = 1;

for (const filename of entries) {
  const match = /^(\\d{4})_([a-z0-9_]+)\\.sql$/.exec(filename);

  if (!match) {
    throw new Error("Invalid migration filename: " + filename);
  }

  const version = Number(match[1]);

  if (version !== expectedVersion) {
    throw new Error(
      "Migration sequence gap: expected "
        + String(expectedVersion).padStart(4, "0")
        + " but found "
        + match[1],
    );
  }

  const content = await readFile(path.join(migrationsDir, filename), "utf8");

  if (content.includes(EM_DASH)) {
    throw new Error("Unicode em dash is forbidden in migration: " + filename);
  }

  if (/^\\s*(BEGIN|COMMIT|ROLLBACK)\\s*;/im.test(content)) {
    throw new Error(
      "Migration transaction control is runner-owned and must not appear in " + filename,
    );
  }

  if (/^\\s*\\\\/m.test(content)) {
    throw new Error(
      "psql meta-commands are forbidden inside migration files: " + filename,
    );
  }

  const checksum = createHash("sha256").update(content).digest("hex");
  console.log(filename + " " + checksum);
  expectedVersion += 1;
}

console.log("MIGRATION_PLAN_PASS count=" + entries.length);
