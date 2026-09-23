import type { LocalMediaDraft } from "./media-types.ts";

const PREFIX = "shawtie-media-v1:";
const VERSION = 1;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Media IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Media transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Media transaction aborted"));
  });
}

function open(accountId: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PREFIX + accountId, VERSION);
    request.onerror = () => reject(request.error ?? new Error("Unable to open media database"));
    request.onblocked = () => reject(new Error("Media database is blocked by another tab"));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("uploadDrafts")) {
        const store = database.createObjectStore("uploadDrafts", { keyPath: "draftId" });
        store.createIndex("byPartnershipCreated", ["partnershipId", "createdAt"]);
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function usingDatabase<T>(accountId: string, task: (database: IDBDatabase) => Promise<T>): Promise<T> {
  const database = await open(accountId);
  try {
    return await task(database);
  } finally {
    database.close();
  }
}

export async function saveMediaDraft(draft: LocalMediaDraft): Promise<void> {
  await usingDatabase(draft.accountId, async (database) => {
    const tx = database.transaction(["uploadDrafts"], "readwrite");
    tx.objectStore("uploadDrafts").put(draft);
    await transactionDone(tx);
  });
}

export async function loadMediaDraft(
  accountId: string,
  draftId: string,
): Promise<LocalMediaDraft | null> {
  return usingDatabase(accountId, async (database) => {
    const tx = database.transaction(["uploadDrafts"], "readonly");
    const value = (await requestResult(tx.objectStore("uploadDrafts").get(draftId))) as
      | LocalMediaDraft
      | undefined;
    await transactionDone(tx);
    return value ?? null;
  });
}

export async function listMediaDrafts(
  accountId: string,
  partnershipId: string,
  ownerContext?: LocalMediaDraft["ownerContext"],
): Promise<LocalMediaDraft[]> {
  return usingDatabase(accountId, async (database) => {
    const tx = database.transaction(["uploadDrafts"], "readonly");
    const values = (await requestResult(
      tx
        .objectStore("uploadDrafts")
        .index("byPartnershipCreated")
        .getAll(
          IDBKeyRange.bound(
            [partnershipId, 0],
            [partnershipId, Number.MAX_SAFE_INTEGER],
          ),
        ),
    )) as LocalMediaDraft[];
    await transactionDone(tx);
    return values
      .filter((draft) => ownerContext === undefined || draft.ownerContext === ownerContext)
      .sort((left, right) => left.createdAt - right.createdAt);
  });
}

export async function deleteMediaDraft(accountId: string, draftId: string): Promise<void> {
  await usingDatabase(accountId, async (database) => {
    const tx = database.transaction(["uploadDrafts"], "readwrite");
    tx.objectStore("uploadDrafts").delete(draftId);
    await transactionDone(tx);
  });
}

export async function purgeMediaPartnershipData(
  accountId: string,
  partnershipId: string,
): Promise<void> {
  await usingDatabase(accountId, async (database) => {
    const tx = database.transaction(["uploadDrafts"], "readwrite");
    const store = tx.objectStore("uploadDrafts");
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const value = cursor.value as LocalMediaDraft;
      if (value.partnershipId === partnershipId) cursor.delete();
      cursor.continue();
    };
    await transactionDone(tx);
  });
}

export async function purgeMediaAccountData(accountId: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(PREFIX + accountId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Unable to delete media database"));
    request.onblocked = () =>
      reject(new Error("Media database purge is blocked by another tab"));
  });
}
