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

let partnerOnline = true;
const KEEPS: Json[] = [];

const YEAR_ITEMS: Json[] = [1, 2].map((n) =>
  relItem({
    itemId: "20000000-0000-4000-8000-00000000000" + n,
    creatorAccountId: ME,
    occurrence: { precision: "day", year: 2026, month: n, day: 1 },
    content: { title: "Year page " + n, note: "Note " + n },
  }),
);

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
    get presence() {
      return { online: partnerOnline, lastSeenAt: null };
    },
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
  partnerOnline = true;
  KEEPS.length = 0;
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
    if (path === "/api/v1/relationship-space/items" && method === "POST") {
      KEEPS.push(route.request().postDataJSON() as Json);
      return json(
        route,
        { itemId: "f0000000-0000-4000-8000-000000000001", version: 1, createdAt: "2026-09-26" },
        201,
      );
    }
    const release = /^\/api\/v1\/relationship-space\/items\/([^/]+)\/release$/.exec(path);
    if (release && method === "POST") {
      const target = items.find((entry) => entry.itemId === release[1]);
      if (!target) return json(route, { error: { code: "RELATIONSHIP_ITEM_NOT_FOUND" } }, 404);
      target.release = {
        ...(target.release as Json),
        state: "released",
        releasedAt: "2026-09-26T12:00:00.000Z",
      };
      target.content = { title: "Open when you miss me", body: "Whenever you miss me, read this." };
      target.preview = null;
      target.version = 2;
      return json(route, { itemId: target.itemId, version: 2, releasedAt: "x" });
    }
    if (path.startsWith("/api/v1/relationship-space/experiences/our-year/")) {
      return json(route, { year: 2026, savedCuration: null, candidates: YEAR_ITEMS });
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

const MOTIONS = ["no-preference", "reduce"] as const;

for (const motion of MOTIONS) {
  test(
    "Ribbon: keeping a message settles a ribbon and the mark returns after Ours loads (" +
      motion +
      ")",
    async ({ page }) => {
      await page.emulateMedia({ reducedMotion: motion });
      await open(page, [KEPT], "#/ours");
      await expect(page.getByRole("button", { name: /Landing/ }).first()).toBeVisible();
      await page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("button", { name: "Talk" })
        .click();
      // Already kept (from the Remember This list Ours loaded): still mark, no settle.
      const kept = page.locator("#talk-msg-" + SOURCE);
      await expect(kept).toHaveAttribute("data-kept", "true");
      await expect(kept.locator(".talk-ribbon")).toBeVisible();
      await expect(kept).not.toHaveAttribute("data-ribbon", "settling");

      // Keep the other message: the ribbon settles once, then rests.
      const other = page.locator("#talk-msg-e0000000-0000-4000-8000-000000000003");
      await other.getByRole("button", { name: /Message actions/ }).click();
      await page.getByRole("button", { name: /Keep in Remember This/ }).click();
      await expect(other).toHaveAttribute("data-kept", "true");
      await expect(other).toHaveAttribute("data-ribbon", "settling");
      const ribbon = await other.locator(".talk-ribbon").evaluate((element) => {
        const style = getComputedStyle(element);
        return { name: style.animationName, duration: style.animationDuration };
      });
      expect(ribbon.name).toBe(motion === "reduce" ? "ux7-fade-in" : "ux7-ribbon-settle");
      await expect(other).not.toHaveAttribute("data-ribbon", "settling", { timeout: 3000 });
      expect(KEEPS).toHaveLength(1);
    },
  );

  test(
    "Memory Return keeps its route, highlight and way back (" + motion + ")",
    async ({ page }) => {
      await page.emulateMedia({ reducedMotion: motion });
      await open(page, [KEPT], "#/ours");
      await page
        .getByRole("button", { name: /Landing/ })
        .first()
        .click();
      await page
        .getByRole("dialog", { name: "Kept" })
        .getByRole("button", { name: "Take me there" })
        .click();
      await expect(page).toHaveURL(/#\/talk\/message\/.+$/);
      await expect(page.locator("#talk-msg-" + SOURCE + "[data-highlighted='true']")).toBeVisible();
      // The transition marker never outlives the transition and shared names are cleaned up.
      await expect
        .poll(() =>
          page.evaluate(() => ({
            marker: document.documentElement.dataset.ux7Transition ?? null,
            named: document.querySelectorAll("[data-ux7-vt]").length,
          })),
        )
        .toEqual({ marker: null, named: 0 });
      await page.getByRole("button", { name: "Back to what we kept" }).click();
      await expect(page).toHaveURL(/#\/ours$/);
      await expect(page.getByRole("button", { name: "Back to what we kept" })).toHaveCount(0);
    },
  );

  test("Threshold into Ours is a short distinct beat (" + motion + ")", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: motion });
    await open(page, [KEPT]);
    await page.evaluate(() => {
      const observed: string[] = [];
      (window as unknown as { __arrival: string[] }).__arrival = observed;
      new MutationObserver(() => {
        const route = document.querySelector(
          ".app-shell[data-route='ours'] .app-route.is-entering",
        );
        if (route) {
          const style = getComputedStyle(route);
          observed.push(style.animationName + "|" + style.animationDuration);
        }
      }).observe(document.body, { subtree: true, attributes: true, childList: true });
    });
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Ours" })
      .click();
    await expect(page.locator(".ours[data-mode]")).toBeVisible();
    const seen = await page.evaluate(
      () => (window as unknown as { __arrival: string[] }).__arrival,
    );
    expect(seen.length).toBeGreaterThan(0);
    const [name, duration] = seen[0]!.split("|");
    const ms = Number(duration!.replace("s", "")) * 1000;
    expect(ms).toBeLessThan(400);
    expect(name).toBe(motion === "reduce" ? "ux7-fade-in" : "ux7-threshold");
  });

  test(
    "Pair Mark draws together for Ours or an online partner, never as a count (" + motion + ")",
    async ({ page }) => {
      await page.emulateMedia({ reducedMotion: motion });
      const identity = page.getByRole("button", { name: "Us: account and partnership" });
      await open(page, [KEPT]);
      await expect(identity).toHaveAttribute("data-together", "true");

      await page.unroute("**/api/**");
      await page.goto("about:blank");
      await mockApi(page, [KEPT]);
      partnerOnline = false;
      await page.goto("/index.html#/talk");
      await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
      await expect(identity).toHaveAttribute("data-together", "false");
      await page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("button", { name: "Ours" })
        .click();
      await expect(identity).toHaveAttribute("data-together", "true");
      const animation = await identity.locator(".ds-pair-mark").evaluate((element) => {
        return getComputedStyle(element).animationName;
      });
      expect(animation).toBe(motion === "reduce" ? "none" : "ux7-pair-settle");
      await expect(identity).toHaveText("");
    },
  );
}

