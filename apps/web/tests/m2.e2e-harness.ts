import {
  ShawtieLocalDatabase,
  purgeAccountLocalData,
  type ChatQueueOperation,
} from "../src/lib/offline/local-db.ts";
import { apiRequest } from "../src/lib/api-client.ts";
import { M2Runtime } from "../src/lib/realtime/runtime-context.tsx";

const PARTNERSHIP_ID = "20000000-0000-4000-8000-000000000001";
let database: ShawtieLocalDatabase | null = null;
let runtime: M2Runtime | null = null;
let unregisterRuntimeProbe: (() => void) | null = null;
const runtimeReconcileLog: string[] = [];

function requireDatabase(): ShawtieLocalDatabase {
  if (!database) throw new Error("Harness database is not open");
  return database;
}

function operation(input: {
  operationId: string;
  partnershipId: string;
  conversationId: string;
  queuedAt?: number;
}): ChatQueueOperation {
  return {
    operationId: input.operationId,
    partnershipId: input.partnershipId,
    conversationId: input.conversationId,
    operationType: "message.send",
    messageId: null,
    idempotencyKey: "m2-e2e-" + input.operationId,
    requestBody: { body: "offline browser probe", replyToMessageId: null },
    expectedContentVersion: null,
    queuedAt: input.queuedAt ?? Date.now(),
    retryCount: 0,
    nextAttemptAt: 0,
    status: "queued",
    lastErrorCode: null,
    claimOwner: null,
    claimGeneration: 0,
    claimExpiresAt: null,
  };
}

const api = {
  async open(accountId: string) {
    database?.close();
    database = await ShawtieLocalDatabase.open(accountId);
  },
  close() {
    database?.close();
    database = null;
  },
  async purge(accountId: string) {
    database?.close();
    database = null;
    await purgeAccountLocalData(accountId);
  },
  async rememberNamespace(partnershipId: string, conversationId: string) {
    await requireDatabase().rememberNamespace(partnershipId, conversationId);
  },
  async enqueue(input: {
    operationId: string;
    partnershipId: string;
    conversationId: string;
    queuedAt?: number;
  }) {
    await requireDatabase().enqueueChat(operation(input));
  },
  async list(partnershipId: string) {
    return requireDatabase().listChatQueue(partnershipId);
  },
  async claim(
    operationId: string,
    owner: string,
    now: number,
    leaseMs: number,
  ) {
    return requireDatabase().claimChat(operationId, owner, now, leaseMs);
  },
  async complete(
    operationId: string,
    owner: string,
    generation: number,
  ) {
    const queued = await requireDatabase().listChatQueue(PARTNERSHIP_ID);
    const current = queued.find((item) => item.operationId === operationId);
    if (!current) throw new Error("Harness queued operation is missing");
    return requireDatabase().completeChatWithoutProjection(
      current,
      owner,
      generation,
    );
  },
  async startRuntime(accountId: string) {
    if (runtime) {
      unregisterRuntimeProbe?.();
      unregisterRuntimeProbe = null;
      await runtime.stop();
    }
    runtimeReconcileLog.length = 0;
    runtime = new M2Runtime(accountId);
    unregisterRuntimeProbe = runtime.registerSynchronizer(
      "m2-e2e-canonical-probe",
      async () => {
        runtimeReconcileLog.push("reconcile");
        return apiRequest<{ latestChangeSequence: number }>(
          "/api/v1/m2-e2e-reconcile",
        );
      },
    );
    await runtime.start();
  },
  async stopRuntime() {
    unregisterRuntimeProbe?.();
    unregisterRuntimeProbe = null;
    const active = runtime;
    runtime = null;
    if (active) await active.stop();
  },
  runtimeState() {
    if (!runtime) {
      return {
        status: "stopped",
        partnershipId: null,
        conversationId: null,
        reconcileLog: [...runtimeReconcileLog],
      };
    }
    return {
      status: runtime.coordinator.status,
      partnershipId: runtime.realtime.scope.partnershipId,
      conversationId: runtime.realtime.scope.conversationId,
      reconcileLog: [...runtimeReconcileLog],
    };
  },
  clearRuntimeLog() {
    runtimeReconcileLog.length = 0;
  },
  async queueRuntimeMessage(body: string, idempotencyKey: string) {
    if (!runtime) throw new Error("Harness runtime is not started");
    return runtime.queueChat({
      operationType: "message.send",
      requestBody: { body, replyToMessageId: null },
      idempotencyKey,
    });
  },
  async runtimeQueue() {
    if (!runtime) throw new Error("Harness runtime is not started");
    const partnershipId = runtime.realtime.scope.partnershipId;
    if (!partnershipId) return [];
    return (await runtime.database()).listChatQueue(partnershipId);
  },
};

declare global {
  interface Window {
    m2Harness: typeof api;
  }
}

window.m2Harness = api;
document.querySelector("#status")!.textContent = "ready";
