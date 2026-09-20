import { spawnSync } from "node:child_process";
import path from "node:path";

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

run(
  "psql",
  [
    databaseUrl,
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-f",
    path.join("packages", "db", "tests", "invariants.sql"),
  ],
);

console.log("DATABASE_INVARIANTS_PASS");
