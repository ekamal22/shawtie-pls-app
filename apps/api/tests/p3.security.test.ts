import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("P3 lifecycle mutation boundary keeps deadlines and generations server-owned", async () => {
  const contracts = await readFile(
    new URL(
      "../../../packages/contracts/src/partnerships/lifecycle.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const routes = await readFile(
    new URL("../src/modules/partnerships/routes.ts", import.meta.url),
    "utf8",
  );

  assert.equal(contracts.includes("partnershipLifecycleMutationBodySchema = z.undefined()"), true);
  assert.equal(routes.includes("parseAtBoundary(partnershipLifecycleMutationBodySchema"), true);
  assert.equal(routes.includes('"idempotency-key"'), true);
  assert.equal(routes.includes("finalDeadline:"), false);
  assert.equal(routes.includes("generation:"), false);
});

test("P3 uses one canonical dissolution kernel across breakup and account deletion", async () => {
  const breakup = await readFile(
    new URL(
      "../../worker/src/partnerships/breakup-finalize-handler.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const deletion = await readFile(
    new URL(
      "../../worker/src/auth/account-deletion-finalize-handler.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const precedence = await readFile(
    new URL(
      "../../worker/src/auth/account-deletion-breakup-precedence-handler.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const accountRepository = await readFile(
    new URL(
      "../../../packages/db/src/repositories/account-auth.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.equal(breakup.includes("dissolvePartnership"), true);
  assert.equal(deletion.includes("dissolvePartnership"), true);
  assert.equal(precedence.includes("dissolvePartnership"), true);
  assert.equal(accountRepository.includes("finalizePartnershipForAccountDeletion"), false);
});

test("P3 worker serious-event email survives deleting-account auth scrub", async () => {
  const notices = await readFile(
    new URL(
      "../../worker/src/partnerships/lifecycle-notices.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const dissolution = await readFile(
    new URL(
      "../../worker/src/partnerships/dissolution.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.equal(notices.includes("emailAccountId?: string | null"), true);
  assert.equal(dissolution.includes("lifecycle.accountDeletion?.accountId === accountId ? null"), true);
});

test("P3 notification storage remains routing metadata only", async () => {
  const repository = await readFile(
    new URL(
      "../../../packages/db/src/repositories/account-notifications.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.equal(/(^|[^A-Za-z0-9_])relationship_start_date([^A-Za-z0-9_]|$)/.test(repository), false);
  assert.equal(/(^|[^A-Za-z0-9_])message_body([^A-Za-z0-9_]|$)/.test(repository), false);
  assert.equal(/(^|[^A-Za-z0-9_])destination_email([^A-Za-z0-9_]|$)/.test(repository), false);
  assert.equal(/(^|[^A-Za-z0-9_])crypto_material([^A-Za-z0-9_]|$)/.test(repository), false);
  assert.equal(repository.includes('"breakup_started"'), true);
  assert.equal(repository.includes('"partnership_dissolved"'), true);
});

test("P3 migration hardens lifecycle state without introducing key material", async () => {
  const migration = await readFile(
    new URL(
      "../../../packages/db/migrations/0010_partnership_lifecycle_runtime.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.equal(migration.includes("breakup_processes_terminal_exclusive"), true);
  assert.equal(migration.includes("account_partner_eligibility_exact_duration"), true);
  assert.equal(migration.includes("partnership_blocks_source_required"), true);
  assert.equal(migration.includes("deletion_manifests_one_partnership"), true);
  assert.equal(migration.includes("private key"), false);
  assert.equal(migration.includes("encrypted_material"), false);
  assert.equal(migration.includes("key_material"), false);
});

test("P3 preserves the verified P2 migration 0009 byte-for-byte", async () => {
  const migration = await readFile(
    new URL(
      "../../../packages/db/migrations/0009_partnership_formation_runtime.sql",
      import.meta.url,
    ),
  );
  assert.equal(
    createHash("sha256").update(migration).digest("hex"),
    "678c11396048061cb1997dc28da5fca099b7972e8039965553dbb93569ed1dc4",
  );
});
