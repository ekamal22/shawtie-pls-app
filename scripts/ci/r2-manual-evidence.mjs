import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

const path =
  process.env.R2_MANUAL_EVIDENCE_FILE || "docs/testing/R2_MANUAL_ACCEPTANCE_EVIDENCE.json";
const evidence = JSON.parse(await readFile(path, "utf8"));
const required = [
  "brevoSenderDomainVerified",
  "brevoSmokeSendPassed",
  "brevoRegistrationAndResendPassed",
  "publicHttpsHeadersPassed",
  "productionWebPushPassed",
  "backupRestoreDeletionDrillPassed",
  "operationalAlertReceived",
  "repositoryProtectionApplied",
  "licenseReviewed",
  "signedReleaseProvenancePassed",
  "accessibilityManualPassed",
  "performanceDevicePassed",
  "physicalAndroidPassed",
  "voiceVideoPrivacyPassed",
  "e2eeReleaseReviewPassed",
  "stagedRollbackPassed",
  "privacyTermsOwnerReviewPassed",
];

const expectedSha = process.env.R2_CANDIDATE_SHA?.trim() || git(["rev-parse", "HEAD"]);
const candidateSha = typeof evidence?.candidateSha === "string" ? evidence.candidateSha.trim() : "";
const recordedAt = typeof evidence?.recordedAt === "string" ? evidence.recordedAt.trim() : "";

if (!/^[0-9a-f]{40}$/.test(candidateSha)) {
  console.error("R2_MANUAL_EVIDENCE_INVALID candidateSha");
  process.exit(1);
}
if (candidateSha !== expectedSha) {
  console.error(
    "R2_MANUAL_EVIDENCE_CANDIDATE_MISMATCH expected=" +
      expectedSha +
      " actual=" +
      candidateSha,
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
    " recordedAt=" +
    recordedAt,
);
