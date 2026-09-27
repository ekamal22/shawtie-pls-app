import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const postgresImage = process.env.SHAWTIE_TEST_POSTGRES_IMAGE ?? "postgres:16-alpine";
const minioImage = process.env.SHAWTIE_TEST_MINIO_IMAGE ?? "quay.io/minio/minio:latest";
const mcImage = process.env.SHAWTIE_TEST_MINIO_MC_IMAGE ?? "quay.io/minio/mc:latest";
const suffix = process.pid;
const network = "shawtie-s1-privacy-net-" + suffix;
const postgres = "shawtie-s1-privacy-postgres-" + suffix;
const minio = "shawtie-s1-privacy-minio-" + suffix;
const pgUser = "shawtie_test";
const pgPassword = "shawtie_test";
const pgDatabase = "shawtie_s1_privacy_test";
const minioUser = "shawtie_s1_privacy";
const minioPassword = "shawtie-s1-privacy-secret-123456";
const bucket = "shawtie-s1-privacy";
const objectKey = "media/v1/raw-inspection-object";
const sentinel = "s1-raw-private-" + randomBytes(18).toString("hex");

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
    throw new Error(String(result.stderr || result.stdout || "docker failed").trim());
  }
  return typeof result.stdout === "string" ? result.stdout.trim() : result.stdout;
}

function hostPort(docker, container, port) {
  const output = dockerRun(docker, ["port", container, port + "/tcp"]);
  const match = String(output).match(/:(\d+)\s*$/);
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
  console.log("S1_RAW_PRIVACY_STEP_START " + name);
  const result = run(command, args, { env });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error("S1 raw privacy step " + name + " exited with status " + result.status);
  }
  console.log("S1_RAW_PRIVACY_STEP_PASS " + name);
  return String(result.stdout ?? "") + String(result.stderr ?? "");
}

function assertNoSentinel(label, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  if (bytes.includes(Buffer.from(sentinel))) {
    throw new Error("Protected plaintext appeared in " + label);
  }
}

const docker = findDocker();
const started = [];
let networkCreated = false;

try {
  dockerRun(docker, ["network", "create", network]);
  networkCreated = true;
  dockerRun(docker, [
    "run",
    "--detach",
    "--rm",
    "--name",
    postgres,
    "--network",
    network,
    "-e",
    "POSTGRES_USER=" + pgUser,
    "-e",
    "POSTGRES_PASSWORD=" + pgPassword,
    "-e",
    "POSTGRES_DB=" + pgDatabase,
    "-p",
    "127.0.0.1::5432",
    postgresImage,
  ]);
  started.push(postgres);
  dockerRun(docker, [
    "run",
    "--detach",
    "--rm",
    "--name",
    minio,
    "--network",
    network,
    "-e",
    "MINIO_ROOT_USER=" + minioUser,
    "-e",
    "MINIO_ROOT_PASSWORD=" + minioPassword,
    "-p",
    "127.0.0.1::9000",
    minioImage,
    "server",
    "/data",
    "--address",
    ":9000",
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
      return (await fetch(minioEndpoint + "/minio/health/ready")).ok;
    } catch {
      return false;
    }
  }, "MinIO");
  dockerRun(docker, [
    "run",
    "--rm",
    "--network",
    network,
    "--entrypoint",
    "/bin/sh",
    mcImage,
    "-c",
    "mc alias set local http://" +
      minio +
      ":9000 " +
      minioUser +
      " " +
      minioPassword +
      " >/dev/null && mc mb --ignore-existing local/" +
      bucket +
      " >/dev/null",
  ]);

  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("Run through npm: npm run test:s1:privacy");
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
    MEDIA_S3_ENDPOINT: minioEndpoint,
    MEDIA_S3_BUCKET: bucket,
    MEDIA_S3_REGION: "us-east-1",
    MEDIA_S3_ACCESS_KEY_ID: minioUser,
    MEDIA_S3_SECRET_ACCESS_KEY: minioPassword,
    S1_RAW_SENTINEL: sentinel,
    S1_RAW_OBJECT_KEY: objectKey,
  };

  step("build-wasm", process.execPath, [npmCli, "run", "build:s1-wasm"], env);
  const postgresOutput = step(
    "postgres",
    process.execPath,
    [npmCli, "run", "test:s1:postgres"],
    env,
  );
  const storageOutput =
    step(
      "object-storage",
      process.execPath,
      [npmCli, "run", "build", "--workspace", "@shawtie/media-storage", "--silent"],
      env,
    ) +
    step(
      "object-storage-integration",
      process.execPath,
      ["--test", "packages/media-storage/tests/s1.raw-privacy.integration.test.ts"],
      env,
    );
  const workerOutput = step(
    "realtime-push-control",
    process.execPath,
    ["--test", "apps/worker/tests/m2.realtime.test.ts", "apps/worker/tests/c1.worker.test.ts"],
    env,
  );
  const browserOutput = step(
    "browser-durable-storage",
    process.execPath,
    [npmCli, "run", "test:s1:browser:e2e:prepared"],
    env,
  );

  const dump = dockerRun(
    docker,
    ["exec", postgres, "pg_dump", "--no-owner", "--no-privileges", "-U", pgUser, pgDatabase],
    { encoding: null },
  );
  assertNoSentinel("raw PostgreSQL dump", dump);
  console.log("S1_POSTGRES_DUMP_PLAINTEXT_INSPECTION_PASS bytes=" + dump.length);

  const rawObject = dockerRun(
    docker,
    [
      "run",
      "--rm",
      "--network",
      network,
      "--entrypoint",
      "/bin/sh",
      mcImage,
      "-c",
      "mc alias set local http://" +
        minio +
        ":9000 " +
        minioUser +
        " " +
        minioPassword +
        " >/dev/null && mc cat local/" +
        bucket +
        "/" +
        objectKey,
    ],
    { encoding: null },
  );
  assertNoSentinel("raw object storage bytes", rawObject);
  if (rawObject.length === 0) throw new Error("Raw object storage inspection returned no bytes");
  console.log("S1_MINIO_RAW_OBJECT_INSPECTION_PASS bytes=" + rawObject.length);

  const postgresLogs = dockerRun(docker, ["logs", postgres], { encoding: null });
  const minioLogs = dockerRun(docker, ["logs", minio], { encoding: null });
  for (const [label, output] of [
    ["PostgreSQL logs", postgresLogs],
    ["MinIO logs", minioLogs],
    ["test process output", postgresOutput + storageOutput + workerOutput + browserOutput],
  ]) {
    assertNoSentinel(label, output);
  }
  console.log("S1_LOG_PLAINTEXT_INSPECTION_PASS");
  console.log("S1_BROWSER_DURABLE_STORAGE_PASS");
  console.log("S1_REALTIME_PUSH_CONTROL_PRIVACY_PASS");
  console.log("S1_RAW_PRIVACY_INSPECTION_PASS");
} finally {
  for (const container of started.reverse()) {
    run(docker, ["stop", "--time", "2", container], { stdio: "ignore" });
  }
  if (networkCreated) run(docker, ["network", "rm", network], { stdio: "ignore" });
}
