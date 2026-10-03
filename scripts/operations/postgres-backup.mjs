import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const databaseUrl = process.env.DATABASE_URL;
const output = process.argv[2] || process.env.R2_BACKUP_FILE;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!output) throw new Error("Backup output path is required");

function pgEnv(raw) {
  const url = new URL(raw);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use PostgreSQL");
  }
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "")),
    ...(url.searchParams.get("sslmode")
      ? { PGSSLMODE: url.searchParams.get("sslmode") }
      : {}),
  };
}

await mkdir(path.dirname(path.resolve(output)), { recursive: true });
const result = spawnSync(
  "pg_dump",
  ["--format=custom", "--no-owner", "--no-privileges", "--file", path.resolve(output)],
  { stdio: "inherit", env: pgEnv(databaseUrl) },
);
if (result.status !== 0) throw new Error("pg_dump failed");
console.log("R2_POSTGRES_BACKUP_PASS file=" + path.resolve(output));
