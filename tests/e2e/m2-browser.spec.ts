import { expect, test } from "@playwright/test";

const ACCOUNT = "10000000-0000-4000-8000-000000000001";
const PARTNERSHIP = "20000000-0000-4000-8000-000000000001";
const CONVERSATION = "30000000-0000-4000-8000-000000000001";
const OPERATION = "40000000-0000-4000-8000-000000000001";

async function openHarness(page: import("@playwright/test").Page) {
  await page.goto("/m2-e2e.html");
  await expect(page.locator("#status")).toHaveText("ready");
  await page.evaluate((accountId) => window.m2Harness.open(accountId), ACCOUNT);
}

test("M2 IndexedDB queue survives a real browser reload", async ({ page }) => {
  await openHarness(page);
  await page.evaluate(
    ({ partnershipId, conversationId, operationId }) =>
      window.m2Harness.enqueue({
        partnershipId,
        conversationId,
        operationId,
      }),
    {
      partnershipId: PARTNERSHIP,
      conversationId: CONVERSATION,
      operationId: OPERATION,
    },
  );
  await page.evaluate(() => window.m2Harness.close());

  await page.reload();
  await expect(page.locator("#status")).toHaveText("ready");
  await page.evaluate((accountId) => window.m2Harness.open(accountId), ACCOUNT);
  const queue = await page.evaluate(
    (partnershipId) => window.m2Harness.list(partnershipId),
    PARTNERSHIP,
  );

  expect(queue).toHaveLength(1);
  expect(queue[0]?.operationId).toBe(OPERATION);
  expect(queue[0]?.idempotencyKey).toBe("m2-e2e-" + OPERATION);

  await page.evaluate((accountId) => window.m2Harness.purge(accountId), ACCOUNT);
});

test("M2 cross-tab claim generation fences stale completion", async ({ context, page }) => {
  const second = await context.newPage();
  await openHarness(page);
  await openHarness(second);

  await page.evaluate(
    ({ partnershipId, conversationId, operationId }) =>
      window.m2Harness.enqueue({
        partnershipId,
        conversationId,
        operationId,
        queuedAt: 1,
      }),
    {
      partnershipId: PARTNERSHIP,
      conversationId: CONVERSATION,
      operationId: OPERATION,
    },
  );

  const firstClaim = await page.evaluate(
    ({ operationId }) =>
      window.m2Harness.claim(operationId, "tab-a", Date.now(), 10),
    { operationId: OPERATION },
  );
  expect(firstClaim?.claimGeneration).toBe(1);

  await page.waitForTimeout(25);

  const secondClaim = await second.evaluate(
    ({ operationId }) =>
      window.m2Harness.claim(operationId, "tab-b", Date.now(), 60_000),
    { operationId: OPERATION },
  );
  expect(secondClaim?.claimGeneration).toBe(2);

  const staleCompleted = await page.evaluate(
    ({ operationId, generation }) =>
      window.m2Harness.complete(operationId, "tab-a", generation),
    { operationId: OPERATION, generation: firstClaim!.claimGeneration },
  );
  expect(staleCompleted).toBe(false);

  const currentCompleted = await second.evaluate(
    ({ operationId, generation }) =>
      window.m2Harness.complete(operationId, "tab-b", generation),
    { operationId: OPERATION, generation: secondClaim!.claimGeneration },
  );
  expect(currentCompleted).toBe(true);

  await page.evaluate(() => window.m2Harness.close());
  await second.evaluate(() => window.m2Harness.close());
  await second.close();
  await page.evaluate((accountId) => window.m2Harness.purge(accountId), ACCOUNT);
});

