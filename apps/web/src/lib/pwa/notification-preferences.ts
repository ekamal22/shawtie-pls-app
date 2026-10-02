const STORAGE_KEY = "shawtie:notification-preview:v1";
const MESSAGE_TYPE = "R2_NOTIFICATION_PREVIEW";

export function readNotificationPreviewPreference(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

async function postPreference(enabled: boolean): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const worker =
    navigator.serviceWorker.controller ??
    registration?.active ??
    registration?.waiting ??
    registration?.installing ??
    null;
  worker?.postMessage({ type: MESSAGE_TYPE, enabled });
}

export async function setNotificationPreviewPreference(enabled: boolean): Promise<void> {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // A storage failure must fail privacy-safe. The service worker defaults to hidden previews.
  }
  await postPreference(enabled);
}

export async function syncNotificationPreviewPreference(): Promise<void> {
  await postPreference(readNotificationPreviewPreference());
}
