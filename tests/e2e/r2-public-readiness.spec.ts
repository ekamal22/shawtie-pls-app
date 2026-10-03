import { expect, test } from "@playwright/test";

async function clearWorkerState(page: import("@playwright/test").Page) {
  await page.goto("/m2-e2e.html");
  await page.evaluate(async () => {
    for (const registration of await navigator.serviceWorker.getRegistrations()) {
      await registration.unregister();
    }
    for (const cacheName of await caches.keys()) {
      await caches.delete(cacheName);
    }
  });
  await page.reload();
}

async function activate(
  page: import("@playwright/test").Page,
  release: string,
): Promise<void> {
  await page.evaluate(async (releaseId) => {
    const registration = await navigator.serviceWorker.register(
      "/sw.js?release=" + encodeURIComponent(releaseId),
      { scope: "/", updateViaCache: "none" },
    );

    const installed = await new Promise<ServiceWorker>((resolve, reject) => {
      const candidate =
        registration.waiting ??
        registration.installing ??
        registration.active;
      if (!candidate) {
        reject(new Error("No service worker candidate"));
        return;
      }
      if (candidate.state === "installed" || candidate.state === "activated") {
        resolve(candidate);
        return;
      }
      candidate.addEventListener("statechange", () => {
        if (candidate.state === "installed" || candidate.state === "activated") {
          resolve(candidate);
        }
      });
    });

    if (installed.state === "installed") {
      const controllerChanged = new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), {
          once: true,
        });
      });
      installed.postMessage({ type: "M2_ACTIVATE_UPDATE" });
      await controllerChanged;
    } else if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), {
          once: true,
        });
      });
    }
  }, release);
}

test("R2 service-worker release rotation prunes old shell and keeps upgraded offline navigation", async ({
  context,
  page,
}) => {
  await clearWorkerState(page);

  await activate(page, "r2-release-a");
  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();

  let cacheNames = await page.evaluate(() => caches.keys());
  expect(cacheNames).toContain("shawtie-shell-r2-release-a");

  await activate(page, "r2-release-b");
  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();

  cacheNames = await page.evaluate(() => caches.keys());
  expect(cacheNames).not.toContain("shawtie-shell-r2-release-a");
  expect(cacheNames).toContain("shawtie-shell-r2-release-b");

  await context.setOffline(true);
  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();
  await context.setOffline(false);

  const apiCached = await page.evaluate(async () => {
    for (const cacheName of await caches.keys()) {
      const cache = await caches.open(cacheName);
      for (const request of await cache.keys()) {
        if (new URL(request.url).pathname.startsWith("/api/")) return true;
      }
    }
    return false;
  });
  expect(apiCached).toBe(false);
});
