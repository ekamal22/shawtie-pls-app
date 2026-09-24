import { spawnSync } from "node:child_process";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "inherit",
    env: process.env,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(command + " " + args.join(" ") + " exited with status " + result.status);
  }
}

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run through npm: npm run test:c2:postgres");
if (!process.env.DATABASE_URL || process.env.DB_TEST_CONFIRM !== "1") {
  throw new Error("C2 PostgreSQL tests require DATABASE_URL and DB_TEST_CONFIRM=1");
}

function npm(script) {
  run(process.execPath, [npmCli, "run", script]);
}

console.log("C2_POSTGRES_MIGRATIONS reserved=0");
npm("db:migrations:check");
npm("test:c2");
npm("db:test:invariants");

for (const workspace of [
  "@shawtie/domain",
  "@shawtie/contracts",
  "@shawtie/db",
  "@shawtie/testkit",
  "@shawtie/api",
  "@shawtie/worker",
  "@shawtie/web",
]) {
  run(process.execPath, [npmCli, "run", "build", "--workspace", workspace]);
}

run(process.execPath, [
  "--test",
  "--test-concurrency=1",
  "apps/api/tests/c1.integration.test.ts",
  "apps/api/tests/c2.integration.test.ts",
]);

console.log("C2_POSTGRES_MATRIX_PASS reserved=0");
