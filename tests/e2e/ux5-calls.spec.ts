import { expect, type Page, type Route, test } from "@playwright/test";

/**
 * UX5 call surfaces. Two layers, both without a backend:
 * 1. The real application bundle against a mocked API, driven by /api/v1/calls/current
 *    projections (ringing, accepted, ended outcomes).
 * 2. A presentation harness that renders CallSurface with fixed props for states that need live
 *    media (connected, muted, reconnecting, video, camera off).
 */

const ME = "a0000000-0000-4000-8000-000000000001";
const PARTNER = "b0000000-0000-4000-8000-000000000002";
const PARTNERSHIP = "d0000000-0000-4000-8000-000000000001";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function projection(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    partnershipId: PARTNERSHIP,
    kind: "voice",
    direction: "incoming",
    state: "ringing",
    version: 2,
    initiatedAt: new Date().toISOString(),
    ringExpiresAt: new Date(Date.now() + 30_000).toISOString(),
    acceptedAt: null,
    connectedAt: null,
    endedAt: null,
    outcome: null,
    isThisDeviceSelectedEndpoint: true,
    ...overrides,
  };
}

async function mockApi(page: Page, currentCall: () => object | null) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/auth/session") {
      return json(route, {
        authenticated: true,
        accountId: ME,
        sessionId: "s1",
        deviceId: "dev1",
        reauthenticatedAt: null,
      });
    }
    if (path === "/api/v1/me") {
      return json(route, {
        accountId: ME,
        username: "me",
        displayName: "Me",
        dateOfBirth: "1995-01-01",
        status: "active",
        email: "me@example.test",
      });
    }
    if (path === "/api/v1/me/devices") return json(route, { devices: [] });
    if (path === "/api/v1/partnerships/current") return json(route, { partnership: null });
    if (path === "/api/v1/conversations/current") {
      return json(route, {
        conversation: {
          conversationId: "c0000000-0000-4000-8000-000000000001",
          partnershipId: PARTNERSHIP,
          lifecycleState: "active",
          interactionMode: "normal",
          latestServerSequence: 0,
          latestChangeSequence: 0,
          breakup: null,
          self: { accountId: ME, username: "me", displayName: "Me", nickname: null },
          partner: {
            accountId: PARTNER,
            username: "gulnur",
            displayName: "Gulnur",
            nickname: null,
            presence: { online: true, lastSeenAt: null },
            typing: false,
          },
          receipts: {},
          capabilities: { sendMessage: true, viewMessages: true },
        },
      });
    }
    if (path.startsWith("/api/v1/conversations/") && path.endsWith("/messages")) {
      return json(route, {
        items: [],
        hasMore: false,
        oldestSequence: null,
        newestSequence: null,
        latestServerSequence: 0,
      });
    }
    if (path === "/api/v1/calls/current") return json(route, { call: currentCall() });
    if (path.startsWith("/api/v1/calls/")) {
      const call = currentCall();
      return call ? json(route, call) : json(route, { error: { code: "NOT_FOUND" } }, 404);
    }
    if (path.startsWith("/api/v1/notifications")) {
      return json(route, { items: [], nextCursor: null });
    }
    if (path.startsWith("/api/v1/partner-requests")) {
      return json(route, { incoming: [], outgoing: [], items: [] });
    }
    if (path.startsWith("/api/v1/relationship-space")) {
      return json(route, { space: null, items: [] });
    }
    if (path === "/api/v1/push/config") return json(route, { enabled: false });
    if (path === "/api/v1/presence/heartbeat") return json(route, {});
    return json(route, { error: { code: "MOCK_NOT_FOUND" } }, 404);
  });
}

async function openApp(page: Page, call: object | null, hash = "#/talk") {
  await mockApi(page, () => call);
  await page.goto("/index.html" + hash);
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
}

const surface = (page: Page) => page.getByRole("dialog");

// Application-level projections -----------------------------------------------------------

test("idle calls show a warm entry with two labelled ways to call and honest privacy copy", async ({
  page,
}) => {
  await openApp(page, null);
  const entry = page.getByRole("region", { name: "Call Gulnur" });
  await expect(entry).toBeVisible();
  await expect(entry.getByRole("button", { name: "Voice call" })).toBeVisible();
  await expect(entry.getByRole("button", { name: "Video call" })).toBeVisible();
  await expect(entry.getByRole("button", { name: "Enable call notifications" })).toBeVisible();
  await expect(entry.getByText("Private relay calling.", { exact: false })).toBeVisible();
  await expect(page.locator(".call-panel")).toHaveAttribute("data-call-state", "idle");
  await expect(surface(page)).toHaveCount(0);
  const text = (await page.locator("body").innerText()).toLowerCase();
  expect(text).not.toContain("end-to-end");
  expect(text).not.toContain("encrypted");
});

