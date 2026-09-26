import { expect, type Page, type Route, test } from "@playwright/test";

/**
 * UX4 Ours and Us smoke. Runs the real application bundle against a mocked API (no backend,
 * no database). It verifies the Then, Now, Next chapters over the R1 read APIs, warm empty
 * states, creator-only Remember This authority, neutral view-only presentation, the create
 * sheet, and Us reachability for every lifecycle, request, device, and deletion action.
 */

const ME = "a0000000-0000-4000-8000-000000000001";
const PARTNER = "b0000000-0000-4000-8000-000000000002";

type Item = Record<string, unknown>;

interface Scenario {
  mode: "active" | "breakup_pending_view_only" | "account_deletion_view_only";
  canCreate: boolean;
  items: Item[];
  upcoming: Item[];
  reunion: Item | null;
  space: boolean;
  posted: Item[];
  released: string[];
  deleted: string[];
  partnership: Record<string, unknown> | null;
  calls: string[];
  former: unknown[];
  notifications: unknown[];
}

let counter = 0;
function item(overrides: Item = {}): Item {
  counter += 1;
  return {
    itemId: "00000000-0000-4000-8000-" + String(counter).padStart(12, "0"),
    kind: "memory",
    creatorAccountId: ME,
    version: 1,
    createdAt: new Date(Date.UTC(2026, 0, counter)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 0, counter)).toISOString(),
    occurrence: null,
    storyIncluded: false,
    release: null,
    featureState: null,
    contentSchemaVersion: 1,
    preview: null,
    content: { title: "Memory " + counter, note: "A note " + counter },
    references: [],
    links: [],
    ...overrides,
  };
}

function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    mode: "active",
    canCreate: true,
    items: [],
    upcoming: [],
    reunion: null,
    space: true,
    posted: [],
    released: [],
    deleted: [],
    partnership: null,
    calls: [],
    former: [],
    notifications: [],
    ...overrides,
  };
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

const partner = {
  accountId: PARTNER,
  username: "gulnur",
  displayName: "Gulnur",
  nickname: null,
  nicknameVersion: 0,
};

const conversation = {
  conversationId: "c0000000-0000-4000-8000-000000000001",
  partnershipId: "d0000000-0000-4000-8000-000000000001",
  lifecycleState: "active",
  interactionMode: "normal",
  latestServerSequence: 0,
  latestChangeSequence: 0,
  breakup: null,
  self: { accountId: ME, username: "me", displayName: "Me", nickname: null, nicknameVersion: 0 },
  partner: { ...partner, presence: { online: true, lastSeenAt: null }, typing: false },
  receipts: {
    selfDeliveredThrough: 0,
    selfReadThrough: 0,
    partnerDeliveredThrough: 0,
    partnerReadThrough: 0,
  },
  capabilities: { sendMessage: true, changeNickname: true, typing: true, viewMessages: true },
};

const basePartnership = {
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
  otherMember: { accountId: PARTNER, username: "gulnur", displayName: "Gulnur" },
};

function home(state: Scenario) {
  const viewOnly = state.mode !== "active";
  return {
    mode: state.mode,
    relationshipStartDate: "2025-06-01",
    serverDate: "2026-09-26",
    relationshipDuration: { years: 1, months: 3, days: 25 },
    capabilities: {
      view: true,
      create: state.canCreate && !viewOnly,
      edit: !viewOnly,
      delete: !viewOnly,
      manualRelease: !viewOnly,
      curate: !viewOnly,
      sendSignal: !viewOnly,
    },
    recentItems: [],
    upcomingReleases: state.upcoming,
    reunion: state.reunion,
    anniversary: { date: "2026-06-01", savedCurationItemId: null },
    recentSignals: state.items.filter((entry) => entry.kind === "relationship_signal"),
  };
}

