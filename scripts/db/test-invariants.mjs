import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Client } = pg;
const root = process.cwd();
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

if (process.env.DB_TEST_CONFIRM !== "1") {
  throw new Error(
    "Refusing to run database invariant tests. Set DB_TEST_CONFIRM=1 only for a disposable test database.",
  );
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(command + " exited with status " + result.status);
  }
}

run(process.execPath, ["scripts/db/check-migrations.mjs"]);
run(process.execPath, ["scripts/db/migrate.mjs"]);

const invariantSql = await readFile(
  path.join(root, "packages", "db", "tests", "invariants.sql"),
  "utf8",
);

const client = new Client({
  connectionString: databaseUrl,
  application_name: "shawtie-invariants",
});

await client.connect();

try {
  await client.query(invariantSql);
} finally {
  await client.end();
}

console.log("DATABASE_INVARIANTS_PASS");
