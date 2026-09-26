import { expect, type Page, type Route, test } from "@playwright/test";

/**
 * UX1 shell and design-system smoke. Runs the real application bundle against a mocked API
 * (no backend, no database). It verifies navigation, reachability of account/request/lifecycle
 * surfaces, Midnight/Dawn theming, reduced motion, presence display, and responsive layout.
 */

interface Scenario {
  conversation: object | null;
  partnership: object | null;
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

const partner = {
  accountId: "b0000000-0000-4000-8000-000000000002",
  username: "gulnur",
  displayName: "Gulnur",
  nickname: null,
  nicknameVersion: 0,
};

function conversation(
  overrides: Record<string, unknown> = {},
  presence = { online: true, lastSeenAt: null as string | null },
) {
  return {
    conversationId: "c0000000-0000-4000-8000-000000000001",
    partnershipId: "d0000000-0000-4000-8000-000000000001",
    lifecycleState: "active",
    interactionMode: "normal",
    latestServerSequence: 0,
    latestChangeSequence: 0,
    breakup: null,
    self: {
      accountId: "a0000000-0000-4000-8000-000000000001",
      username: "me",
      displayName: "Me",
      nickname: null,
      nicknameVersion: 0,
    },
    partner: { ...partner, presence, typing: false },
    receipts: {
      selfDeliveredThrough: 0,
      selfReadThrough: 0,
      partnerDeliveredThrough: 0,
      partnerReadThrough: 0,
    },
    capabilities: { sendMessage: true, changeNickname: true, typing: true, viewMessages: true },
    ...overrides,
  };
}

function partnership(overrides: Record<string, unknown> = {}) {
  return {
    partnershipId: "d0000000-0000-4000-8000-000000000001",
    lifecycleState: "active",
    interactionMode: "normal",
    activatedAt: "2026-01-01T00:00:00.000Z",
    relationshipStartDate: "2025-06-01",
    metadataVersion: 1,
    generation: 1,
    breakup: null,
    accountDeletion: null,
    capabilities: {
      changeRelationshipStartDate: true,
      initiateBreakup: true,
      cancelBreakup: false,
      submitRestoreIntent: false,
      viewSharedData: true,
    },
    otherMember: {
      accountId: partner.accountId,
      username: partner.username,
      displayName: partner.displayName,
    },
    ...overrides,
  };
}

async function mockApi(page: Page, scenario: Scenario) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/v1/auth/session") {
      return json(route, {
        authenticated: true,
        accountId: "a0000000-0000-4000-8000-000000000001",
        sessionId: "s1",
        deviceId: "dev1",
        reauthenticatedAt: null,
      });
    }
    if (path === "/api/v1/me") {
      return json(route, {
        accountId: "a0000000-0000-4000-8000-000000000001",
        username: "me",
        displayName: "Me",
        dateOfBirth: "1995-01-01",
        status: "active",
        email: "me@example.test",
      });
    }
    if (path === "/api/v1/me/devices") {
      return json(route, {
        devices: [
          {
            id: "dev1",
            displayName: "Test phone",
            createdAt: "2026-01-01T00:00:00.000Z",
            lastSeenAt: null,
            revokedAt: null,
            activeSessionCount: 1,
            isCurrent: true,
          },
        ],
      });
    }
    if (path === "/api/v1/partnerships/current")
      return json(route, { partnership: scenario.partnership });
    if (path === "/api/v1/conversations/current")
      return json(route, { conversation: scenario.conversation });
    if (path.startsWith("/api/v1/conversations/") && path.endsWith("/messages")) {
      return json(route, {
        items: [],
        hasMore: false,
        oldestSequence: null,
        newestSequence: null,
        latestServerSequence: 0,
      });
    }
    if (path === "/api/v1/calls/current") return json(route, { call: null });
    if (path === "/api/v1/notifications" || path.startsWith("/api/v1/notifications")) {
      return json(route, { items: [], nextCursor: null });
    }
    if (path.startsWith("/api/v1/partner-requests"))
      return json(route, { incoming: [], outgoing: [], items: [] });
    if (path === "/api/v1/relationship-space") return json(route, { space: null });
    if (path.startsWith("/api/v1/relationship-space/items"))
      return json(route, { items: [], nextCursor: null });
    if (path === "/api/v1/push/config") return json(route, { enabled: false });
    if (path === "/api/v1/presence/heartbeat") return json(route, {});
    return json(route, { error: { code: "MOCK_NOT_FOUND" } }, 404);
  });
}

async function openApp(page: Page, scenario: Scenario, hash = "") {
  await mockApi(page, scenario);
  await page.goto("/index.html" + hash);
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
}

