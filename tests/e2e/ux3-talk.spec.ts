import { expect, type Page, type Route, test } from "@playwright/test";

/**
 * UX3 Talk surface. Runs the real application bundle against a mocked API (no backend).
 * Covers grouped bubbles and time separators, quoted replies with jump-to-original, the
 * deleted placeholder, read and delivered labels, long-message collapse, the composer and its
 * sheet, message actions, Keep to Remember This, the offline banner, view-only gating, and
 * reduced motion.
 */

const SELF = "a0000000-0000-4000-8000-000000000001";
const PARTNER = "b0000000-0000-4000-8000-000000000002";
const CONVERSATION_ID = "c0000000-0000-4000-8000-000000000001";
const PARTNERSHIP_ID = "d0000000-0000-4000-8000-000000000001";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function yesterdayAt(hour: number, minute: number): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

const LONG_BODY = Array.from({ length: 16 }, (_, index) => "Line " + (index + 1)).join("\n");

function message(
  n: number,
  sender: string,
  at: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    messageId: "e000000" + n + "-0000-4000-8000-000000000000",
    conversationId: CONVERSATION_ID,
    senderAccountId: sender,
    senderDeviceId: null,
    serverSequence: n,
    contentVersion: 1,
    lastChangeSequence: n,
    replyToMessageId: null,
    replyContext: null,
    body: "message " + n,
    createdAt: at,
    editedAt: null,
    deletedAt: null,
    reactions: [],
    attachments: [],
    ...overrides,
  };
}

const M1 = message(1, PARTNER, yesterdayAt(10, 0), { body: "Good morning" });
const M2 = message(2, PARTNER, yesterdayAt(10, 1), { body: "Did you sleep well?" });
const M3 = message(3, SELF, yesterdayAt(10, 5), {
  body: "Like a stone",
  replyToMessageId: M1.messageId,
  replyContext: {
    messageId: M1.messageId,
    senderAccountId: PARTNER,
    body: "Good morning",
    deleted: false,
  },
  reactions: [{ accountId: PARTNER, emoji: "❤️" }],
});
const M4 = message(4, SELF, yesterdayAt(10, 30), { body: null, deletedAt: yesterdayAt(10, 31) });
const M5 = message(5, SELF, yesterdayAt(10, 45), { body: LONG_BODY });
const MESSAGES = [M1, M2, M3, M4, M5];

interface Scenario {
  conversation?: Record<string, unknown>;
  messages?: Array<Record<string, unknown>>;
  keepRequests?: unknown[];
}

function conversation(overrides: Record<string, unknown> = {}) {
  return {
    conversationId: CONVERSATION_ID,
    partnershipId: PARTNERSHIP_ID,
    lifecycleState: "active",
    interactionMode: "normal",
    latestServerSequence: 5,
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
      selfDeliveredThrough: 5,
      selfReadThrough: 5,
      partnerDeliveredThrough: 5,
      partnerReadThrough: 3,
    },
    capabilities: { sendMessage: true, changeNickname: true, typing: true, viewMessages: true },
    ...overrides,
  };
}

async function mockApi(page: Page, scenario: Scenario) {
  const items = scenario.messages ?? MESSAGES;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
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
    if (path === "/api/v1/partnerships/current") {
      return json(route, {
        partnership: {
          partnershipId: PARTNERSHIP_ID,
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
        },
      });
    }
    if (path === "/api/v1/conversations/current") {
      return json(route, { conversation: scenario.conversation ?? conversation() });
    }
    if (path === "/api/v1/conversations/" + CONVERSATION_ID + "/messages") {
      return json(route, {
        items,
        hasMore: false,
        oldestSequence: 1,
        newestSequence: items.length,
        latestServerSequence: items.length,
      });
    }
    if (path === "/api/v1/conversations/" + CONVERSATION_ID + "/changes") {
      return json(route, { items: [], latestChangeSequence: 0, hasMore: false });
    }
    if (path.startsWith("/api/v1/conversations/" + CONVERSATION_ID + "/messages/")) {
      const id = path.split("/").pop();
      const found = items.find((item) => item.messageId === id);
      return found ? json(route, found) : json(route, { error: { code: "NOT_FOUND" } }, 404);
    }
    if (path === "/api/v1/relationship-space/items" && method === "POST") {
      scenario.keepRequests?.push(route.request().postDataJSON());
      return json(
        route,
        { itemId: "f0000000-0000-4000-8000-000000000001", version: 1, createdAt: "2026-01-02" },
        201,
      );
    }
    if (path === "/api/v1/calls/current") return json(route, { call: null });
    if (path.startsWith("/api/v1/notifications"))
      return json(route, { items: [], nextCursor: null });
    if (path.startsWith("/api/v1/partner-requests"))
      return json(route, { incoming: [], outgoing: [], items: [] });
    if (path === "/api/v1/relationship-space") return json(route, { space: null });
    if (path.startsWith("/api/v1/relationship-space/items"))
      return json(route, { items: [], nextCursor: null });
    if (path === "/api/v1/push/config") return json(route, { enabled: false });
    if (path === "/api/v1/presence/heartbeat") return json(route, {});
    if (path.endsWith("/receipt")) return json(route, {});
    return json(route, { error: { code: "MOCK_NOT_FOUND" } }, 404);
  });
}

