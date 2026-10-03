import { execFileSync } from "node:child_process";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

const head = git(["rev-parse", "HEAD"]);
const expected = process.env.R2_CANDIDATE_SHA?.trim();
if (expected && expected !== head) {
  throw new Error("R2_CANDIDATE_SHA does not match HEAD");
}

const status = git(["status", "--porcelain=v1"]);
if (status) throw new Error("Release candidate worktree must be clean");

const releaseId = process.env.SHAWTIE_RELEASE_ID?.trim();
if (!releaseId || releaseId === "unversioned") {
  throw new Error("SHAWTIE_RELEASE_ID must be the exact release source SHA");
}
if (releaseId !== head) {
  throw new Error("SHAWTIE_RELEASE_ID must equal the exact HEAD SHA");
}

const branch = git(["branch", "--show-current"]);
console.log("R2_CANDIDATE_PASS sha=" + head + " branch=" + branch);
