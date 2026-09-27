import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalJson,
  decodeRecoveryMasterSecret,
  decryptBytes,
  decryptRecoveryBundle,
  encodeRecoveryMasterSecret,
  encryptBytes,
  encryptRecoveryBundle,
  envelopeContext,
  generateRecoveryMasterSecret,
  utf8,
  utf8Decode,
} from "../src/index.ts";

test("canonical JSON sorts object keys recursively", () => {
  assert.equal(
    canonicalJson({ z: 1, a: { y: true, b: "x" }, m: [2, 1] }),
    '{"a":{"b":"x","y":true},"m":[2,1],"z":1}',
  );
});

test("protected content round trips and rejects substitution of every authenticated context field", async () => {
  const context = envelopeContext({
    partnershipId: "00000000-0000-4000-8000-000000000001",
    groupGeneration: 1,
    mlsEpoch: 3,
    contentType: "message",
    contentId: "00000000-0000-4000-8000-000000000002",
    contentVersion: 1,
    payloadRole: "message_body",
    senderCryptoDeviceId: "00000000-0000-4000-8000-000000000003",
    schemaVersion: 1,
  });
  const encrypted = await encryptBytes(utf8("private hello"), context);
  assert.equal(
    utf8Decode(await decryptBytes(encrypted.payload, encrypted.key, context)),
    "private hello",
  );

  const substitutions = [
    { ...context, cryptoProfile: "shawtie.mls.v2" },
    { ...context, partnershipId: "00000000-0000-4000-8000-000000000004" },
    { ...context, groupGeneration: 2 },
    { ...context, mlsEpoch: 4 },
    { ...context, contentType: "relationship_item" },
    { ...context, contentId: "00000000-0000-4000-8000-000000000004" },
    { ...context, contentVersion: 2 },
    { ...context, payloadRole: "relationship_main" },
    { ...context, senderCryptoDeviceId: "00000000-0000-4000-8000-000000000004" },
    { ...context, schemaVersion: 2 },
  ] as const;
  for (const substituted of substitutions) {
    await assert.rejects(
      () => decryptBytes(encrypted.payload, encrypted.key, substituted),
      /CRYPTO_(?:CIPHERTEXT_INVALID|UNSUPPORTED_PROTOCOL)/u,
    );
  }
});

test("recovery bundle requires the Recovery Master Secret", async () => {
  const secret = generateRecoveryMasterSecret();
  const encoded = encodeRecoveryMasterSecret(secret);
  assert.deepEqual(decodeRecoveryMasterSecret(encoded), secret);

  const bundle = await encryptRecoveryBundle(utf8("root material"), secret);
  assert.equal(utf8Decode(await decryptRecoveryBundle(bundle, secret)), "root material");

  const wrong = generateRecoveryMasterSecret();
  await assert.rejects(() => decryptRecoveryBundle(bundle, wrong), /CRYPTO_RECOVERY_FAILED/u);
});