test("M2 pre-S1 cold start hides existing private cache when session verification has no network", async ({
  page,
}) => {
  const PRIVATE_SENTINEL = "cold-start-private-cache-sentinel";
  const MESSAGE = "50000000-0000-4000-8000-000000000030";

  await page.goto("/m2-e2e.html");
  await expect(page.locator("#status")).toHaveText("ready");
  await page.evaluate(
    async ({ accountId, partnershipId, conversationId, messageId, body }) => {
      await window.m2Harness.open(accountId);
      await window.m2Harness.rememberNamespace(partnershipId, conversationId);
      await window.m2Harness.seedMessage({
        partnershipId,
        conversationId,
        messageId,
        body,
      });
      window.m2Harness.close();
    },
    {
      accountId: ACCOUNT,
      partnershipId: PARTNERSHIP,
      conversationId: CONVERSATION,
      messageId: MESSAGE,
      body: PRIVATE_SENTINEL,
    },
  );

  await page.route("**/api/v1/auth/session", async (route) => {
    await route.abort("internetdisconnected");
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Offline" })).toBeVisible();
  await expect(page.getByText(/verify this private session/i)).toBeVisible();
  await expect(page.getByText(PRIVATE_SENTINEL)).toHaveCount(0);

  await page.goto("/m2-e2e.html");
  await page.evaluate((accountId) => window.m2Harness.purge(accountId), ACCOUNT);
});

test("M2 service worker never caches private API responses", async ({ page }) => {
  await page.route("**/api/m2-private-probe", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ private: "sentinel" }),
    });
  });

  await page.goto("/m2-e2e.html");
  await expect(page.locator("#status")).toHaveText("ready");

  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    await navigator.serviceWorker.ready;

    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => resolve(),
          { once: true },
        );
      });
    }

    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("icon failed to load"));
    });
    image.src = "/icon.svg?m2-browser-cache-probe=1";
    document.body.append(image);
    await loaded;

    const response = await fetch("/api/m2-private-probe");
    if (!response.ok) throw new Error("private API probe failed");
  });

  const cacheUrls = await page.evaluate(async () => {
    const result: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) result.push(request.url);
    }
    return result;
  });

  expect(cacheUrls.some((url) => url.includes("/api/"))).toBe(false);
  expect(cacheUrls.some((url) => url.includes("/icon.svg"))).toBe(true);
});


