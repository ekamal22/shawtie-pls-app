import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
