import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

function git(args, options = {}) {
  return execFileSync("git", args, { encoding: "utf8", ...options }).trim();
}

const path =
  process.env.R2_MANUAL_EVIDENCE_FILE || "docs/testing/R2_MANUAL_ACCEPTANCE_EVIDENCE.json";
const evidence = JSON.parse(await readFile(path, "utf8"));
const required = [
  "hostedAutomatedGatePassed",
  "brevoSenderDomainVerified",
  "brevoSmokeSendPassed",
  "brevoRegistrationAndResendPassed",
  "brevoSeriousEventPassed",
  "productionTopologyReviewed",
  "productionDeploymentSmokePassed",
  "publicHttpsHeadersPassed",
  "productionWebPushPassed",
  "backupRestoreDeletionDrillPassed",
  "operationalAlertReceived",
  "repositoryProtectionApplied",
  "licenseReviewed",
  "accessibilityManualPassed",
  "performanceDevicePassed",
  "physicalAndroidPassed",
  "voiceVideoPrivacyPassed",
  "e2eeReleaseReviewPassed",
  "stagedRollbackPassed",
  "supportWorkflowPassed",
  "privacyTermsOwnerReviewPassed",
];

const head = process.env.R2_EVIDENCE_HEAD_SHA?.trim() || git(["rev-parse", "HEAD"]);
const candidateSha = typeof evidence?.candidateSha === "string" ? evidence.candidateSha.trim() : "";
const recordedAt = typeof evidence?.recordedAt === "string" ? evidence.recordedAt.trim() : "";

if (!/^[0-9a-f]{40}$/.test(candidateSha)) {
  console.error("R2_MANUAL_EVIDENCE_INVALID candidateSha");
  process.exit(1);
}
if (!/^[0-9a-f]{40}$/.test(head)) {
  console.error("R2_MANUAL_EVIDENCE_INVALID headSha");
  process.exit(1);
}

const ancestor = execFileSync("git", ["merge-base", "--is-ancestor", candidateSha, head], {
  stdio: "ignore",
});
if (ancestor === undefined) {
  // execFileSync returns undefined on success with ignored stdio.
}

const changedFiles = git(["diff", "--name-only", candidateSha + ".." + head])
  .split(/\r?\n/)
  .filter(Boolean);
const releaseDrift = changedFiles.filter(
  (file) => file !== "README.md" && !file.startsWith("docs/"),
);
if (releaseDrift.length > 0) {
  console.error(
    "R2_MANUAL_EVIDENCE_RELEASE_DRIFT candidate=" +
      candidateSha +
      " head=" +
      head +
      " files=" +
      releaseDrift.join(","),
  );
  process.exit(1);
}

if (!recordedAt || !Number.isFinite(Date.parse(recordedAt))) {
  console.error("R2_MANUAL_EVIDENCE_INVALID recordedAt");
  process.exit(1);
}

const missing = [];
for (const key of required) {
  const gate = evidence?.gates?.[key];
  if (gate?.passed !== true) {
    missing.push(key + ":not_passed");
    continue;
  }
  if (typeof gate.evidence !== "string" || gate.evidence.trim().length < 3) {
    missing.push(key + ":evidence_missing");
  }
}

if (missing.length > 0) {
  console.error("R2_MANUAL_EVIDENCE_INCOMPLETE gates=" + missing.join(","));
  process.exit(1);
}

console.log(
  "R2_MANUAL_EVIDENCE_PASS gates=" +
    required.length +
    " candidate=" +
    candidateSha +
    " evidenceHead=" +
    head +
    " recordedAt=" +
    recordedAt,
);
