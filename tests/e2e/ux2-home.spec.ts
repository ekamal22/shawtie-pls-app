import { expect, type Page, type Route, test } from "@playwright/test";

/**
 * UX2 Home smoke. Runs the real bundle against a mocked API. Verifies the curated Home:
 * partner presence, latest message context, one quiet moment, the doorway into Ours, calm
 * empty and loading states, offline resilience, and that Home performs no writes.
 */

const SELF = "a0000000-0000-4000-8000-000000000001";
const PARTNER = "b0000000-0000-4000-8000-000000000002";
const CONVERSATION = "c0000000-0000-4000-8000-000000000001";

interface Scenario {
  conversation?: object | null;
  messages?: object[];
  space?: object | null;
  thisDay?: object[];
  failSpace?: boolean;
  delayConversationMs?: number;
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function conversation(overrides: Record<string, unknown> = {}) {
  return {
    conversationId: CONVERSATION,
    partnershipId: "d0000000-0000-4000-8000-000000000001",
    lifecycleState: "active",
    interactionMode: "normal",
    latestServerSequence: 1,
    latestChangeSequence: 0,
    breakup: null,
    self: {
      accountId: SELF,
      username: "me",
      displayName: "Me",
      nickname: null,
      nicknameVersion: 0,
    },
    partner: {
      accountId: PARTNER,
      username: "gulnur",
      displayName: "Gulnur",
      nickname: null,
      nicknameVersion: 0,
      presence: { online: true, lastSeenAt: null },
      typing: false,
    },
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

function message(body: string, sender = PARTNER) {
  return {
    messageId: "m1",
    conversationId: CONVERSATION,
    senderAccountId: sender,
    senderDeviceId: null,
    serverSequence: 1,
    contentVersion: 1,
    lastChangeSequence: 1,
    replyToMessageId: null,
    replyContext: null,
    body,
    createdAt: new Date().toISOString(),
    editedAt: null,
    deletedAt: null,
    reactions: [],
    attachments: [],
  };
}

function space(overrides: Record<string, unknown> = {}) {
  return {
    mode: "active",
    relationshipStartDate: "2025-06-01",
    serverDate: "2026-05-01",
    relationshipDuration: { years: 0, months: 11, days: 0 },
    capabilities: {
      view: true,
      create: true,
      edit: true,
      delete: true,
      manualRelease: true,
      curate: true,
      sendSignal: true,
    },
    recentItems: [],
    upcomingReleases: [],
    reunion: null,
    anniversary: { date: "2026-12-01", savedCurationItemId: null },
    recentSignals: [],
    ...overrides,
  };
}

function item(title: string, overrides: Record<string, unknown> = {}) {
  return {
    itemId: "e0000000-0000-4000-8000-000000000001",
    kind: "memory",
    creatorAccountId: SELF,
    version: 1,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    occurrence: null,
    storyIncluded: true,
    release: null,
    featureState: null,
    contentSchemaVersion: 1,
    preview: { title },
    content: null,
    references: [],
    links: [],
    ...overrides,
  };
}

async function mockApi(page: Page, scenario: Scenario, writes: string[]) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() !== "GET" && path !== "/api/v1/presence/heartbeat") {
      writes.push(request.method() + " " + path);
    }
    if (path === "/api/v1/auth/session") {
      return json(route, {
        authenticated: true,
        accountId: SELF,
        sessionId: "s1",
        deviceId: "dev1",
        reauthenticatedAt: null,
      });
    }
    if (path === "/api/v1/me") {
      return json(route, {
        accountId: SELF,
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
      if (scenario.delayConversationMs) {
        await new Promise((resolve) => setTimeout(resolve, scenario.delayConversationMs));
      }
      return json(route, {
        conversation: scenario.conversation === undefined ? conversation() : scenario.conversation,
      });
    }
    if (path.startsWith("/api/v1/conversations/") && path.endsWith("/messages")) {
      const items = scenario.messages ?? [];
      return json(route, {
        items,
        hasMore: false,
        oldestSequence: items.length ? 1 : null,
        newestSequence: items.length ? 1 : null,
        latestServerSequence: items.length,
      });
    }
    if (path === "/api/v1/calls/current") return json(route, { call: null });
    if (path.startsWith("/api/v1/notifications")) {
      return json(route, { items: [], nextCursor: null });
    }
    if (path.startsWith("/api/v1/partner-requests")) {
      return json(route, { incoming: [], outgoing: [], items: [] });
    }
    if (path === "/api/v1/relationship-space") {
      if (scenario.failSpace) return json(route, { error: { code: "INTERNAL" } }, 500);
      return json(route, { space: scenario.space === undefined ? space() : scenario.space });
    }
    if (path === "/api/v1/relationship-space/experiences/this-day") {
      return json(route, { on: "2026-05-01", items: scenario.thisDay ?? [] });
    }
    if (path.startsWith("/api/v1/relationship-space/items")) {
      return json(route, { items: [], nextCursor: null });
    }
    if (path === "/api/v1/push/config") return json(route, { enabled: false });
    if (path === "/api/v1/presence/heartbeat") return json(route, {});
    return json(route, { error: { code: "MOCK_NOT_FOUND" } }, 404);
  });
}

async function openHome(page: Page, scenario: Scenario = {}, hash = "") {
  const writes: string[] = [];
  await mockApi(page, scenario, writes);
  await page.goto("/index.html" + hash);
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  return writes;
}

const main = (page: Page) => page.getByRole("main");
const talkDoor = (page: Page) => main(page).getByRole("button", { name: /^Talk/ });
const quietMoment = (page: Page) => page.getByRole("article", { name: "A quiet moment" });

test("Home shows the partner, presence, and the latest message on the Talk door", async ({
  page,
}) => {
  await openHome(page, { messages: [message("Good morning, love")] });
  await expect(page.getByRole("heading", { name: "Gulnur" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Your partner" }).getByText("Online", { exact: true }),
  ).toBeVisible();
  await expect(talkDoor(page)).toContainText("Gulnur: Good morning, love");
  await talkDoor(page).click();
  await expect(page).toHaveURL(/#\/talk$/);
});

test("Home labels my own latest message as You", async ({ page }) => {
  await openHome(page, { messages: [message("On my way", SELF)] });
  await expect(talkDoor(page)).toContainText("You: On my way");
});

test("Home is calm for a new couple: no messages, no moment, no metrics", async ({ page }) => {
  await openHome(page, { messages: [], space: space() });
  await expect(talkDoor(page)).toContainText("Say hello, or pick up where you left off.");
  await expect(quietMoment(page)).toHaveCount(0);
  const text = await main(page).innerText();
  expect(text).not.toMatch(/streak|score|unread|\b\d+ messages\b|\bcalls?\b/i);
  await main(page).getByRole("button", { name: /^Ours/ }).click();
  await expect(page).toHaveURL(/#\/ours$/);
});

test("Home shows a reunion the couple entered as the single quiet moment", async ({ page }) => {
  const reunion = item("Reunion", {
    kind: "reunion",
    featureState: { type: "reunion", targetDate: "2026-05-11" },
  });
  await openHome(page, { space: space({ reunion, recentItems: [item("Our first walk")] }) });
  await expect(quietMoment(page)).toHaveCount(1);
  await expect(quietMoment(page)).toContainText("Until we’re together again");
  await expect(quietMoment(page)).toContainText("10 days");
  await expect(quietMoment(page)).not.toContainText("Our first walk");
});

test("Home shows a recent shared item quietly when nothing else applies", async ({ page }) => {
  await openHome(page, { space: space({ recentItems: [item("Our first walk")] }) });
  await expect(quietMoment(page)).toContainText("Our first walk");
});

test("Home never shows locked or surprise items", async ({ page }) => {
  await openHome(page, {
    space: space({
      recentItems: [
        item("Hidden gift", { kind: "surprise" }),
        item("Locked note", { release: { state: "locked" } }),
      ],
    }),
  });
  await expect(page.getByRole("heading", { name: "Gulnur" })).toBeVisible();
  await expect(page.getByText("Hidden gift")).toHaveCount(0);
  await expect(page.getByText("Locked note")).toHaveCount(0);
  await expect(quietMoment(page)).toHaveCount(0);
});

test("Home still works when the shared space cannot be loaded", async ({ page }) => {
  await openHome(page, { failSpace: true, messages: [message("Hi")] });
  await expect(talkDoor(page)).toContainText("Gulnur: Hi");
  await expect(quietMoment(page)).toHaveCount(0);
  await expect(page.locator(".ds-skeleton")).toHaveCount(0);
});

test("Home shows a skeleton while loading, then the partner", async ({ page }) => {
  await mockApi(page, { delayConversationMs: 600 }, []);
  await page.goto("/index.html");
  await expect(page.getByRole("status", { name: "Opening your space" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Gulnur" })).toBeVisible();
});

// Receipts posted here come from the always-mounted Talk panel (UX1 shell keeps it mounted so
// receipts and sync keep working), not from Home. Home itself issues no writes at all.
test("Home itself performs no writes", async ({ page }) => {
  const writes = await openHome(page, { messages: [message("Hello")] });
  await expect(talkDoor(page)).toContainText("Hello");
  await page.waitForTimeout(500);
  expect(writes.filter((entry) => !entry.endsWith("/receipt"))).toEqual([]);
});

test("Home stays neutral in view-only lifecycle states", async ({ page }) => {
  await openHome(page, {
    conversation: conversation({
      lifecycleState: "breakup_pending",
      interactionMode: "breakup_restricted",
    }),
    messages: [],
  });
  await expect(page.getByRole("heading", { name: "Gulnur" })).toBeVisible();
  await expect(talkDoor(page)).toContainText("Your conversation");
  await expect(main(page)).not.toContainText(/hurry|deadline|last chance|miss/i);
});

test("Home keeps last known content when the network drops", async ({ page, context }) => {
  await openHome(page, { messages: [message("Still here")] });
  await expect(talkDoor(page)).toContainText("Still here");
  await context.setOffline(true);
  const nav = page.getByRole("navigation", { name: "Primary" });
  await nav.getByRole("button", { name: "Ours" }).click();
  await nav.getByRole("button", { name: "Home" }).click();
  await expect(page.getByRole("heading", { name: "Gulnur" })).toBeVisible();
  await expect(talkDoor(page)).toContainText("Still here");
  await context.setOffline(false);
});

test("Home fits a narrow phone without horizontal scroll and offers 44px targets", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openHome(page, { messages: [message("A".repeat(300))] });
  await expect(talkDoor(page)).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  for (const name of [/^Talk/, /^Ours/]) {
    const box = await main(page).getByRole("button", { name }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});
