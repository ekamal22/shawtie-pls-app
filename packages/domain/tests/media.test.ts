import assert from "node:assert/strict";
import test from "node:test";
import { mediaBindingAllowed, mediaFormatAllowed, mediaRoleAllowed } from "../src/index.ts";

test("M3 media format policy is explicit", () => {
  assert.equal(mediaFormatAllowed("image", "webp"), true);
  assert.equal(mediaFormatAllowed("video", "mp4"), true);
  assert.equal(mediaFormatAllowed("voice", "webm_opus"), true);
  assert.equal(mediaFormatAllowed("file", "pdf"), true);
  assert.equal(mediaFormatAllowed("image", "mp4"), false);
  assert.equal(mediaFormatAllowed("voice", "pdf"), false);
});

test("M3 media role policy prevents cross-purpose binding", () => {
  assert.equal(mediaRoleAllowed("voice", "voice_message"), true);
  assert.equal(mediaRoleAllowed("voice", "voice_letter"), true);
  assert.equal(mediaRoleAllowed("voice", "attachment"), false);
  assert.equal(mediaRoleAllowed("image", "attachment"), true);
  assert.equal(mediaRoleAllowed("image", "voice_letter"), false);

  assert.equal(mediaBindingAllowed("message", "voice_message"), true);
  assert.equal(mediaBindingAllowed("message", "voice_letter"), false);
  assert.equal(mediaBindingAllowed("relationship_item", "voice_letter"), true);
  assert.equal(mediaBindingAllowed("relationship_item", "voice_message"), false);
});
