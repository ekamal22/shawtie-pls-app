import { spawnSync } from "node:child_process";

const expectedBranch = "feat/m3-media-voice";
const baseRef = process.env.M3_BASE_REF ?? "origin/main";
const emDash = String.fromCodePoint(0x2014);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim();
    throw new Error(command + " " + args.join(" ") + " exited with status " + result.status + (detail ? "\n" + detail : ""));
  }
  return result.stdout?.trim() ?? "";
}

function step(name, command, args) {
  console.log("M3_CLOSURE_STEP_START " + name);
  const result = spawnSync(command, args, { encoding: "utf8", stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("M3 closure step " + name + " exited with status " + result.status);
  console.log("M3_CLOSURE_STEP_PASS " + name);
}

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this through npm: npm run test:m3:closure");

const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== expectedBranch) {
  throw new Error("M3 closure must run on " + expectedBranch + ". Current branch: " + branch);
}
const initialStatus = run("git", ["status", "--short"]);
if (initialStatus) throw new Error("M3 closure requires a clean worktree.\n" + initialStatus);

step("fetch", "git", ["fetch", "origin"]);
const localHead = run("git", ["rev-parse", "HEAD"]);
const remoteHead = run("git", ["rev-parse", "origin/" + expectedBranch]);
if (localHead !== remoteHead) {
  throw new Error("Local M3 HEAD does not match origin. local=" + localHead + " remote=" + remoteHead);
}

const commits = run("git", ["log", "--format=%H%x09%s", baseRef + "..HEAD"]);
for (const line of commits.split("\n").filter(Boolean)) {
  const separator = line.indexOf("\t");
  const sha = separator >= 0 ? line.slice(0, separator) : line;
  const subject = separator >= 0 ? line.slice(separator + 1) : "";
  if (!subject.includes("[skip ci]")) {
    throw new Error("M3 commit is missing [skip ci]: " + sha + " " + subject);
  }
}

const diff = run("git", ["diff", "--unified=0", baseRef + "...HEAD", "--", "."]);
const introducedEmDash = diff
  .split("\n")
  .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
  .find((line) => line.includes(emDash));
if (introducedEmDash) throw new Error("M3 diff introduces a forbidden em dash.");

step("m3-local", process.execPath, [npmCli, "run", "test:m3:local"]);
step("health", process.execPath, [npmCli, "run", "health"]);
step("audit-high", process.execPath, [npmCli, "audit", "--audit-level=high"]);
step("git-diff-check", "git", ["diff", "--check"]);

const finalStatus = run("git", ["status", "--short"]);
if (finalStatus) throw new Error("M3 automated closure left a dirty worktree.\n" + finalStatus);

console.log("M3_AUTOMATED_CLOSURE_HEAD " + localHead);
console.log("M3_AUTOMATED_CLOSURE_PASS");
console.log("Physical Android 20-scenario acceptance and committed evidence remain separate required gates.");
