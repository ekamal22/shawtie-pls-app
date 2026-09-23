import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relative: string): Promise<string> {
  return readFile(new URL(relative, import.meta.url), "utf8");
}

test("C1 timeout workers are deadline-generation fenced", async () => {
  const handler = await source("../src/calls/call-timeout-handler.ts");
  const defaults = await source("../src/auth/default-account-handlers.ts");

  assert.equal(handler.includes("loadCallDeadlineGeneration"), true);
  assert.equal(handler.includes("action.expectedGeneration"), true);
  assert.equal(handler.includes('"c1.call.ringing_timeout"'), false);
  assert.equal(handler.includes('handler("ringing")'), true);
  assert.equal(handler.includes('handler("accepted")'), true);
  assert.equal(handler.includes('handler("connected")'), true);
  assert.equal(defaults.includes("createC1CallTimeoutHandlers"), true);
});

test("C1 outbox sends content-free realtime and generic push only", async () => {
  const handler = await source("../src/calls/call-outbox-handler.ts");
  const push = await source("../src/calls/web-push.ts");
  const defaults = await source("../src/outbox/default-outbox-handlers.ts");

  assert.equal(handler.includes('"c1.call.changed"'), true);
  assert.equal(handler.includes('"c1.call.push"'), true);
  assert.equal(handler.includes('"call_state_changed"'), true);
  assert.equal(handler.includes("callerName"), false);
  assert.equal(handler.includes("sdp"), false);
  assert.equal(handler.includes("candidate"), false);
  assert.equal(push.includes('"aes-128-gcm"'), true);
  assert.equal(push.includes("vapidAuthorization"), true);
  assert.equal(defaults.includes("createC1CallOutboxHandlers"), true);
});
