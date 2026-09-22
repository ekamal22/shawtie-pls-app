import { expect, test } from "@playwright/test";

const ACCOUNT = "10000000-0000-4000-8000-000000000001";
const PARTNERSHIP = "20000000-0000-4000-8000-000000000001";
const CONVERSATION = "30000000-0000-4000-8000-000000000001";
const OPERATION = "40000000-0000-4000-8000-000000000001";

async function openHarness(page: import("@playwright/test").Page) {
  await page.goto("/m2-e2e.html");
  await expect(page.locator("#status")).toHaveText("ready");
  await page.evaluate((accountId) => window.m2Harness.open(accountId), ACCOUNT);
}

test("M2 IndexedDB queue survives a real browser reload", async ({ page }) => {
  await openHarness(page);
  await page.evaluate(
    ({ partnershipId, conversationId, operationId }) =>
      window.m2Harness.enqueue({
        partnershipId,
        conversationId,
        operationId,
      }),
    {
      partnershipId: PARTNERSHIP,
      conversationId: CONVERSATION,
      operationId: OPERATION,
    },
  );
  await page.evaluate(() => window.m2Harness.close());

  await page.reload();
  await expect(page.locator("#status")).toHaveText("ready");
  await page.evaluate((accountId) => window.m2Harness.open(accountId), ACCOUNT);
  const queue = await page.evaluate(
    (partnershipId) => window.m2Harness.list(partnershipId),
    PARTNERSHIP,
  );

  expect(queue).toHaveLength(1);
  expect(queue[0]?.operationId).toBe(OPERATION);
  expect(queue[0]?.idempotencyKey).toBe("m2-e2e-" + OPERATION);

  await page.evaluate((accountId) => window.m2Harness.purge(accountId), ACCOUNT);
});

test("M2 cross-tab claim generation fences stale completion", async ({ context, page }) => {
  const second = await context.newPage();
  await openHarness(page);
  await openHarness(second);

  await page.evaluate(
    ({ partnershipId, conversationId, operationId }) =>
      window.m2Harness.enqueue({
        partnershipId,
        conversationId,
        operationId,
        queuedAt: 1,
      }),
    {
      partnershipId: PARTNERSHIP,
      conversationId: CONVERSATION,
      operationId: OPERATION,
    },
  );

  const firstClaim = await page.evaluate(
    ({ operationId }) =>
      window.m2Harness.claim(operationId, "tab-a", Date.now(), 10),
    { operationId: OPERATION },
  );
  expect(firstClaim?.claimGeneration).toBe(1);

  await page.waitForTimeout(25);

  const secondClaim = await second.evaluate(
    ({ operationId }) =>
      window.m2Harness.claim(operationId, "tab-b", Date.now(), 60_000),
    { operationId: OPERATION },
  );
  expect(secondClaim?.claimGeneration).toBe(2);

  const staleCompleted = await page.evaluate(
    ({ operationId, generation }) =>
      window.m2Harness.complete(operationId, "tab-a", generation),
    { operationId: OPERATION, generation: firstClaim!.claimGeneration },
  );
  expect(staleCompleted).toBe(false);

  const currentCompleted = await second.evaluate(
    ({ operationId, generation }) =>
      window.m2Harness.complete(operationId, "tab-b", generation),
    { operationId: OPERATION, generation: secondClaim!.claimGeneration },
  );
  expect(currentCompleted).toBe(true);

  await page.evaluate(() => window.m2Harness.close());
  await second.evaluate(() => window.m2Harness.close());
  await second.close();
  await page.evaluate((accountId) => window.m2Harness.purge(accountId), ACCOUNT);
});

test("M2 pre-S1 cold start remains locked when session verification has no network", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.abort("internetdisconnected");
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Offline" })).toBeVisible();
  await expect(page.getByText(/verify this private session/i)).toBeVisible();
});

test("M2 service worker never caches private API responses", async ({ page }) => {
  await page.route("**/api/m2-private-probe", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ private: "sentinel" }),
    });
  });

  await page.goto("/m2-e2e.html");
  await expect(page.locator("#status")).toHaveText("ready");

  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    await navigator.serviceWorker.ready;

    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => resolve(),
          { once: true },
        );
      });
    }

    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("icon failed to load"));
    });
    image.src = "/icon.svg?m2-browser-cache-probe=1";
    document.body.append(image);
    await loaded;

    const response = await fetch("/api/m2-private-probe");
    if (!response.ok) throw new Error("private API probe failed");
  });

  const cacheUrls = await page.evaluate(async () => {
    const result: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) result.push(request.url);
    }
    return result;
  });

  expect(cacheUrls.some((url) => url.includes("/api/"))).toBe(false);
  expect(cacheUrls.some((url) => url.includes("/icon.svg"))).toBe(true);
});