async function mockApi(page: Page, state: Scenario) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    if (path === "/api/v1/auth/session") {
      return json(route, {
        authenticated: true,
        accountId: ME,
        sessionId: "s1",
        deviceId: "dev1",
        reauthenticatedAt: null,
      });
    }
    if (path === "/api/v1/partnerships/current") {
      return json(route, { partnership: state.partnership ?? basePartnership });
    }
    if (path === "/api/v1/partnerships/former") return json(route, { items: state.former });
    if (method === "POST" && /breakup|restore|account-deletion|cancel|read$|logout/.test(path)) {
      state.calls.push(path);
      return json(route, { restored: false });
    }
    if (method === "DELETE" && path.startsWith("/api/v1/me/devices/")) {
      state.calls.push(path);
      return json(route, {});
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
    if (path === "/api/v1/conversations/current") return json(route, { conversation });
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
    if (path === "/api/v1/relationship-space") {
      return json(route, { space: state.space ? home(state) : null });
    }
    if (path === "/api/v1/relationship-space/items" && method === "GET") {
      const kind = url.searchParams.get("kind");
      const items = state.items.filter((entry) => !kind || entry.kind === kind);
      return json(route, { items, nextCursor: null });
    }
    if (path === "/api/v1/relationship-space/items" && method === "POST") {
      state.posted.push(route.request().postDataJSON() as Item);
      return json(route, { itemId: "new", version: 1, createdAt: new Date().toISOString() }, 201);
    }
    if (path === "/api/v1/relationship-space/experiences/this-day") {
      return json(route, { on: "2026-09-26", items: [] });
    }
    if (/\/api\/v1\/relationship-space\/items\/[^/]+\/release$/.test(path)) {
      state.released.push(path.split("/").at(-2) as string);
      return json(route, { itemId: "x", version: 2, releasedAt: new Date().toISOString() });
    }
    if (/\/api\/v1\/relationship-space\/items\/[^/]+$/.test(path) && method === "DELETE") {
      state.deleted.push(path.split("/").at(-1) as string);
      return json(route, {});
    }
    if (path.startsWith("/api/v1/notifications")) {
      return json(route, { items: state.notifications, nextCursor: null });
    }
    if (path.startsWith("/api/v1/partner-requests")) {
      return json(route, { items: [], nextCursor: null });
    }
    if (path === "/api/v1/push/config") return json(route, { enabled: false });
    if (path === "/api/v1/presence/heartbeat") return json(route, {});
    return json(route, { error: { code: "MOCK_NOT_FOUND" } }, 404);
  });
}

async function openOurs(page: Page, state: Scenario) {
  await mockApi(page, state);
  await page.goto("/index.html#/ours");
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
}

function chapter(page: Page, name: "Then" | "Now" | "Next") {
  return page.getByRole("region", { name });
}

test("Ours is one scroll of Then, Now, and Next with a few curated items and See all", async ({
  page,
}) => {
  const items = [1, 2, 3, 4, 5].map((n) =>
    item({
      kind: "memory",
      content: { title: "Memory number " + n, note: null },
      occurrence: { precision: "day", year: 2025, month: 6, day: n },
    }),
  );
  items.push(
    item({
      kind: "for_you",
      content: { body: "Read this when you wake." },
      preview: { title: "Morning letter", conditionLabel: null },
      release: {
        mode: "immediate",
        generation: 1,
        unlockAt: null,
        releasedAt: "2026-09-01T00:00:00.000Z",
        state: "released",
      },
    }),
    item({
      kind: "someday",
      content: { title: "See the sea in winter", note: null },
      featureState: { type: "someday", state: "someday" },
    }),
  );
  await openOurs(page, scenario({ items }));

  await expect(page.getByText("Together for")).toBeVisible();
  await expect(page.getByText("1 year, 3 months, 25 days")).toBeVisible();
  for (const name of ["Then", "Now", "Next"] as const) {
    await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
  }
  await expect(chapter(page, "Then").getByRole("button", { name: /Memory number/ })).toHaveCount(3);
  await expect(chapter(page, "Now").getByRole("button", { name: /Morning letter/ })).toBeVisible();
  await expect(
    chapter(page, "Next").getByRole("button", { name: /See the sea in winter/ }),
  ).toBeVisible();
  await expect(chapter(page, "Next").getByText(/Our anniversary, 1 June 2026/)).toBeVisible();

  await chapter(page, "Then").getByRole("button", { name: "See all" }).click();
  const sheet = page.getByRole("dialog", { name: "Then, all" });
  await expect(sheet.getByRole("button", { name: /Memory number/ })).toHaveCount(5);
});

