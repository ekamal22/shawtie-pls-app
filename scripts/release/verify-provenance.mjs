import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const tag = process.env.R2_RELEASE_TAG?.trim();
const expectedSha = process.env.R2_CANDIDATE_SHA?.trim() || git(["rev-parse", "HEAD"]);
const artifactDir = path.resolve(process.env.R2_ARTIFACT_DIR || process.argv[2] || "");
if (!tag) throw new Error("R2_RELEASE_TAG is required");
if (!artifactDir || !(await stat(artifactDir)).isDirectory()) {
  throw new Error("R2_ARTIFACT_DIR is required");
}

execFileSync("git", ["verify-tag", tag], { stdio: "inherit" });
const tagSha = git(["rev-list", "-n", "1", tag]);
if (tagSha !== expectedSha) {
  throw new Error("Signed release tag does not point to the expected candidate SHA");
}

const sums = (await readFile(path.join(artifactDir, "SHA256SUMS"), "utf8"))
  .trim()
  .split(/\r?\n/)
  .filter(Boolean);
for (const line of sums) {
  const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
  if (!match) throw new Error("Malformed SHA256SUMS entry");
  const file = path.resolve(artifactDir, match[2]);
  if (!file.startsWith(artifactDir + path.sep)) throw new Error("Checksum path escapes artifact dir");
  const actual = createHash("sha256").update(await readFile(file)).digest("hex");
  if (actual !== match[1]) throw new Error("Artifact checksum mismatch: " + match[2]);
}

console.log(
  "R2_RELEASE_PROVENANCE_PASS tag=" + tag + " sha=" + expectedSha + " artifacts=" + sums.length,
);
