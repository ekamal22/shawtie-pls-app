import assert from "node:assert/strict";
import test from "node:test";
import type { DatabasePool } from "@shawtie/db";
import { apiConfigFromEnv } from "../src/config.ts";
import type { AccountService } from "../src/modules/accounts/account-service.ts";
import { PartnerRequestService } from "../src/modules/partner-requests/partner-request-service.ts";

const key = Buffer.alloc(32, 7).toString("base64");

test("P1 production configuration rejects request_only_test mode", () => {
  assert.throws(
    () =>
      apiConfigFromEnv({
        NODE_ENV: "production",
        APP_ORIGIN: "https://shawtie.example",
        AUTH_HMAC_KEYS: "1:" + key,
        AUTH_HMAC_ACTIVE_VERSION: "1",
        PARTNER_REQUEST_MODE: "request_only_test",
      }),
    /forbidden in production/,
  );
});

test("P1 paired mode fails closed without a formation coordinator", () => {
  const database = {} as DatabasePool;
  const accountService = {} as AccountService;
  assert.throws(
    () =>
      new PartnerRequestService(database, accountService, {
        mode: "paired",
      }),
    /requires a partnership formation coordinator/,
  );
});

test("P1 test mode is accepted outside production", () => {
  const config = apiConfigFromEnv({
    NODE_ENV: "test",
    APP_ORIGIN: "http://127.0.0.1:4173",
    ALLOW_INSECURE_LOOPBACK_COOKIES: "1",
    AUTH_HMAC_KEYS: "1:" + key,
    AUTH_HMAC_ACTIVE_VERSION: "1",
    PARTNER_REQUEST_MODE: "request_only_test",
  });
  assert.equal(config.partnerRequestMode, "request_only_test");
});
