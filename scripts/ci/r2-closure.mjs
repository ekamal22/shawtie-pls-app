import { execFileSync, spawnSync } from "node:child_process";

// Stable automated freeze trigger: V1 and R2 must both remain green on this exact main state.

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) {
    throw new Error(command + " " + args.join(" ") + " failed");
  }
}

const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

run("node", ["scripts/release/verify-candidate.mjs"], {
  R2_CANDIDATE_SHA: head,
  SHAWTIE_RELEASE_ID: head,
});
run("npm", ["run", "health"]);
run("npm", ["run", "test:r2:security"]);
run("npm", ["run", "test:r2:performance"]);
run("npm", ["run", "secret:scan"], { SECRET_SCAN_REQUIRE_FULL_HISTORY: "1" });
run("npm", ["audit", "--audit-level=high"]);
run("git", ["diff", "--check"]);
run("node", ["scripts/ci/r2-manual-evidence.mjs"], { R2_EVIDENCE_HEAD_SHA: head });

console.log("R2_PRE_PROVENANCE_ACCEPTANCE_PASS evidenceHead=" + head);
