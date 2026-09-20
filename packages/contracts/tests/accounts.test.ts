import assert from "node:assert/strict";
import test from "node:test";
import {
  loginSchema,
  registrationStartSchema,
  registrationVerifySchema,
  safeParseAtBoundary,
} from "../src/index.ts";

test("A1 registration contracts reject malformed boundary input", () => {
  assert.equal(
    safeParseAtBoundary(registrationStartSchema, {
      username: "",
      displayName: "",
      dateOfBirth: "not-a-date",
      email: "",
      password: "",
    }).success,
    false,
  );
  assert.equal(
    safeParseAtBoundary(registrationVerifySchema, {
      registrationIntentId: "not-a-uuid",
      code: "1234",
    }).success,
    false,
  );
});

test("A1 login contract accepts a bounded identifier and password", () => {
  const result = safeParseAtBoundary(loginSchema, {
    identifier: "alice@example.test",
    password: "this is a long password",
  });
  assert.equal(result.success, true);
});
