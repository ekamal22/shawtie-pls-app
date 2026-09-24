import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { S3MediaObjectStore, mediaStorageConfigFromEnv } from "../src/index.ts";

test("M3 S3-compatible adapter performs private whole-object lifecycle", async () => {
  const config = mediaStorageConfigFromEnv();
  if (!config) throw new Error("MEDIA_S3_* configuration is required for storage integration");
  const store = new S3MediaObjectStore(config);
  const objectKey = "media/v1/integration-" + randomUUID();
  const bytes = Buffer.from("shawtie-m3-private-ciphertext-smoke-" + randomUUID());
  const digest = createHash("sha256").update(bytes).digest("hex");

  const upload = await store.createUploadGrant({
    objectKey,
    sha256: digest,
    expiresAt: new Date(Date.now() + 60_000),
  });
  const first = await fetch(upload.url, {
    method: "PUT",
    headers: upload.requiredHeaders,
    body: bytes,
    redirect: "error",
  });
  assert.equal(first.ok, true, "first whole-object PUT must succeed");

  const duplicate = await fetch(upload.url, {
    method: "PUT",
    headers: upload.requiredHeaders,
    body: bytes,
    redirect: "error",
  });
  assert.equal(duplicate.status, 412, "create-only retry must not overwrite an existing object");

  assert.equal(
    await store.verifyObject({ objectKey, expectedBytes: BigInt(bytes.length), sha256: digest }),
    true,
  );

  const download = await store.createDownloadGrant({
    objectKey,
    expiresAt: new Date(Date.now() + 60_000),
  });
  const downloaded = await fetch(download.url, { redirect: "error", cache: "no-store" });
  assert.equal(downloaded.ok, true);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);

  await store.deleteObject(objectKey);
  assert.equal(
    await store.verifyObject({ objectKey, expectedBytes: BigInt(bytes.length), sha256: digest }),
    false,
  );
});
