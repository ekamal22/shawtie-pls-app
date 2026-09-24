import { expect, test } from "@playwright/test";

const CALL = "20000000-0000-4000-8000-000000000099";
const DEVICE = "70000000-0000-4000-8000-000000000099";

async function openHarness(page: import("@playwright/test").Page) {
  const response = await page.goto("/c1-e2e.html");
  expect(response).not.toBeNull();
  await expect(page.locator("#status")).toHaveText("ready");
  return response!;
}

test("C1 browser host disables camera and scopes microphone to self", async ({ page }) => {
  const response = await openHarness(page);
  expect(response.headers()["permissions-policy"]).toBe("camera=(), microphone=(self)");
});

test("C1 media owner is single-tab and takeover generation is monotonic", async ({
  context,
  page,
}) => {
  const second = await context.newPage();
  await openHarness(page);
  await openHarness(second);

  await page.evaluate(
    ({ callId, deviceId }) => window.c1Harness.create("owner", callId, deviceId),
    { callId: CALL, deviceId: DEVICE },
  );
  await second.evaluate(
    ({ callId, deviceId }) => window.c1Harness.create("observer", callId, deviceId),
    { callId: CALL, deviceId: DEVICE },
  );

  expect(await page.evaluate(() => window.c1Harness.acquire("owner"))).toBe(1);
  await page.evaluate(() => window.c1Harness.heartbeat("owner"));
  expect(await second.evaluate(() => window.c1Harness.acquire("observer"))).toBeNull();

  await page.evaluate(() => window.c1Harness.stopHeartbeat("owner"));
  await page.evaluate(() => window.c1Harness.expire("owner"));

  expect(await second.evaluate(() => window.c1Harness.acquire("observer"))).toBe(2);
  await expect
    .poll(() => page.evaluate(() => window.c1Harness.state("owner").lost))
    .toBe(true);

  expect(await second.evaluate(() => window.c1Harness.state("observer").generation)).toBe(2);

  await page.evaluate(() => window.c1Harness.release("owner"));
  await second.evaluate(() => window.c1Harness.release("observer"));
  await second.close();
});
