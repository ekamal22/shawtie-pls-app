import {
  M2_LOCAL_SCHEMA_VERSION,
  M2_PRE_S1_CONTENT_CONTEXT,
  type MessageProjection,
  type RelationshipItemProjection,
} from "@shawtie/contracts";

const DATABASE_PREFIX = "shawtie-local-v1:";
const LAST_ACCOUNT_KEY = "shawtie:last-account";
const DATABASE_VERSION = M2_LOCAL_SCHEMA_VERSION;
export const M2_MAX_CACHED_MESSAGES_PER_CONVERSATION = 500;
export const M2_MAX_CACHED_RELATIONSHIP_ITEMS_PER_PARTNERSHIP = 500;

export interface ConversationSyncState {
  readonly partnershipId: string;
  readonly conversationId: string;
  readonly latestChangeSequence: number;
  readonly latestServerSequence: number;
  readonly retainedHistoryStartSequence: number;
  readonly retainedHistoryEndSequence: number;
  readonly pendingDeliveredThrough: number;
  readonly pendingReadThrough: number;
  readonly lastSyncedAt: string;
}

interface CachedMessage extends MessageProjection {
  readonly partnershipId: string;
  readonly contentContextKey: string;
}

interface CachedRelationshipItem extends RelationshipItemProjection {
  readonly partnershipId: string;
  readonly contentContextKey: string;
}

export interface OfflineQueueClaim {
  readonly claimOwner: string | null;
  readonly claimGeneration: number;
  readonly claimExpiresAt: number | null;
}

export type ChatOperationType =
  | "message.send"
  | "message.edit"
  | "message.delete"
  | "reaction.set"
  | "reaction.remove";

export interface ChatQueueOperation extends OfflineQueueClaim {
  readonly operationId: string;
  readonly partnershipId: string;
  readonly conversationId: string;
  readonly operationType: ChatOperationType;
  readonly messageId: string | null;
  readonly idempotencyKey: string;
  readonly requestBody: unknown;
  readonly expectedContentVersion: number | null;
  readonly queuedAt: number;
  readonly retryCount: number;
  readonly nextAttemptAt: number;
  readonly status: "queued" | "retrying" | "blocked";
  readonly lastErrorCode: string | null;
}

export type RelationshipOperationType = "item.create" | "item.patch" | "item.delete";

