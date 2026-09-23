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
