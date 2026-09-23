import assert from "node:assert/strict";
import test from "node:test";
import {
  M3_ATTACHMENTS_PER_MESSAGE_MAX,
  mediaUploadCreateSchema,
  messageSendSchema,
} from "../src/index.ts";

const digest = "a".repeat(64);

test("M3 media upload contracts enforce product limits and duration semantics", () => {
  assert.equal(
    mediaUploadCreateSchema.safeParse({
      kind: "video",
      formatCode: "mp4",
      ciphertextBytes: 1024,
      ciphertextSha256: digest,
      cryptoProtocolVersion: "m3-test-aes-gcm-v1",
      durationSeconds: 120,
    }).success,
    true,
  );
  assert.equal(
    mediaUploadCreateSchema.safeParse({
      kind: "video",
      formatCode: "mp4",
      ciphertextBytes: 1024,
      ciphertextSha256: digest,
      cryptoProtocolVersion: "m3-test-aes-gcm-v1",
      durationSeconds: 121,
    }).success,
    false,
  );
  assert.equal(
    mediaUploadCreateSchema.safeParse({
      kind: "image",
      formatCode: "webp",
      ciphertextBytes: 1024,
      ciphertextSha256: digest,
      cryptoProtocolVersion: "m3-test-aes-gcm-v1",
      durationSeconds: 1,
    }).success,
    false,
  );
});

test("M3 message send permits attachment-only messages and constrains voice messages", () => {
  assert.equal(
    messageSendSchema.safeParse({
      body: null,
      replyToMessageId: null,
      attachments: [{ mediaId: crypto.randomUUID(), role: "attachment", position: 0 }],
    }).success,
    true,
  );
  assert.equal(
    messageSendSchema.safeParse({
      body: null,
      replyToMessageId: null,
      attachments: [{ mediaId: crypto.randomUUID(), role: "voice_message", position: 0 }],
    }).success,
    true,
  );
  assert.equal(
    messageSendSchema.safeParse({
      body: "not voice-only",
      replyToMessageId: null,
      attachments: [{ mediaId: crypto.randomUUID(), role: "voice_message", position: 0 }],
    }).success,
    false,
  );
  assert.equal(
    messageSendSchema.safeParse({
      body: null,
      replyToMessageId: null,
      attachments: [],
    }).success,
    false,
  );
});

test("M3 message attachment positions are unique and capped", () => {
  const attachments = Array.from({ length: M3_ATTACHMENTS_PER_MESSAGE_MAX }, (_, position) => ({
    mediaId: crypto.randomUUID(),
    role: "attachment" as const,
    position,
  }));
  assert.equal(
    messageSendSchema.safeParse({ body: null, replyToMessageId: null, attachments }).success,
    true,
  );
  assert.equal(
    messageSendSchema.safeParse({
      body: null,
      replyToMessageId: null,
      attachments: [...attachments, { mediaId: crypto.randomUUID(), role: "attachment", position: 0 }],
    }).success,
    false,
  );
});
