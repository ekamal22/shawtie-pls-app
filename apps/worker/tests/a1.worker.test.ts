import assert from "node:assert/strict";
import test from "node:test";
import { WorkerAuthKeyRing } from "../src/auth/worker-auth-key-ring.ts";

test("worker auth key ring derives deterministic eight digit codes", () => {
  const ring = new WorkerAuthKeyRing({
    activeVersion: 1,
    keys: new Map([[1, Buffer.alloc(32, 7)]]),
  });
  const first = ring.deriveEmailCode("challenge", "registration", Buffer.alloc(32, 2), 1);
  const second = ring.deriveEmailCode("challenge", "registration", Buffer.alloc(32, 2), 1);
  assert.equal(first, second);
  assert.match(first, /^\d{8}$/);
});
