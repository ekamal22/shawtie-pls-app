const CHANNEL_PREFIX = "shawtie-account-control:";
const DEVICE_KEY_PREFIX = "shawtie:a1-device:";
const LAST_CRYPTO_ACCOUNT_KEY = "shawtie:last-crypto-account";
const PENDING_DELETION_KEY = "shawtie:pending-account-deletion";

interface PendingAccountDeletion {
  readonly accountId: string;
  readonly recoverUntil: string;
}

export function broadcastLocalLogout(accountId: string): void {
  if (!("BroadcastChannel" in window)) return;
  const channel = new BroadcastChannel(CHANNEL_PREFIX + accountId);
  channel.postMessage({ type: "logout", accountId });
  channel.close();
}

export function subscribeLocalLogout(accountId: string, listener: () => void): () => void {
  if (!("BroadcastChannel" in window)) return () => undefined;
  const channel = new BroadcastChannel(CHANNEL_PREFIX + accountId);
  channel.addEventListener("message", (event) => {
    if (event.data?.type === "logout" && event.data?.accountId === accountId) {
      listener();
    }
  });
  return () => channel.close();
}

export function rememberLocalDeviceId(accountId: string, deviceId: string): void {
  try {
    localStorage.setItem(DEVICE_KEY_PREFIX + accountId, deviceId);
  } catch {
    // Best-effort lifecycle marker. IndexedDB remains the protected local store.
  }
}

export function rememberedLocalDeviceId(accountId: string): string | null {
  try {
    return localStorage.getItem(DEVICE_KEY_PREFIX + accountId);
  } catch {
    return null;
  }
}

export function clearRememberedLocalDeviceId(accountId: string): void {
  try {
    localStorage.removeItem(DEVICE_KEY_PREFIX + accountId);
  } catch {
    // Best-effort marker cleanup.
  }
}

export function rememberLastCryptoAccount(accountId: string): void {
  try {
    localStorage.setItem(LAST_CRYPTO_ACCOUNT_KEY, accountId);
  } catch {
    // Best-effort lifecycle marker.
  }
}

export function rememberedLastCryptoAccount(): string | null {
  try {
    return localStorage.getItem(LAST_CRYPTO_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

export function clearLastCryptoAccount(accountId: string): void {
  try {
    if (localStorage.getItem(LAST_CRYPTO_ACCOUNT_KEY) === accountId) {
      localStorage.removeItem(LAST_CRYPTO_ACCOUNT_KEY);
    }
  } catch {
    // Best-effort marker cleanup.
  }
}

export function rememberPendingAccountDeletion(accountId: string, recoverUntil: string): void {
  try {
    localStorage.setItem(PENDING_DELETION_KEY, JSON.stringify({ accountId, recoverUntil }));
  } catch {
    // The server remains authoritative; this marker only drives local crypto cleanup.
  }
}

export function pendingAccountDeletion(): PendingAccountDeletion | null {
  try {
    const raw = localStorage.getItem(PENDING_DELETION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingAccountDeletion>;
    if (
      typeof parsed.accountId !== "string" ||
      typeof parsed.recoverUntil !== "string" ||
      !Number.isFinite(Date.parse(parsed.recoverUntil))
    ) {
      localStorage.removeItem(PENDING_DELETION_KEY);
      return null;
    }
    return { accountId: parsed.accountId, recoverUntil: parsed.recoverUntil };
  } catch {
    return null;
  }
}

export function clearPendingAccountDeletion(accountId: string): void {
  const pending = pendingAccountDeletion();
  if (!pending || pending.accountId !== accountId) return;
  try {
    localStorage.removeItem(PENDING_DELETION_KEY);
  } catch {
    // Best-effort marker cleanup.
  }
}

export function pendingAccountDeletionExpired(accountId: string, now = Date.now()): boolean {
  const pending = pendingAccountDeletion();
  return Boolean(
    pending && pending.accountId === accountId && now >= Date.parse(pending.recoverUntil),
  );
}