test("M2 runtime reconnects and replays one offline message after canonical sync with stable idempotency", async ({
  context,
  page,
}) => {
  const MESSAGE = "50000000-0000-4000-8000-000000000001";
  const IDEMPOTENCY = "m2-e2e-lost-response-0001";
  const requestOrder: string[] = [];
  const idempotencyKeys: string[] = [];
  const logicalMessages = new Map<string, string>();
  let postAttempts = 0;
  let socketConnections = 0;
  let activeSocket: import("@playwright/test").WebSocketRoute | null = null;

  await page.routeWebSocket("/api/v1/realtime", async (socket) => {
    socketConnections += 1;
    activeSocket = socket;
    expect(socket.protocols()).toContain("shawtie.realtime.v2");
    socket.send(
      JSON.stringify({
        v: 1,
        type: "control.ready",
        payload: {
          connectionId:
            "60000000-0000-4000-8000-" +
            String(socketConnections).padStart(12, "0"),
          serverTime: "2026-09-22T18:00:00.000Z",
          accountId: ACCOUNT,
          partnershipId: PARTNERSHIP,
          conversationId: CONVERSATION,
          partnershipGeneration: 1,
          latestServerSequence: 0,
          latestChangeSequence: 0,
        },
      }),
    );
  });

  await page.route("**/api/v1/m2-e2e-reconcile", async (route) => {
    requestOrder.push("reconcile");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ latestChangeSequence: 0 }),
    });
  });
  await page.route("**/api/v1/auth/session", async (route) => {
    requestOrder.push("session");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ authenticated: true }),
    });
  });
  await page.route("**/api/v1/conversations/current", async (route) => {
    requestOrder.push("authority");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        conversation: {
          conversationId: CONVERSATION,
          partnershipId: PARTNERSHIP,
          capabilities: { sendMessage: true },
        },
      }),
    });
  });
  await page.route("**/api/v1/relationship-space", async (route) => {
    requestOrder.push("relationship-authority");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ space: null }),
    });
  });
  await page.route(
    "**/api/v1/conversations/" + CONVERSATION + "/messages",
    async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      requestOrder.push("post");
      postAttempts += 1;
      const key = route.request().headers()["idempotency-key"];
      expect(key).toBeTruthy();
      idempotencyKeys.push(key!);
      if (!logicalMessages.has(key!)) logicalMessages.set(key!, MESSAGE);

      if (postAttempts === 1) {
        await route.abort("connectionreset");
        return;
      }

      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ messageId: logicalMessages.get(key!) }),
      });
    },
  );
  await page.route(
    "**/api/v1/conversations/" + CONVERSATION + "/messages/" + MESSAGE,
    async (route) => {
      requestOrder.push("projection");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          messageId: MESSAGE,
          conversationId: CONVERSATION,
          senderAccountId: ACCOUNT,
          senderDeviceId: null,
          serverSequence: 1,
          contentVersion: 1,
          lastChangeSequence: 1,
          replyToMessageId: null,
          replyContext: null,
          body: "offline browser probe",
          createdAt: "2026-09-22T18:00:01.000Z",
          editedAt: null,
          deletedAt: null,
          reactions: [],
        }),
      });
    },
  );

  await page.goto("/m2-e2e.html");
  await expect(page.locator("#status")).toHaveText("ready");
  await page.evaluate((accountId) => window.m2Harness.startRuntime(accountId), ACCOUNT);

  await expect
    .poll(() =>
      page.evaluate(() => window.m2Harness.runtimeState().partnershipId),
    )
    .toBe(PARTNERSHIP);
  await expect
    .poll(() => page.evaluate(() => window.m2Harness.runtimeState().status))
    .toBe("live");

  requestOrder.length = 0;
  await page.evaluate(() => window.m2Harness.clearRuntimeLog());
  await context.setOffline(true);
  await expect
    .poll(() => page.evaluate(() => navigator.onLine))
    .toBe(false);
  if (activeSocket) {
    await activeSocket.close({ code: 1001, reason: "offline acceptance" });
  }

  await page.evaluate(
    ({ body, key }) => window.m2Harness.queueRuntimeMessage(body, key),
    { body: "offline browser probe", key: IDEMPOTENCY },
  );
  await expect
    .poll(() => page.evaluate(() => window.m2Harness.runtimeQueue().then((q) => q.length)))
    .toBe(1);
  await expect
    .poll(() => page.evaluate(() => window.m2Harness.runtimeState().status))
    .toBe("offline");
  expect(requestOrder).toEqual([]);

  await context.setOffline(false);
  await expect
    .poll(() => postAttempts, { timeout: 15_000 })
    .toBe(2);
  await expect
    .poll(() => page.evaluate(() => window.m2Harness.runtimeQueue().then((q) => q.length)))
    .toBe(0);
  await expect
    .poll(() => socketConnections)
    .toBeGreaterThanOrEqual(2);

  expect(idempotencyKeys).toEqual([IDEMPOTENCY, IDEMPOTENCY]);
  expect(logicalMessages.size).toBe(1);

  const firstPost = requestOrder.indexOf("post");
  const secondPost = requestOrder.lastIndexOf("post");
  expect(firstPost).toBeGreaterThan(0);
  expect(secondPost).toBeGreaterThan(firstPost);
  expect(requestOrder.slice(0, firstPost)).toContain("reconcile");
  expect(requestOrder.slice(0, firstPost)).toContain("authority");
  expect(requestOrder.slice(firstPost + 1, secondPost)).toContain("reconcile");
  expect(requestOrder.slice(firstPost + 1, secondPost)).toContain("authority");

  await page.evaluate(() => window.m2Harness.stopRuntime());
  await page.evaluate((accountId) => window.m2Harness.purge(accountId), ACCOUNT);
});