async function openTalk(page: Page, scenario: Scenario = {}) {
  await mockApi(page, scenario);
  await page.goto("/index.html#/talk");
  await expect(page.getByRole("log", { name: "Messages" })).toBeVisible();
}

test("Bubbles group by speaker with a human time separator and the 2px / 12px rhythm", async ({
  page,
}) => {
  await openTalk(page);
  await expect(page.locator(".talk-separator").first()).toHaveText("Yesterday morning");
  const first = page.locator("#talk-msg-" + M1.messageId);
  const second = page.locator("#talk-msg-" + M2.messageId);
  await expect(first).toHaveAttribute("data-position", "first");
  await expect(second).toHaveAttribute("data-position", "last");
  expect(await second.evaluate((el) => getComputedStyle(el).marginTop)).toBe("2px");
  const own = page.locator("#talk-msg-" + M3.messageId);
  expect(await own.evaluate((el) => getComputedStyle(el).marginTop)).toBe("12px");
  await expect(own).toHaveAttribute("data-own", "true");
  // No avatars in the thread.
  await expect(page.locator(".talk-list .ds-avatar")).toHaveCount(0);
  // Reactions are shown per the existing API.
  await expect(own.getByLabel("❤️ from them")).toBeVisible();
});

test("Header shows the partner with shared presence and no way to hide it", async ({ page }) => {
  await openTalk(page);
  const header = page.locator(".talk-header");
  await expect(header.getByRole("heading", { name: "Gulnur" })).toBeVisible();
  await expect(header.getByText("Online", { exact: true })).toBeVisible();
  await expect(page.getByText(/hide (my )?(last seen|online|typing)|read receipts?/i)).toHaveCount(
    0,
  );
});

test("A reply shows a quoted excerpt and jumps to the original", async ({ page }) => {
  await openTalk(page);
  const quote = page.locator("#talk-msg-" + M3.messageId).locator(".talk-quote");
  await expect(quote).toContainText("Good morning");
  await quote.click();
  await expect(page.locator("#talk-msg-" + M1.messageId)).toHaveAttribute(
    "data-highlighted",
    "true",
  );
});

test("A deleted message shows only a placeholder", async ({ page }) => {
  await openTalk(page);
  const deleted = page.locator("#talk-msg-" + M4.messageId);
  await expect(deleted).toHaveAttribute("data-deleted", "true");
  await expect(deleted.getByText("This message has been deleted")).toBeVisible();
  await expect(deleted.getByRole("button")).toHaveCount(0);
});

test("Own messages show Read, Delivered, and Sent from the existing receipt marks", async ({
  page,
}) => {
  await openTalk(page);
  await expect(
    page.locator("#talk-msg-" + M3.messageId).locator("[data-delivery=read]"),
  ).toHaveText("Read");
  await expect(
    page.locator("#talk-msg-" + M5.messageId).locator("[data-delivery=delivered]"),
  ).toHaveText("Delivered");

  await page.unroute("**/api/**");
  await mockApi(page, {
    conversation: conversation({
      receipts: {
        selfDeliveredThrough: 5,
        selfReadThrough: 5,
        partnerDeliveredThrough: 2,
        partnerReadThrough: 1,
      },
    }),
  });
  await page.reload();
  await expect(
    page.locator("#talk-msg-" + M5.messageId).locator("[data-delivery=sent]"),
  ).toHaveText("Sent");
});

test("Long messages collapse and expand", async ({ page }) => {
  await openTalk(page);
  const long = page.locator("#talk-msg-" + M5.messageId);
  await expect(long.locator(".talk-text")).toHaveAttribute("data-collapsed", "true");
  await long.getByRole("button", { name: "Read more" }).click();
  await expect(long.locator(".talk-text")).toHaveAttribute("data-collapsed", "false");
  await expect(long.getByRole("button", { name: "Show less" })).toBeVisible();
});

