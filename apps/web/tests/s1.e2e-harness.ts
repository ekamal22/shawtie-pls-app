import {
  CryptoLocalVault,
  createMlsEngine,
  decryptBytes,
  encryptBytes,
  envelopeContext,
  restoreMlsEngine,
  utf8,
  utf8Decode,
} from "@shawtie/crypto";
import { loadOpenMlsModule } from "../src/lib/crypto/openmls-loader.ts";

const api = {
  async mlsRoundTrip(text: string) {
    const module = await loadOpenMlsModule();
    const aliceId = crypto.randomUUID();
    const bobId = crypto.randomUUID();
    let alice = createMlsEngine(module, aliceId);
    let bob = createMlsEngine(module, bobId);
    const groupId = crypto.getRandomValues(new Uint8Array(32));

    const created = alice.createGroup(groupId);
    alice = restoreMlsEngine(module, created.state);

    const added = alice.addMember(groupId, bob.keyPackage());
    if (!added.welcome || !added.controlMessage) {
      throw new Error("S1 browser harness missing MLS Add/Welcome output");
    }
    alice = restoreMlsEngine(module, added.state);

    const joined = bob.joinWelcome(added.welcome);
    bob = restoreMlsEngine(module, joined.state);

    const bobLeafIndex = alice.memberLeafIndex(groupId, bobId);
    if (bobLeafIndex === null) throw new Error("S1 browser harness missing Bob leaf index");

    const outbound = alice.createApplicationMessage(groupId, utf8(text));
    if (!outbound.applicationMessage) {
      throw new Error("S1 browser harness missing application message");
    }
    alice = restoreMlsEngine(module, outbound.state);

    const received = bob.processMessage(groupId, outbound.applicationMessage);
    if (!received.applicationMessage) {
      throw new Error("S1 browser harness missing decrypted application payload");
    }
    bob = restoreMlsEngine(module, received.state);

    return {
      plaintext: utf8Decode(received.applicationMessage),
      aliceEpoch: outbound.epoch,
      bobEpoch: received.epoch,
      bobLeafIndex,
      aliceDeviceId: alice.cryptoDeviceId,
      bobDeviceId: bob.cryptoDeviceId,
    };
  },

  async protectedContentRoundTrip(text: string) {
    const context = envelopeContext({
      partnershipId: "20000000-0000-4000-8000-000000000001",
      groupGeneration: 1,
      mlsEpoch: 2,
      contentType: "message",
      contentId: "50000000-0000-4000-8000-000000000001",
      contentVersion: 1,
      payloadRole: "message_body",
      senderCryptoDeviceId: "70000000-0000-4000-8000-000000000001",
      schemaVersion: 1,
    });
    const encrypted = await encryptBytes(utf8(text), context);
    const plaintext = utf8Decode(
      await decryptBytes(encrypted.payload, encrypted.key, context),
    );
    let substitutionRejected = false;
    try {
      await decryptBytes(encrypted.payload, encrypted.key, {
        ...context,
        contentId: "50000000-0000-4000-8000-000000000002",
      });
    } catch {
      substitutionRejected = true;
    }
    return {
      plaintext,
      substitutionRejected,
      ciphertextContainsPlaintext: new TextDecoder().decode(encrypted.ciphertext).includes(text),
    };
  },

  async localVaultRoundTrip(accountId: string, partnershipId: string) {
    const contentKeyId = crypto.randomUUID();
    const key = crypto.getRandomValues(new Uint8Array(32));
    let vault = await CryptoLocalVault.open(accountId);
    await vault.putContentKey(contentKeyId, partnershipId, key);
    vault.close();

    vault = await CryptoLocalVault.open(accountId);
    const restored = await vault.contentKey(contentKeyId);
    const persisted = restored !== null && restored.every((value, index) => value === key[index]);
    await vault.purgePartnership(partnershipId);
    const afterPurge = await vault.contentKey(contentKeyId);
    vault.close();

    return {
      persisted,
      purged: afterPurge === null,
    };
  },
};

declare global {
  interface Window {
    s1Harness: typeof api;
  }
}

window.s1Harness = api;
document.querySelector("#status")!.textContent = "ready";
