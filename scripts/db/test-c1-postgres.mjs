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
if (!npmCli) {
  throw new Error("npm_execpath is unavailable. Run through npm: npm run test:c1:postgres");
}
if (!process.env.DATABASE_URL || process.env.DB_TEST_CONFIRM !== "1") {
  throw new Error("C1 PostgreSQL tests require DATABASE_URL and DB_TEST_CONFIRM=1 for a disposable database");
}

function npm(script, extra = []) {
  run(process.execPath, [npmCli, "run", script, ...extra]);
}

console.log("C1_POSTGRES_MIGRATIONS reserved=0");
npm("db:migrations:check");
npm("test:c1");
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
  "apps/api/tests/p1.integration.test.ts",
  "apps/api/tests/p2.integration.test.ts",
  "apps/api/tests/p3.integration.test.ts",
  "apps/api/tests/m1.integration.test.ts",
  "apps/api/tests/r1.integration.test.ts",
  "apps/api/tests/m2.integration.test.ts",
  "apps/api/tests/c1.integration.test.ts",
  "apps/worker/tests/p1.integration.test.ts",
  "apps/worker/tests/a1.integration.test.ts",
  "apps/worker/tests/p3.integration.test.ts",
  "apps/worker/tests/m1.integration.test.ts",
  "apps/worker/tests/r1.integration.test.ts",
  "apps/worker/tests/c1.integration.test.ts",
]);

console.log("C1_POSTGRES_MATRIX_PASS reserved=0");
