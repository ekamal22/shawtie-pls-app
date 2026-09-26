import { utf8 } from "./bytes.ts";
import { S1_CRYPTO_PROFILE } from "./profile.ts";

const DATABASE_PREFIX = "shawtie-crypto-v1:";
const DATABASE_VERSION = 2;
const LOCK_PREFIX = "shawtie:crypto:";
const VAULT_KEY_LOCK_PREFIX = "shawtie:crypto-vault-key:";
const LOCAL_WRAP_AAD_PREFIX = "shawtie/local-vault/v1";

export interface StoredCryptoDeviceState {
  readonly key: "device";
  readonly cryptoProfile: typeof S1_CRYPTO_PROFILE;
  readonly cryptoDeviceId: string;
  readonly state: Uint8Array<ArrayBuffer>;
  readonly updatedAt: number;
}

export interface StoredGroupState {
  readonly partnershipId: string;
  readonly cryptoProfile: typeof S1_CRYPTO_PROFILE;
  readonly groupGeneration: number;
  readonly mlsEpoch: number;
  readonly groupId: Uint8Array<ArrayBuffer>;
  readonly state: Uint8Array<ArrayBuffer>;
  readonly controlCursor: number;
  readonly updatedAt: number;
}

export interface StoredRecoveryState {
  readonly key: "recovery";
  readonly cryptoProfile: typeof S1_CRYPTO_PROFILE;
  readonly recoveryKeyVersion: number;
  readonly recoveryHpkePrivateKey: Uint8Array<ArrayBuffer>;
  readonly recoveryHpkePublicKey: Uint8Array<ArrayBuffer>;
  readonly recoveryAuthPrivateKeyPkcs8: Uint8Array<ArrayBuffer>;
  readonly recoveryAuthPublicKey: Uint8Array<ArrayBuffer>;
  readonly updatedAt: number;
}

export interface FrozenCryptoOperation {
  readonly operationId: string;
  readonly partnershipId: string;
  readonly cryptoProfile: typeof S1_CRYPTO_PROFILE;
  readonly requestBody: unknown;
  readonly candidateState: Uint8Array<ArrayBuffer>;
  readonly createdAt: number;
}

interface SealedBytes {
  readonly iv: Uint8Array<ArrayBuffer>;
  readonly ciphertext: Uint8Array<ArrayBuffer>;
}

interface StoredDeviceRow extends Omit<StoredCryptoDeviceState, "state"> {
  readonly state: SealedBytes;
}

interface StoredGroupRow extends Omit<StoredGroupState, "state"> {
  readonly state: SealedBytes;
}

interface StoredRecoveryRow
  extends Omit<
    StoredRecoveryState,
    | "recoveryHpkePrivateKey"
    | "recoveryAuthPrivateKeyPkcs8"
  > {
  readonly recoveryHpkePrivateKey: SealedBytes;
  readonly recoveryAuthPrivateKeyPkcs8: SealedBytes;
}

interface StoredOperationRow extends Omit<FrozenCryptoOperation, "candidateState"> {
  readonly candidateState: SealedBytes;
}

interface StoredContentKeyRow {
  readonly contentKeyId: string;
  readonly partnershipId: string;
  readonly wrappedKey: SealedBytes;
  readonly updatedAt: number;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB crypto request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB crypto transaction aborted"));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB crypto transaction failed"));
  });
}

