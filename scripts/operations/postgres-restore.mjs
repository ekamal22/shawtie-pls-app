import { spawnSync } from "node:child_process";
import path from "node:path";

const databaseUrl = process.env.DATABASE_URL;
const backupFile = process.argv[2] || process.env.R2_BACKUP_FILE;
const journalFile = process.argv[3] || process.env.R2_ERASURE_JOURNAL_FILE;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!backupFile) throw new Error("Backup file is required");
if (!journalFile) throw new Error("Erasure journal file is required");
if (process.env.R2_RESTORE_CONFIRM !== "RESTORE") {
  throw new Error("R2_RESTORE_CONFIRM=RESTORE is required");
}
if (process.env.R2_RESTORE_ISOLATED !== "1") {
  throw new Error("Restore must run with R2_RESTORE_ISOLATED=1");
}

function pgEnv(raw) {
  const url = new URL(raw);
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

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.status !== 0) throw new Error(command + " failed");
}

run(
  "pg_restore",
  ["--clean", "--if-exists", "--no-owner", "--no-privileges", path.resolve(backupFile)],
  pgEnv(databaseUrl),
);
run("npm", ["run", "db:migrate"]);
run("npm", ["run", "build", "--workspace", "@shawtie/db"]);
run("node", ["scripts/operations/apply-erasure-journal.mjs", path.resolve(journalFile)]);
console.log("R2_POSTGRES_RESTORE_STAGED_PASS");
console.log(
  "Do not expose this database to users until the deletion worker drains restored deletion manifests and verify-erasure-restore passes.",
);
