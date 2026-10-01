import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("transactional auth email provider remains outside HTTP and browser code", async () => {
  const routes = await readFile(new URL("../src/modules/auth/routes.ts", import.meta.url), "utf8");
  const application = await readFile(new URL("../src/application.ts", import.meta.url), "utf8");
  const webApp = await readFile(
    new URL("../../web/src/app/App.tsx", import.meta.url),
    "utf8",
  );
  const workerMain = await readFile(
    new URL("../../worker/src/main.ts", import.meta.url),
    "utf8",
  );

  assert.equal(routes.includes("deriveEmailCode"), false);
  assert.equal(routes.includes("BREVO_"), false);
  assert.equal(application.includes("BREVO_"), false);
  assert.equal(webApp.includes("BREVO_"), false);
  assert.equal(workerMain.includes("emailDeliveryFromEnv"), true);
});

test("production auth email integration has no HTTP code extraction shortcut", async () => {
  const routes = await readFile(new URL("../src/modules/auth/routes.ts", import.meta.url), "utf8");
  const service = await readFile(
    new URL("../src/modules/accounts/account-service.ts", import.meta.url),
    "utf8",
  );

  assert.equal(routes.includes("challenge_nonce"), false);
  assert.equal(routes.includes("verifier_key_version"), false);
  assert.equal(routes.includes("deriveEmailCode"), false);
  assert.equal(service.includes('payload: { challengeId: id }'), true);
});