function openCryptoDatabase(accountId: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_PREFIX + accountId, DATABASE_VERSION);
    request.onerror = () => reject(request.error ?? new Error("Unable to open crypto database"));
    request.onblocked = () => reject(new Error("Crypto database upgrade is blocked"));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("vaultKey")) {
        database.createObjectStore("vaultKey", { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains("deviceState")) {
        database.createObjectStore("deviceState", { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains("recoveryState")) {
        database.createObjectStore("recoveryState", { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains("groups")) {
        database.createObjectStore("groups", { keyPath: "partnershipId" });
      }
      if (!database.objectStoreNames.contains("pendingOperations")) {
        const operations = database.createObjectStore("pendingOperations", {
          keyPath: "operationId",
        });
        operations.createIndex("byPartnership", ["partnershipId", "createdAt"]);
      }
      if (!database.objectStoreNames.contains("contentKeys")) {
        const contentKeys = database.createObjectStore("contentKeys", {
          keyPath: "contentKeyId",
        });
        contentKeys.createIndex("byPartnership", ["partnershipId", "updatedAt"]);
      } else {
        const contentKeys = request.transaction?.objectStore("contentKeys");
        if (contentKeys && !contentKeys.indexNames.contains("byPartnership")) {
          contentKeys.createIndex("byPartnership", ["partnershipId", "updatedAt"]);
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function sealed(value: unknown): value is SealedBytes {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<SealedBytes>;
  return row.iv instanceof Uint8Array && row.ciphertext instanceof Uint8Array;
}

function queueRange(partnershipId: string): IDBKeyRange {
  return IDBKeyRange.bound(
    [partnershipId, 0],
    [partnershipId, Number.MAX_SAFE_INTEGER],
  );
}

export class CryptoLocalVault {
  readonly accountId: string;
  readonly #database: IDBDatabase;
  #wrappingKeyPromise: Promise<CryptoKey> | null = null;

  private constructor(accountId: string, database: IDBDatabase) {
    this.accountId = accountId;
    this.#database = database;
  }

  static async open(accountId: string): Promise<CryptoLocalVault> {
    const vault = new CryptoLocalVault(accountId, await openCryptoDatabase(accountId));
    await vault.#wrappingKey();
    return vault;
  }

  close(): void {
    this.#database.close();
  }

  async #wrappingKey(): Promise<CryptoKey> {
    if (this.#wrappingKeyPromise) return this.#wrappingKeyPromise;
    this.#wrappingKeyPromise = navigator.locks.request(
      VAULT_KEY_LOCK_PREFIX + this.accountId,
      { mode: "exclusive" },
      async () => {
        const read = this.#database.transaction(["vaultKey"], "readonly");
        const existing = (await requestResult(
          read.objectStore("vaultKey").get("local"),
        )) as { key: "local"; value: CryptoKey } | undefined;
        await transactionDone(read);
        if (existing?.value) return existing.value;

        const generated = await crypto.subtle.generateKey(
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"],
        );
        const write = this.#database.transaction(["vaultKey"], "readwrite");
        write.objectStore("vaultKey").put({ key: "local", value: generated });
        await transactionDone(write);
        return generated;
      },
    );
    return this.#wrappingKeyPromise;
  }

  #aad(purpose: string, recordId: string): Uint8Array<ArrayBuffer> {
    return utf8(
      [LOCAL_WRAP_AAD_PREFIX, this.accountId, purpose, recordId].join("\0"),
    );
  }

  async #seal(
    value: Uint8Array,
    purpose: string,
    recordId: string,
  ): Promise<SealedBytes> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: this.#aad(purpose, recordId),
          tagLength: 128,
        },
        await this.#wrappingKey(),
        arrayBuffer(value),
      ),
    );
    return { iv, ciphertext };
  }

  async #open(
    value: SealedBytes,
    purpose: string,
    recordId: string,
  ): Promise<Uint8Array<ArrayBuffer>> {
    try {
      return new Uint8Array(
        await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: value.iv,
            additionalData: this.#aad(purpose, recordId),
            tagLength: 128,
          },
          await this.#wrappingKey(),
          value.ciphertext,
        ),
      );
    } catch {
      throw new Error("CRYPTO_LOCAL_STATE_INVALID");
    }
  }

  async deviceState(): Promise<StoredCryptoDeviceState | null> {
    const tx = this.#database.transaction(["deviceState"], "readonly");
    const value = (await requestResult(
      tx.objectStore("deviceState").get("device"),
    )) as StoredDeviceRow | StoredCryptoDeviceState | undefined;
    await transactionDone(tx);
    if (!value) return null;
    if (!sealed(value.state)) {
      throw new Error("CRYPTO_LOCAL_STATE_MIGRATION_REQUIRED");
    }
    return {
      ...value,
      state: await this.#open(value.state, "device", value.cryptoDeviceId),
    };
  }

  async putDeviceState(state: StoredCryptoDeviceState): Promise<void> {
    const row: StoredDeviceRow = {
      ...state,
      state: await this.#seal(state.state, "device", state.cryptoDeviceId),
    };
    const tx = this.#database.transaction(["deviceState"], "readwrite");
    tx.objectStore("deviceState").put(row);
    await transactionDone(tx);
  }

  async recoveryState(): Promise<StoredRecoveryState | null> {
    const tx = this.#database.transaction(["recoveryState"], "readonly");
    const value = (await requestResult(
      tx.objectStore("recoveryState").get("recovery"),
    )) as StoredRecoveryRow | undefined;
    await transactionDone(tx);
    if (!value) return null;
    return {
      ...value,
      recoveryHpkePrivateKey: await this.#open(
        value.recoveryHpkePrivateKey,
        "recovery-hpke",
        String(value.recoveryKeyVersion),
      ),
      recoveryAuthPrivateKeyPkcs8: await this.#open(
        value.recoveryAuthPrivateKeyPkcs8,
        "recovery-auth",
        String(value.recoveryKeyVersion),
      ),
    };
  }

  async putRecoveryState(state: StoredRecoveryState): Promise<void> {
    const row: StoredRecoveryRow = {
      ...state,
      recoveryHpkePrivateKey: await this.#seal(
        state.recoveryHpkePrivateKey,
        "recovery-hpke",
        String(state.recoveryKeyVersion),
      ),
      recoveryAuthPrivateKeyPkcs8: await this.#seal(
        state.recoveryAuthPrivateKeyPkcs8,
        "recovery-auth",
        String(state.recoveryKeyVersion),
      ),
    };
    const tx = this.#database.transaction(["recoveryState"], "readwrite");
    tx.objectStore("recoveryState").put(row);
    await transactionDone(tx);
  }

  async group(partnershipId: string): Promise<StoredGroupState | null> {
    const tx = this.#database.transaction(["groups"], "readonly");
    const value = (await requestResult(
      tx.objectStore("groups").get(partnershipId),
    )) as StoredGroupRow | StoredGroupState | undefined;
    await transactionDone(tx);
    if (!value) return null;
    if (!sealed(value.state)) {
      throw new Error("CRYPTO_LOCAL_STATE_MIGRATION_REQUIRED");
    }
    return {
      ...value,
      state: await this.#open(value.state, "group", partnershipId),
    };
  }

  async putGroup(state: StoredGroupState): Promise<void> {
    const row: StoredGroupRow = {
      ...state,
      state: await this.#seal(state.state, "group", state.partnershipId),
    };
    const tx = this.#database.transaction(["groups"], "readwrite");
    tx.objectStore("groups").put(row);
    await transactionDone(tx);
  }

  async stageApplicationOutbound(
    operation: FrozenCryptoOperation,
    group: StoredGroupState,
  ): Promise<void> {
    if (operation.partnershipId !== group.partnershipId) {
      throw new Error("Crypto operation namespace mismatch");
    }
    const groupRow: StoredGroupRow = {
      ...group,
      state: await this.#seal(group.state, "group", group.partnershipId),
    };
    const operationRow: StoredOperationRow = {
      ...operation,
      candidateState: await this.#seal(
        operation.candidateState,
        "operation",
        operation.operationId,
      ),
    };
    const tx = this.#database.transaction(["groups", "pendingOperations"], "readwrite");
    tx.objectStore("groups").put(groupRow);
    tx.objectStore("pendingOperations").add(operationRow);
    await transactionDone(tx);
  }

  async stageControlOutbound(operation: FrozenCryptoOperation): Promise<void> {
    const row: StoredOperationRow = {
      ...operation,
      candidateState: await this.#seal(
        operation.candidateState,
        "operation",
        operation.operationId,
      ),
    };
    const tx = this.#database.transaction(["pendingOperations"], "readwrite");
    tx.objectStore("pendingOperations").add(row);
    await transactionDone(tx);
  }

  async promoteControlOperation(
    operationId: string,
    group: StoredGroupState,
  ): Promise<void> {
    const groupRow: StoredGroupRow = {
      ...group,
      state: await this.#seal(group.state, "group", group.partnershipId),
    };
    const tx = this.#database.transaction(["groups", "pendingOperations"], "readwrite");
    tx.objectStore("groups").put(groupRow);
    tx.objectStore("pendingOperations").delete(operationId);
    await transactionDone(tx);
  }

  async pendingOperation(operationId: string): Promise<FrozenCryptoOperation | null> {
    const tx = this.#database.transaction(["pendingOperations"], "readonly");
    const value = (await requestResult(
      tx.objectStore("pendingOperations").get(operationId),
    )) as StoredOperationRow | FrozenCryptoOperation | undefined;
    await transactionDone(tx);
    if (!value) return null;
    if (!sealed(value.candidateState)) {
      throw new Error("CRYPTO_LOCAL_STATE_MIGRATION_REQUIRED");
    }
    return {
      ...value,
      candidateState: await this.#open(
        value.candidateState,
        "operation",
        value.operationId,
      ),
    };
  }

  async pendingOperations(partnershipId: string): Promise<readonly FrozenCryptoOperation[]> {
    const tx = this.#database.transaction(["pendingOperations"], "readonly");
    const rows = (await requestResult(
      tx.objectStore("pendingOperations").index("byPartnership").getAll(
        queueRange(partnershipId),
      ),
    )) as Array<StoredOperationRow | FrozenCryptoOperation>;
    await transactionDone(tx);
    const output: FrozenCryptoOperation[] = [];
    for (const row of rows) {
      if (!sealed(row.candidateState)) {
        throw new Error("CRYPTO_LOCAL_STATE_MIGRATION_REQUIRED");
      }
      output.push({
        ...row,
        candidateState: await this.#open(
          row.candidateState,
          "operation",
          row.operationId,
        ),
      });
    }
    return output.sort((left, right) => left.createdAt - right.createdAt);
  }

  async completeOperation(operationId: string): Promise<void> {
    const tx = this.#database.transaction(["pendingOperations"], "readwrite");
    tx.objectStore("pendingOperations").delete(operationId);
    await transactionDone(tx);
  }

  async putContentKey(
    contentKeyId: string,
    partnershipId: string,
    contentKey: Uint8Array,
  ): Promise<void> {
    const row: StoredContentKeyRow = {
      contentKeyId,
      partnershipId,
      wrappedKey: await this.#seal(contentKey, "content-key", contentKeyId),
      updatedAt: Date.now(),
    };
    const tx = this.#database.transaction(["contentKeys"], "readwrite");
    tx.objectStore("contentKeys").put(row);
    await transactionDone(tx);
  }

  async contentKey(contentKeyId: string): Promise<Uint8Array<ArrayBuffer> | null> {
    const tx = this.#database.transaction(["contentKeys"], "readonly");
    const value = (await requestResult(
      tx.objectStore("contentKeys").get(contentKeyId),
    )) as StoredContentKeyRow | undefined;
    await transactionDone(tx);
    return value
      ? this.#open(value.wrappedKey, "content-key", contentKeyId)
      : null;
  }

  async purgePartnership(partnershipId: string): Promise<void> {
    const tx = this.#database.transaction(
      ["groups", "pendingOperations", "contentKeys"],
      "readwrite",
    );
    tx.objectStore("groups").delete(partnershipId);

    const pending = tx.objectStore("pendingOperations").index("byPartnership");
    const pendingKeys = await requestResult(pending.getAllKeys(queueRange(partnershipId)));
    for (const key of pendingKeys) {
      tx.objectStore("pendingOperations").delete(key);
    }

    const content = tx.objectStore("contentKeys").index("byPartnership");
    const contentKeys = await requestResult(content.getAllKeys(queueRange(partnershipId)));
    for (const key of contentKeys) {
      tx.objectStore("contentKeys").delete(key);
    }
    await transactionDone(tx);
  }
}

export async function withCryptoLock<T>(
  partnershipId: string,
  cryptoDeviceId: string,
  callback: () => Promise<T>,
): Promise<T> {
  if (!navigator.locks) throw new Error("CRYPTO_LOCK_UNAVAILABLE");
  return navigator.locks.request(
    LOCK_PREFIX + partnershipId + ":" + cryptoDeviceId,
    { mode: "exclusive" },
    callback,
  );
}

export async function purgeCryptoAccountData(accountId: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_PREFIX + accountId);
    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(request.error ?? new Error("Unable to delete crypto database"));
    request.onblocked = () => {
      // Other tabs release their handles through the existing logout broadcast.
    };
  });
}