test("Lenses filter Then by existing kinds and empty lenses stay warm", async ({ page }) => {
  await openOurs(
    page,
    scenario({
      items: [
        item({ kind: "first", content: { title: "First dinner", note: null } }),
        item({
          kind: "place",
          content: { title: "The bench", note: null, latitude: null, longitude: null },
        }),
        item({
          kind: "remember_this",
          content: { title: null, snapshotText: "You said it", note: null },
        }),
      ],
    }),
  );
  const then = chapter(page, "Then");
  await then.getByRole("button", { name: "Firsts" }).click();
  await expect(then.getByRole("button", { name: /First dinner/ })).toBeVisible();
  await expect(then.getByRole("button", { name: /The bench/ })).toHaveCount(0);
  await then.getByRole("button", { name: "Places" }).click();
  await expect(then.getByRole("button", { name: /The bench/ })).toBeVisible();
  await then.getByRole("button", { name: "Kept" }).click();
  await expect(then.getByRole("button", { name: /You said it/ })).toBeVisible();
  await then.getByRole("button", { name: "All", exact: true }).click();
  await expect(then.getByRole("button", { name: "All", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("Empty chapters are warm and never imply something is missing", async ({ page }) => {
  await openOurs(page, scenario());
  await expect(page.getByText("The story starts wherever you like.")).toBeVisible();
  await expect(page.getByText("Nothing new right now.")).toBeVisible();
  const text = (await page.locator(".ours").innerText()).toLowerCase();
  for (const bad of ["incomplete", "missing", "you haven't", "not yet"]) {
    expect(text).not.toContain(bad);
  }
});

test("Ours without a partnership leads calmly to Us", async ({ page }) => {
  await openOurs(page, scenario({ space: false }));
  await expect(page.getByText("Ours begins with two.")).toBeVisible();
  await page.getByRole("button", { name: "Go to Us" }).click();
  await expect(page).toHaveURL(/#\/us$/);
});

test("Remember This is shared to read and creator-only to change", async ({ page }) => {
  const theirs = item({
    kind: "remember_this",
    creatorAccountId: PARTNER,
    content: { title: "Their words", snapshotText: "You made me laugh", note: null },
  });
  const mine = item({
    kind: "remember_this",
    content: { title: "My words", snapshotText: "I kept this", note: null },
  });
  const state = scenario({ items: [theirs, mine] });
  await openOurs(page, state);

  await chapter(page, "Then")
    .getByRole("button", { name: /Their words/ })
    .click();
  let sheet = page.getByRole("dialog", { name: "Kept" });
  await expect(sheet.getByText("Kept for us.")).toBeVisible();
  await expect(sheet.getByText("You made me laugh")).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await sheet.getByRole("button", { name: "Close" }).first().click();

  await chapter(page, "Then")
    .getByRole("button", { name: /My words/ })
    .click();
  sheet = page.getByRole("dialog", { name: "Kept" });
  await expect(sheet.getByRole("button", { name: "Edit" })).toBeVisible();
  await sheet.getByRole("button", { name: "Delete" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete this item?" });
  await expect(confirm.getByText("Delete this relationship item?")).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  expect(state.deleted).toEqual([]);
  await sheet.getByRole("button", { name: "Delete" }).click();
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect.poll(() => state.deleted.length).toBe(1);
});

test("Sealed letters wait quietly and the recipient opens them", async ({ page }) => {
  const sealed = item({
    kind: "for_you",
    creatorAccountId: PARTNER,
    content: null,
    preview: { title: "For a hard day", conditionLabel: "Open when you need reassurance" },
    release: {
      mode: "recipient_open",
      generation: 1,
      unlockAt: null,
      releasedAt: null,
      state: "locked",
    },
  });
  const state = scenario({ upcoming: [sealed], items: [sealed] });
  await openOurs(page, state);
  const now = chapter(page, "Now");
  await expect(now.getByText("Waiting for you")).toBeVisible();
  await now.getByRole("button", { name: /For a hard day/ }).click();
  const sheet = page.getByRole("dialog", { name: "A letter for you" });
  await expect(sheet.getByText("Open when you need reassurance")).toBeVisible();
  await sheet.getByRole("button", { name: "Open", exact: true }).click();
  await expect.poll(() => state.released.length).toBe(1);
});

test("Create sheet groups by intent and uses the existing create flow", async ({ page }) => {
  const state = scenario();
  await openOurs(page, state);
  await page.getByRole("button", { name: "Add to Ours" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Add to Ours" });
  for (const group of ["Remember something", "Say something", "Look ahead", "Plan a surprise"]) {
    await expect(sheet.getByRole("heading", { name: group })).toBeVisible();
  }
  await sheet.getByRole("button", { name: "A memory" }).click();
  const form = page.getByRole("dialog", { name: "A memory" });
  await form.getByLabel("Title").fill("The first rain");
  await form.getByRole("button", { name: "Add to Ours" }).click();
  await expect.poll(() => state.posted.length).toBe(1);
  expect(state.posted[0]).toMatchObject({
    kind: "memory",
    content: { title: "The first rain", note: null },
    release: null,
  });
});

test("View-only Ours is neutral: everything can be read and nothing offers a change", async ({
  page,
}) => {
  const mine = item({ kind: "memory", content: { title: "Our bench", note: "Cold tea" } });
  await openOurs(
    page,
    scenario({ mode: "breakup_pending_view_only", canCreate: false, items: [mine] }),
  );
  await expect(page.getByText(/Ours is view-only during the breakup process/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to Ours" })).toHaveCount(0);
  await chapter(page, "Then")
    .getByRole("button", { name: /Our bench/ })
    .click();
  const sheet = page.getByRole("dialog", { name: "Memory" });
  await expect(sheet.getByText("Cold tea")).toBeVisible();
  for (const name of ["Edit", "Delete", "Add to Our Story"]) {
    await expect(sheet.getByRole("button", { name })).toHaveCount(0);
  }
  const text = (await page.locator(".ours").innerText()).toLowerCase();
  for (const bad of ["hurry", "last chance", "too late", "lose"]) {
    expect(text).not.toContain(bad);
  }
});

test("Ours fits a 320px phone and reduced motion swaps movement for a fade", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openOurs(page, scenario({ items: [item()] }));
  await expect(page.locator(".ours[data-mode]")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const name = await page.evaluate(
    () => getComputedStyle(document.querySelector(".ours") as Element).animationName,
  );
  expect(name).toBe("ours-arrive-still");
});

async function openUs(page: Page, state: Scenario) {
  await mockApi(page, state);
  await page.goto("/index.html#/us");
  await expect(page.getByRole("heading", { name: "Partnership", exact: true })).toBeVisible();
}

test("Us keeps profile, security, devices, and account deletion reachable and calm", async ({
  page,
}) => {
  const state = scenario();
  await openUs(page, state);
  for (const name of [
    "Appearance",
    "Account",
    "Username",
    "Date of birth",
    "Security confirmation",
    "Verified email",
    "Devices",
    "Delete account",
    "Notifications",
  ]) {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(page.getByText("This device", { exact: true })).toBeVisible();

  // Presence, typing, last seen, and receipts are always on and never appear as settings.
  const text = (await page.locator("#main").innerText()).toLowerCase();
  for (const word of ["read receipt", "typing indicator", "last seen", "online status"]) {
    expect(text).not.toContain(word);
  }
  await expect(page.getByRole("switch")).toHaveCount(0);
});

test("Breakup start keeps its confirmation text and calls the unchanged endpoint", async ({
  page,
}) => {
  const state = scenario();
  await openUs(page, state);
  await page.getByRole("button", { name: "Start breakup" }).click();
  const dialog = page.getByRole("dialog", { name: "Start the breakup process?" });
  await expect(
    dialog.getByText(
      "Start the breakup process? You can cancel directly only during the first hour.",
    ),
  ).toBeVisible();
  // The destructive choice is never the initially focused control.
  await expect(dialog.getByRole("button", { name: "Start breakup" })).not.toBeFocused();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(state.calls).toEqual([]);
  await page.getByRole("button", { name: "Start breakup" }).click();
  await dialog.getByRole("button", { name: "Start breakup" }).click();
  await expect.poll(() => state.calls.filter((path) => path.endsWith("/breakup")).length).toBe(1);
});

test("Breakup in progress shows cancel and restore neutrally, with the irreversible restore text", async ({
  page,
}) => {
  const breakup = {
    breakupId: "e0000000-0000-4000-8000-000000000001",
    initiatedBy: "self",
    initiatedAt: "2026-09-01T00:00:00.000Z",
    initiatorCancelUntil: "2026-09-01T01:00:00.000Z",
    baseDeadline: "2026-09-30T00:00:00.000Z",
    finalDeadline: "2026-09-30T00:00:00.000Z",
    selfRestoreIntentAt: null,
    partnerRestoreIntentAt: null,
  };
  const state = scenario({
    partnership: {
      ...basePartnership,
      lifecycleState: "breakup_pending",
      interactionMode: "breakup_restricted",
      breakup,
      capabilities: {
        changeRelationshipStartDate: false,
        initiateBreakup: false,
        cancelBreakup: true,
        submitRestoreIntent: true,
        viewSharedData: true,
      },
    },
  });
  await openUs(page, state);
  await expect(page.getByText("Breakup in progress", { exact: true })).toBeVisible();
  await expect(page.getByText(/Current final deadline:/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel breakup" })).toBeVisible();
  await expect(page.getByText("Relationship metadata is currently view-only.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start breakup" })).toHaveCount(0);
  const main = (await page.locator("#main").innerText()).toLowerCase();
  for (const bad of ["hurry", "last chance", "too late", "don't leave"]) {
    expect(main).not.toContain(bad);
  }

  await page.getByRole("button", { name: "Restore partnership" }).click();
  const dialog = page.getByRole("dialog", { name: "Restore the partnership?" });
  await expect(
    dialog.getByText(
      "Submit your restore request? It cannot be withdrawn during this breakup process.",
    ),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Submit restore request" }).click();
  await expect.poll(() => state.calls.filter((path) => path.endsWith("/restore")).length).toBe(1);
  await page.getByRole("button", { name: "Cancel breakup" }).click();
  await expect.poll(() => state.calls.filter((path) => path.endsWith("/cancel")).length).toBe(1);
});

test("Account deletion keeps its consequence text and is confirmed in a dialog", async ({
  page,
}) => {
  const state = scenario();
  await openUs(page, state);
  await page.getByRole("button", { name: "Request account deletion" }).click();
  const dialog = page.getByRole("dialog", { name: "Request account deletion?" });
  await expect(dialog.getByText(/Access is removed immediately/)).toBeVisible();
  await expect(dialog.getByText(/exactly seven days/)).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(state.calls).toEqual([]);
});

test("Deletion recovery notice, former partners, and notifications are calm and reachable", async ({
  page,
}) => {
  const state = scenario({
    partnership: {
      ...basePartnership,
      interactionMode: "account_deletion_view_only",
      accountDeletion: { deletingMember: "partner", recoverUntil: "2026-10-01T00:00:00.000Z" },
    },
    former: [
      {
        partnershipId: "f0000000-0000-4000-8000-000000000001",
        terminatedAt: "2025-01-01T00:00:00.000Z",
        terminationReason: "breakup",
        formerPartner: { accountId: "x", username: "sam", displayName: "Sam" },
        blockedByMe: false,
      },
    ],
    notifications: [
      {
        notificationId: "n1",
        eventType: "breakup_deadline_reminder",
        actorAccountId: null,
        partnershipId: null,
        createdAt: "2026-09-20T00:00:00.000Z",
        readAt: null,
      },
    ],
  });
  await openUs(page, state);
  await expect(
    page.getByText(/view-only while your partner's account deletion is pending/),
  ).toBeVisible();
  await expect(page.getByText(/Recovery closes at/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Former partnerships" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Block former partner" })).toBeVisible();
  await expect(page.getByText("A reminder about the breakup deadline.")).toBeVisible();
  await expect(page.getByText(/approaching/i)).toHaveCount(0);
  await page.getByRole("button", { name: "Mark read" }).click();
  await expect.poll(() => state.calls.filter((path) => path.endsWith("/read")).length).toBe(1);
});

test("Unpaired accounts reach partner requests in Us", async ({ page }) => {
  await mockApi(page, scenario());
  await page.route("**/api/v1/partnerships/current", (route) => json(route, { partnership: null }));
  await page.route("**/api/v1/conversations/current", (route) =>
    json(route, { conversation: null }),
  );
  await page.goto("/index.html#/us");
  await expect(page.getByRole("heading", { name: "Find your partner" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Search" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Incoming" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Outgoing" })).toBeVisible();
});

test("Us fits a 320px phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openUs(page, scenario());
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