test("the idle call entry stays compact on a small phone and survives large text", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openApp(page, null);
  const entry = page.getByRole("region", { name: "Call Gulnur" });
  await expect(entry).toBeVisible();
  const box = await entry.boundingBox();
  expect(box?.height ?? 999).toBeLessThan(250);
  for (const name of ["Voice call", "Video call"]) {
    const button = entry.getByRole("button", { name });
    expect((await button.boundingBox())?.height ?? 0).toBeLessThan(60);
  }
  // 200 percent text on a common 390px phone.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addStyleTag({ content: "html { font-size: 32px !important; }" });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("incoming voice call is a full-screen dialog with Decline and Answer", async ({ page }) => {
  await openApp(page, projection());
  const dialog = surface(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog.getByRole("heading", { name: "Gulnur" })).toBeFocused();
  await expect(dialog).toContainText("Incoming voice call");
  await expect(dialog.getByRole("button", { name: "Decline" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Answer" })).toBeVisible();
  await expect(page.locator(".call-panel")).toHaveAttribute("data-call-state", "ringing");
  await expect(dialog.getByRole("status")).toContainText("Incoming voice call");
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(box?.width).toBe(viewport?.width);
  expect(box?.height).toBe(viewport?.height);
});

test("incoming video keeps both explicit accept choices and Decline", async ({ page }) => {
  await openApp(page, projection({ kind: "video" }), "#/home");
  const dialog = surface(page);
  await expect(dialog).toContainText("Incoming video call");
  await expect(dialog.getByRole("button", { name: "Accept video" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Accept with camera off" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Decline" })).toBeVisible();
});

test("outgoing ringing names the person and offers Cancel call", async ({ page }) => {
  await openApp(page, projection({ direction: "outgoing" }));
  const dialog = surface(page);
  await expect(dialog.getByRole("heading", { name: "Calling Gulnur..." })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel call" })).toBeVisible();
});

test("accepted call without local media reads as connecting and stays endable", async ({
  page,
}) => {
  await openApp(
    page,
    projection({ state: "accepted", acceptedAt: new Date().toISOString(), direction: "outgoing" }),
  );
  const dialog = surface(page);
  await expect(dialog).toContainText("Connecting audio...");
  await expect(dialog.getByRole("button", { name: "End call" })).toBeVisible();
  await expect(page.locator(".call-panel")).toHaveAttribute("data-call-state", "accepted");
});

test("call on another device is described calmly and offers no media controls", async ({
  page,
}) => {
  await openApp(
    page,
    projection({ state: "connected", isThisDeviceSelectedEndpoint: false }),
    "#/ours",
  );
  const dialog = surface(page);
  await expect(dialog).toContainText("This call is on another device.");
  await expect(dialog.getByRole("button", { name: "Mute" })).toHaveCount(0);
});

for (const [name, overrides, expected] of [
  [
    "completed",
    {
      state: "ended",
      outcome: "completed",
      connectedAt: "2026-01-01T10:00:00.000Z",
      endedAt: "2026-01-01T10:12:31.000Z",
    },
    "Call lasted 12:31.",
  ],
  ["no answer", { state: "ended", outcome: "missed", direction: "outgoing" }, "No answer."],
  [
    "failed",
    { state: "ended", outcome: "failed", direction: "outgoing" },
    "Couldn't connect. Check your connection and try again.",
  ],
  ["declined by me", { state: "ended", outcome: "rejected" }, "You declined the call."],
] as const) {
  test(
    "ended call (" + name + ") uses calm copy and Done returns to the entry",
    async ({ page }) => {
      await openApp(page, projection(overrides));
      const dialog = surface(page);
      await expect(dialog).toContainText(expected);
      await expect(dialog.getByRole("heading", { name: /Call ended/ })).toBeVisible();
      if (name === "failed") {
        await expect(dialog.getByRole("button", { name: "Try again" })).toBeVisible();
      }
      await dialog.getByRole("button", { name: "Done" }).click();
      await expect(surface(page)).toHaveCount(0);
      // Focus returns to the page (the entry button is disabled in this offline mock).
      await expect(page.locator("#main")).toBeFocused();
    },
  );
}

test("Tab stays inside the call surface", async ({ page }) => {
  await openApp(page, projection());
  await expect(surface(page)).toBeVisible();
  await expect(surface(page).getByRole("heading")).toBeFocused();
  for (let index = 0; index < 6; index += 1) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(
      () => document.activeElement?.closest("[role='dialog']") !== null,
    );
    expect(inside).toBe(true);
  }
});

// Presentation harness ---------------------------------------------------------------------

async function harness(page: Page, scenario: object) {
  await page.goto("/ux5-e2e.html");
  await expect(page.locator("#status")).toHaveText("ready");
  await page.evaluate((value) => window.ux5Harness.render(value as never), scenario);
  await expect(page.getByRole("dialog")).toBeVisible();
}

test("connected voice shows name, quiet timer, mute, End call and microphone state", async ({
  page,
}) => {
  await harness(page, { kind: "voice", mediaState: "connected" });
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Maya" })).toBeVisible();
  await expect(dialog).toContainText("Connected");
  await expect(dialog.getByRole("timer")).toBeVisible();
  await expect(dialog.getByText("Microphone on")).toBeVisible();
  await expect(dialog.getByText("Private relay calling")).toBeVisible();
  await dialog.getByRole("button", { name: "Mute" }).click();
  expect(await page.evaluate(() => window.ux5Harness.log())).toContain("mute");
  await expect(dialog.getByRole("button", { name: "End call" })).toBeVisible();
});

test("muted state uses icon and text, not color alone", async ({ page }) => {
  await harness(page, { kind: "voice", mediaState: "muted", muted: true });
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Microphone off")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Unmute" })).toBeVisible();
  await expect(dialog.getByRole("status")).toContainText("Your microphone is off.");
});

