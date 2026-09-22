import {
  ShawtieLocalDatabase,
  purgeAccountLocalData,
  type ChatQueueOperation,
} from "../src/lib/offline/local-db.ts";

const PARTNERSHIP_ID = "20000000-0000-4000-8000-000000000001";
let database: ShawtieLocalDatabase | null = null;

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
};

declare global {
  interface Window {
    m2Harness: typeof api;
  }
}

window.m2Harness = api;
document.querySelector("#status")!.textContent = "ready";