test("Our Year pages by keyboard and status with no metrics, and reduced motion only fades", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, [KEPT], "#/ours");
  await page.getByRole("button", { name: "Open the full space" }).click();
  const full = page.getByRole("dialog");
  await full.getByRole("button", { name: "Our Year", exact: true }).click();
  const book = full.getByRole("group", { name: /Our Year 2026/ });
  await expect(book).toBeVisible();
  const status = book.getByRole("status");
  await expect(status).toHaveText("Cover");
  await book.focus();
  await page.keyboard.press("ArrowRight");
  await expect(status).toHaveText("Page 1 of 2");
  await page.keyboard.press("End");
  await expect(status).toHaveText("Last page");
  await page.keyboard.press("Home");
  await expect(status).toHaveText("Cover");
  await page.keyboard.press("PageDown");
  await expect(book.getByText("Year page 1")).toBeVisible();
  const stage = await book.locator(".mem-book__stage").evaluate((element) => {
    return getComputedStyle(element).animationName;
  });
  expect(stage).toBe("mem-fade");
  const text = (await book.innerText()).toLowerCase();
  for (const word of ["score", "rank", "streak", "total", "most "]) {
    expect(text).not.toContain(word);
  }
});

for (const motion of MOTIONS) {
  test(
    "Letter Unfolds moves focus to the opened letter and never lingers (" + motion + ")",
    async ({ page }) => {
      await page.emulateMedia({ reducedMotion: motion });
      const sealed = relItem({
        itemId: "10000000-0000-4000-8000-0000000000ad",
        kind: "for_you",
        creatorAccountId: PARTNER,
        preview: { title: "Open when you miss me", conditionLabel: "Open when you miss me" },
        content: null,
        release: {
          mode: "recipient_open",
          generation: 1,
          unlockAt: null,
          releasedAt: null,
          state: "locked",
        },
      });
      await open(page, [sealed], "#/ours");
      await page.getByRole("button", { name: "Open the full space" }).click();
      const full = page.getByRole("dialog");
      await full.getByRole("button", { name: "For you", exact: true }).click();
      await full
        .getByRole("region", { name: "For you", exact: true })
        .getByRole("button", { name: "Open the letter" })
        .click();
      await expect(full.getByText("Whenever you miss me, read this.")).toBeVisible();
      await expect(page.locator(".mem-letter__reveal:focus")).toHaveCount(1);
      await expect(page.locator(".mem-letter.is-unfolding")).toHaveCount(0, { timeout: 1500 });
    },
  );
}

test("Escape skips an unfolding letter immediately", async ({ page }) => {
  const sealed = relItem({
    itemId: "10000000-0000-4000-8000-0000000000ae",
    kind: "for_you",
    creatorAccountId: PARTNER,
    preview: { title: "Open when you miss me", conditionLabel: "Open when you miss me" },
    content: null,
    release: {
      mode: "recipient_open",
      generation: 1,
      unlockAt: null,
      releasedAt: null,
      state: "locked",
    },
  });
  await open(page, [sealed], "#/ours");
  await page.getByRole("button", { name: "Open the full space" }).click();
  const full = page.getByRole("dialog");
  await full.getByRole("button", { name: "For you", exact: true }).click();
  await full
    .getByRole("region", { name: "For you", exact: true })
    .getByRole("button", { name: "Open the letter" })
    .click();
  await expect(full.getByText("Whenever you miss me, read this.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".mem-letter.is-unfolding")).toHaveCount(0, { timeout: 300 });
});
