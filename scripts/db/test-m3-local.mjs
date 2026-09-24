import { spawnSync } from "node:child_process";

const postgresImage = process.env.SHAWTIE_TEST_POSTGRES_IMAGE ?? "postgres:16-alpine";
const minioImage = process.env.SHAWTIE_TEST_MINIO_IMAGE ?? "quay.io/minio/minio:latest";
const mcImage = process.env.SHAWTIE_TEST_MINIO_MC_IMAGE ?? "quay.io/minio/mc:latest";
const suffix = process.pid;
const network = "shawtie-m3-net-" + suffix;
const postgres = "shawtie-m3-postgres-" + suffix;
const minio = "shawtie-m3-minio-" + suffix;
const pgUser = "shawtie_test";
const pgPassword = "shawtie_test";
const pgDatabase = "shawtie_m3_test";
const minioUser = "shawtie_m3_test";
const minioPassword = "shawtie-m3-test-secret-123456";
const bucket = "shawtie-m3-test";

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

const docker = findDocker();
const started = [];
let networkCreated = false;

try {
  dockerRun(docker, ["network", "create", network]);
  networkCreated = true;

  dockerRun(docker, [
    "run", "--detach", "--rm", "--name", postgres, "--network", network,
    "-e", "POSTGRES_USER=" + pgUser,
    "-e", "POSTGRES_PASSWORD=" + pgPassword,
    "-e", "POSTGRES_DB=" + pgDatabase,
    "-p", "127.0.0.1::5432",
    postgresImage,
  ]);
  started.push(postgres);

  dockerRun(docker, [
    "run", "--detach", "--rm", "--name", minio, "--network", network,
    "-e", "MINIO_ROOT_USER=" + minioUser,
    "-e", "MINIO_ROOT_PASSWORD=" + minioPassword,
    "-p", "127.0.0.1::9000",
    minioImage,
    "server", "/data", "--address", ":9000",
  ]);
  started.push(minio);

  await waitFor(async () => {
    const result = run(docker, ["exec", postgres, "pg_isready", "-U", pgUser, "-d", pgDatabase], {
      stdio: "ignore",
    });
    return !result.error && result.status === 0;
  }, "PostgreSQL");

  const pgPort = hostPort(docker, postgres, 5432);
  const minioPort = hostPort(docker, minio, 9000);
  const minioEndpoint = "http://127.0.0.1:" + minioPort;

  await waitFor(async () => {
    try {
      const response = await fetch(minioEndpoint + "/minio/health/ready");
      return response.ok;
    } catch {
      return false;
    }
  }, "MinIO");

  dockerRun(docker, [
    "run", "--rm", "--network", network, "--entrypoint", "/bin/sh", mcImage, "-c",
    "mc alias set local http://" + minio + ":9000 " + minioUser + " " + minioPassword
      + " >/dev/null && mc mb --ignore-existing local/" + bucket + " >/dev/null",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("Run through npm: npm run test:m3:local");

  const commonEnv = {
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
    MEDIA_S3_ENDPOINT: minioEndpoint,
    MEDIA_S3_BUCKET: bucket,
    MEDIA_S3_REGION: "us-east-1",
    MEDIA_S3_ACCESS_KEY_ID: minioUser,
    MEDIA_S3_SECRET_ACCESS_KEY: minioPassword,
  };

  for (const script of ["test:m3:postgres", "test:m3:storage:integration", "test:m3:browser:e2e"]) {
    console.log("M3_LOCAL_STEP_START " + script);
    const result = run(process.execPath, [npmCli, "run", script], {
      stdio: "inherit",
      env: commonEnv,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(script + " exited with status " + result.status);
    console.log("M3_LOCAL_STEP_PASS " + script);
  }

  console.log("M3_LOCAL_POSTGRES_PORT " + pgPort);
  console.log("M3_LOCAL_MINIO_PORT " + minioPort);
  console.log("M3_LOCAL_PASS");
} finally {
  for (const container of started.reverse()) {
    run(docker, ["stop", "--time", "2", container], { stdio: "ignore" });
  }
  if (networkCreated) run(docker, ["network", "rm", network], { stdio: "ignore" });
}
