import { spawnSync } from "node:child_process";

const postgresImage = process.env.SHAWTIE_TEST_POSTGRES_IMAGE ?? "postgres:16-alpine";
const suffix = process.pid;
const postgres = "shawtie-s1-postgres-" + suffix;
const pgUser = "shawtie_test";
const pgPassword = "shawtie_test";
const pgDatabase = "shawtie_s1_test";

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", ...options });
}

function findDocker() {
  const candidates = [
    process.env.DOCKER_CLI,
    process.platform === "win32"
      ? "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe"
      : undefined,
    "docker",
  ].filter(Boolean);
  for (const candidate of candidates) {
    const result = run(candidate, ["version", "--format", "{{.Server.Version}}"], {
      stdio: "ignore",
    });
    if (!result.error && result.status === 0) return candidate;
  }
  throw new Error("Docker CLI/engine is unavailable. Start Docker Desktop or set DOCKER_CLI.");
}

function dockerRun(docker, args, options = {}) {
  const result = run(docker, args, options);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "docker failed");
  }
  return result.stdout?.trim() ?? "";
}

function hostPort(docker, container, port) {
  const output = dockerRun(docker, ["port", container, port + "/tcp"]);
  const match = output.match(/:(\d+)\s*$/);
  if (!match) throw new Error("Could not determine Docker host port: " + output);
  return match[1];
}

async function waitFor(check, label) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(label + " did not become ready");
}

function step(name, command, args, env) {
  console.log("S1_LOCAL_STEP_START " + name);
  const result = run(command, args, {
    stdio: "inherit",
    env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error("S1 local step " + name + " exited with status " + result.status);
  }
  console.log("S1_LOCAL_STEP_PASS " + name);
}

const docker = findDocker();
let started = false;

try {
  dockerRun(docker, [
    "run", "--detach", "--rm", "--name", postgres,
    "-e", "POSTGRES_USER=" + pgUser,
    "-e", "POSTGRES_PASSWORD=" + pgPassword,
    "-e", "POSTGRES_DB=" + pgDatabase,
    "-p", "127.0.0.1::5432",
    postgresImage,
  ]);
  started = true;

  await waitFor(async () => {
    const result = run(
      docker,
      ["exec", postgres, "pg_isready", "-U", pgUser, "-d", pgDatabase],
      { stdio: "ignore" },
    );
    return !result.error && result.status === 0;
  }, "PostgreSQL");

  const pgPort = hostPort(docker, postgres, 5432);
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("Run through npm: npm run test:s1:local");

  const env = {
    ...process.env,
    DATABASE_URL:
      "postgresql://" + pgUser + ":" + pgPassword + "@127.0.0.1:" + pgPort + "/" + pgDatabase,
    DB_TEST_CONFIRM: "1",
    NODE_ENV: "test",
    APP_ORIGIN: "http://127.0.0.1:4173",
    ALLOW_INSECURE_LOOPBACK_COOKIES: "1",
    AUTH_HMAC_KEYS: "1:" + Buffer.alloc(32, 7).toString("base64"),
    AUTH_HMAC_ACTIVE_VERSION: "1",
    PARTNER_REQUEST_MODE: "paired",
  };

  step("build-wasm", process.execPath, [npmCli, "run", "build:s1-wasm"], env);
  step("postgres", process.execPath, [npmCli, "run", "test:s1:postgres"], env);
  step("plaintext-inventory", process.execPath, [npmCli, "run", "s1:plaintext:assert-clean"], env);
  step("browser-e2e", process.execPath, [npmCli, "run", "test:s1:browser:e2e:prepared"], env);
  step("production-web-build", process.execPath, [npmCli, "run", "build", "--workspace", "@shawtie/web"], env);
  step("production-scan", process.execPath, [npmCli, "run", "s1:production:scan"], env);

  console.log("S1_LOCAL_POSTGRES_PORT " + pgPort);
  console.log("S1_LOCAL_AUTOMATED_PASS");
} finally {
  if (started) run(docker, ["stop", "--time", "2", postgres], { stdio: "ignore" });
}