test("reconnecting keeps the person in the call and blames no one", async ({ page }) => {
  await harness(page, { kind: "voice", mediaState: "disconnected" });
  await expect(page.getByRole("dialog")).toContainText(
    "Reconnecting... you are still in the call.",
  );
});

test("controls are at least 64px and always carry a text label", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await harness(page, { kind: "video", cameraState: "on", remote: true, local: true });
  const buttons = page.getByRole("group", { name: "Call controls" }).getByRole("button");
  const count = await buttons.count();
  expect(count).toBeGreaterThanOrEqual(4);
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    const disc = await button.locator(".call-control__disc").boundingBox();
    expect(disc?.width ?? 0).toBeGreaterThanOrEqual(64);
    expect(disc?.height ?? 0).toBeGreaterThanOrEqual(64);
    expect((await button.innerText()).trim().length).toBeGreaterThan(0);
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("active video: named controls, always-visible badges, auto-hide bar, movable preview", async ({
  page,
}) => {
  await harness(page, { kind: "video", cameraState: "on", remote: true, local: true });
  const dialog = page.getByRole("dialog");
  for (const name of ["Mute", "Turn camera off", "Switch camera", "End call"]) {
    await expect(dialog.getByRole("button", { name })).toBeVisible();
  }
  await expect(dialog.getByText("Microphone on")).toBeVisible();
  await expect(dialog.getByText("Camera on")).toBeVisible();

  // The bar hides after inactivity while the badges stay; a touch brings it back.
  await expect(dialog).toHaveAttribute("data-controls", "hidden", { timeout: 9_000 });
  await expect(dialog.getByText("Microphone on")).toBeVisible();
  await expect(dialog.getByText("Camera on")).toBeVisible();
  await page.mouse.click(200, 300);
  await expect(dialog).toHaveAttribute("data-controls", "visible");

  const tile = dialog.getByRole("button", { name: /Your camera preview/ });
  await expect(tile).toHaveAttribute("data-corner", "bottom-right");
  await tile.click();
  await expect(tile).toHaveAttribute("data-corner", "bottom-left");
});

test("camera off shows an explicit label, badge and a way back on", async ({ page }) => {
  await harness(page, { kind: "video", cameraState: "off", remote: false, local: false });
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Camera off").first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Turn camera on" })).toBeVisible();
  await expect(dialog.getByText("Waiting for Maya's video")).toBeVisible();
});

test("call motion stops under reduced motion and runs otherwise", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await harness(page, { kind: "voice", direction: "outgoing", state: "ringing" });
  const animation = () =>
    page.evaluate(
      () =>
        getComputedStyle(document.querySelector(".call-portrait") as Element, "::before")
          .animationName,
    );
  expect(await animation()).toBe("call-breathe");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await animation()).toBe("none");
});

test("call surface uses the Midnight palette even when the phone is in light mode", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await harness(page, { kind: "voice" });
  const background = await page
    .getByRole("dialog")
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(background).toBe("rgb(21, 18, 26)");
});
