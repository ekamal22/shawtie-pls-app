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
import { S1_CONTENT_CONTEXT, S1_CRYPTO_PROFILE } from "@shawtie/contracts";
import { loadOpenMlsModule } from "../src/lib/crypto/openmls-loader.ts";
import { ShawtieLocalDatabase } from "../src/lib/offline/local-db.ts";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB inspection failed"));
  });
}

async function durableValues(): Promise<unknown[]> {
  const output: unknown[] = [];
  for (const descriptor of await indexedDB.databases()) {
    if (!descriptor.name) continue;
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(descriptor.name!);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB inspection failed"));
    });
    for (const storeName of database.objectStoreNames) {
      const transaction = database.transaction(storeName, "readonly");
      output.push(...(await requestResult(transaction.objectStore(storeName).getAll())));
    }
    database.close();
  }
  for (const storage of [localStorage, sessionStorage]) {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key) output.push(key, storage.getItem(key));
    }
  }
  for (const cacheName of await caches.keys()) {
    output.push(cacheName);
    const cache = await caches.open(cacheName);
    for (const request of await cache.keys()) {
      output.push(request.url, await (await cache.match(request))?.text());
    }
  }
  for (const registration of await navigator.serviceWorker.getRegistrations()) {
    output.push(registration.scope);
    for (const notification of await registration.getNotifications()) {
      output.push(notification.title, notification.body, notification.data);
    }
  }
  return output;
}

