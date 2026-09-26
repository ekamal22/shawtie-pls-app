import { expect, type Page, type Route, test } from "@playwright/test";

/**
 * Cross-surface integration smoke for the combined UX2 through UX6 build. Runs the real bundle
 * against a mocked API. It checks the seams between surfaces: Memory Return from Ours into
 * Talk, Home context without leaking release-gated items, and navigation across the
 * kept-mounted Talk and the mounted-on-demand Ours and Us surfaces.
 */

const ME = "a0000000-0000-4000-8000-000000000001";
const PARTNER = "b0000000-0000-4000-8000-000000000002";
const CONVERSATION = "c0000000-0000-4000-8000-000000000001";
const PARTNERSHIP = "d0000000-0000-4000-8000-000000000001";
const SOURCE = "e0000000-0000-4000-8000-000000000001";
const GONE = "e0000000-0000-4000-8000-000000000002";

type Json = Record<string, unknown>;

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function message(id: string, n: number, sender: string, body: string): Json {
  return {
    messageId: id,
    conversationId: CONVERSATION,
    senderAccountId: sender,
    serverSequence: n,
    changeSequence: n,
    body,
    createdAt: "2026-09-25T10:0" + n + ":00.000Z",
    editedAt: null,
    deletedAt: null,
    replyToMessageId: null,
    replyPreview: null,
    reactions: [],
    attachments: [],
    contentVersion: 1,
  };
}

const MESSAGES = [
  message(SOURCE, 1, PARTNER, "Text me when you land"),
  message("e0000000-0000-4000-8000-000000000003", 2, ME, "Landed"),
];

function relItem(overrides: Json): Json {
  return {
    itemId: "10000000-0000-4000-8000-000000000001",
    kind: "memory",
    creatorAccountId: PARTNER,
    version: 1,
    createdAt: "2026-03-01T10:00:00.000Z",
    updatedAt: "2026-03-01T10:00:00.000Z",
    occurrence: null,
    storyIncluded: false,
    release: null,
    featureState: null,
    contentSchemaVersion: 1,
    preview: null,
    content: null,
    references: [],
    links: [],
    ...overrides,
  };
}

const KEPT = relItem({
  itemId: "10000000-0000-4000-8000-0000000000aa",
  kind: "remember_this",
  content: { title: "Landing", snapshotText: "Text me when you land", note: null },
  references: [{ referenceId: SOURCE, referenceType: "message", role: "source", position: null }],
});
const KEPT_GONE = relItem({
  itemId: "10000000-0000-4000-8000-0000000000ab",
  kind: "remember_this",
  content: { title: "Old words", snapshotText: "These are older", note: null },
  references: [{ referenceId: GONE, referenceType: "message", role: "source", position: null }],
});
const SEALED = relItem({
  itemId: "10000000-0000-4000-8000-0000000000ac",
  kind: "surprise",
  content: null,
  preview: { title: "Secret preview title", conditionLabel: null },
  release: {
    mode: "creator_reveal",
    generation: 1,
    unlockAt: null,
    releasedAt: null,
    state: "locked",
  },
});

const CONVERSATION_BODY = {
  conversationId: CONVERSATION,
  partnershipId: PARTNERSHIP,
  lifecycleState: "active",
  interactionMode: "normal",
  latestServerSequence: 2,
  latestChangeSequence: 2,
  breakup: null,
  self: { accountId: ME, username: "me", displayName: "Me", nickname: null, nicknameVersion: 0 },
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
};

const PARTNERSHIP_BODY = {
  partnershipId: PARTNERSHIP,
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
  otherMember: { accountId: PARTNER, username: "gulnur", displayName: "Gulnur" },
};

