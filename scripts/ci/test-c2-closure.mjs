import { spawnSync } from "node:child_process";

const expectedBranch = "feat/c2-video-calling";
const baseRef = process.env.C2_BASE_REF ?? "origin/main";
const emDash = String.fromCodePoint(0x2014);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim();
    throw new Error(
      command + " " + args.join(" ") + " exited with status " + result.status
        + (detail ? "\n" + detail : ""),
    );
  }
  return result.stdout?.trim() ?? "";
}

function step(name, command, args, env = process.env) {
  console.log("C2_CLOSURE_STEP_START " + name);
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "inherit",
    env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error("C2 closure step " + name + " exited with status " + result.status);
  }
  console.log("C2_CLOSURE_STEP_PASS " + name);
}

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run through npm: npm run test:c2:closure");
if ((process.env.SHAWTIE_MIGRATION_RESERVATIONS ?? "").trim()) {
  throw new Error("C2 integrated closure forbids SHAWTIE_MIGRATION_RESERVATIONS.");
}

const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== expectedBranch) {
  throw new Error("C2 closure must run on " + expectedBranch + ". Current branch: " + branch);
}
const initialStatus = run("git", ["status", "--short"]);
if (initialStatus) throw new Error("C2 closure requires a clean worktree.\n" + initialStatus);

step("fetch", "git", ["fetch", "origin"]);
const localHead = run("git", ["rev-parse", "HEAD"]);
const remoteHead = run("git", ["rev-parse", "origin/" + expectedBranch]);
if (localHead !== remoteHead) {
  throw new Error("Local C2 HEAD does not match origin. local=" + localHead + " remote=" + remoteHead);
}

const behind = run("git", ["rev-list", "--count", "HEAD.." + baseRef]);
if (behind !== "0") throw new Error("C2 branch is behind " + baseRef + " by " + behind + " commits.");

const commits = run("git", ["log", "--format=%H%x09%s", baseRef + "..HEAD"]);
for (const line of commits.split("\n").filter(Boolean)) {
  const separator = line.indexOf("\t");
  const sha = separator >= 0 ? line.slice(0, separator) : line;
  const subject = separator >= 0 ? line.slice(separator + 1) : "";
  if (!subject.includes("[skip ci]")) {
    throw new Error("C2 commit is missing [skip ci]: " + sha + " " + subject);
  }
}

const diff = run("git", ["diff", "--unified=0", baseRef + "...HEAD", "--", "."]);
const introducedEmDash = diff
  .split("\n")
  .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
  .find((line) => line.includes(emDash));
if (introducedEmDash) throw new Error("C2 diff introduces a forbidden em dash.");

step("m3-local", process.execPath, [npmCli, "run", "test:m3:local"]);
step("c1-local", process.execPath, [npmCli, "run", "test:c1:local"]);
step("c1-browser-e2e", process.execPath, [npmCli, "run", "test:c1:browser:e2e"]);
step("c2-local", process.execPath, [npmCli, "run", "test:c2:local"]);
step("c2-browser-e2e", process.execPath, [npmCli, "run", "test:c2:browser:e2e"]);
step("health", process.execPath, [npmCli, "run", "health"]);
step("audit-high", process.execPath, [npmCli, "audit", "--audit-level=high"]);
step("git-diff-check", "git", ["diff", "--check"]);

const finalStatus = run("git", ["status", "--short"]);
if (finalStatus) throw new Error("C2 automated closure left a dirty worktree.\n" + finalStatus);

console.log("C2_AUTOMATED_IMPLEMENTATION_HEAD " + localHead);
console.log("C2_AUTOMATED_INTEGRATED_PASS reserved=0");
console.log("C2 integrated migration closure passed against real migrations 0001-0018 with reserved=0.");
console.log(
  "C2 physical Android acceptance remains a separate required gate and is not implied by this marker.",
);
