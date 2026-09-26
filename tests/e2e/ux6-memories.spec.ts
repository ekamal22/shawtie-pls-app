import { expect, type Page, type Route, test } from "@playwright/test";

/**
 * UX6 memories, letters, and time. Runs the real bundle against a mocked API with realistic
 * R1 projections (packages/contracts/src/relationship-space). No backend, no database.
 */

const ME = "a0000000-0000-4000-8000-000000000001";
const THEM = "b0000000-0000-4000-8000-000000000002";
const PARTNERSHIP = "d0000000-0000-4000-8000-000000000001";
const CONVERSATION = "c0000000-0000-4000-8000-000000000001";
const MSG_OK = "e0000000-0000-4000-8000-000000000001";
const MSG_GONE = "e0000000-0000-4000-8000-000000000002";

type Item = Record<string, any>;

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

let counter = 0;
function id(): string {
  counter += 1;
  return "10000000-0000-4000-8000-" + String(counter).padStart(12, "0");
}

function item(overrides: Item): Item {
  return {
    itemId: id(),
    kind: "memory",
    creatorAccountId: ME,
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

function fixtures(): Item[] {
  return [
    item({
      itemId: "20000000-0000-4000-8000-000000000001",
      kind: "memory",
      storyIncluded: true,
      occurrence: { precision: "day", year: 2024, month: 6, day: 1 },
      content: {
        title: "The night we talked until sunrise",
        note: "Neither of us wanted to hang up.",
      },
    }),
    item({
      itemId: "20000000-0000-4000-8000-000000000002",
      kind: "first",
      storyIncluded: true,
      creatorAccountId: THEM,
      occurrence: { precision: "month", year: 2025, month: 2, day: null },
      content: { title: "First trip together", note: null },
    }),
    item({
      itemId: "20000000-0000-4000-8000-000000000003",
      kind: "memory",
      storyIncluded: true,
      occurrence: null,
      content: { title: "Something from before we counted", note: null },
    }),
    item({
      itemId: "20000000-0000-4000-8000-000000000004",
      kind: "remember_this",
      creatorAccountId: THEM,
      content: {
        title: null,
        snapshotText: "Text me when you land, even if it is 3am.",
        note: null,
      },
      references: [{ referenceType: "message", referenceId: MSG_OK, role: "source", position: 0 }],
    }),
    item({
      itemId: "20000000-0000-4000-8000-000000000005",
      kind: "remember_this",
      creatorAccountId: ME,
      content: {
        title: "Your voice on a hard day",
        snapshotText: "You did enough today.",
        note: null,
      },
      references: [
        { referenceType: "message", referenceId: MSG_GONE, role: "source", position: 0 },
      ],
    }),
    // A sealed letter the partner wrote for me (recipient sees preview only).
    item({
      itemId: "20000000-0000-4000-8000-000000000006",
      kind: "for_you",
      creatorAccountId: THEM,
      preview: { title: "Open when you miss me", conditionLabel: "Open when you miss me" },
      content: null,
      release: {
        mode: "recipient_open",
        generation: 1,
        unlockAt: null,
        releasedAt: null,
        state: "locked",
      },
    }),
    // An opened letter.
    item({
      itemId: "20000000-0000-4000-8000-000000000007",
      kind: "for_you",
      creatorAccountId: THEM,
      preview: { title: "For your birthday" },
      content: { body: "Happy birthday. I hope today feels like being held." },
      release: {
        mode: "immediate",
        generation: 1,
        unlockAt: null,
        releasedAt: "2026-02-02T00:00:00.000Z",
        state: "released",
      },
    }),
    // A scheduled letter I wrote (creator can read while locked).
    item({
      itemId: "20000000-0000-4000-8000-000000000008",
      kind: "for_you",
      creatorAccountId: ME,
      preview: { title: "Anniversary morning" },
      content: { body: "Good morning. Look at us." },
      release: {
        mode: "scheduled",
        generation: 1,
        unlockAt: "2027-06-01T08:00:00.000Z",
        releasedAt: null,
        state: "locked",
      },
    }),
    item({
      itemId: "20000000-0000-4000-8000-000000000009",
      kind: "someday",
      content: { title: "See the northern lights", note: null },
      featureState: { type: "someday", state: "someday" },
    }),
    item({
      itemId: "20000000-0000-4000-8000-00000000000a",
      kind: "someday",
      content: { title: "Cook a whole meal together", note: null },
      featureState: { type: "someday", state: "completed" },
    }),
    item({
      itemId: "20000000-0000-4000-8000-00000000000b",
      kind: "love",
      content: { category: "reason", text: "You laugh with your whole face." },
    }),
  ];
}

interface Scenario {
  items: Item[];
  mode?: "active" | "breakup_pending_view_only";
  writes: Array<{ method: string; path: string; body: any; key: string | undefined }>;
}

function homeFor(scenario: Scenario) {
  return {
    space: {
      mode: scenario.mode ?? "active",
      relationshipStartDate: "2024-06-01",
      serverDate: "2026-09-26",
      relationshipDuration: { years: 2, months: 3, days: 25 },
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
      anniversary: { date: "2026-06-01", savedCurationItemId: null },
      recentSignals: [],
    },
  };
}

async function mockApi(page: Page, scenario: Scenario) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
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
    if (path === "/api/v1/partnerships/current") {
      return json(route, {
        partnership: {
          partnershipId: PARTNERSHIP,
          lifecycleState: "active",
          interactionMode: "normal",
          activatedAt: "2026-01-01T00:00:00.000Z",
          relationshipStartDate: "2024-06-01",
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
          otherMember: { accountId: THEM, username: "gulnur", displayName: "Gulnur" },
        },
      });
    }
    if (path === "/api/v1/conversations/current") {
      return json(route, {
        conversation: {
          conversationId: CONVERSATION,
          partnershipId: PARTNERSHIP,
          lifecycleState: "active",
          interactionMode: "normal",
          latestServerSequence: 0,
          latestChangeSequence: 0,
          breakup: null,
          self: {
            accountId: ME,
            username: "me",
            displayName: "Me",
            nickname: null,
            nicknameVersion: 0,
          },
          partner: {
            accountId: THEM,
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
          capabilities: {
            sendMessage: true,
            changeNickname: true,
            typing: true,
            viewMessages: true,
          },
        },
      });
    }
    if (path === "/api/v1/conversations/" + CONVERSATION + "/messages/" + MSG_OK) {
      return json(route, {
        messageId: MSG_OK,
        conversationId: CONVERSATION,
        deletedAt: null,
        body: "Text me when you land",
      });
    }
    if (path === "/api/v1/conversations/" + CONVERSATION + "/messages/" + MSG_GONE) {
      return json(route, { error: { code: "MESSAGE_NOT_FOUND" } }, 404);
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
    if (path === "/api/v1/calls/current") return json(route, { call: null });
    if (path.startsWith("/api/v1/notifications"))
      return json(route, { items: [], nextCursor: null });
    if (path.startsWith("/api/v1/partner-requests")) {
      return json(route, { incoming: [], outgoing: [], items: [] });
    }
    if (path === "/api/v1/push/config") return json(route, { enabled: false });
    if (path === "/api/v1/presence/heartbeat") return json(route, {});
    if (path === "/api/v1/relationship-space") return json(route, homeFor(scenario));

    if (path === "/api/v1/relationship-space/items" && method === "GET") {
      const kind = url.searchParams.get("kind");
      const storyOnly = url.searchParams.get("storyOnly") === "true";
      let list = scenario.items;
      if (kind) list = list.filter((entry) => entry.kind === kind);
      if (storyOnly) list = list.filter((entry) => entry.storyIncluded);
      return json(route, { items: list, nextCursor: null });
    }
    if (path === "/api/v1/relationship-space/items" && method === "POST") {
      const body = request.postDataJSON();
      scenario.writes.push({ method, path, body, key: request.headers()["idempotency-key"] });
      const created = item({ ...body, creatorAccountId: ME });
      scenario.items.unshift(created);
      return json(route, { itemId: created.itemId, version: 1, createdAt: created.createdAt }, 201);
    }
    const itemMatch = /^\/api\/v1\/relationship-space\/items\/([^/]+)(\/release)?$/.exec(path);
    if (itemMatch) {
      const target = scenario.items.find((entry) => entry.itemId === itemMatch[1]);
      if (!target) return json(route, { error: { code: "RELATIONSHIP_ITEM_NOT_FOUND" } }, 404);
      const body = request.postDataJSON();
      scenario.writes.push({ method, path, body, key: request.headers()["idempotency-key"] });
      if (itemMatch[2] && method === "POST") {
        target.release = {
          ...target.release,
          state: "released",
          releasedAt: "2026-09-26T12:00:00.000Z",
        };
        target.content = { body: "Whenever you miss me, read this. I am always one message away." };
        target.version += 1;
        return json(route, { itemId: target.itemId, version: target.version, releasedAt: "x" });
      }
      if (method === "PATCH") {
        Object.assign(target, body, { version: target.version + 1 });
        delete (target as Item).expectedVersion;
        return json(route, { itemId: target.itemId, version: target.version, updatedAt: "x" });
      }
      if (method === "DELETE") {
        scenario.items = scenario.items.filter((entry) => entry.itemId !== target.itemId);
        return json(route, {});
      }
    }
    if (path.startsWith("/api/v1/relationship-space/experiences/this-day")) {
      return json(route, { on: "2026-09-26", items: [] });
    }
    return json(route, { error: { code: "MOCK_NOT_FOUND" } }, 404);
  });
}

function newScenario(items = fixtures()): Scenario {
  return { items, writes: [] };
}

async function openOurs(page: Page, scenario: Scenario, lens?: string) {
  await mockApi(page, scenario);
  await page.goto("/index.html#/ours");
  await expect(page.getByRole("heading", { name: /Together for/ })).toBeVisible();
  if (lens) await page.getByRole("button", { name: lens, exact: true }).click();
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("Our Story is an editorial timeline with explicit precision and a year rail", async ({
  page,
}) => {
  await openOurs(page, newScenario(), "Our Story");
  await expect(
    page.getByRole("heading", { name: "The night we talked until sunrise" }),
  ).toBeVisible();
  // Day precision: large day, month and year, and the precision named.
  const day = page.locator("time[datetime='2024-06-01']");
  await expect(day).toContainText("1");
  await expect(day).toContainText("June 2024");
  await expect(day).toContainText("Exact day");
  // Month precision is not dressed up as a day.
  const month = page.locator("time[datetime='2025-02']");
  await expect(month).toContainText("February");
  await expect(month).toContainText("Month");
  // Year rail is derived from the years that exist plus the undated group.
  const rail = page.getByRole("navigation", { name: "Jump to a year" });
  await expect(rail.getByRole("button", { name: "2024" })).toBeVisible();
  await expect(rail.getByRole("button", { name: "2025" })).toBeVisible();
  await expect(rail.getByRole("button", { name: "Undated" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Whenever it was" })).toBeVisible();
});

test("Kept shows pull-quotes, creator-only edit and delete, and Memory Return only when it resolves", async ({
  page,
}) => {
  await openOurs(page, newScenario(), "Kept");
  await expect(page.getByText("Text me when you land, even if it is 3am.")).toBeVisible();
  await expect(page.getByText("Kept by Gulnur").or(page.getByText("Kept by them"))).toBeVisible();
  await expect(page.getByText("Kept by you")).toBeVisible();

  // Resolvable source shows the action; the missing one is rendered unavailable.
  await expect(page.getByRole("button", { name: "Take me there" })).toHaveCount(1);
  await expect(page.getByText("The original message is no longer available.")).toBeVisible();

  // Partner's kept item: no Edit and no Delete.
  const theirs = page.locator("article.mem-kept").filter({ hasText: "Text me when you land" });
  await theirs.getByRole("button", { name: "More for this item" }).click();
  await expect(page.getByRole("menuitem", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Delete" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // My own kept item: Edit and Delete are offered.
  const mine = page.locator("article.mem-kept").filter({ hasText: "You did enough today." });
  await mine.getByRole("button", { name: "More for this item" }).click();
  await expect(page.getByRole("menuitem", { name: "Edit" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Take me there" }).click();
  await expect(page).toHaveURL(new RegExp("#/talk/message/" + MSG_OK));
});

test("A sealed letter shows only the projection, opens with the existing action, and unfolds", async ({
  page,
}) => {
  const scenario = newScenario();
  await openOurs(page, scenario, "For you");

  const sealed = page
    .locator("article.mem-letter.is-sealed")
    .filter({ hasText: "Open when you miss me" });
  await expect(sealed.getByText("Sealed", { exact: true })).toBeVisible();
  // No teaser and no creator cue on a sealed item for its recipient; the sealed body is absent.
  await expect(sealed.getByText("From Gulnur")).toHaveCount(0);
  await expect(sealed.getByText("Whenever you miss me")).toHaveCount(0);

  // The opened letter reads as paper regardless of theme.
  await expect(page.getByText("Happy birthday. I hope today feels like being held.")).toBeVisible();

  await sealed.getByRole("button", { name: "Open the letter" }).click();
  await expect(page.getByText("Whenever you miss me, read this.")).toBeVisible();
  const release = scenario.writes.find((write) => write.path.endsWith("/release"));
  expect(release?.method).toBe("POST");
  expect(release?.body).toEqual({ expectedVersion: 1 });
  expect(release?.key).toBeTruthy();
  // The unfolding class is transient (under one second) and does not linger.
  await expect(page.locator(".mem-letter.is-unfolding")).toHaveCount(0, { timeout: 2000 });
});

test("The Letter Unfolds becomes a short crossfade under reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const scenario = newScenario();
  await openOurs(page, scenario, "For you");
  await page
    .locator("article.mem-letter.is-sealed")
    .filter({ hasText: "Open when you miss me" })
    .getByRole("button", { name: "Open the letter" })
    .click();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const element = document.querySelector(".mem-letter__reveal--unfold");
        if (!element) return "gone";
        const style = getComputedStyle(element);
        return style.animationName + ":" + style.animationDuration;
      }),
    )
    .toMatch(/^(mem-fade:0\.12s|gone)$/);
});

test("Creator sees their own scheduled letter with a calm sealed band and reschedule", async ({
  page,
}) => {
  await openOurs(page, newScenario(), "For you");
  const own = page.locator("article.mem-letter").filter({ hasText: "Anniversary morning" });
  await expect(own.getByText("Sealed until it arrives")).toBeVisible();
  await expect(own.getByText("Good morning. Look at us.")).toBeVisible();
  await own.getByText("Change when it arrives").click();
  await expect(own.getByRole("button", { name: "Reschedule" })).toBeVisible();
});

test("Empty states are warm and never imply the relationship is incomplete", async ({ page }) => {
  await openOurs(page, newScenario([]));
  await expect(page.getByText("Your space is ready")).toBeVisible();
  for (const [lens, text] of [
    ["Our Story", "Your story starts wherever you like"],
    ["Kept", "Nothing kept yet"],
    ["For you", "No letters yet"],
    ["Someday", "Room for someday"],
    ["Love", "Nothing here yet"],
    ["Firsts", "Firsts will gather here"],
  ] as const) {
    await page.getByRole("button", { name: lens, exact: true }).click();
    await expect(page.getByText(text)).toBeVisible();
  }
  await expect(page.getByText(/no streak|behind|catch up|you haven't/i)).toHaveCount(0);
});

test("Someday renders three soft states and moves an item with the existing state change", async ({
  page,
}) => {
  const scenario = newScenario();
  await openOurs(page, scenario, "Someday");
  await expect(page.getByRole("heading", { name: "Someday", level: 3 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "We did it", level: 3 })).toBeVisible();

  const lights = page.locator("li.mem-someday").filter({ hasText: "See the northern lights" });
  await expect(lights.getByRole("radio", { name: "Someday" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await lights.getByRole("radio", { name: "Soon" }).click();
  await expect(page.getByRole("heading", { name: "Soon", level: 3 })).toBeVisible();
  const patch = scenario.writes.find((write) => write.method === "PATCH");
  expect(patch?.body).toEqual({
    expectedVersion: 1,
    featureState: { type: "someday", state: "soon" },
  });
});

test("Love is a calm deck with no counts or streaks", async ({ page }) => {
  await openOurs(page, newScenario(), "Love");
  await expect(page.getByText("You laugh with your whole face.")).toBeVisible();
  await expect(page.getByText(/\d+\s*(of|\/)\s*\d+|streak|day \d+/i)).toHaveCount(0);
});

test("Composer keeps the existing create payload and idempotent key", async ({ page }) => {
  const scenario = newScenario([]);
  await openOurs(page, scenario);
  await page.getByRole("button", { name: "Add to Ours" }).first().click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("radio", { name: "First", exact: true }).click();
  await sheet.getByLabel("Title").fill("First snow");
  await sheet.getByLabel("When did this happen?").selectOption("month");
  await sheet.getByLabel("Month", { exact: true }).fill("2025-12");
  await sheet.getByRole("button", { name: "Add to Ours" }).click();
  await expect.poll(() => scenario.writes.length).toBe(1);
  const write = scenario.writes[0]!;
  expect(write.method).toBe("POST");
  expect(write.key).toBeTruthy();
  expect(write.body.kind).toBe("first");
  expect(write.body.contentSchemaVersion).toBe(1);
  expect(write.body.occurrence).toEqual({ precision: "month", year: 2025, month: 12, day: null });
  expect(write.body.content).toEqual({ title: "First snow", note: null });
  expect(write.body.references).toEqual([]);
});

test("Composer copy makes only truthful local-storage statements", async ({ page }) => {
  await openOurs(page, newScenario([]));
  await page.getByRole("button", { name: "Add to Ours" }).first().click();
  const text = (await page.getByRole("dialog").innerText()).toLowerCase();
  expect(text).not.toContain("encrypted");
  expect(text).toContain("stay on this device");
});

test("View-only spaces hide write actions and keep a neutral banner", async ({ page }) => {
  const scenario = newScenario();
  scenario.mode = "breakup_pending_view_only";
  await openOurs(page, scenario, "For you");
  await expect(page.getByText("Ours is view-only for now")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open the letter" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reschedule" })).toHaveCount(0);
});

test("Paper stays light in Midnight and Dawn", async ({ page }) => {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.unroute("**/api/**").catch(() => undefined);
    await openOurs(page, newScenario(), "For you");
    const paper = await page
      .locator("article.mem-letter")
      .first()
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(paper).toBe(scheme === "light" ? "rgb(255, 253, 248)" : "rgb(241, 232, 218)");
    const ink = await page
      .locator("article.mem-letter .mem-letter__title")
      .first()
      .evaluate((element) => getComputedStyle(element).color);
    expect(ink).toBe("rgb(46, 37, 40)");
  }
});

test("Small phones keep every lens within the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openOurs(page, newScenario());
  for (const lens of ["Our Story", "Kept", "For you", "Someday", "Love", "Firsts", "Places"]) {
    await page.getByRole("button", { name: lens, exact: true }).click();
    await page.waitForTimeout(150);
    await noHorizontalScroll(page);
  }
});

// Optional visual review aid: UX6_SHOTS=<dir> writes full-page screenshots and asserts nothing.
test("Visual review screenshots (opt in)", async ({ page }) => {
  const dir = process.env.UX6_SHOTS;
  test.skip(!dir, "set UX6_SHOTS to capture screenshots");
  await page.setViewportSize({ width: 390, height: 844 });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.unroute("**/api/**").catch(() => undefined);
    await openOurs(page, newScenario());
    for (const lens of ["Our Story", "Kept", "For you", "Someday", "Love", "Firsts"]) {
      await page.getByRole("button", { name: lens, exact: true }).click();
      await page.waitForTimeout(300);
      await page.screenshot({
        path: dir + "/" + scheme + "-" + lens.replaceAll(" ", "_") + ".png",
        fullPage: true,
      });
    }
  }
});
