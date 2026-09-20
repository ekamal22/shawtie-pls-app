import { spawnSync } from "node:child_process";

const image = process.env.SHAWTIE_TEST_POSTGRES_IMAGE ?? "postgres:16-alpine";
const requestedPort = process.env.SHAWTIE_TEST_POSTGRES_PORT;
const containerName = `shawtie-a1-postgres-${process.pid}`;
const user = "shawtie_test";
const password = "shawtie_test";
const database = "shawtie_a1_test";

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
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
    if (!result.error && result.status === 0) {
      return candidate;
    }
  }

  throw new Error(
    "Docker CLI or Docker Desktop engine is unavailable. Start Docker Desktop and retry. "
      + "If docker.exe is in a custom location, set DOCKER_CLI to its full path.",
  );
}

function runDocker(docker, args, options = {}) {
  const result = run(docker, args, options);

  if (result.error) throw result.error;

  if (result.status !== 0) {
    const message = result.stderr?.trim() || result.stdout?.trim();
    throw new Error(message || "docker exited with status " + result.status);
  }

  return result.stdout?.trim() ?? "";
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const docker = findDocker();
let started = false;

try {
  console.log(
    "A1_LOCAL_POSTGRES_START image="
      + image
      + (requestedPort ? " port=" + requestedPort : " port=dynamic"),
  );

  const publish = requestedPort
    ? "127.0.0.1:" + requestedPort + ":5432"
    : "127.0.0.1::5432";

  runDocker(
    docker,
    [
      "run",
      "--detach",
      "--rm",
      "--name",
      containerName,
      "--label",
      "com.shawtie.role=a1-disposable-postgres",
      "-e",
      "POSTGRES_USER=" + user,
      "-e",
      "POSTGRES_PASSWORD=" + password,
      "-e",
      "POSTGRES_DB=" + database,
      "-p",
      publish,
      image,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  started = true;

  let ready = false;
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    const result = run(
      docker,
      [
        "exec",
        containerName,
        "pg_isready",
        "-U",
        user,
        "-d",
        database,
      ],
      { stdio: "ignore" },
    );

    if (!result.error && result.status === 0) {
      ready = true;
      break;
    }

    await sleep(1_000);
  }

  if (!ready) {
    const logs = runDocker(docker, ["logs", containerName]);
    throw new Error(
      "Disposable PostgreSQL did not become ready. Container logs:\n" + logs,
    );
  }

  const portOutput = runDocker(
    docker,
    ["port", containerName, "5432/tcp"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const portMatch = portOutput.match(/:(\d+)\s*$/);
  if (!portMatch) {
    throw new Error(
      "Could not determine the disposable PostgreSQL host port from Docker: "
        + portOutput,
    );
  }

  const port = portMatch[1];
  const databaseUrl =
    `postgresql://${user}:${password}@127.0.0.1:${port}/${database}`;

  console.log("A1_LOCAL_POSTGRES_READY port=" + port);

  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error(
      "npm_execpath is unavailable. Run this command through npm: npm run test:a1:local",
    );
  }

  const testResult = run(
    process.execPath,
    [npmCli, "run", "test:a1:postgres"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        DB_TEST_CONFIRM: "1",
        NODE_ENV: "test",
        APP_ORIGIN: "http://127.0.0.1:4173",
        ALLOW_INSECURE_LOOPBACK_COOKIES: "1",
        AUTH_HMAC_KEYS: "1:" + Buffer.alloc(32, 7).toString("base64"),
        AUTH_HMAC_ACTIVE_VERSION: "1",
      },
    },
  );

  if (testResult.error) throw testResult.error;
  if (testResult.status !== 0) {
    throw new Error(
      "A1 PostgreSQL suite exited with status " + testResult.status,
    );
  }

  console.log("A1_LOCAL_POSTGRES_PASS");
} finally {
  if (started) {
    const cleanup = run(docker, ["stop", "--time", "2", containerName], {
      stdio: "ignore",
    });

    if (cleanup.error || cleanup.status !== 0) {
      console.error("A1_LOCAL_POSTGRES_CLEANUP_WARNING", {
        containerName,
      });
    }
  }
}
