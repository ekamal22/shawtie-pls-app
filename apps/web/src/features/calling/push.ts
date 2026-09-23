import {
  fetchPushConfig,
  savePushSubscription,
} from "./api.ts";

function applicationServerKey(value: string): Uint8Array {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function serialize(subscription: PushSubscription) {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!p256dh || !auth) throw new Error("Push subscription keys unavailable");
  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime,
    keys: { p256dh, auth },
  };
}

export async function reconcileCallPushSubscription(
  requestPermission: boolean,
): Promise<"enabled" | "denied" | "unavailable"> {
  if (
    !("serviceWorker" in navigator)
    || !("PushManager" in window)
    || !("Notification" in window)
  ) {
    return "unavailable";
  }

  const config = await fetchPushConfig();
  if (!config.enabled || !config.applicationServerKey) return "unavailable";

  let permission = Notification.permission;
  if (permission === "default" && requestPermission) {
    permission = await Notification.requestPermission();
  }
  if (permission !== "granted") {
    return permission === "denied" ? "denied" : "unavailable";
  }

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(config.applicationServerKey),
    });
  }
  await savePushSubscription(serialize(subscription));
  return "enabled";
}
