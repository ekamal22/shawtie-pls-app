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
  await expect.poll(() => page.evaluate(() => window.c1Harness.state("owner").lost)).toBe(true);

  expect(await second.evaluate(() => window.c1Harness.state("observer").generation)).toBe(2);

  await page.evaluate(() => window.c1Harness.release("owner"));
  await second.evaluate(() => window.c1Harness.release("observer"));
  await second.close();
});

const projection = {
  id: CALL,
  state: "accepted",
  version: 2,
  isThisDeviceSelectedEndpoint: true,
};

const turnCredential = {
  urls: ["turn:127.0.0.1:1?transport=tcp"],
  username: "c1-harness",
  credential: "c1-harness",
  expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  iceTransportPolicy: "relay",
};

async function mockCallApi(page: import("@playwright/test").Page, gate: Promise<void>) {
  await page.route("**/api/v1/calls/" + CALL, (route) => route.fulfill({ json: projection }));
  await page.route("**/api/v1/calls/" + CALL + "/turn-credentials", async (route) => {
    await gate;
    await route.fulfill({ json: turnCredential });
  });
}

test("C1 lease verification distinguishes the current owner from a superseded generation", async ({
  page,
}) => {
  await openHarness(page);
  await page.evaluate(
    ({ callId, deviceId }) => window.c1Harness.create("owner", callId, deviceId),
    { callId: CALL, deviceId: DEVICE },
  );
  expect(await page.evaluate(() => window.c1Harness.acquire("owner"))).toBe(1);
  expect(await page.evaluate(() => window.c1Harness.verify("owner"))).toBe(true);

  await page.evaluate(
    ({ callId, deviceId }) => window.c1Harness.takeOverWithoutHint(callId, deviceId, 2),
    { callId: CALL, deviceId: DEVICE },
  );
  expect(await page.evaluate(() => window.c1Harness.verify("owner"))).toBe(false);
  await page.evaluate(() => window.c1Harness.release("owner"));
});

test("C1 completion from a superseded lease generation cannot create media or displace the owner", async ({
  page,
}) => {
  let releaseTurn!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });
  await mockCallApi(page, gate);
  await openHarness(page);

  await page.evaluate(
    ({ callId, deviceId }) => window.c1Harness.startSession("stale", callId, deviceId),
    { callId: CALL, deviceId: DEVICE },
  );
  await expect
    .poll(() =>
      page.evaluate(({ callId, deviceId }) => window.c1Harness.leaseRecord(callId, deviceId), {
        callId: CALL,
        deviceId: DEVICE,
      }),
    )
    .toMatchObject({ ownerGeneration: 1 });

  // Generation 2 is claimed by another tab while the generation-1 TURN request is in flight,
  // without a takeover hint and before the generation-1 heartbeat can notice.
  await page.evaluate(
    ({ callId, deviceId }) => window.c1Harness.takeOverWithoutHint(callId, deviceId, 2),
    { callId: CALL, deviceId: DEVICE },
  );
  releaseTurn();

  expect(await page.evaluate(() => window.c1Harness.sessionResult("stale"))).toBe("done");
  const state = await page.evaluate(() => window.c1Harness.sessionState("stale"));
  expect(state.lost).toBe(true);
  expect(state.peerConnections).toBe(0);
  expect(state.sockets).toBe(0);
  expect(
    await page.evaluate(({ callId, deviceId }) => window.c1Harness.leaseRecord(callId, deviceId), {
      callId: CALL,
      deviceId: DEVICE,
    }),
  ).toMatchObject({ ownerTabId: "other-tab", ownerGeneration: 2 });
});

test("C1 current lease owner still creates exactly one peer connection and one signaling socket", async ({
  page,
}) => {
  await mockCallApi(page, Promise.resolve());
  await openHarness(page);
  await page.evaluate(
    ({ callId, deviceId }) => window.c1Harness.startSession("owner", callId, deviceId),
    { callId: CALL, deviceId: DEVICE },
  );
  expect(await page.evaluate(() => window.c1Harness.sessionResult("owner"))).toBe("done");
  const state = await page.evaluate(() => window.c1Harness.sessionState("owner"));
  expect(state.lost).toBe(false);
  expect(state.peerConnections).toBe(1);
  expect(state.sockets).toBe(1);
  await page.evaluate(() => window.c1Harness.stopSession("owner"));
});