const PAIRED: Scenario = { conversation: conversation(), partnership: partnership() };

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("Home shows the partner and authoritative online presence", async ({ page }) => {
  await openApp(page, PAIRED);
  await expect(page.getByRole("heading", { name: "Gulnur" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Your partner" }).getByText("Online", { exact: true }),
  ).toBeVisible();
});

test("Home shows a formatted last seen time when the partner is offline", async ({ page }) => {
  const lastSeenAt = new Date(Date.now() - 3 * 3600_000).toISOString();
  await openApp(page, {
    conversation: conversation({}, { online: false, lastSeenAt }),
    partnership: partnership(),
  });
  await expect(
    page.getByRole("region", { name: "Your partner" }).getByText(/^Last seen /),
  ).toBeVisible();
});

test("Home ↔ Talk ↔ Ours ↔ Us navigation works and reflects the current page", async ({ page }) => {
  await openApp(page, PAIRED);
  const nav = page.getByRole("navigation", { name: "Primary" });
  await nav.getByRole("button", { name: "Talk" }).click();
  await expect(page).toHaveURL(/#\/talk$/);
  await expect(nav.getByRole("button", { name: "Talk" })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("button", { name: "Ours" }).click();
  await expect(page).toHaveURL(/#\/ours$/);
  await page.getByRole("button", { name: "Us: account and partnership" }).click();
  await expect(page).toHaveURL(/#\/us$/);
  await page.goBack();
  await expect(page).toHaveURL(/#\/ours$/);
  await nav.getByRole("button", { name: "Home" }).click();
  await expect(page.getByRole("heading", { name: "Gulnur" })).toBeVisible();
});

test("Us keeps account, devices, partnership, requests, and deletion reachable", async ({
  page,
}) => {
  await openApp(page, PAIRED, "#/us");
  await expect(page.getByRole("heading", { name: "Partnership" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Devices" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start breakup" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Request account deletion" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
});

test("Unpaired accounts see a calm Home that leads to partner requests", async ({ page }) => {
  await openApp(page, { conversation: null, partnership: null });
  await expect(page.getByText("Your space is waiting for two.")).toBeVisible();
  await page.getByRole("button", { name: "Find your person" }).click();
  await expect(page).toHaveURL(/#\/us$/);
  await expect(page.getByRole("heading", { name: /find your partner/i }).first()).toBeVisible();
});

test("Lifecycle view-only states show a neutral banner with a path to details", async ({
  page,
}) => {
  await openApp(page, {
    conversation: conversation({
      lifecycleState: "breakup_pending",
      interactionMode: "breakup_restricted",
    }),
    partnership: partnership({
      lifecycleState: "breakup_pending",
      interactionMode: "breakup_restricted",
    }),
  });
  const banner = page.getByRole("status").filter({ hasText: "Breakup process in progress" });
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Details" }).click();
  await expect(page).toHaveURL(/#\/us$/);

  await page.unroute("**/api/**");
  await openApp(page, {
    conversation: conversation({ interactionMode: "account_deletion_view_only" }),
    partnership: partnership({ interactionMode: "account_deletion_view_only" }),
  });
  await expect(
    page.getByText("Account deletion is pending, so shared content can be viewed but not changed."),
  ).toBeVisible();
});

test("Midnight and Dawn apply, persist, and follow the phone by default", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openApp(page, PAIRED, "#/us");
  const room = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await room()).toBe("rgb(246, 240, 231)");
  await page.getByRole("radio", { name: "Midnight" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "midnight");
  expect(await room()).toBe("rgb(21, 18, 26)");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "midnight");
  await page.getByRole("radio", { name: "Follow my phone" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await room()).toBe("rgb(21, 18, 26)");
});

test("Reduced motion replaces route movement with a fade", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openApp(page, PAIRED);
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("button", { name: "Ours" })
    .click();
  const name = await page.evaluate(() => {
    const element = document.querySelector(".app-route.is-entering");
    return element ? getComputedStyle(element).animationName : "missing";
  });
  expect(name).toBe("ds-fade-in");
});

test("Small phones and wide screens keep the layout within the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openApp(page, PAIRED);
  for (const hash of ["#/home", "#/talk", "#/ours", "#/us"]) {
    await page.goto("/index.html" + hash);
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await noHorizontalScroll(page);
  }
  const nav = await page.getByRole("navigation", { name: "Primary" }).boundingBox();
  expect(nav?.y ?? 0).toBeGreaterThan(500);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/index.html#/home");
  const rail = await page.getByRole("navigation", { name: "Primary" }).boundingBox();
  expect(rail?.x).toBe(0);
  expect(rail?.width ?? 0).toBeLessThan(200);
});

test("Route changes move focus to the new content for keyboard users", async ({ page }) => {
  await openApp(page, PAIRED);
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("button", { name: "Ours" })
    .click();
  await expect(page.locator("#main")).toBeFocused();
});

test("Segmented controls move focus with the arrow keys", async ({ page }) => {
  await openApp(page, PAIRED, "#/us");
  const system = page.getByRole("radio", { name: "Follow my phone" });
  await system.focus();
  await page.keyboard.press("ArrowRight");
  const dawn = page.getByRole("radio", { name: "Dawn" });
  await expect(dawn).toBeFocused();
  await expect(dawn).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(system).toBeFocused();
});
