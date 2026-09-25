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

test("C2 remote video shows the no-video state when the sender camera stops and recovers when it returns", async ({
  page,
}) => {
  await openHarness(page);
  await page.evaluate(() => window.c2Harness.mountRemoteVideo());

  // 1. frames initially advance and the frame is shown
  await expect
    .poll(() => page.evaluate(() => window.c2Harness.remoteVideoState()), { timeout: 10_000 })
    .toMatchObject({ hasElement: true, placeholderVisible: false, hidden: false });
  await expect
    .poll(() => page.evaluate(() => window.c2Harness.remoteVideoState().totalFrames))
    .toBeGreaterThan(5);

  // 2. the sender detaches its camera track
  await page.evaluate(() => window.c2Harness.remoteSenderCamera(false));

  // 3. the receiving track stays live and unmuted, so mute events alone would keep the stale frame
  await page.waitForTimeout(1500);
  const stale = await page.evaluate(() => window.c2Harness.remoteVideoState());
  expect(stale.receiverTrackState).toBe("live");
  expect(stale.receiverTrackMuted).toBe(false);

  // 4. rendering progress stops, so the UI moves to the no-video state
  await expect
    .poll(() => page.evaluate(() => window.c2Harness.remoteVideoState()), { timeout: 12_000 })
    .toMatchObject({ placeholderVisible: true, hidden: true });
  const stalled = await page.evaluate(() => window.c2Harness.remoteVideoState());
  expect(stalled.receiverTrackState).toBe("live");
  expect(stalled.receiverTrackMuted).toBe(false);

  // 5. the sender camera returns and rendering resumes automatically
  await page.evaluate(() => window.c2Harness.remoteSenderCamera(true));
  await expect
    .poll(() => page.evaluate(() => window.c2Harness.remoteVideoState()), { timeout: 12_000 })
    .toMatchObject({ placeholderVisible: false, hidden: false });

  await page.evaluate(() => window.c2Harness.unmountRemoteVideo());
});
