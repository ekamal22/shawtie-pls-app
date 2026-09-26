import { expect, test } from "@playwright/test";

async function open(page: import("@playwright/test").Page) {
  await page.goto("/s1-e2e.html");
  await expect(page.locator("#status")).toHaveText("ready");
}

test("S1 OpenMLS WASM performs Add, Welcome and application delivery in Chromium", async ({
  page,
}) => {
  await open(page);
  const result = await page.evaluate(() =>
    window.s1Harness.mlsRoundTrip("s1-browser-private-sentinel"),
  );

  expect(result.plaintext).toBe("s1-browser-private-sentinel");
  expect(result.aliceEpoch).toBe(result.bobEpoch);
  expect(result.aliceEpoch).toBeGreaterThanOrEqual(1);
  expect(result.bobLeafIndex).toBeGreaterThanOrEqual(0);
  expect(result.aliceDeviceId).not.toBe(result.bobDeviceId);
});

test("S1 protected content rejects authenticated-context substitution in Chromium", async ({
  page,
}) => {
  await open(page);
  const result = await page.evaluate(() =>
    window.s1Harness.protectedContentRoundTrip("s1-aad-private-sentinel"),
  );

  expect(result.plaintext).toBe("s1-aad-private-sentinel");
  expect(result.substitutionRejected).toBe(true);
  expect(result.ciphertextContainsPlaintext).toBe(false);
});

test("S1 local vault survives reload boundary and purges partnership keys", async ({
  page,
}) => {
  await open(page);
  const result = await page.evaluate(() =>
    window.s1Harness.localVaultRoundTrip(
      "10000000-0000-4000-8000-000000000001",
      "20000000-0000-4000-8000-000000000001",
    ),
  );

  expect(result.persisted).toBe(true);
  expect(result.purged).toBe(true);
});
