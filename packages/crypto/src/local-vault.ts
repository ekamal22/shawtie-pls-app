import { S1_CRYPTO_PROFILE } from "./profile.ts";

const DATABASE_PREFIX = "shawtie-crypto-v1:";
const DATABASE_VERSION = 1;
const LOCK_PREFIX = "shawtie:crypto:";

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

export interface FrozenCryptoOperation {
  readonly operationId: string;
  readonly partnershipId: string;
  readonly cryptoProfile: typeof S1_CRYPTO_PROFILE;
  readonly requestBody: unknown;
  readonly candidateState: Uint8Array<ArrayBuffer>;
  readonly createdAt: number;
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
      if (!database.objectStoreNames.contains("deviceState")) {
        database.createObjectStore("deviceState", { keyPath: "key" });
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
        database.createObjectStore("contentKeys", { keyPath: "contentKeyId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

export class CryptoLocalVault {
  readonly accountId: string;
  readonly #database: IDBDatabase;

  private constructor(accountId: string, database: IDBDatabase) {
    this.accountId = accountId;
    this.#database = database;
  }

  static async open(accountId: string): Promise<CryptoLocalVault> {
    return new CryptoLocalVault(accountId, await openCryptoDatabase(accountId));
  }

  close(): void {
    this.#database.close();
  }

  async deviceState(): Promise<StoredCryptoDeviceState | null> {
    const tx = this.#database.transaction(["deviceState"], "readonly");
    const value = await requestResult(tx.objectStore("deviceState").get("device"));
    await transactionDone(tx);
    return (value as StoredCryptoDeviceState | undefined) ?? null;
  }

  async putDeviceState(state: StoredCryptoDeviceState): Promise<void> {
    const tx = this.#database.transaction(["deviceState"], "readwrite");
    tx.objectStore("deviceState").put(state);
    await transactionDone(tx);
  }

  async group(partnershipId: string): Promise<StoredGroupState | null> {
    const tx = this.#database.transaction(["groups"], "readonly");
    const value = await requestResult(tx.objectStore("groups").get(partnershipId));
    await transactionDone(tx);
    return (value as StoredGroupState | undefined) ?? null;
  }

  async putGroup(state: StoredGroupState): Promise<void> {
    const tx = this.#database.transaction(["groups"], "readwrite");
    tx.objectStore("groups").put(state);
    await transactionDone(tx);
  }

  async stageOutbound(
    operation: FrozenCryptoOperation,
    group: StoredGroupState,
  ): Promise<void> {
    if (operation.partnershipId !== group.partnershipId) {
      throw new Error("Crypto operation namespace mismatch");
    }
    const tx = this.#database.transaction(["groups", "pendingOperations"], "readwrite");
    tx.objectStore("groups").put(group);
    tx.objectStore("pendingOperations").add(operation);
    await transactionDone(tx);
  }

  async pendingOperation(operationId: string): Promise<FrozenCryptoOperation | null> {
    const tx = this.#database.transaction(["pendingOperations"], "readonly");
    const value = await requestResult(tx.objectStore("pendingOperations").get(operationId));
    await transactionDone(tx);
    return (value as FrozenCryptoOperation | undefined) ?? null;
  }

  async completeOperation(operationId: string): Promise<void> {
    const tx = this.#database.transaction(["pendingOperations"], "readwrite");
    tx.objectStore("pendingOperations").delete(operationId);
    await transactionDone(tx);
  }

  async putContentKey(contentKeyId: string, wrappedKey: Uint8Array): Promise<void> {
    const tx = this.#database.transaction(["contentKeys"], "readwrite");
    tx.objectStore("contentKeys").put({
      contentKeyId,
      wrappedKey: new Uint8Array(wrappedKey),
      updatedAt: Date.now(),
    });
    await transactionDone(tx);
  }

  async contentKey(contentKeyId: string): Promise<Uint8Array<ArrayBuffer> | null> {
    const tx = this.#database.transaction(["contentKeys"], "readonly");
    const value = (await requestResult(
      tx.objectStore("contentKeys").get(contentKeyId),
    )) as { wrappedKey?: Uint8Array } | undefined;
    await transactionDone(tx);
    return value?.wrappedKey ? new Uint8Array(value.wrappedKey) : null;
  }

  async purgePartnership(partnershipId: string): Promise<void> {
    const tx = this.#database.transaction(["groups", "pendingOperations"], "readwrite");
    tx.objectStore("groups").delete(partnershipId);
    const index = tx.objectStore("pendingOperations").index("byPartnership");
    const range = IDBKeyRange.bound([partnershipId, 0], [partnershipId, Number.MAX_SAFE_INTEGER]);
    const keys = await requestResult(index.getAllKeys(range));
    for (const key of keys) tx.objectStore("pendingOperations").delete(key);
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