test("The compact composer swaps mic for send and discloses extras in a sheet", async ({
  page,
}) => {
  await openTalk(page);
  const composer = page.locator(".talk-composer");
  await expect(composer.getByRole("button", { name: "Record a voice message" })).toBeVisible();
  await expect(composer.getByRole("button", { name: "Send" })).toHaveCount(0);
  await composer.getByRole("textbox", { name: "Message" }).fill("hello");
  await expect(composer.getByRole("button", { name: "Send" })).toBeVisible();

  await composer.getByRole("button", { name: "Add photo, file, or voice message" }).click();
  const sheet = page.getByRole("dialog", { name: "Add to message" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: /Photo, video, or file/ })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /Voice message/ })).toBeVisible();
  await expect(sheet.getByText(/encrypted/i)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

test("Message actions offer reply, edit, and delete only where M1 allows them", async ({
  page,
}) => {
  await openTalk(page);
  await page.locator("#talk-msg-" + M2.messageId + " .talk-bubble").click();
  let sheet = page.getByRole("dialog", { name: "Message" });
  await expect(sheet.getByRole("button", { name: "Reply" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /Keep in Remember This/ })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await sheet.getByRole("button", { name: "Reply" }).click();
  await expect(page.locator(".talk-replying")).toContainText("Replying to Gulnur");
  await page.getByRole("button", { name: "Cancel reply" }).click();

  // The named button is the alternative to tapping the bubble.
  await page
    .getByRole("button", { name: /^Message actions for Me/ })
    .first()
    .focus();
  await page
    .getByRole("button", { name: /^Message actions for Me/ })
    .first()
    .click();
  sheet = page.getByRole("dialog", { name: "Message" });
  // Yesterday's message is past the 30-minute edit window, so only Delete is offered.
  await expect(sheet.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await sheet.getByRole("button", { name: "Delete" }).click();
  await expect(
    page.getByRole("dialog", { name: "Delete this message for both of you?" }),
  ).toBeVisible();
});

test("Keeping a message uses the existing R1 create with a message source and a snapshot", async ({
  page,
}) => {
  const keepRequests: unknown[] = [];
  await openTalk(page, { keepRequests });
  await page.locator("#talk-msg-" + M2.messageId + " .talk-bubble").click();
  const sheet = page.getByRole("dialog", { name: "Message" });
  await expect(
    sheet.getByText("Both of you can see what is kept. Only you can change or remove it."),
  ).toBeVisible();
  await sheet.getByRole("button", { name: /Keep in Remember This/ }).click();
  await expect(page.getByText("Kept for us.")).toBeVisible();
  expect(keepRequests).toHaveLength(1);
  const body = keepRequests[0] as {
    kind: string;
    references: Array<{ referenceType: string; referenceId: string; role: string }>;
    content: { snapshotText: string };
    release: unknown;
  };
  expect(body.kind).toBe("remember_this");
  expect(body.release).toBeNull();
  expect(body.content.snapshotText).toBe("Did you sleep well?");
  expect(body.references).toEqual([
    expect.objectContaining({
      referenceType: "message",
      referenceId: M2.messageId,
      role: "source",
    }),
  ]);
  await expect(page.locator("#talk-msg-" + M2.messageId).getByLabel("Kept")).toBeVisible();
});

test("Going offline shows a calm banner and keeps writing available", async ({ page, context }) => {
  await openTalk(page);
  await context.setOffline(true);
  await expect(page.getByText(/You are offline\. Messages you write will send/)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message" })).toBeEnabled();
  await context.setOffline(false);
  await expect(page.getByText(/You are offline/)).toHaveCount(0);
});

test("View-only accounts can read but not write, reply, or keep", async ({ page }) => {
  await openTalk(page, {
    conversation: conversation({
      interactionMode: "account_deletion_view_only",
      capabilities: {
        sendMessage: false,
        changeNickname: false,
        typing: false,
        viewMessages: true,
      },
    }),
  });
  await expect(page.getByText("View only", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message" })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Add photo, file, or voice message" }),
  ).toBeDisabled();
  await page.locator("#talk-msg-" + M2.messageId + " .talk-bubble").click({ force: true });
  await expect(page.getByRole("dialog", { name: "Message" })).toBeHidden();
});

test("Reduced motion turns sheet movement into a fade", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openTalk(page);
  await page.getByRole("button", { name: "Add photo, file, or voice message" }).click();
  const name = await page.evaluate(() => {
    const panel = document.querySelector(".ds-overlay--sheet[open] .ds-overlay__panel");
    return panel ? getComputedStyle(panel).animationName : "missing";
  });
  expect(name).toBe("ds-fade-in");
});

test("A 320px phone keeps Talk inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openTalk(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
