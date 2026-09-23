const DATABASE_NAME = "shawtie-c1-media-owner";
const STORE_NAME = "leases";
const LEASE_MS = 8_000;
const HEARTBEAT_MS = 2_000;

interface LeaseRecord {
  readonly key: string;
  readonly ownerTabId: string;
  readonly ownerGeneration: number;
  readonly expiresAt: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("C1 owner database failed"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("C1 owner request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("C1 owner transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("C1 owner transaction failed"));
  });
}

type BrowserLocks = {
  request<T>(
    name: string,
    options: { mode: "exclusive"; ifAvailable: true },
    callback: (lock: unknown | null) => Promise<T>,
  ): Promise<T>;
};

export class MediaOwnerLease {
  readonly tabId = crypto.randomUUID();
  readonly key: string;
  #generation = 0;
  #heartbeat: number | null = null;
  #channel: BroadcastChannel | null = null;

  constructor(callId: string, deviceId: string) {
    this.key = callId + ":" + deviceId;
    if ("BroadcastChannel" in window) {
      this.#channel = new BroadcastChannel("shawtie-c1-call-owner");
    }
  }

  get generation(): number {
    return this.#generation;
  }

  async acquire(): Promise<number | null> {
    const locks = (navigator as Navigator & { locks?: BrowserLocks }).locks;
    if (locks) {
      return locks.request(
        "shawtie-c1-owner:" + this.key,
        { mode: "exclusive", ifAvailable: true },
        async (lock) => (lock ? this.#acquireFromDatabase() : null),
      );
    }
    return this.#acquireFromDatabase();
  }

  startHeartbeat(onLost: () => void): void {
    if (this.#generation <= 0 || this.#heartbeat !== null) return;
    this.#heartbeat = window.setInterval(() => {
      void this.#renew().then((owned) => {
        if (owned) return;
        this.stopHeartbeat();
        onLost();
      });
    }, HEARTBEAT_MS);
  }

  stopHeartbeat(): void {
    if (this.#heartbeat !== null) {
      window.clearInterval(this.#heartbeat);
      this.#heartbeat = null;
    }
  }

  async release(): Promise<void> {
    this.stopHeartbeat();
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const current = await requestResult(store.get(this.key) as IDBRequest<LeaseRecord | undefined>);
      if (
        current
        && current.ownerTabId === this.tabId
        && current.ownerGeneration === this.#generation
      ) {
        store.delete(this.key);
      }
      await transactionDone(transaction);
    } finally {
      database.close();
      this.#channel?.postMessage({ key: this.key, type: "released" });
      this.#channel?.close();
      this.#channel = null;
      this.#generation = 0;
    }
  }

  async #acquireFromDatabase(): Promise<number | null> {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const current = await requestResult(store.get(this.key) as IDBRequest<LeaseRecord | undefined>);
      const now = Date.now();
      if (
        current
        && current.expiresAt > now
        && current.ownerTabId !== this.tabId
      ) {
        await transactionDone(transaction);
        return null;
      }
      const generation = Math.max(current?.ownerGeneration ?? 0, this.#generation) + 1;
      store.put({
        key: this.key,
        ownerTabId: this.tabId,
        ownerGeneration: generation,
        expiresAt: now + LEASE_MS,
      } satisfies LeaseRecord);
      await transactionDone(transaction);
      this.#generation = generation;
      this.#channel?.postMessage({ key: this.key, type: "claimed", generation });
      return generation;
    } finally {
      database.close();
    }
  }

  async #renew(): Promise<boolean> {
    if (this.#generation <= 0) return false;
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const current = await requestResult(store.get(this.key) as IDBRequest<LeaseRecord | undefined>);
      if (
        !current
        || current.ownerTabId !== this.tabId
        || current.ownerGeneration !== this.#generation
      ) {
        await transactionDone(transaction);
        return false;
      }
      store.put({ ...current, expiresAt: Date.now() + LEASE_MS });
      await transactionDone(transaction);
      return true;
    } finally {
      database.close();
    }
  }
}
