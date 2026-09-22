const CHANNEL_PREFIX = "shawtie-account-control:";

export function broadcastLocalLogout(accountId: string): void {
  if (!("BroadcastChannel" in window)) return;
  const channel = new BroadcastChannel(CHANNEL_PREFIX + accountId);
  channel.postMessage({ type: "logout", accountId });
  channel.close();
}

export function subscribeLocalLogout(
  accountId: string,
  listener: () => void,
): () => void {
  if (!("BroadcastChannel" in window)) return () => undefined;
  const channel = new BroadcastChannel(CHANNEL_PREFIX + accountId);
  channel.addEventListener("message", (event) => {
    if (
      event.data?.type === "logout" &&
      event.data?.accountId === accountId
    ) {
      listener();
    }
  });
  return () => channel.close();
}
