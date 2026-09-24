import { expect, test } from "@playwright/test";

async function openHarness(page: import("@playwright/test").Page) {
  const response = await page.goto("/c2-e2e.html");
  expect(response).not.toBeNull();
  await expect(page.locator("#status")).toHaveText("ready");
  return response!;
}

test("C2 stale camera acquisition cannot reactivate capture after camera off", async ({ page }) => {
  await openHarness(page);
  await page.evaluate(() => {
    void window.c2Harness.begin("stale");
  });
  await page.evaluate(() => window.c2Harness.disable());
  await page.evaluate(() => window.c2Harness.resolve("stale"));
  await expect.poll(() => page.evaluate(() => window.c2Harness.state())).toMatchObject({
    state: "off",
    senderHasTrack: false,
    localHasTrack: false,
  });
  await page.evaluate(() => window.c2Harness.cleanup());
});

test("C2 current camera intent attaches one live track", async ({ page }) => {
  await openHarness(page);
  expect(await page.evaluate(() => window.c2Harness.enableNow())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.c2Harness.state())).toMatchObject({
    state: "on",
    senderHasTrack: true,
    localHasTrack: true,
  });
  await page.evaluate(() => window.c2Harness.cleanup());
});

test("C2 authority loss prevents camera acquisition", async ({ page }) => {
  await openHarness(page);
  await page.evaluate(() => window.c2Harness.setAuthority(false));
  expect(await page.evaluate(() => window.c2Harness.enableNow())).toBe(false);
  await expect.poll(() => page.evaluate(() => window.c2Harness.state())).toMatchObject({
    senderHasTrack: false,
    localHasTrack: false,
  });
  await page.evaluate(() => window.c2Harness.cleanup());
});

test("C2 browser host scopes camera and microphone to self", async ({ page }) => {
  const response = await openHarness(page);
  expect(response.headers()["permissions-policy"]).toBe("camera=(self), microphone=(self)");
});
