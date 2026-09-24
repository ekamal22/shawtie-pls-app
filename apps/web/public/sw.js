const CACHE_NAME = "shawtie-shell-v1";

function isPrivateApi(url) {
  return url.pathname === "/api" || url.pathname.startsWith("/api/");
}

function cacheableResponse(response) {
  if (!response || !response.ok) return false;
  const cacheControl = response.headers.get("cache-control") || "";
  return !/\b(no-store|private)\b/i.test(cacheControl);
}

self.addEventListener("install", () => {
  // Activation is explicitly coordinated by the page rather than during install.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("shawtie-shell-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "M2_ACTIVATE_UPDATE") {
    event.waitUntil(self.skipWaiting());
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isPrivateApi(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (cacheableResponse(response)) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put("/", response.clone());
          }
          return response;
        } catch (error) {
          const cached = await caches.match("/");
          if (cached) return cached;
          throw error;
        }
      })(),
    );
    return;
  }

  const staticDestination = new Set(["script", "style", "font", "image"]);
  if (!staticDestination.has(request.destination)) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;

      const response = await fetch(request);
      if (cacheableResponse(response)) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});


const C1_CALL_NOTIFICATION_TAG = "shawtie-current-call";

async function closeCallNotifications() {
  const notifications = await self.registration.getNotifications({
    tag: C1_CALL_NOTIFICATION_TAG,
  });
  for (const notification of notifications) notification.close();
}

async function reconcileCallNotification() {
  let response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    response = await fetch("/api/v1/calls/current", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "x-shawtie-client-protocol-version": "1",
        "x-shawtie-local-schema-version": "1",
      },
    });
  } catch {
    await closeCallNotifications();
    return;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    await closeCallNotifications();
    return;
  }

  const body = await response.json().catch(() => null);
  const call = body?.call;
  if (call?.direction === "incoming" && call?.state === "ringing") {
    await self.registration.showNotification("Incoming call", {
      body: "Open Shawtie pls to answer.",
      tag: C1_CALL_NOTIFICATION_TAG,
      renotify: true,
      requireInteraction: true,
      data: { type: "c1-call" },
    });
    return;
  }
  await closeCallNotifications();
}

self.addEventListener("push", (event) => {
  let payload = null;
  try {
    payload = event.data?.json() ?? null;
  } catch {
    payload = null;
  }
  if (payload?.v !== 1 || payload?.type !== "call_state_changed") return;
  event.waitUntil(reconcileCallNotification());
});

self.addEventListener("notificationclick", (event) => {
  if (event.notification?.data?.type !== "c1-call") return;
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      let target = windows.find((client) => "focus" in client) ?? null;
      if (target) {
        await target.focus();
      } else {
        target = await self.clients.openWindow("/");
      }
      target?.postMessage({ type: "C1_CALL_NOTIFICATION_CLICK" });
    })(),
  );
});
