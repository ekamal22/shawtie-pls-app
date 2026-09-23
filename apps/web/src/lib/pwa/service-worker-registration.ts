import type { SyncCoordinator } from "../realtime/sync-coordinator.ts";

const UPDATE_EVENT = "shawtie:update-waiting";
let waitingRegistration: ServiceWorkerRegistration | null = null;
let controllerListenerInstalled = false;

function announceWaiting(registration: ServiceWorkerRegistration): void {
  waitingRegistration = registration;
  window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
}

export async function registerM2ServiceWorker(): Promise<void> {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

  const registration = await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
    updateViaCache: "none",
  });

  if (!controllerListenerInstalled) {
    controllerListenerInstalled = true;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.location.reload();
    });
  }

  if (registration.waiting) announceWaiting(registration);

  registration.addEventListener("updatefound", () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      if (
        installing.state === "installed" &&
        navigator.serviceWorker.controller &&
        registration.waiting
      ) {
        announceWaiting(registration);
      }
    });
  });

  await registration.update().catch(() => undefined);
}

export function hasWaitingM2ServiceWorker(): boolean {
  return Boolean(waitingRegistration?.waiting);
}

export function subscribeM2UpdateWaiting(listener: () => void): () => void {
  window.addEventListener(UPDATE_EVENT, listener);
  return () => window.removeEventListener(UPDATE_EVENT, listener);
}

export function activateWaitingM2ServiceWorker(coordinator: SyncCoordinator): boolean {
  const waiting = waitingRegistration?.waiting;
  if (!waiting) return false;
  coordinator.markUpdateRequired();
  waiting.postMessage({ type: "M2_ACTIVATE_UPDATE" });
  return true;
}
