import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) {
    throw new Error(command + " " + args.join(" ") + " failed");
  }
}

const evidencePath =
  process.env.R2_MANUAL_EVIDENCE_FILE || "docs/testing/R2_MANUAL_ACCEPTANCE_EVIDENCE.json";
const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
const candidateSha = typeof evidence?.candidateSha === "string" ? evidence.candidateSha.trim() : "";
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

if (!/^[0-9a-f]{40}$/.test(candidateSha)) {
  throw new Error("R2 manual evidence candidateSha is invalid");
}

run("node", ["scripts/ci/r2-manual-evidence.mjs"], {
  R2_MANUAL_EVIDENCE_FILE: evidencePath,
  R2_EVIDENCE_HEAD_SHA: head,
});

const provenance = evidence?.gates?.signedReleaseProvenancePassed;
if (provenance?.passed !== true) {
  throw new Error("signedReleaseProvenancePassed is not recorded");
}
if (typeof provenance.evidence !== "string" || provenance.evidence.trim().length < 3) {
  throw new Error("signedReleaseProvenancePassed evidence is missing");
}

run("node", ["scripts/release/verify-provenance.mjs"], {
  R2_CANDIDATE_SHA: candidateSha,
});

console.log(
  "R2_FINAL_RELEASE_GATE_PASS candidate=" +
    candidateSha +
    " evidenceHead=" +
    head +
    " tag=" +
    process.env.R2_RELEASE_TAG,
);