test("M2 account databases never expose another account private cache or queue", async ({ page }) => {
  const ACCOUNT_B = "10000000-0000-4000-8000-000000000002";
  const MESSAGE_A = "50000000-0000-4000-8000-000000000010";
  const OPERATION_A = "40000000-0000-4000-8000-000000000010";

  await page.goto("/m2-e2e.html");
  await expect(page.locator("#status")).toHaveText("ready");

  await page.evaluate(
    async ({ accountId, partnershipId, conversationId, messageId, operationId }) => {
      await window.m2Harness.open(accountId);
      await window.m2Harness.rememberNamespace(partnershipId, conversationId);
      await window.m2Harness.seedMessage({
        partnershipId,
        conversationId,
        messageId,
        body: "account-a-private-cache",
      });
      await window.m2Harness.enqueue({
        partnershipId,
        conversationId,
        operationId,
      });
      window.m2Harness.close();
    },
    {
      accountId: ACCOUNT,
      partnershipId: PARTNERSHIP,
      conversationId: CONVERSATION,
      messageId: MESSAGE_A,
      operationId: OPERATION_A,
    },
  );

  await page.evaluate((accountId) => window.m2Harness.open(accountId), ACCOUNT_B);
  expect(
    await page.evaluate(
      ({ partnershipId, conversationId }) =>
        window.m2Harness.messages(partnershipId, conversationId),
      { partnershipId: PARTNERSHIP, conversationId: CONVERSATION },
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(
      (partnershipId) => window.m2Harness.list(partnershipId),
      PARTNERSHIP,
    ),
  ).toEqual([]);
  await page.evaluate(() => window.m2Harness.close());

  await page.evaluate((accountId) => window.m2Harness.purge(accountId), ACCOUNT);
  await page.evaluate((accountId) => window.m2Harness.purge(accountId), ACCOUNT_B);
});

test("M2 final partnership purge prevents a future partnership inheriting old cache or queue", async ({
  page,
}) => {
  const OLD_MESSAGE = "50000000-0000-4000-8000-000000000020";
  const OLD_OPERATION = "40000000-0000-4000-8000-000000000020";
  const NEW_PARTNERSHIP = "20000000-0000-4000-8000-000000000002";
  const NEW_CONVERSATION = "30000000-0000-4000-8000-000000000002";
  const NEW_MESSAGE = "50000000-0000-4000-8000-000000000021";
  const NEW_OPERATION = "40000000-0000-4000-8000-000000000021";

  await openHarness(page);
  await page.evaluate(
    async ({ partnershipId, conversationId, messageId, operationId }) => {
      await window.m2Harness.rememberNamespace(partnershipId, conversationId);
      await window.m2Harness.seedMessage({
        partnershipId,
        conversationId,
        messageId,
        body: "old-partnership-private-cache",
      });
      await window.m2Harness.enqueue({
        partnershipId,
        conversationId,
        operationId,
      });
      await window.m2Harness.purgePartnership(partnershipId);
    },
    {
      partnershipId: PARTNERSHIP,
      conversationId: CONVERSATION,
      messageId: OLD_MESSAGE,
      operationId: OLD_OPERATION,
    },
  );

  expect(
    await page.evaluate(
      ({ partnershipId, conversationId }) =>
        window.m2Harness.messages(partnershipId, conversationId),
      { partnershipId: PARTNERSHIP, conversationId: CONVERSATION },
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(
      (partnershipId) => window.m2Harness.list(partnershipId),
      PARTNERSHIP,
    ),
  ).toEqual([]);

  await page.evaluate(
    async ({ partnershipId, conversationId, messageId, operationId }) => {
      await window.m2Harness.rememberNamespace(partnershipId, conversationId);
      await window.m2Harness.seedMessage({
        partnershipId,
        conversationId,
        messageId,
        body: "new-partnership-cache",
      });
      await window.m2Harness.enqueue({
        partnershipId,
        conversationId,
        operationId,
      });
    },
    {
      partnershipId: NEW_PARTNERSHIP,
      conversationId: NEW_CONVERSATION,
      messageId: NEW_MESSAGE,
      operationId: NEW_OPERATION,
    },
  );

  const newMessages = await page.evaluate(
    ({ partnershipId, conversationId }) =>
      window.m2Harness.messages(partnershipId, conversationId),
    { partnershipId: NEW_PARTNERSHIP, conversationId: NEW_CONVERSATION },
  );
  expect(newMessages).toHaveLength(1);
  expect(newMessages[0]?.body).toBe("new-partnership-cache");

  const newQueue = await page.evaluate(
    (partnershipId) => window.m2Harness.list(partnershipId),
    NEW_PARTNERSHIP,
  );
  expect(newQueue).toHaveLength(1);
  expect(newQueue[0]?.operationId).toBe(NEW_OPERATION);
  expect(
    await page.evaluate(
      (partnershipId) => window.m2Harness.list(partnershipId),
      PARTNERSHIP,
    ),
  ).toEqual([]);

  await page.evaluate((accountId) => window.m2Harness.purge(accountId), ACCOUNT);
});
