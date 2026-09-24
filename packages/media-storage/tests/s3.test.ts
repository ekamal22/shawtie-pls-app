import assert from "node:assert/strict";
import test from "node:test";
import { S3MediaObjectStore, mediaStorageConfigFromEnv } from "../src/index.ts";

const config = {
  endpoint: "https://objects.example.test",
  bucket: "private-media",
  region: "auto",
  accessKeyId: "TESTACCESS",
  secretAccessKey: "test-secret-key",
};

test("M3 S3 upload grants are short-lived create-only opaque ciphertext PUTs", async () => {
  const store = new S3MediaObjectStore(config);
  const grant = await store.createUploadGrant({
    objectKey: "media/v1/abcdef0123456789",
    sha256: "a".repeat(64),
    expiresAt: new Date(Date.now() + 60_000),
  });
  const url = new URL(grant.url);
  assert.equal(url.origin, config.endpoint);
  assert.equal(url.pathname.includes("private-media/media/v1/abcdef0123456789"), true);
  assert.equal(url.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
  assert.equal(url.searchParams.has("X-Amz-Signature"), true);
  assert.equal(grant.requiredHeaders["content-type"], "application/octet-stream");
  assert.equal(grant.requiredHeaders["if-none-match"], "*");
  assert.equal(grant.requiredHeaders["x-amz-meta-sha256"], "a".repeat(64));
  assert.equal(grant.url.includes(config.secretAccessKey), false);
});

test("M3 storage config rejects partial and insecure remote configuration", () => {
  assert.equal(mediaStorageConfigFromEnv({}), null);
  assert.throws(() =>
    mediaStorageConfigFromEnv({
      MEDIA_S3_ENDPOINT: "https://objects.example.test",
      MEDIA_S3_BUCKET: "bucket",
    }),
  );
  assert.throws(() =>
    mediaStorageConfigFromEnv({
      MEDIA_S3_ENDPOINT: "http://objects.example.test",
      MEDIA_S3_BUCKET: "bucket",
      MEDIA_S3_REGION: "auto",
      MEDIA_S3_ACCESS_KEY_ID: "key",
      MEDIA_S3_SECRET_ACCESS_KEY: "secret",
    }),
  );
  assert.ok(
    mediaStorageConfigFromEnv({
      MEDIA_S3_ENDPOINT: "http://127.0.0.1:9000",
      MEDIA_S3_BUCKET: "bucket",
      MEDIA_S3_REGION: "auto",
      MEDIA_S3_ACCESS_KEY_ID: "key",
      MEDIA_S3_SECRET_ACCESS_KEY: "secret",
    }),
  );
});
