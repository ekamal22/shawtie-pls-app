import { CallMediaSession } from "../src/features/calling/media-controller.ts";
import { MediaOwnerLease } from "../src/features/calling/media-owner-lease.ts";

interface LeaseState {
  readonly lease: MediaOwnerLease;
  lost: boolean;
}

const leases = new Map<string, LeaseState>();

interface SessionState {
  readonly session: CallMediaSession;
  readonly started: Promise<string>;
  lost: boolean;
}

const sessions = new Map<string, SessionState>();
const counts = { peerConnections: 0, sockets: 0 };
let instrumented = false;

function instrumentConstructors(): void {
  if (instrumented) return;
  instrumented = true;
  const NativePeer = window.RTCPeerConnection;
  window.RTCPeerConnection = new Proxy(NativePeer, {
    construct(target, args, newTarget) {
      counts.peerConnections += 1;
      return Reflect.construct(target, args, newTarget);
    },
  });
  const NativeSocket = window.WebSocket;
  window.WebSocket = new Proxy(NativeSocket, {
    construct(target, args, newTarget) {
      counts.sockets += 1;
      return Reflect.construct(target, args, newTarget);
    },
  });
}

async function writeLease(key: string, ownerTabId: string, ownerGeneration: number): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("shawtie-c1-media-owner", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("C1 harness database failed"));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("leases", "readwrite");
      transaction.objectStore("leases").put({
        key,
        ownerTabId,
        ownerGeneration,
        expiresAt: Date.now() + 8_000,
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("C1 harness transaction failed"));
    });
  } finally {
    database.close();
  }
}

function requireSession(name: string): SessionState {
  const state = sessions.get(name);
  if (!state) throw new Error("C1 harness session is missing: " + name);
  return state;
}

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
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("C1 harness transaction failed"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("C1 harness transaction aborted"));
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
  async verify(name: string) {
    return requireLease(name).lease.verifyOwnership();
  },
  startSession(name: string, callId: string, deviceId: string) {
    instrumentConstructors();
    const audio = new AudioContext();
    const destination = audio.createMediaStreamDestination();
    const holder: { state: SessionState | null } = { state: null };
    const session = new CallMediaSession(callId, deviceId, destination.stream, {
      onState: () => undefined,
      onAutoplayBlocked: () => undefined,
      onOwnershipLost: () => {
        if (holder.state) holder.state.lost = true;
      },
      onUnrecoverableFailure: () => undefined,
      onError: () => undefined,
    });
    const started = session.start().then(
      () => "done",
      (error: unknown) => "error:" + (error instanceof Error ? error.message : String(error)),
    );
    holder.state = { session, started, lost: false };
    sessions.set(name, holder.state);
  },
  async sessionResult(name: string) {
    return requireSession(name).started;
  },
  sessionState(name: string) {
    const state = requireSession(name);
    return {
      lost: state.lost,
      peerConnections: counts.peerConnections,
      sockets: counts.sockets,
    };
  },
  async leaseRecord(callId: string, deviceId: string) {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("shawtie-c1-media-owner", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("C1 harness database failed"));
    });
    try {
      return await new Promise<{ ownerTabId: string; ownerGeneration: number } | null>(
        (resolve, reject) => {
          const request = database
            .transaction("leases")
            .objectStore("leases")
            .get(callId + ":" + deviceId);
          request.onsuccess = () => resolve(request.result ?? null);
          request.onerror = () => reject(request.error ?? new Error("C1 harness read failed"));
        },
      );
    } finally {
      database.close();
    }
  },
  async takeOverWithoutHint(callId: string, deviceId: string, generation: number) {
    await writeLease(callId + ":" + deviceId, "other-tab", generation);
  },
  async stopSession(name: string) {
    await requireSession(name).session.stop();
    sessions.delete(name);
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
