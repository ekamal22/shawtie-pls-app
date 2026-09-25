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

const VIDEO_CALL = "20000000-0000-4000-8000-0000000000c2";
const VIDEO_DEVICE = "70000000-0000-4000-8000-0000000000c2";

test("C2 callee adopts the offered video transceiver and never renegotiates a second video m-line", async ({
  page,
}) => {
  await page.route("**/api/v1/calls/" + VIDEO_CALL, (route) =>
    route.fulfill({
      json: {
        id: VIDEO_CALL,
        kind: "video",
        direction: "incoming",
        state: "accepted",
        version: 2,
        isThisDeviceSelectedEndpoint: true,
      },
    }),
  );
  await page.route("**/api/v1/calls/" + VIDEO_CALL + "/turn-credentials", (route) =>
    route.fulfill({
      json: {
        urls: ["turn:127.0.0.1:1?transport=tcp"],
        username: "c2-harness",
        credential: "c2-harness",
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        iceTransportPolicy: "relay",
      },
    }),
  );
  await openHarness(page);
  const result = await page.evaluate(
    ({ callId, deviceId }) => window.c2Harness.videoCalleeNegotiation(callId, deviceId),
    { callId: VIDEO_CALL, deviceId: VIDEO_DEVICE },
  );

  expect(result.descriptions.map((description) => description.type)).toEqual(["answer"]);
  expect(result.descriptions[0]).toMatchObject({
    audioLines: 1,
    videoLines: 1,
    applicationLines: 0,
    sendrecvLines: 2,
  });
  expect(result.videoTransceivers).toBe(1);
  expect(result.cameraWaitSettled).toBe("settled");
});
