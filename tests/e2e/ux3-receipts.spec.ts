import { expect, type Page, type Route, test } from "@playwright/test";

/**
 * Read receipts advance only while Talk is the active route. Talk stays mounted on Home and
 * Ours (heartbeat, sync, delivery), so a message that arrives there is DELIVERED but not READ
 * until the person actually opens Talk. Runs the real bundle against a mocked API and records
 * every POST to /conversations/{id}/receipt.
 */

const SELF = "a0000000-0000-4000-8000-000000000001";
const PARTNER = "b0000000-0000-4000-8000-000000000002";
const CONVERSATION_ID = "c0000000-0000-4000-8000-000000000001";
const PARTNERSHIP_ID = "d0000000-0000-4000-8000-000000000001";

interface ReceiptPost {
  readonly type: "delivered" | "read";
  readonly throughSequence: number;
}

class Harness {
  readonly posts: ReceiptPost[] = [];
  readonly messages: Array<Record<string, unknown>> = [];
  selfDelivered = 0;
  selfRead = 0;

  constructor(initial: number) {
    for (let n = 1; n <= initial; n += 1) this.add(n);
  }

  add(n: number) {
    this.messages.push({
      messageId: "e000000" + n + "-0000-4000-8000-000000000000",
      conversationId: CONVERSATION_ID,
      senderAccountId: PARTNER,
      senderDeviceId: null,
      serverSequence: n,
      contentVersion: 1,
      lastChangeSequence: n,
      replyToMessageId: null,
      replyContext: null,
      body: "hello " + n,
      createdAt: new Date(Date.now() - (10 - n) * 60_000).toISOString(),
      editedAt: null,
      deletedAt: null,
      reactions: [],
      attachments: [],
    });
  }

  highest(type: ReceiptPost["type"]): number {
    return Math.max(
      0,
      ...this.posts.filter((post) => post.type === type).map((p) => p.throughSequence),
    );
  }

  conversation() {
    return {
      conversationId: CONVERSATION_ID,
      partnershipId: PARTNERSHIP_ID,
      lifecycleState: "active",
      interactionMode: "normal",
      latestServerSequence: this.messages.length,
      latestChangeSequence: this.messages.length,
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
        selfDeliveredThrough: this.selfDelivered,
        selfReadThrough: this.selfRead,
        partnerDeliveredThrough: 0,
        partnerReadThrough: 0,
      },
      capabilities: { sendMessage: true, changeNickname: true, typing: true, viewMessages: true },
    };
  }
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockApi(page: Page, harness: Harness) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const base = "/api/v1/conversations/" + CONVERSATION_ID;
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
      return json(route, { conversation: harness.conversation() });
    }
    if (path === base + "/messages") {
      const after = Number(url.searchParams.get("afterSequence") ?? "0");
      const items = harness.messages.filter((m) => (m.serverSequence as number) > after);
      return json(route, {
        items,
        hasMore: false,
        oldestSequence: items.at(0)?.serverSequence ?? null,
        newestSequence: items.at(-1)?.serverSequence ?? null,
        latestServerSequence: harness.messages.length,
      });
    }
    if (path === base + "/changes") {
      const after = Number(url.searchParams.get("afterChangeSequence") ?? "0");
      const items = harness.messages
        .filter((m) => (m.lastChangeSequence as number) > after)
        .map((m) => ({
          changeSequence: m.lastChangeSequence,
          type: "message.created",
          messageId: m.messageId,
          contentVersion: 1,
          changedAt: m.createdAt,
        }));
      return json(route, {
        items,
        latestChangeSequence: harness.messages.length,
        hasMore: false,
      });
    }
    if (path.startsWith(base + "/messages/")) {
      const found = harness.messages.find((m) => m.messageId === path.split("/").pop());
      return found ? json(route, found) : json(route, { error: { code: "NOT_FOUND" } }, 404);
    }
    if (path === base + "/receipt" && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as ReceiptPost;
      harness.posts.push(body);
      if (body.type === "delivered")
        harness.selfDelivered = Math.max(harness.selfDelivered, body.throughSequence);
      if (body.type === "read") harness.selfRead = Math.max(harness.selfRead, body.throughSequence);
      return json(route, {});
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
    return json(route, { error: { code: "MOCK_NOT_FOUND" } }, 404);
  });
}

async function open(page: Page, harness: Harness, hash: string) {
  await mockApi(page, harness);
  await page.goto("/index.html" + hash);
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
}

async function goTo(page: Page, name: "Home" | "Talk" | "Ours") {
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name }).click();
}

/** A new message arrives while the person is elsewhere; the app's own visibility sync fetches it. */
async function deliverNewMessage(page: Page, harness: Harness, n: number) {
  harness.add(n);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
}

for (const elsewhere of ["Home", "Ours"] as const) {
  test(
    "Messages arriving on " + elsewhere + " are delivered but not read until Talk opens",
    async ({ page }) => {
      const harness = new Harness(3);
      await open(page, harness, "#/" + elsewhere.toLowerCase());

      // Initial load while Talk is hidden: delivered advances, read does not.
      await expect.poll(() => harness.highest("delivered")).toBe(3);
      await page.waitForTimeout(500);
      expect(harness.highest("read")).toBe(0);

      // Entering Talk acknowledges what is now visible.
      await goTo(page, "Talk");
      await expect.poll(() => harness.highest("read")).toBe(3);

      // Leaving Talk: a new message is delivered, and stays unread.
      await goTo(page, elsewhere);
      await deliverNewMessage(page, harness, 4);
      await expect.poll(() => harness.highest("delivered")).toBe(4);
      await page.waitForTimeout(500);
      expect(harness.highest("read")).toBe(3);

      // Opening Talk again reads it.
      await goTo(page, "Talk");
      await expect.poll(() => harness.highest("read")).toBe(4);
    },
  );
}

test("With Talk active, incoming messages are read as before", async ({ page }) => {
  const harness = new Harness(2);
  await open(page, harness, "#/talk");
  await expect.poll(() => harness.highest("read")).toBe(2);
  await expect(page.getByText("hello 2")).toBeVisible();

  await deliverNewMessage(page, harness, 3);
  await expect.poll(() => harness.highest("delivered")).toBe(3);
  await expect.poll(() => harness.highest("read")).toBe(3);
});