function containsSecret(value: unknown, secret: string, bytes: Uint8Array): boolean {
  if (typeof value === "string") return value.includes(secret);
  if (value instanceof ArrayBuffer) return containsSecret(new Uint8Array(value), secret, bytes);
  if (ArrayBuffer.isView(value)) {
    const candidate = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return (
      candidate.length >= bytes.length &&
      candidate.some(
        (_, start) =>
          start + bytes.length <= candidate.length &&
          bytes.every((byte, offset) => candidate[start + offset] === byte),
      )
    );
  }
  if (Array.isArray(value)) return value.some((entry) => containsSecret(entry, secret, bytes));
  if (value && typeof value === "object" && !(value instanceof CryptoKey)) {
    return Object.values(value).some((entry) => containsSecret(entry, secret, bytes));
  }
  return false;
}

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
    const plaintext = utf8Decode(await decryptBytes(encrypted.payload, encrypted.key, context));
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

  async durablePrivacyInspection(seed: string) {
    const secret = seed.padEnd(32, "x").slice(0, 32);
    const secretBytes = utf8(secret);
    const accountId = crypto.randomUUID();
    const partnershipId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const cryptoDeviceId = crypto.randomUUID();
    const context = envelopeContext({
      partnershipId,
      groupGeneration: 1,
      mlsEpoch: 1,
      contentType: "message",
      contentId: messageId,
      contentVersion: 1,
      payloadRole: "message_body",
      senderCryptoDeviceId: cryptoDeviceId,
      schemaVersion: 1,
    });
    const encrypted = await encryptBytes(secretBytes, context);
    const protectedBody = {
      ciphertext: encrypted.payload.ciphertext,
      envelope: {
        cryptoProfile: S1_CRYPTO_PROFILE,
        groupGeneration: 1,
        mlsEpoch: 1,
        senderCryptoDeviceId: cryptoDeviceId,
        contentKeyId: crypto.randomUUID(),
        nonce: encrypted.payload.nonce,
        ciphertextSha256: encrypted.payload.ciphertextSha256,
        keyDistributionMessage: "AA",
        contentSignature: "AA",
        recoveryCapsules: [],
      },
    };

    const local = await ShawtieLocalDatabase.open(accountId);
    await local.rememberNamespace(partnershipId, conversationId, S1_CONTENT_CONTEXT);
    const now = Date.now();
    await local.enqueueChat({
      operationId: crypto.randomUUID(),
      partnershipId,
      conversationId,
      operationType: "message.send",
      contentContextKey: S1_CONTENT_CONTEXT,
      messageId,
      idempotencyKey: crypto.randomUUID(),
      requestBody: { messageId, body: null, protectedBody },
      expectedContentVersion: null,
      queuedAt: now,
      retryCount: 0,
      nextAttemptAt: now,
      status: "queued",
      lastErrorCode: null,
      claimOwner: null,
      claimGeneration: 0,
      claimExpiresAt: null,
    });
    await local.enqueueRelationship({
      operationId: crypto.randomUUID(),
      partnershipId,
      itemId: crypto.randomUUID(),
      operationType: "item.create",
      contentContextKey: S1_CONTENT_CONTEXT,
      idempotencyKey: crypto.randomUUID(),
      requestBody: { preview: null, content: null, protectedContent: protectedBody },
      expectedVersion: null,
      queuedAt: now,
      retryCount: 0,
      nextAttemptAt: now,
      status: "queued",
      lastErrorCode: null,
      claimOwner: null,
      claimGeneration: 0,
      claimExpiresAt: null,
    });
    local.close();

    let vault = await CryptoLocalVault.open(accountId);
    await vault.putDeviceState({
      key: "device",
      cryptoProfile: S1_CRYPTO_PROFILE,
      cryptoDeviceId,
      state: secretBytes,
      updatedAt: now,
    });
    await vault.putRecoveryState({
      key: "recovery",
      cryptoProfile: S1_CRYPTO_PROFILE,
      recoveryKeyVersion: 1,
      recoveryHpkePrivateKey: secretBytes,
      recoveryHpkePublicKey: crypto.getRandomValues(new Uint8Array(32)),
      recoveryAuthPrivateKeyPkcs8: secretBytes,
      recoveryAuthPublicKey: crypto.getRandomValues(new Uint8Array(32)),
      updatedAt: now,
    });
    await vault.putGroup({
      partnershipId,
      cryptoProfile: S1_CRYPTO_PROFILE,
      groupGeneration: 1,
      mlsEpoch: 1,
      groupId: crypto.getRandomValues(new Uint8Array(32)),
      state: secretBytes,
      controlCursor: 0,
      cryptoRequired: true,
      rekeyRequired: false,
      devices: [],
      recoveryRecipients: [],
      serverSyncedAt: now,
      updatedAt: now,
    });
    await vault.stageControlOutbound({
      operationId: crypto.randomUUID(),
      partnershipId,
      cryptoProfile: S1_CRYPTO_PROFILE,
      requestBody: { protectedBody },
      candidateState: secretBytes,
      createdAt: now,
    });
    const contentKeyId = crypto.randomUUID();
    await vault.putContentKey(contentKeyId, partnershipId, secretBytes);
    vault.close();

    const rawValues = await durableValues();
    const plaintextFindings = rawValues.filter((value) =>
      containsSecret(value, secret, secretBytes),
    );

    const reopenedLocal = await ShawtieLocalDatabase.open(accountId);
    await reopenedLocal.purgePartnership(partnershipId);
    const chatPurged = (await reopenedLocal.listChatQueue(partnershipId)).length === 0;
    const relationshipPurged =
      (await reopenedLocal.listRelationshipQueue(partnershipId)).length === 0;
    reopenedLocal.close();
    vault = await CryptoLocalVault.open(accountId);
    await vault.purgePartnership(partnershipId);
    const groupPurged = (await vault.group(partnershipId)) === null;
    const contentKeyPurged = (await vault.contentKey(contentKeyId)) === null;
    const operationsPurged = (await vault.pendingOperations(partnershipId)).length === 0;
    vault.close();

    return {
      inspectedValueCount: rawValues.length,
      plaintextFindingCount: plaintextFindings.length,
      ciphertextContainsPlaintext: new TextDecoder().decode(encrypted.ciphertext).includes(secret),
      s1Namespace: S1_CONTENT_CONTEXT,
      chatPurged,
      relationshipPurged,
      groupPurged,
      contentKeyPurged,
      operationsPurged,
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
