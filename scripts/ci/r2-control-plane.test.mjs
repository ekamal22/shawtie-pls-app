import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

function run(script, args = [], env = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("R2 default manual evidence ledger blocks closure", () => {
  const result = run("scripts/ci/r2-manual-evidence.mjs");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /R2_MANUAL_EVIDENCE_INVALID candidateSha/);
});


function completePreProvenanceEvidence(candidateSha) {
  const gates = {
    brevoSenderDomainVerified: true,
    brevoSmokeSendPassed: true,
    brevoRegistrationAndResendPassed: true,
    publicHttpsHeadersPassed: true,
    productionWebPushPassed: true,
    backupRestoreDeletionDrillPassed: true,
    operationalAlertReceived: true,
    repositoryProtectionApplied: true,
    licenseReviewed: true,
    signedReleaseProvenancePassed: false,
    accessibilityManualPassed: true,
    performanceDevicePassed: true,
    physicalAndroidPassed: true,
    voiceVideoPrivacyPassed: true,
    e2eeReleaseReviewPassed: true,
    stagedRollbackPassed: true,
    privacyTermsOwnerReviewPassed: true,
    hostedAutomatedGatePassed: true,
    brevoSeriousEventPassed: true,
    productionTopologyReviewed: true,
    productionDeploymentSmokePassed: true,
    supportWorkflowPassed: true,
  };
  return {
    schemaVersion: 2,
    candidateSha,
    recordedAt: "2026-10-03T12:00:00.000Z",
    gates: Object.fromEntries(
      Object.entries(gates).map(([key, passed]) => [
        key,
        { passed, evidence: passed ? "synthetic control-plane test" : null },
      ]),
    ),
  };
}

test("R2 manual evidence allows evidence-only descendants and defers signed provenance", () => {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dir = mkdtempSync(path.join(tmpdir(), "shawtie-r2-evidence-"));
  const evidencePath = path.join(dir, "evidence.json");
  try {
    writeFileSync(evidencePath, JSON.stringify(completePreProvenanceEvidence(head)));
    const result = run("scripts/ci/r2-manual-evidence.mjs", [], {
      R2_MANUAL_EVIDENCE_FILE: evidencePath,
      R2_EVIDENCE_HEAD_SHA: head,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /R2_MANUAL_EVIDENCE_PASS/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R2 final release gate still requires recorded signed provenance", () => {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dir = mkdtempSync(path.join(tmpdir(), "shawtie-r2-finalize-"));
  const evidencePath = path.join(dir, "evidence.json");
  try {
    writeFileSync(evidencePath, JSON.stringify(completePreProvenanceEvidence(head)));
    const result = run("scripts/release/finalize-r2-release.mjs", [], {
      R2_MANUAL_EVIDENCE_FILE: evidencePath,
      R2_EVIDENCE_HEAD_SHA: head,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /signedReleaseProvenancePassed is not recorded/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R2 restore tooling rejects a non PostgreSQL target before execution", () => {
  const result = run("scripts/operations/postgres-restore.mjs", ["fake.dump", "fake-journal.json"], {
    DATABASE_URL: "https://example.test/not-a-database",
    R2_RESTORE_CONFIRM: "RESTORE",
    R2_RESTORE_ISOLATED: "1",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DATABASE_URL must use PostgreSQL/);
});

test("R2 production API contract accepts the complete stable product configuration", () => {
  const result = run("scripts/release/verify-production-contract.mjs", ["api"], {
    NODE_ENV: "production",
    APP_ORIGIN: "https://shawtie.example.test",
    DATABASE_URL: "postgresql://user:pass@db.internal:5432/shawtie",
    AUTH_HMAC_KEYS: "1:placeholder",
    AUTH_HMAC_ACTIVE_VERSION: "1",
    PARTNER_REQUEST_MODE: "paired",
    MEDIA_UPLOAD_INITIATION_ENABLED: "1",
    MEDIA_BINDING_ENABLED: "1",
    MEDIA_DOWNLOAD_GRANT_ENABLED: "1",
    MEDIA_S3_ENDPOINT: "https://storage.example.test",
    MEDIA_S3_BUCKET: "shawtie",
    MEDIA_S3_REGION: "auto",
    MEDIA_S3_ACCESS_KEY_ID: "placeholder",
    MEDIA_S3_SECRET_ACCESS_KEY: "placeholder",
    C1_CALLING_ENABLED: "1",
    C1_TRANSPORT_ENABLED: "1",
    C2_VIDEO_ENABLED: "1",
    C1_TURN_URLS: "turns:turn.example.test:5349?transport=tcp",
    C1_TURN_SHARED_SECRET: "placeholder",
    C1_PUSH_VAPID_PUBLIC_KEY: "placeholder",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /R2_PRODUCTION_CONTRACT_PASS role=api/);
});

test("R2 web contract rejects an unreviewed public plaintext backend hop", () => {
  const result = run("scripts/release/verify-production-contract.mjs", ["web"], {
    NODE_ENV: "production",
    APP_ORIGIN: "https://shawtie.example.test",
    BACKEND_PROXY_TARGET: "http://203.0.113.10:3000",
    WEB_TRUSTED_PROXY: "203.0.113.20/32",
    WEB_MEDIA_CONNECT_SRC: "https://storage.example.test",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /HTTP BACKEND_PROXY_TARGET/);
});

test("R2 worker contract refuses missing push provider key material", () => {
  const result = run("scripts/release/verify-production-contract.mjs", ["worker"], {
    NODE_ENV: "production",
    APP_ORIGIN: "https://shawtie.example.test",
    DATABASE_URL: "postgresql://user:pass@db.internal:5432/shawtie",
    AUTH_HMAC_KEYS: "1:placeholder",
    AUTH_HMAC_ACTIVE_VERSION: "1",
    MEDIA_S3_ENDPOINT: "https://storage.example.test",
    MEDIA_S3_BUCKET: "shawtie",
    MEDIA_S3_REGION: "auto",
    MEDIA_S3_ACCESS_KEY_ID: "placeholder",
    MEDIA_S3_SECRET_ACCESS_KEY: "placeholder",
    EMAIL_PROVIDER: "brevo",
    BREVO_API_KEY: "placeholder",
    BREVO_SENDER_EMAIL: "security@example.test",
    BREVO_SENDER_NAME: "Shawtie pls",
    C1_PUSH_VAPID_SUBJECT: "mailto:security@example.test",
    C1_PUSH_VAPID_PUBLIC_KEY: "placeholder",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /C1_PUSH_VAPID_PRIVATE_KEY is required/);
});
