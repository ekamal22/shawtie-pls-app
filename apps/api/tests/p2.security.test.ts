import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { apiConfigFromEnv } from "../src/config.ts";
import {
  createP2PartnershipFormationCoordinator,
} from "../src/modules/partnerships/partnership-formation-coordinator.ts";

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

test("P2 notification repository does not persist private relationship content", async () => {
  const source = await readFile(
    new URL("../../../packages/db/src/repositories/account-notifications.ts", import.meta.url),
    "utf8",
  );

  assert.equal(
    /(^|[^A-Za-z0-9_])relationship_start_date([^A-Za-z0-9_]|$)/.test(source),
    false,
  );
  assert.equal(
    /(^|[^A-Za-z0-9_])relationshipStartDate([^A-Za-z0-9_]|$)/.test(source),
    false,
  );
  assert.equal(/(^|[^A-Za-z0-9_])message_body([^A-Za-z0-9_]|$)/.test(source), false);
  assert.equal(/(^|[^A-Za-z0-9_])messageBody([^A-Za-z0-9_]|$)/.test(source), false);
  assert.equal(/(^|[^A-Za-z0-9_])email([^A-Za-z0-9_]|$)/.test(source), false);
  assert.equal(/(^|[^A-Za-z0-9_])date_of_birth([^A-Za-z0-9_]|$)/.test(source), false);
  assert.equal(/(^|[^A-Za-z0-9_])dateOfBirth([^A-Za-z0-9_]|$)/.test(source), false);
  assert.equal(/(^|[^A-Za-z0-9_])crypto_material([^A-Za-z0-9_]|$)/.test(source), false);
  assert.equal(/(^|[^A-Za-z0-9_])cryptoMaterial([^A-Za-z0-9_]|$)/.test(source), false);

  assert.equal(source.includes('"relationship_start_date_changed"'), true);
});

test("P2 migration uses partnership id without fake crypto state", async () => {
  const migration = await readFile(
    new URL(
      "../../../packages/db/migrations/0009_partnership_formation_runtime.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.equal(migration.includes("security_context"), false);
  assert.equal(migration.includes("partnership_crypto_epochs"), false);
  assert.equal(migration.includes("accepted_partnership_id"), true);
  assert.equal(migration.includes("account_notifications"), true);
});

test("P2 preserves the verified P1 migration 0008 byte-for-byte", async () => {
  const migration = await readFile(
    new URL(
      "../../../packages/db/migrations/0008_partner_discovery_requests_runtime.sql",
      import.meta.url,
    ),
  );
  assert.equal(
    createHash("sha256").update(migration).digest("hex"),
    "94e2d22ceff3b73fc990fc07810cabedea097d7440a571c54c00ec185bebd18e",
  );
});
