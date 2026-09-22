import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("R1 routes mark private responses no-store before parsing or service work", async () => {
  const routes = await source("../src/modules/relationship-space/routes.ts");
  const routeBodies = routes.split("app.").slice(1);
  assert.ok(routeBodies.length >= 9);
  for (const body of routeBodies) {
    if (!body.includes("/api/v1/relationship-space")) continue;
    const auth = body.indexOf("requireAuthentication");
    const noStore = body.indexOf("privateNoStore(reply)");
    assert.ok(auth >= 0);
    assert.ok(noStore > auth);
    const parse = body.indexOf("parseAtBoundary");
    const service = body.indexOf("service.");
    const nextWork = [parse, service].filter((value) => value >= 0).sort((a, b) => a - b)[0];
    if (nextWork !== undefined) assert.ok(noStore < nextWork);
  }
});

test("R1 private idempotency uses a keyed domain-separated verifier and metadata-only response", async () => {
  const service = await source("../src/modules/relationship-space/relationship-space-service.ts");
  const keyRing = await source("../src/security/auth-key-ring.ts");
  assert.equal(service.includes('"r1-idempotency-fingerprint"'), true);
  assert.equal(service.includes("createHash("), false);
  assert.equal(service.includes("activeVerifier"), true);
  assert.equal(service.includes("canonicalJson"), true);
  assert.equal(keyRing.includes('"r1-idempotency-fingerprint"'), true);
  assert.equal(
    service.includes("responseBody: input.body"),
    false,
  );
});

test("R1 does not import M1 messaging runtime or M3 media runtime", async () => {
  const service = await source("../src/modules/relationship-space/relationship-space-service.ts");
  const routes = await source("../src/modules/relationship-space/routes.ts");
  assert.equal(service.includes("/messages/"), false);
  assert.equal(service.includes("messaging"), false);
  assert.equal(service.includes("media-service"), false);
  assert.equal(routes.includes("/messages/"), false);
});

test("R1 migrations keep plaintext explicit and never label it as ciphertext", async () => {
  const migration = await source("../../../packages/db/migrations/0013_relationship_space_runtime.sql");
  assert.equal(migration.includes("development_preview_payload jsonb"), true);
  assert.equal(migration.includes("development_plaintext_payload jsonb"), true);
  assert.equal(migration.includes("encrypted_preview_payload bytea"), true);
  assert.equal(migration.includes("relationship_items_content_storage_mode"), true);
  assert.equal(migration.includes("relationship_items_identity_immutable"), true);
});

test("R1 scheduled payload stays content-free and release is generation fenced", async () => {
  const service = await source("../src/modules/relationship-space/relationship-space-service.ts");
  const handler = await source(
    "../../worker/src/relationship-space/relationship-item-release-handler.ts",
  );
  assert.equal(service.includes('payload: {}'), true);
  assert.equal(service.includes('expectedGeneration: releaseGeneration'), true);
  assert.equal(handler.includes("expectedGeneration"), true);
  assert.equal(handler.includes("evaluateScheduledRelationshipRelease"), true);
  assert.equal(handler.includes("developmentPlaintextPayload"), false);
});

test("R1 account deletion pauses and recovery wakes pending release work", async () => {
  const accountService = await source("../src/modules/accounts/account-service.ts");
  assert.equal(
    accountService.includes("pausePendingRelationshipReleaseActionsForPartnership"),
    true,
  );
  assert.equal(
    accountService.includes("wakePendingRelationshipReleaseActionsForPartnership"),
    true,
  );
});

test("R1 Voice Letter is a media reference and not a standalone item kind", async () => {
  const contracts = await source(
    "../../../packages/contracts/src/relationship-space/items.ts",
  );
  assert.equal(contracts.includes('"voice_letter",'), true);
  const kinds = contracts.slice(
    contracts.indexOf("relationshipItemKindSchema"),
    contracts.indexOf("]);", contracts.indexOf("relationshipItemKindSchema")) + 3,
  );
  assert.equal(kinds.includes('"voice_letter"'), false);
  assert.equal(contracts.includes('role: z.enum(["source", "attachment", "voice_letter"])'), true);
});


test("R1 mutation lock order is partnership then sorted items then operation receipt", async () => {
  const service = await source("../src/modules/relationship-space/relationship-space-service.ts");

  const sections = [
    service.slice(service.indexOf("async create("), service.indexOf("async patch(")),
    service.slice(service.indexOf("async patch("), service.indexOf("async delete(")),
    service.slice(service.indexOf("async delete("), service.indexOf("async release(")),
    service.slice(service.indexOf("async release("), service.indexOf("async thisDay(")),
  ];

  for (const section of sections) {
    const partnershipLock = section.indexOf("lockPartnershipLifecycle");
    const replayPreflight = section.indexOf("#findCompletedMutation");
    const itemLock = section.indexOf("lockRelationshipItemsByIds");
    const receiptLock = section.indexOf("#reserveMutation");

    assert.ok(partnershipLock >= 0);
    assert.ok(replayPreflight > partnershipLock);
    assert.ok(itemLock > replayPreflight);
    assert.ok(receiptLock > itemLock);
  }
});


test("R1 server paths do not log private payloads or coordinates", async () => {
  const service = await source("../src/modules/relationship-space/relationship-space-service.ts");
  const routes = await source("../src/modules/relationship-space/routes.ts");
  const worker = await source(
    "../../worker/src/relationship-space/relationship-item-release-handler.ts",
  );
  const combined = service + "\n" + routes + "\n" + worker;

  assert.equal(combined.includes("console.log"), false);
  assert.equal(combined.includes("request.log"), false);
  assert.equal(combined.includes("logger.info"), false);
  assert.equal(combined.includes("logger.debug"), false);
  assert.equal(worker.includes("latitude"), false);
  assert.equal(worker.includes("longitude"), false);
  assert.equal(worker.includes("payload: {"), false);
  assert.equal(service.includes("payload: {}"), true);
});

test("R1 migration ownership remains 0013 and 0014 only", async () => {
  const packageJson = await source("../../../package.json");
  const design = await source(
    "../../../docs/architecture/R1_RELATIONSHIP_SPACE_DESIGN.md",
  );
  assert.equal(design.includes("0013_relationship_space_runtime.sql"), true);
  assert.equal(design.includes("0014_relationship_space_interaction_runtime.sql"), true);
  assert.equal(design.includes("R1 owns `0011"), false);
  assert.equal(design.includes("R1 owns `0012"), false);
  assert.equal(packageJson.includes("test:r1:postgres"), true);
});