export interface RelationshipQueueOperation extends OfflineQueueClaim {
  readonly operationId: string;
  readonly partnershipId: string;
  readonly itemId: string | null;
  readonly operationType: RelationshipOperationType;
  readonly idempotencyKey: string;
  readonly requestBody: unknown;
  readonly expectedVersion: number | null;
  readonly queuedAt: number;
  readonly retryCount: number;
  readonly nextAttemptAt: number;
  readonly status: "queued" | "retrying" | "blocked";
  readonly lastErrorCode: string | null;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

function openDatabase(accountId: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_PREFIX + accountId, DATABASE_VERSION);
    request.onerror = () => reject(request.error ?? new Error("Unable to open local database"));
    request.onblocked = () => reject(new Error("Local database upgrade is blocked"));
    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains("appMeta")) {
        database.createObjectStore("appMeta", { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains("namespaceMeta")) {
        database.createObjectStore("namespaceMeta", { keyPath: "partnershipId" });
      }
      if (!database.objectStoreNames.contains("conversationSync")) {
        database.createObjectStore("conversationSync", {
          keyPath: ["partnershipId", "conversationId"],
        });
      }
      if (!database.objectStoreNames.contains("messages")) {
        const messages = database.createObjectStore("messages", {
          keyPath: ["partnershipId", "conversationId", "messageId"],
        });
        messages.createIndex(
          "byConversationSequence",
          ["partnershipId", "conversationId", "serverSequence"],
          { unique: true },
        );
      }
      if (!database.objectStoreNames.contains("relationshipItems")) {
        database.createObjectStore("relationshipItems", {
          keyPath: ["partnershipId", "itemId"],
        });
      }
      if (!database.objectStoreNames.contains("relationshipMeta")) {
        database.createObjectStore("relationshipMeta", { keyPath: "partnershipId" });
      }
      if (!database.objectStoreNames.contains("chatOutbox")) {
        const outbox = database.createObjectStore("chatOutbox", {
          keyPath: "operationId",
        });
        outbox.createIndex("byNamespaceQueuedAt", ["partnershipId", "queuedAt"]);
      }
      if (!database.objectStoreNames.contains("relationshipOutbox")) {
        const outbox = database.createObjectStore("relationshipOutbox", {
          keyPath: "operationId",
        });
        outbox.createIndex("byNamespaceQueuedAt", ["partnershipId", "queuedAt"]);
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function queueRange(partnershipId: string): IDBKeyRange {
  return IDBKeyRange.bound(
    [partnershipId, 0],
    [partnershipId, Number.MAX_SAFE_INTEGER],
  );
}

export class ShawtieLocalDatabase {
  readonly #database: IDBDatabase;
  readonly accountId: string;

  private constructor(database: IDBDatabase, accountId: string) {
    this.#database = database;
    this.accountId = accountId;
  }

  static async open(accountId: string): Promise<ShawtieLocalDatabase> {
    const database = await openDatabase(accountId);
    const local = new ShawtieLocalDatabase(database, accountId);
    await local.#initialize();
    return local;
  }

  close(): void {
    this.#database.close();
  }

  async #initialize(): Promise<void> {
    const tx = this.#database.transaction(["appMeta"], "readwrite");
    tx.objectStore("appMeta").put({
      key: "singleton",
      localSchemaVersion: M2_LOCAL_SCHEMA_VERSION,
      accountId: this.accountId,
      contentContextKey: M2_PRE_S1_CONTENT_CONTEXT,
      lastOpenedAt: new Date().toISOString(),
    });
    await transactionDone(tx);
  }

  async rememberNamespace(partnershipId: string, conversationId: string): Promise<void> {
    const tx = this.#database.transaction(["namespaceMeta"], "readwrite");
    tx.objectStore("namespaceMeta").put({
      partnershipId,
      conversationId,
      contentContextKey: M2_PRE_S1_CONTENT_CONTEXT,
      localSchemaVersion: M2_LOCAL_SCHEMA_VERSION,
      lastAuthoritativeSyncAt: new Date().toISOString(),
      revokedAt: null,
    });
    await transactionDone(tx);
  }

  async getConversationSync(
    partnershipId: string,
    conversationId: string,
  ): Promise<ConversationSyncState | null> {
    const tx = this.#database.transaction(["conversationSync"], "readonly");
    const value = await requestResult(
      tx.objectStore("conversationSync").get([partnershipId, conversationId]),
    );
    await transactionDone(tx);
    return (value as ConversationSyncState | undefined) ?? null;
  }

  async loadMessages(
    partnershipId: string,
    conversationId: string,
  ): Promise<MessageProjection[]> {
    const tx = this.#database.transaction(["messages"], "readonly");
    const index = tx.objectStore("messages").index("byConversationSequence");
    const values = (await requestResult(
      index.getAll(
        IDBKeyRange.bound(
          [partnershipId, conversationId, 0],
          [partnershipId, conversationId, Number.MAX_SAFE_INTEGER],
        ),
      ),
    )) as CachedMessage[];
    await transactionDone(tx);
    return values
      .sort((left, right) => left.serverSequence - right.serverSequence)
      .map(({ partnershipId: _partnershipId, contentContextKey: _context, ...message }) => message);
  }

  async commitMessagesAndSync(input: {
    partnershipId: string;
    conversationId: string;
    messages: readonly MessageProjection[];
    sync: ConversationSyncState;
  }): Promise<void> {
    const tx = this.#database.transaction(
      ["messages", "conversationSync", "namespaceMeta"],
      "readwrite",
    );
    const messages = tx.objectStore("messages");
    for (const message of input.messages) {
      messages.put({
        ...message,
        partnershipId: input.partnershipId,
        contentContextKey: M2_PRE_S1_CONTENT_CONTEXT,
      } satisfies CachedMessage);
    }

    const range = IDBKeyRange.bound(
      [input.partnershipId, input.conversationId, 0],
      [input.partnershipId, input.conversationId, Number.MAX_SAFE_INTEGER],
    );
    const cached = (await requestResult(
      messages.index("byConversationSequence").getAll(range),
    )) as CachedMessage[];
    const excess = Math.max(
      0,
      cached.length - M2_MAX_CACHED_MESSAGES_PER_CONVERSATION,
    );
    for (const message of cached.slice(0, excess)) {
      messages.delete([
        input.partnershipId,
        input.conversationId,
        message.messageId,
      ]);
    }
    const retained = cached.slice(excess);
    const retainedStart =
      retained.at(0)?.serverSequence ?? input.sync.retainedHistoryStartSequence;
    const retainedEnd =
      retained.at(-1)?.serverSequence ?? input.sync.retainedHistoryEndSequence;

    tx.objectStore("conversationSync").put({
      ...input.sync,
      retainedHistoryStartSequence: retainedStart,
      retainedHistoryEndSequence: retainedEnd,
    } satisfies ConversationSyncState);
    tx.objectStore("namespaceMeta").put({
      partnershipId: input.partnershipId,
      conversationId: input.conversationId,
      contentContextKey: M2_PRE_S1_CONTENT_CONTEXT,
      localSchemaVersion: M2_LOCAL_SCHEMA_VERSION,
      lastAuthoritativeSyncAt: input.sync.lastSyncedAt,
      revokedAt: null,
    });
    await transactionDone(tx);
  }

  async cacheRelationshipItems(
    partnershipId: string,
    items: readonly RelationshipItemProjection[],
  ): Promise<void> {
    const tx = this.#database.transaction(
      ["relationshipItems", "relationshipMeta"],
      "readwrite",
    );
    const store = tx.objectStore("relationshipItems");
    for (const item of items) {
      store.put({
        ...item,
        partnershipId,
        contentContextKey: M2_PRE_S1_CONTENT_CONTEXT,
      } satisfies CachedRelationshipItem);
    }

    const all = (await requestResult(store.getAll())) as CachedRelationshipItem[];
    const partnershipItems = all
      .filter((item) => item.partnershipId === partnershipId)
      .sort(
        (left, right) =>
          Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
          right.itemId.localeCompare(left.itemId),
      );
    for (const item of partnershipItems.slice(
      M2_MAX_CACHED_RELATIONSHIP_ITEMS_PER_PARTNERSHIP,
    )) {
      store.delete([partnershipId, item.itemId]);
    }

    tx.objectStore("relationshipMeta").put({
      partnershipId,
      stale: false,
      lastSyncedAt: new Date().toISOString(),
    });
    await transactionDone(tx);
  }

  async advancePendingReceipts(input: {
    partnershipId: string;
    conversationId: string;
    deliveredThrough: number;
    readThrough: number;
  }): Promise<ConversationSyncState | null> {
    const tx = this.#database.transaction(["conversationSync"], "readwrite");
    const store = tx.objectStore("conversationSync");
    const key = [input.partnershipId, input.conversationId];
    const current = (await requestResult(store.get(key))) as
      | ConversationSyncState
      | undefined;
    if (!current) {
      tx.abort();
      return null;
    }

    const next: ConversationSyncState = {
      ...current,
      pendingDeliveredThrough: Math.max(
        current.pendingDeliveredThrough,
        input.deliveredThrough,
      ),
      pendingReadThrough: Math.max(
        current.pendingReadThrough,
        input.readThrough,
      ),
    };
    store.put(next);
    await transactionDone(tx);
    return next;
  }

  async purgePartnership(partnershipId: string): Promise<void> {
    const stores = [
      "namespaceMeta",
      "conversationSync",
      "messages",
      "relationshipItems",
      "relationshipMeta",
      "chatOutbox",
      "relationshipOutbox",
    ];
    const tx = this.#database.transaction(stores, "readwrite");
    tx.objectStore("namespaceMeta").delete(partnershipId);
    tx.objectStore("relationshipMeta").delete(partnershipId);

    for (const storeName of stores.filter(
      (name) => name !== "namespaceMeta" && name !== "relationshipMeta",
    )) {
      const store = tx.objectStore(storeName);
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const value = cursor.value as { partnershipId?: string };
        if (value.partnershipId === partnershipId) cursor.delete();
        cursor.continue();
      };
    }
    await transactionDone(tx);
  }

  async enqueueChat(operation: ChatQueueOperation): Promise<void> {
    const tx = this.#database.transaction(["chatOutbox"], "readwrite");
    tx.objectStore("chatOutbox").add(operation);
    await transactionDone(tx);
  }

  async listChatQueue(partnershipId: string): Promise<ChatQueueOperation[]> {
    const tx = this.#database.transaction(["chatOutbox"], "readonly");
    const values = (await requestResult(
      tx.objectStore("chatOutbox").index("byNamespaceQueuedAt").getAll(queueRange(partnershipId)),
    )) as ChatQueueOperation[];
    await transactionDone(tx);
    return values.sort((left, right) => left.queuedAt - right.queuedAt);
  }

  async claimChat(
    operationId: string,
    owner: string,
    now: number,
    leaseMs: number,
  ): Promise<ChatQueueOperation | null> {
    const tx = this.#database.transaction(["chatOutbox"], "readwrite");
    const store = tx.objectStore("chatOutbox");
    const current = (await requestResult(store.get(operationId))) as ChatQueueOperation | undefined;
    if (
      !current ||
      current.status === "blocked" ||
      (current.claimExpiresAt !== null &&
        current.claimExpiresAt > now &&
        current.claimOwner !== owner)
    ) {
      tx.abort();
      return null;
    }
    const claimed: ChatQueueOperation = {
      ...current,
      claimOwner: owner,
      claimGeneration: current.claimGeneration + 1,
      claimExpiresAt: now + leaseMs,
    };
    store.put(claimed);
    await transactionDone(tx);
    return claimed;
  }

  async updateChat(
    operation: ChatQueueOperation,
    owner: string,
    claimGeneration: number,
  ): Promise<boolean> {
    const tx = this.#database.transaction(["chatOutbox"], "readwrite");
    const store = tx.objectStore("chatOutbox");
    const current = (await requestResult(store.get(operation.operationId))) as
      | ChatQueueOperation
      | undefined;
    if (
      !current ||
      current.claimOwner !== owner ||
      current.claimGeneration !== claimGeneration
    ) {
      tx.abort();
      return false;
    }
    store.put(operation);
    await transactionDone(tx);
    return true;
  }

  async retryChatOperation(operationId: string): Promise<boolean> {
    const tx = this.#database.transaction(["chatOutbox"], "readwrite");
    const store = tx.objectStore("chatOutbox");
    const current = (await requestResult(store.get(operationId))) as
      | ChatQueueOperation
      | undefined;
    if (!current) {
      tx.abort();
      return false;
    }
    store.put({
      ...current,
      status: "queued",
      lastErrorCode: null,
      nextAttemptAt: Date.now(),
      claimOwner: null,
      claimExpiresAt: null,
    } satisfies ChatQueueOperation);
    await transactionDone(tx);
    return true;
  }

  async discardChatOperation(operationId: string): Promise<void> {
    const tx = this.#database.transaction(["chatOutbox"], "readwrite");
    tx.objectStore("chatOutbox").delete(operationId);
    await transactionDone(tx);
  }

  async completeChatWithMessage(
    operation: ChatQueueOperation,
    owner: string,
    claimGeneration: number,
    message: MessageProjection,
  ): Promise<boolean> {
    const tx = this.#database.transaction(
      ["chatOutbox", "messages", "conversationSync"],
      "readwrite",
    );
    const outbox = tx.objectStore("chatOutbox");
    const current = (await requestResult(outbox.get(operation.operationId))) as
      | ChatQueueOperation
      | undefined;
    if (
      !current ||
      current.claimOwner !== owner ||
      current.claimGeneration !== claimGeneration
    ) {
      tx.abort();
      return false;
    }

    const messages = tx.objectStore("messages");
    messages.put({
      ...message,
      partnershipId: operation.partnershipId,
      contentContextKey: M2_PRE_S1_CONTENT_CONTEXT,
    } satisfies CachedMessage);

    const range = IDBKeyRange.bound(
      [operation.partnershipId, operation.conversationId, 0],
      [
        operation.partnershipId,
        operation.conversationId,
        Number.MAX_SAFE_INTEGER,
      ],
    );
    const cached = (await requestResult(
      messages.index("byConversationSequence").getAll(range),
    )) as CachedMessage[];
    const excess = Math.max(
      0,
      cached.length - M2_MAX_CACHED_MESSAGES_PER_CONVERSATION,
    );
    for (const cachedMessage of cached.slice(0, excess)) {
      messages.delete([
        operation.partnershipId,
        operation.conversationId,
        cachedMessage.messageId,
      ]);
    }
    const retained = cached.slice(excess);

    const syncStore = tx.objectStore("conversationSync");
    const existing = (await requestResult(
      syncStore.get([operation.partnershipId, operation.conversationId]),
    )) as ConversationSyncState | undefined;

    syncStore.put({
      partnershipId: operation.partnershipId,
      conversationId: operation.conversationId,
      latestChangeSequence: Math.max(
        existing?.latestChangeSequence ?? 0,
        message.lastChangeSequence,
      ),
      latestServerSequence: Math.max(
        existing?.latestServerSequence ?? 0,
        message.serverSequence,
      ),
      retainedHistoryStartSequence:
        retained.at(0)?.serverSequence ??
        existing?.retainedHistoryStartSequence ??
        message.serverSequence,
      retainedHistoryEndSequence:
        retained.at(-1)?.serverSequence ??
        Math.max(
          existing?.retainedHistoryEndSequence ?? 0,
          message.serverSequence,
        ),
      pendingDeliveredThrough: existing?.pendingDeliveredThrough ?? 0,
      pendingReadThrough: existing?.pendingReadThrough ?? 0,
      lastSyncedAt: new Date().toISOString(),
    } satisfies ConversationSyncState);

    outbox.delete(operation.operationId);
    await transactionDone(tx);
    return true;
  }

  async completeChatWithoutProjection(
    operation: ChatQueueOperation,
    owner: string,
    claimGeneration: number,
  ): Promise<boolean> {
    const tx = this.#database.transaction(["chatOutbox"], "readwrite");
    const store = tx.objectStore("chatOutbox");
    const current = (await requestResult(store.get(operation.operationId))) as
      | ChatQueueOperation
      | undefined;
    if (
      !current ||
      current.claimOwner !== owner ||
      current.claimGeneration !== claimGeneration
    ) {
      tx.abort();
      return false;
    }
    store.delete(operation.operationId);
    await transactionDone(tx);
    return true;
  }

  async enqueueRelationship(operation: RelationshipQueueOperation): Promise<void> {
    const tx = this.#database.transaction(["relationshipOutbox"], "readwrite");
    tx.objectStore("relationshipOutbox").add(operation);
    await transactionDone(tx);
  }

  async listRelationshipQueue(partnershipId: string): Promise<RelationshipQueueOperation[]> {
    const tx = this.#database.transaction(["relationshipOutbox"], "readonly");
    const values = (await requestResult(
      tx
        .objectStore("relationshipOutbox")
        .index("byNamespaceQueuedAt")
        .getAll(queueRange(partnershipId)),
    )) as RelationshipQueueOperation[];
    await transactionDone(tx);
    return values.sort((left, right) => left.queuedAt - right.queuedAt);
  }

  async claimRelationship(
    operationId: string,
    owner: string,
    now: number,
    leaseMs: number,
  ): Promise<RelationshipQueueOperation | null> {
    const tx = this.#database.transaction(["relationshipOutbox"], "readwrite");
    const store = tx.objectStore("relationshipOutbox");
    const current = (await requestResult(store.get(operationId))) as
      | RelationshipQueueOperation
      | undefined;
    if (
      !current ||
      current.status === "blocked" ||
      (current.claimExpiresAt !== null &&
        current.claimExpiresAt > now &&
        current.claimOwner !== owner)
    ) {
      tx.abort();
      return null;
    }
    const claimed: RelationshipQueueOperation = {
      ...current,
      claimOwner: owner,
      claimGeneration: current.claimGeneration + 1,
      claimExpiresAt: now + leaseMs,
    };
    store.put(claimed);
    await transactionDone(tx);
    return claimed;
  }

  async updateRelationship(
    operation: RelationshipQueueOperation,
    owner: string,
    claimGeneration: number,
  ): Promise<boolean> {
    const tx = this.#database.transaction(["relationshipOutbox"], "readwrite");
    const store = tx.objectStore("relationshipOutbox");
    const current = (await requestResult(store.get(operation.operationId))) as
      | RelationshipQueueOperation
      | undefined;
    if (
      !current ||
      current.claimOwner !== owner ||
      current.claimGeneration !== claimGeneration
    ) {
      tx.abort();
      return false;
    }
    store.put(operation);
    await transactionDone(tx);
    return true;
  }

  async retryRelationshipOperation(operationId: string): Promise<boolean> {
    const tx = this.#database.transaction(["relationshipOutbox"], "readwrite");
    const store = tx.objectStore("relationshipOutbox");
    const current = (await requestResult(store.get(operationId))) as
      | RelationshipQueueOperation
      | undefined;
    if (!current) {
      tx.abort();
      return false;
    }
    store.put({
      ...current,
      status: "queued",
      lastErrorCode: null,
      nextAttemptAt: Date.now(),
      claimOwner: null,
      claimExpiresAt: null,
    } satisfies RelationshipQueueOperation);
    await transactionDone(tx);
    return true;
  }

  async discardRelationshipOperation(operationId: string): Promise<void> {
    const tx = this.#database.transaction(["relationshipOutbox"], "readwrite");
    tx.objectStore("relationshipOutbox").delete(operationId);
    await transactionDone(tx);
  }

  async completeRelationship(
    operation: RelationshipQueueOperation,
    owner: string,
    claimGeneration: number,
    item: RelationshipItemProjection | null,
  ): Promise<boolean> {
    const tx = this.#database.transaction(
      ["relationshipOutbox", "relationshipItems"],
      "readwrite",
    );
    const outbox = tx.objectStore("relationshipOutbox");
    const current = (await requestResult(outbox.get(operation.operationId))) as
      | RelationshipQueueOperation
      | undefined;
    if (
      !current ||
      current.claimOwner !== owner ||
      current.claimGeneration !== claimGeneration
    ) {
      tx.abort();
      return false;
    }

    const items = tx.objectStore("relationshipItems");
    if (item) {
      items.put({
        ...item,
        partnershipId: operation.partnershipId,
        contentContextKey: M2_PRE_S1_CONTENT_CONTEXT,
      } satisfies CachedRelationshipItem);
    } else if (operation.itemId) {
      items.delete([operation.partnershipId, operation.itemId]);
    }

    outbox.delete(operation.operationId);
    await transactionDone(tx);
    return true;
  }
}

export function rememberLocalAccount(accountId: string): void {
  try {
    localStorage.setItem(LAST_ACCOUNT_KEY, accountId);
  } catch {
    // Storage availability is best-effort. IndexedDB remains the authoritative local store.
  }
}

export function rememberedLocalAccount(): string | null {
  try {
    return localStorage.getItem(LAST_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

export async function purgeAccountLocalData(accountId: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_PREFIX + accountId);
    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(request.error ?? new Error("Unable to delete local database"));
    request.onblocked = () => {
      // Other Shawtie pls tabs receive the logout broadcast and close their
      // database handles; the delete request completes after those handles close.
    };
  });
  try {
    if (localStorage.getItem(LAST_ACCOUNT_KEY) === accountId) {
      localStorage.removeItem(LAST_ACCOUNT_KEY);
    }
  } catch {
    // Ignore best-effort marker cleanup.
  }
}

export async function purgeRememberedAccountLocalData(): Promise<void> {
  const accountId = rememberedLocalAccount();
  if (!accountId) return;
  await purgeAccountLocalData(accountId);
}

export async function requestPersistentLocalStorage(): Promise<boolean | null> {
  if (!navigator.storage?.persist) return null;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
