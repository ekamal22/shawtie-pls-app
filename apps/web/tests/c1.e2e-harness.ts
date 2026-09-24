import { MediaOwnerLease } from "../src/features/calling/media-owner-lease.ts";

interface LeaseState {
  readonly lease: MediaOwnerLease;
  lost: boolean;
}

const leases = new Map<string, LeaseState>();

function requireLease(name: string): LeaseState {
  const state = leases.get(name);
  if (!state) throw new Error("C1 harness lease is missing: " + name);
  return state;
}

async function forceExpire(key: string): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("shawtie-c1-media-owner", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("C1 harness database failed"));
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("leases", "readwrite");
      const store = transaction.objectStore("leases");
      const request = store.get(key);
      request.onsuccess = () => {
        const value = request.result;
        if (!value) {
          transaction.abort();
          reject(new Error("C1 harness lease record is missing"));
          return;
        }
        store.put({ ...value, expiresAt: 0 });
      };
      request.onerror = () => reject(request.error ?? new Error("C1 harness lease read failed"));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("C1 harness transaction failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("C1 harness transaction aborted"));
    });
  } finally {
    database.close();
  }
}

const api = {
  create(name: string, callId: string, deviceId: string) {
    leases.set(name, { lease: new MediaOwnerLease(callId, deviceId), lost: false });
  },
  async acquire(name: string) {
    return requireLease(name).lease.acquire();
  },
  heartbeat(name: string) {
    const state = requireLease(name);
    state.lease.startHeartbeat(() => {
      state.lost = true;
    });
  },
  stopHeartbeat(name: string) {
    requireLease(name).lease.stopHeartbeat();
  },
  async expire(name: string) {
    await forceExpire(requireLease(name).lease.key);
  },
  state(name: string) {
    const state = requireLease(name);
    return { generation: state.lease.generation, lost: state.lost };
  },
  async release(name: string) {
    const state = requireLease(name);
    await state.lease.release();
    leases.delete(name);
  },
};

declare global {
  interface Window {
    c1Harness: typeof api;
  }
}

window.c1Harness = api;
document.querySelector("#status")!.textContent = "ready";
