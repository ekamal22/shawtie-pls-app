import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { apiConfigFromEnv } from "../src/config.ts";
import { createP2PartnershipFormationCoordinator } from "../src/modules/partnerships/partnership-formation-coordinator.ts";

const key = Buffer.alloc(32, 7).toString("base64");

test("P2 production configuration accepts paired mode", () => {
  const config = apiConfigFromEnv({
    NODE_ENV: "production",
    APP_ORIGIN: "https://shawtie.example",
    AUTH_HMAC_KEYS: "1:" + key,
    AUTH_HMAC_ACTIVE_VERSION: "1",
    PARTNER_REQUEST_MODE: "paired",
  });
  assert.equal(config.partnerRequestMode, "paired");
});

test("P2 coordinator is transaction-scoped and does not create a nested transaction", async () => {
  const source = await readFile(
    new URL("../src/modules/partnerships/partnership-formation-coordinator.ts", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes("withTransaction"), false);
  assert.equal(source.includes("partnership_crypto_epochs"), false);
  assert.equal(source.includes("encrypted_material"), false);
  assert.equal(source.includes("private key"), false);
  assert.ok(createP2PartnershipFormationCoordinator());
});

test("P2 notification persistence contains routing metadata but no relationship date or content", async () => {
  const source = await readFile(
    new URL("../../../packages/db/src/repositories/account-notifications.ts", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes("relationship_start_date"), false);
  assert.equal(source.includes("message"), false);
  assert.equal(source.includes("email"), false);
  assert.equal(source.includes("date_of_birth"), false);
  assert.equal(source.includes("crypto"), false);
});

test("P2 migration uses the partnership id as the namespace and does not add fake crypto state", async () => {
  const migration = await readFile(
    new URL("../../../packages/db/migrations/0009_partnership_formation_runtime.sql", import.meta.url),
    "utf8",
  );
  assert.equal(migration.includes("security_context"), false);
  assert.equal(migration.includes("partnership_crypto_epochs"), false);
  assert.equal(migration.includes("accepted_partnership_id"), true);
  assert.equal(migration.includes("account_notifications"), true);
});
