import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import {
  decryptBytes,
  encryptBytes,
  envelopeContext,
  utf8,
  utf8Decode,
} from "../../crypto/src/index.ts";
import { S3MediaObjectStore, mediaStorageConfigFromEnv } from "../src/index.ts";

test("S1 object storage contains authenticated ciphertext and no protected plaintext", async () => {
  const config = mediaStorageConfigFromEnv();
  if (!config) throw new Error("MEDIA_S3_* configuration is required for S1 raw inspection");
  const secret = process.env.S1_RAW_SENTINEL;
  const objectKey = process.env.S1_RAW_OBJECT_KEY;
  if (!secret || !objectKey) throw new Error("S1 raw inspection environment is required");

  const store = new S3MediaObjectStore(config);
  let totalBytes = 0;
  for (const mediaKind of ["image", "voice", "file"] as const) {
    const mediaSecret = secret + ":" + mediaKind;
    const mediaObjectKey = objectKey + "-" + mediaKind;
    const context = envelopeContext({
      partnershipId: randomUUID(),
      groupGeneration: 1,
      mlsEpoch: 1,
      contentType: "media",
      contentId: randomUUID(),
      contentVersion: 1,
      payloadRole: "media_content",
      senderCryptoDeviceId: randomUUID(),
      schemaVersion: 1,
    });
    const encrypted = await encryptBytes(utf8(mediaSecret), context);
    const ciphertext = Buffer.from(encrypted.ciphertext);
    const digest = createHash("sha256").update(ciphertext).digest("hex");
    const upload = await store.createUploadGrant({
      objectKey: mediaObjectKey,
      sha256: digest,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const uploaded = await fetch(upload.url, {
      method: "PUT",
      headers: upload.requiredHeaders,
      body: ciphertext,
      redirect: "error",
    });
    assert.equal(uploaded.ok, true);
    assert.equal(ciphertext.includes(Buffer.from(secret)), false);
    assert.equal(
      await store.verifyObject({
        objectKey: mediaObjectKey,
        expectedBytes: BigInt(ciphertext.length),
        sha256: digest,
      }),
      true,
    );

    const download = await store.createDownloadGrant({
      objectKey: mediaObjectKey,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const downloaded = await fetch(download.url, { redirect: "error", cache: "no-store" });
    assert.equal(downloaded.ok, true);
    const rawObject = Buffer.from(await downloaded.arrayBuffer());
    assert.deepEqual(rawObject, ciphertext);
    assert.equal(rawObject.includes(Buffer.from(secret)), false);
    assert.equal(
      utf8Decode(await decryptBytes(encrypted.payload, encrypted.key, context)),
      mediaSecret,
    );
    totalBytes += rawObject.length;
  }
  console.log("S1_OBJECT_STORAGE_CIPHERTEXT_PASS objects=3 bytes=" + totalBytes);
});
