import assert from "node:assert/strict";
import test from "node:test";
import { brevoEmailConfigFromEnv } from "../src/auth/brevo-email-delivery.ts";

const API_KEY = "BREVO_" + "API_KEY";

test("email provider is optional outside production but required in production", () => {
  assert.equal(brevoEmailConfigFromEnv({}), null);
  assert.throws(
    () => brevoEmailConfigFromEnv({ NODE_ENV: "production" }),
    /EMAIL_PROVIDER is required in production/,
  );
  assert.throws(
    () => brevoEmailConfigFromEnv({ EMAIL_PROVIDER: "other" }),
    /EMAIL_PROVIDER must be disabled or brevo/,
  );
});

test("Brevo provider configuration validates required fields and timeout", () => {
  const valid = {
    EMAIL_PROVIDER: "brevo",
    [API_KEY]: "placeholder",
    BREVO_SENDER_EMAIL: "auth@example.test",
  };
  assert.deepEqual(brevoEmailConfigFromEnv(valid), {
    apiKey: "placeholder",
    senderEmail: "auth@example.test",
    senderName: "Shawtie pls",
    timeoutMs: 10_000,
  });
  assert.throws(
    () => brevoEmailConfigFromEnv({ EMAIL_PROVIDER: "brevo" }),
    /BREVO_API_KEY is required/,
  );
  assert.throws(
    () => brevoEmailConfigFromEnv({ ...valid, BREVO_SENDER_EMAIL: "invalid" }),
    /BREVO_SENDER_EMAIL/,
  );
  assert.throws(
    () => brevoEmailConfigFromEnv({ ...valid, BREVO_TIMEOUT_MS: "999" }),
    /BREVO_TIMEOUT_MS/,
  );
  assert.equal(
    brevoEmailConfigFromEnv({ ...valid, BREVO_TIMEOUT_MS: "15000" })?.timeoutMs,
    15_000,
  );
});