async function mockApi(page: Page, items: Json[]) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    if (path === "/api/v1/auth/session") {
      return json(route, {
        authenticated: true,
        accountId: ME,
        sessionId: "s",
        deviceId: "d",
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
    if (path === "/api/v1/partnerships/current") {
      return json(route, { partnership: PARTNERSHIP_BODY });
    }
    if (path === "/api/v1/conversations/current") {
      return json(route, { conversation: CONVERSATION_BODY });
    }
    const one = path.match(/\/api\/v1\/conversations\/[^/]+\/messages\/([^/]+)$/);
    if (one) {
      const found = MESSAGES.find((entry) => entry.messageId === one[1]);
      return found
        ? json(route, found)
        : json(route, { error: { code: "MESSAGE_NOT_FOUND" } }, 404);
    }
    if (path.startsWith("/api/v1/conversations/") && path.endsWith("/messages")) {
      return json(route, {
        items: MESSAGES,
        hasMore: false,
        oldestSequence: 1,
        newestSequence: 2,
        latestServerSequence: 2,
      });
    }
    if (path.startsWith("/api/v1/conversations/") && path.endsWith("/changes")) {
      return json(route, { items: [], nextCursor: null, latestChangeSequence: 2 });
    }
    if (path === "/api/v1/calls/current") return json(route, { call: null });
    if (path === "/api/v1/relationship-space") {
      return json(route, {
        space: {
          mode: "active",
          relationshipStartDate: "2025-06-01",
          serverDate: "2026-09-26",
          relationshipDuration: { years: 1, months: 3, days: 25 },
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
          upcomingReleases: items.filter(
            (entry) => (entry.release as { state?: string } | null)?.state === "locked",
          ),
          reunion: null,
          anniversary: { date: "2026-06-01", savedCurationItemId: null },
          recentSignals: [],
        },
      });
    }
    if (path === "/api/v1/relationship-space/items" && method === "GET") {
      const kind = url.searchParams.get("kind");
      return json(route, {
        items: items.filter((entry) => !kind || entry.kind === kind),
        nextCursor: null,
      });
    }
    if (path.startsWith("/api/v1/relationship-space/experiences/")) {
      return json(route, { on: "2026-09-26", items: [] });
    }
    if (path.startsWith("/api/v1/notifications"))
      return json(route, { items: [], nextCursor: null });
    if (path.startsWith("/api/v1/partner-requests")) {
      return json(route, { items: [], nextCursor: null });
    }
    if (path === "/api/v1/push/config") return json(route, { enabled: false });
    if (path === "/api/v1/presence/heartbeat") return json(route, {});
    return json(route, { error: { code: "MOCK_NOT_FOUND" } }, 404);
  });
}

async function open(page: Page, items: Json[], hash = "") {
  await mockApi(page, items);
  await page.goto("/index.html" + hash);
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
}

test("Memory Return takes a kept item to its source message in Talk", async ({ page }) => {
  await open(page, [KEPT], "#/ours");
  await page
    .getByRole("button", { name: /Landing/ })
    .first()
    .click();
  const sheet = page.getByRole("dialog", { name: "Kept" });
  await sheet.getByRole("button", { name: "Take me there" }).click();
  await expect(page).toHaveURL(/#\/talk\/message\/.+$/);
  await expect(page.locator("#talk-msg-" + SOURCE)).toBeVisible();
  await expect(page.locator("#talk-msg-" + SOURCE + "[data-highlighted='true']")).toBeVisible();
});

test("Memory Return is offered only when the source message still exists", async ({ page }) => {
  await open(page, [KEPT_GONE], "#/ours");
  await page
    .getByRole("button", { name: /Old words/ })
    .first()
    .click();
  const sheet = page.getByRole("dialog", { name: "Kept" });
  await expect(sheet.getByText("These are older")).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Take me there" })).toHaveCount(0);
});

test("Home never reveals an unreleased release-gated item to the recipient", async ({ page }) => {
  await open(page, [SEALED]);
  await expect(page.getByRole("region", { name: "Your partner" })).toBeVisible();
  const homeText = (await page.locator(".app-route:not([hidden])").innerText()).toLowerCase();
  for (const leak of [
    "secret preview title",
    "surprise",
    "waiting for you",
    "something is waiting",
    "sealed",
    "countdown",
  ]) {
    expect(homeText).not.toContain(leak);
  }
});

test("Home, Talk, Ours, and Us stay reachable and each keeps its own state", async ({ page }) => {
  await open(page, [KEPT]);
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(
    page.getByRole("region", { name: "Your partner" }).getByText("Online", { exact: true }),
  ).toBeVisible();
  await nav.getByRole("button", { name: "Talk" }).click();
  await expect(page.locator("#talk-msg-" + SOURCE)).toBeVisible();
  await nav.getByRole("button", { name: "Ours" }).click();
  await expect(page.getByRole("button", { name: /Landing/ }).first()).toBeVisible();
  await page.getByRole("button", { name: "Us: account and partnership" }).click();
  await expect(page.getByRole("heading", { name: "Partnership", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#\/ours$/);
});
