import { apiRequest } from "../api-client.ts";

const MESSAGE_TYPE = "R2_NOTIFICATION_PREVIEW";

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
  await postPreference(enabled);
}

export async function syncNotificationPreviewPreference(): Promise<void> {
  // Fail privacy-safe across logout, account switching, startup, and network failure.
  await postPreference(false);
  try {
    const preference = await apiRequest<{ messagePreviewEnabled: boolean }>(
      "/api/v1/me/notification-preferences",
    );
    if (preference.messagePreviewEnabled) {
      await postPreference(true);
    }
  } catch {
    // Hidden preview remains authoritative until the account preference can be loaded.
  }
}
