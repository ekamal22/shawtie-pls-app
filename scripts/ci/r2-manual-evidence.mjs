import { readFile } from "node:fs/promises";

const path = process.env.R2_MANUAL_EVIDENCE_FILE || "docs/testing/R2_MANUAL_ACCEPTANCE_EVIDENCE.json";
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
  "privacyTermsOwnerReviewPassed"
];
const missing = required.filter((key) => evidence?.gates?.[key]?.passed !== true);
if (missing.length > 0) {
  console.error("R2_MANUAL_EVIDENCE_INCOMPLETE gates=" + missing.join(","));
  process.exit(1);
}
console.log("R2_MANUAL_EVIDENCE_PASS gates=" + required.length);
