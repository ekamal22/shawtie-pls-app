import { expect, test } from "@playwright/test";

const ACCOUNT_A = "10000000-0000-4000-8000-000000000001";
const ACCOUNT_B = "10000000-0000-4000-8000-000000000002";
const PARTNERSHIP = "20000000-0000-4000-8000-000000000001";

async function open(page: import("@playwright/test").Page) {
  await page.goto("/m3-e2e.html");
  await expect(page.locator("#status")).toHaveText("ready");
  expect(await page.evaluate(() => window.m3Harness.cryptoAvailable())).toBe(true);
}

test("M3 browser test adapter encrypts and decrypts without plaintext ciphertext", async ({ page }) => {
  await open(page);
  const result = await page.evaluate(() => window.m3Harness.encryptRoundTrip("private-m3-sentinel"));
  expect(result.protocolVersion).toBe("m3-test-aes-gcm-v1");
  expect(result.plaintext).toBe("private-m3-sentinel");
  expect(result.ciphertextHex).not.toContain(
    [...new TextEncoder().encode("private-m3-sentinel")]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(""),
  );
});

test("M3 encrypted media draft survives browser reload and keeps owner context", async ({ page }) => {
  await open(page);
  await page.evaluate(
    (input) => window.m3Harness.seedDraft(input),
    {
      accountId: ACCOUNT_A,
      partnershipId: PARTNERSHIP,
      ownerContext: "chat",
      draftId: "40000000-0000-4000-8000-000000000001",
      plaintext: "reload-private-sentinel",
    },
  );

  await page.reload();
  await expect(page.locator("#status")).toHaveText("ready");
  const chat = await page.evaluate(
    ({ accountId, partnershipId }) =>
      window.m3Harness.list(accountId, partnershipId, "chat"),
    { accountId: ACCOUNT_A, partnershipId: PARTNERSHIP },
  );
  const relationship = await page.evaluate(
    ({ accountId, partnershipId }) =>
      window.m3Harness.list(accountId, partnershipId, "relationship"),
    { accountId: ACCOUNT_A, partnershipId: PARTNERSHIP },
  );

  expect(chat).toHaveLength(1);
  expect(chat[0]?.ciphertextText).not.toContain("reload-private-sentinel");
  expect(relationship).toEqual([]);
  await page.evaluate((accountId) => window.m3Harness.purgeAccount(accountId), ACCOUNT_A);
});

test("M3 media databases isolate accounts and purge final partnership drafts", async ({ page }) => {
  await open(page);
  await page.evaluate(
    (input) => window.m3Harness.seedDraft(input),
    {
      accountId: ACCOUNT_A,
      partnershipId: PARTNERSHIP,
      ownerContext: "relationship",
      draftId: "40000000-0000-4000-8000-000000000002",
      plaintext: "account-a-media",
    },
  );

  expect(
    await page.evaluate(
      ({ accountId, partnershipId }) => window.m3Harness.list(accountId, partnershipId),
      { accountId: ACCOUNT_B, partnershipId: PARTNERSHIP },
    ),
  ).toEqual([]);

  await page.evaluate(
    ({ accountId, partnershipId }) =>
      window.m3Harness.purgePartnership(accountId, partnershipId),
    { accountId: ACCOUNT_A, partnershipId: PARTNERSHIP },
  );
  expect(
    await page.evaluate(
      ({ accountId, partnershipId }) => window.m3Harness.list(accountId, partnershipId),
      { accountId: ACCOUNT_A, partnershipId: PARTNERSHIP },
    ),
  ).toEqual([]);

  await page.evaluate((accountId) => window.m3Harness.purgeAccount(accountId), ACCOUNT_A);
  await page.evaluate((accountId) => window.m3Harness.purgeAccount(accountId), ACCOUNT_B);
});

test("M3 service worker does not cache protected API probes", async ({ page }) => {
  await page.route("**/api/m3-private-probe", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "cache-control": "private, no-store" },
      body: JSON.stringify({ private: "sentinel" }),
    });
  });

  await open(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
    await navigator.serviceWorker.ready;
    await fetch("/api/m3-private-probe", { cache: "no-store" });
  });

  const urls = await page.evaluate(async () => {
    const values: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) values.push(request.url);
    }
    return values;
  });
  expect(urls.some((url) => url.includes("/api/m3-private-probe"))).toBe(false);
});
