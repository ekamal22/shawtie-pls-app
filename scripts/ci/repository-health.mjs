import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const failures = [];
const notes = [];
const EM_DASH = "\u2014";

const ignoredDirectories = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".vite",
  ".turbo",
]);

const textExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".sql",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

const requiredPaths = [
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "package.json",
  "docs/product/PRD.md",
  "docs/PROJECT_STATE.md",
  "docs/ROADMAP.md",
  "docs/ROADMAP_EPICS.md",
  "docs/architecture/ARCHITECTURE_BASELINE.md",
  "docs/architecture/ARCHITECTURE_GOVERNANCE.md",
  "docs/security/THREAT_MODEL.md",
  "docs/security/DATA_CLASSIFICATION.md",
  "docs/testing/TEST_STRATEGY.md",
  "docs/testing/CI_AND_REPOSITORY_HEALTH.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/CODEOWNERS",
];

const forbiddenSecretFileNames = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  ".env.test",
]);

const forbiddenSecretExtensions = new Set([
  ".key",
  ".p12",
  ".pfx",
  ".pem",
  ".sqlite",
  ".sqlite3",
]);

const secretPatterns = [
  ["private key material", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ["live secret key", /\bsk_live_[A-Za-z0-9]{16,}\b/],
];

const forbiddenDomainPackages = [
  "react",
  "react-dom",
  "fastify",
  "pg",
  "postgres",
  "drizzle-orm",
  "@prisma/",
  "knex",
  "typeorm",
  "sequelize",
  "@aws-sdk/",
  "@supabase/",
  "firebase",
  "@google-cloud/",
  "resend",
  "nodemailer",
  "redis",
  "ioredis",
];

const genericCatchAllNames = new Set(["shared", "common", "helpers", "misc"]);

function fail(message) {
  failures.push(message);
}

async function walk(directory, files = []) {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;

    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");

    if (entry.isDirectory()) {
      if (
        (relative.startsWith("apps/") || relative.startsWith("packages/"))
        && genericCatchAllNames.has(entry.name)
      ) {
        fail(`Generic catch-all directory is forbidden: ${relative}`);
      }

      await walk(absolute, files);
    } else if (entry.isFile()) {
      files.push({ absolute, relative });
    }
  }

  return files;
}

function isTextFile(relative) {
  const base = path.basename(relative);

  if (["Dockerfile", "Makefile", ".gitignore", ".npmrc"].includes(base)) {
    return true;
  }

  return textExtensions.has(path.extname(relative).toLowerCase());
}

function isForbiddenDomainImport(specifier) {
  if (
    specifier.includes("/apps/")
    || specifier.startsWith("apps/")
    || specifier.startsWith("../../../apps")
  ) {
    return true;
  }

  if (specifier.startsWith("@shawtie/") && specifier !== "@shawtie/domain") {
    return true;
  }

  return forbiddenDomainPackages.some(
    (prefix) => specifier === prefix || specifier.startsWith(prefix),
  );
}

function checkDomainImports(relative, content) {
  if (
    !relative.startsWith("packages/domain/")
    || !/\.(?:ts|tsx|js|mjs)$/.test(relative)
  ) {
    return;
  }

  const patterns = [
    /\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (isForbiddenDomainImport(match[1])) {
        fail(`Forbidden domain dependency in ${relative}: ${match[1]}`);
      }
    }
  }
}

function checkWorkflowPolicy(relative, content) {
  if (
    !relative.startsWith(".github/workflows/")
    || !/\.ya?ml$/.test(relative)
  ) {
    return;
  }

  if (/pull_request_target\s*:/.test(content)) {
    fail(
      `pull_request_target is forbidden without an accepted security review: ${relative}`,
    );
  }

  if (/permissions\s*:\s*write-all/.test(content)) {
    fail(`write-all workflow permissions are forbidden: ${relative}`);
  }

  if (!/^permissions\s*:/m.test(content)) {
    fail(`Workflow must declare explicit permissions: ${relative}`);
  }

  if (!/timeout-minutes\s*:/.test(content)) {
    fail(`Workflow jobs must declare timeout-minutes: ${relative}`);
  }

  for (const match of content.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)) {
    const reference = match[1];

    if (reference.startsWith("./")) continue;

    const atIndex = reference.lastIndexOf("@");
    const ref = atIndex >= 0 ? reference.slice(atIndex + 1) : "";

    if (!/^[0-9a-f]{40}$/i.test(ref)) {
      fail(`External GitHub Action must be pinned to a full commit SHA: ${relative}: ${reference}`);
    }
  }
}

for (const required of requiredPaths) {
  if (!existsSync(path.join(root, required))) {
    fail(`Required repository file is missing: ${required}`);
  }
}

const files = await walk(root);

for (const file of files) {
  const base = path.basename(file.relative);
  const extension = path.extname(base).toLowerCase();

  if (forbiddenSecretFileNames.has(base)) {
    fail(`Secret-bearing environment file must not be committed: ${file.relative}`);
  }

  if (forbiddenSecretExtensions.has(extension)) {
    fail(`Sensitive file extension must not be committed: ${file.relative}`);
  }

  if (file.relative.startsWith("docs/worklog/")) {
    fail(
      `Private worklog directory is forbidden in the public repository: ${file.relative}`,
    );
  }

  if (!isTextFile(file.relative)) continue;

  const info = await stat(file.absolute);

  if (info.size > 5 * 1024 * 1024) {
    notes.push(
      `Skipped text scan for file larger than 5 MiB: ${file.relative}`,
    );
    continue;
  }

  const content = await readFile(file.absolute, "utf8");

  if (content.includes(EM_DASH)) {
    fail(`Unicode em dash is forbidden: ${file.relative}`);
  }

  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(content)) {
      fail(`Possible ${label} detected in ${file.relative}`);
    }
  }

  checkDomainImports(file.relative, content);
  checkWorkflowPolicy(file.relative, content);
}

try {
  const message = execFileSync(
    "git",
    ["log", "-1", "--format=%B"],
    { cwd: root, encoding: "utf8" },
  );

  if (message.includes(EM_DASH)) {
    fail("Unicode em dash is forbidden in the current commit message");
  }
} catch {
  notes.push(
    "Git metadata unavailable, current commit-message policy was not checked",
  );
}

if (failures.length > 0) {
  console.error("REPOSITORY_HEALTH_FAIL");

  for (const failure of failures) {
    console.error(`- ${failure}`);
  }

  process.exit(1);
}

console.log("REPOSITORY_HEALTH_PASS");
console.log(`Scanned ${files.length} repository files`);

for (const note of notes) {
  console.log(`NOTE: ${note}`);
}
