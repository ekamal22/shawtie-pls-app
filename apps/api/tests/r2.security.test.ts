import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("R2 normalizes media realtime and calling network subjects", async () => {
  const media = await readFile(new URL("../src/modules/media/routes.ts", import.meta.url), "utf8");
  const realtime = await readFile(new URL("../src/modules/realtime/routes.ts", import.meta.url), "utf8");
  const calls = await readFile(new URL("../src/modules/calls/routes.ts", import.meta.url), "utf8");
  for (const source of [media, realtime, calls]) {
    assert.equal(source.includes("networkPrefix(request.ip)"), true);
    assert.equal(source.includes("network\\0${request.ip}"), false);
  }
  assert.equal(calls.includes("deps.keys.versions.map"), true);
});

test("R2 production registration requires versioned policy acceptance", async () => {
  const routes = await readFile(new URL("../src/modules/auth/routes.ts", import.meta.url), "utf8");
  const contracts = await readFile(new URL("../../../packages/contracts/src/accounts/account-contracts.ts", import.meta.url), "utf8");
  assert.equal(routes.includes('config.environment === "production"'), true);
  assert.equal(routes.includes("POLICY_ACCEPTANCE_REQUIRED"), true);
  assert.equal(routes.includes("CURRENT_LEGAL_POLICY_VERSION"), true);
  assert.equal(contracts.includes("termsAccepted"), true);
  assert.equal(contracts.includes("privacyAccepted"), true);
});

test("R2 support reports are authenticated and network limited", async () => {
  const routes = await readFile(new URL("../src/modules/support/routes.ts", import.meta.url), "utf8");
  const service = await readFile(new URL("../src/modules/support/support-service.ts", import.meta.url), "utf8");
  assert.equal(routes.includes("requireAuthentication"), true);
  assert.equal(routes.includes("networkPrefix(request.ip)"), true);
  assert.equal(service.includes("support_report_account"), true);
  assert.equal(service.includes("support_report_network"), true);
  assert.equal(service.includes("insertAbuseReport"), true);
  assert.equal(service.includes("subjectReference"), true);
});

test("R2 production runtime exposes dependency-aware readiness and private-network binding", async () => {
  const application = await readFile(new URL("../src/application.ts", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.equal(application.includes('app.get("/ready"'), true);
  assert.equal(application.includes('database.pool.query("SELECT 1")'), true);
  assert.equal(main.includes('process.env.NODE_ENV === "production" ? "0.0.0.0"'), true);
});

test("R2 account deletion scrubs new preference and support text", async () => {
  const source = await readFile(
    new URL("../../../packages/db/src/repositories/account-auth.ts", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes("DELETE FROM account_notification_preferences"), true);
  assert.equal(source.includes("DELETE FROM account_policy_acceptances"), true);
  assert.equal(source.includes("DELETE FROM abuse_reports WHERE reporter_account_id"), true);
  assert.equal(source.includes("UPDATE abuse_reports SET target_account_id = NULL"), true);
});

test("R2 browser and API sources do not contain provider credentials", async () => {
  const browser = await readFile(new URL("../../web/src/lib/pwa/notification-preferences.ts", import.meta.url), "utf8");
  const support = await readFile(new URL("../src/modules/support/routes.ts", import.meta.url), "utf8");
  for (const source of [browser, support]) {
    assert.equal(source.includes("BREVO_API_KEY"), false);
    assert.equal(source.includes("C1_PUSH_VAPID_PRIVATE_KEY"), false);
  }
});
