import { spawnSync } from "node:child_process";

const expectedBranch = "feat/sec1-pre-v1-security-hardening";
const baseRef = process.env.SEC1_BASE_REF ?? "origin/main";
const emDash = String.fromCodePoint(0x2014);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim();
    throw new Error(
      command +
        " " +
        args.join(" ") +
        " exited with status " +
        result.status +
        (detail ? "\n" + detail : ""),
    );
  }
  return result.stdout?.trim() ?? "";
}

function step(name, command, args) {
  console.log("SEC1_CLOSURE_STEP_START " + name);
  const result = spawnSync(command, args, { encoding: "utf8", stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error("SEC1 closure step " + name + " exited with status " + result.status);
  }
  console.log("SEC1_CLOSURE_STEP_PASS " + name);
}

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this through npm: npm run test:sec1:closure");

const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== expectedBranch) {
  throw new Error("SEC1 closure must run on " + expectedBranch + ". Current branch: " + branch);
}

const initialStatus = run("git", ["status", "--short"]);
if (initialStatus) throw new Error("SEC1 closure requires a clean worktree.\n" + initialStatus);

step("fetch", "git", ["fetch", "origin"]);
const localHead = run("git", ["rev-parse", "HEAD"]);
const remoteHead = run("git", ["rev-parse", "origin/" + expectedBranch]);
if (localHead !== remoteHead) {
  throw new Error(
    "Local SEC1 HEAD does not match origin. local=" + localHead + " remote=" + remoteHead,
  );
}

const commits = run("git", ["log", "--format=%H%x09%s", baseRef + "..HEAD"]);
for (const line of commits.split("\n").filter(Boolean)) {
  const separator = line.indexOf("\t");
  const sha = separator >= 0 ? line.slice(0, separator) : line;
  const subject = separator >= 0 ? line.slice(separator + 1) : "";
  if (!subject.includes("[skip ci]")) {
    throw new Error("SEC1 commit is missing [skip ci]: " + sha + " " + subject);
  }
}

const diff = run("git", ["diff", "--unified=0", baseRef + "...HEAD", "--", "."]);
const introducedEmDash = diff
  .split("\n")
  .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
  .find((line) => line.includes(emDash));
if (introducedEmDash) throw new Error("SEC1 diff introduces a forbidden em dash.");

step("password-corpus-regenerate", process.execPath, [
  npmCli,
  "run",
  "sec1:passwords:generate",
]);
step("password-corpus-reproducible", "git", [
  "diff",
  "--exit-code",
  "--",
  "apps/api/src/security/common-passwords.generated.ts",
]);
step("sec1-format", process.execPath, [npmCli, "run", "sec1:format:check"]);
step("sec1-focused", process.execPath, [npmCli, "run", "test:sec1"]);
step("sec1-postgres", process.execPath, [npmCli, "run", "test:sec1:local"]);
step("sec1-browser", process.execPath, [npmCli, "run", "test:sec1:browser:e2e"]);
step("sec1-production-scan", process.execPath, ["scripts/security/sec1-production-scan.mjs"]);
step("health", process.execPath, [npmCli, "run", "health"]);
step("audit-high", process.execPath, [npmCli, "audit", "--audit-level=high"]);
step("git-diff-check", "git", ["diff", "--check"]);

const finalStatus = run("git", ["status", "--short"]);
if (finalStatus) throw new Error("SEC1 automated closure left a dirty worktree.\n" + finalStatus);

console.log("SEC1_AUTOMATED_CLOSURE_HEAD " + localHead);
console.log("SEC1_PASSWORD_ADMISSION_PASS");
console.log("SEC1_RECOVERY_POLICY_PARITY_PASS");
console.log("SEC1_REAUTH_RATE_LIMIT_PASS");
console.log("SEC1_REGISTRATION_HASH_CLEANUP_PASS");
console.log("SEC1_BROWSER_HEADERS_PASS");
console.log("SEC1_CSP_WASM_PASS");
console.log("SEC1_A1_REGRESSION_PASS");
console.log("SEC1_REPOSITORY_HEALTH_PASS");
console.log("SEC1_DEPENDENCY_AUDIT_PASS");
console.log("SEC1_SECURITY_HARDENING_PASS");
console.log("Physical Android acceptance is not a default SEC1 gate.");
