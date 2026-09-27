import { expect, type Browser, type Page, type Route, test } from "@playwright/test";

const ACCOUNT_ID = "a0000000-0000-4000-8000-000000000001";
const DEVICE_ONE = "d0000000-0000-4000-8000-000000000001";
const DEVICE_OTHER = "d0000000-0000-4000-8000-000000000002";
const DEVICE_NEW = "d0000000-0000-4000-8000-000000000003";
const OTHER_CRYPTO = "c0000000-0000-4000-8000-000000000002";
const CHALLENGE_ID = "f0000000-0000-4000-8000-000000000001";
const CHALLENGE = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

interface Json {
  [key: string]: unknown;
}

interface MockState {
  cryptoDevices: Json[];
  recoveryBundle: Json | null;
  enrollmentRequests: number;
  accountDevices: Array<{
    id: string;
    displayName: string;
    createdAt: string;
    lastSeenAt: string | null;
    revokedAt: string | null;
    activeSessionCount: number;
  }>;
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function deviceProjection(body: Json, deviceId: string, trustState: "pending" | "trusted"): Json {
  return {
    cryptoDeviceId: body.cryptoDeviceId,
    deviceId,
    accountId: ACCOUNT_ID,
    cryptoProfile: body.cryptoProfile,
    mlsSigningPublicKey: body.mlsSigningPublicKey,
    contentSigningPublicKey: body.contentSigningPublicKey,
    trustState,
    approvedAt: trustState === "trusted" ? new Date().toISOString() : null,
    createdAt: new Date().toISOString(),
    revokedAt: null,
  };
}

function accountDevice(id: string, displayName: string) {
  return {
    id,
    displayName,
    createdAt: "2026-09-27T00:00:00.000Z",
    lastSeenAt: "2026-09-27T00:00:00.000Z",
    revokedAt: null,
    activeSessionCount: 1,
  };
}

async function mockApi(page: Page, state: MockState, sessionDeviceId: string) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === "/api/v1/auth/session") {
      return json(route, {
        authenticated: true,
        accountId: ACCOUNT_ID,
        sessionId: "session-" + sessionDeviceId,
        deviceId: sessionDeviceId,
        reauthenticatedAt: new Date().toISOString(),
      });
    }
    if (path === "/api/v1/me") {
      return json(route, {
        accountId: ACCOUNT_ID,
        username: "me",
        displayName: "Me",
        dateOfBirth: "1995-01-01",
        status: "active",
        email: "me@example.test",
      });
    }
    if (path === "/api/v1/me/devices") {
      return json(route, {
        devices: state.accountDevices.map((device) => ({
          ...device,
          isCurrent: device.id === sessionDeviceId,
        })),
      });
    }
    if (path === "/api/v1/partnerships/current") {
      return json(route, { partnership: null });
    }
    if (path === "/api/v1/conversations/current") {
      return json(route, { conversation: null });
    }
    if (path === "/api/v1/calls/current") return json(route, { call: null });
    if (path.startsWith("/api/v1/notifications")) {
      return json(route, { items: [], nextCursor: null });
    }
    if (path.startsWith("/api/v1/partner-requests")) {
      return json(route, { items: [], nextCursor: null });
    }
    if (path === "/api/v1/push/config") return json(route, { enabled: false });
    if (path === "/api/v1/presence/heartbeat") return json(route, {});

    if (path === "/api/v1/crypto/devices/enroll" && method === "POST") {
      state.enrollmentRequests += 1;
      const existing = state.cryptoDevices.find((device) => device.deviceId === sessionDeviceId);
      if (existing) {
        return json(route, {
          device: existing,
          initialTrust: existing.trustState === "trusted",
        });
      }
      const body = request.postDataJSON() as Json;
      const first = state.cryptoDevices.length === 0;
      const projection = deviceProjection(body, sessionDeviceId, first ? "trusted" : "pending");
      state.cryptoDevices.push(projection);
      if (first) {
        state.cryptoDevices.push({
          ...projection,
          cryptoDeviceId: OTHER_CRYPTO,
          deviceId: DEVICE_OTHER,
          trustState: "pending",
          approvedAt: null,
        });
      }
      return json(route, { device: projection, initialTrust: first });
    }
    if (path === "/api/v1/crypto/devices/current") {
      const current = state.cryptoDevices.find((device) => device.deviceId === sessionDeviceId);
      return current
        ? json(route, { device: current })
        : json(route, { error: { code: "CRYPTO_NOT_INITIALIZED" } }, 409);
    }
    if (path === "/api/v1/crypto/devices") {
      return json(route, { devices: state.cryptoDevices });
    }

    const approve = path.match(/^\/api\/v1\/crypto\/devices\/([^/]+)\/approve$/);
    if (approve && method === "POST") {
      const target = state.cryptoDevices.find((device) => device.cryptoDeviceId === approve[1]);
      if (!target) return json(route, { error: { code: "CRYPTO_DEVICE_NOT_FOUND" } }, 404);
      target.trustState = "trusted";
      target.approvedAt = new Date().toISOString();
      return json(route, { device: target });
    }

    if (path === "/api/v1/crypto/recovery/bundle") {
      return state.recoveryBundle
        ? json(route, state.recoveryBundle)
        : json(route, { error: { code: "CRYPTO_RECOVERY_UNAVAILABLE" } }, 404);
    }
    if (path === "/api/v1/crypto/recovery/setup" && method === "POST") {
      const body = request.postDataJSON() as Json;
      state.recoveryBundle = {
        cryptoProfile: body.cryptoProfile,
        recoveryKeyVersion: body.recoveryKeyVersion,
        recoveryHpkePublicKey: body.recoveryHpkePublicKey,
        recoveryAuthPublicKey: body.recoveryAuthPublicKey,
        encryptedBundle: body.encryptedBundle,
        createdAt: new Date().toISOString(),
      };
      return json(route, {
        cryptoProfile: body.cryptoProfile,
        recoveryKeyVersion: body.recoveryKeyVersion,
        createdAt: new Date().toISOString(),
        cryptoRequired: false,
      });
    }
    if (path === "/api/v1/crypto/recovery/challenge" && method === "POST") {
      return json(route, {
        challengeId: CHALLENGE_ID,
        challenge: CHALLENGE,
        recoveryKeyVersion: state.recoveryBundle?.recoveryKeyVersion ?? 1,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      });
    }
    if (path === "/api/v1/crypto/recovery/prove" && method === "POST") {
      const current = state.cryptoDevices.find((device) => device.deviceId === sessionDeviceId);
      if (!current) return json(route, { error: { code: "CRYPTO_RECOVERY_FAILED" } }, 409);
      current.trustState = "trusted";
      current.approvedAt = new Date().toISOString();
      return json(route, { device: current });
    }

    return json(route, { error: { code: "MOCK_NOT_FOUND" } }, 404);
  });
}

async function openUs(page: Page, state: MockState, deviceId: string) {
  await mockApi(page, state, deviceId);
  await page.goto("/");
  const usButton = page.getByRole("button", { name: "Us: account and partnership" });
  await expect(usButton).toBeVisible();
  await usButton.click();
  await expect(page.getByRole("heading", { name: "Protected sharing" })).toBeVisible();
}

async function durableText(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const values: string[] = [];
    values.push(location.href);
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key) values.push(key, localStorage.getItem(key) ?? "");
    }
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (key) values.push(key, sessionStorage.getItem(key) ?? "");
    }

    if ("databases" in indexedDB) {
      const databases = await indexedDB.databases();
      for (const info of databases) {
        if (!info.name) continue;
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(info.name!);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        for (const storeName of Array.from(database.objectStoreNames)) {
          const rows = await new Promise<unknown[]>((resolve, reject) => {
            const transaction = database.transaction(storeName, "readonly");
            const request = transaction.objectStore(storeName).getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          values.push(info.name, storeName, JSON.stringify(rows));
        }
        database.close();
      }
    }

    for (const cacheName of await caches.keys()) {
      values.push(cacheName);
      const cache = await caches.open(cacheName);
      for (const request of await cache.keys()) {
        values.push(request.url);
        const response = await cache.match(request);
        if (response)
          values.push(
            await response
              .clone()
              .text()
              .catch(() => ""),
          );
      }
    }
    return values.join("\n");
  });
}

test.describe.serial("UX8 encrypted UX integration", () => {
  const state: MockState = {
    cryptoDevices: [],
    recoveryBundle: null,
    enrollmentRequests: 0,
    accountDevices: [
      accountDevice(DEVICE_ONE, "Main browser"),
      accountDevice(DEVICE_OTHER, "Other browser"),
      accountDevice(DEVICE_NEW, "Fresh browser"),
    ],
  };
  let recoveryKey = "";

  test("trusted device creates recovery, avoids RMS persistence and approves another device", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openUs(page, state, DEVICE_ONE);

    await expect(
      page.getByRole("paragraph").filter({ hasText: "No recovery key has been saved yet." }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Create recovery key" }).click();
    await expect(page.getByRole("dialog", { name: "Ready to save a recovery key?" })).toBeVisible();
    await page.getByRole("button", { name: "Generate recovery key" }).click();

    const reveal = page.getByRole("dialog", { name: "Save your recovery key" });
    await expect(reveal).toBeVisible();
    recoveryKey = (await reveal.locator(".security-secret__value").innerText()).trim();
    expect(recoveryKey.length).toBeGreaterThan(20);
    expect(state.enrollmentRequests).toBe(1);

    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(
      true,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(reveal.getByRole("button", { name: "Copy recovery key" })).toBeVisible();
    await expect(reveal.getByRole("button", { name: "Done" })).toBeVisible();

    const durable = await durableText(page);
    expect(durable).not.toContain(recoveryKey);

    await reveal.getByRole("checkbox").check();
    await reveal.getByRole("button", { name: "Done" }).click();
    await expect(reveal).toBeHidden();
    await expect(page.getByText("Recovery setup complete.")).toBeVisible();
    expect(await durableText(page)).not.toContain(recoveryKey);

    const row = page.locator(".security-device-row").filter({ hasText: "Other browser" });
    await expect(row).toContainText("Waiting for protected-sharing approval");
    await row.getByRole("button", { name: "Approve" }).click();
    await expect(
      page.getByText(
        "Device approved for future protected sharing. Approval alone does not promise access to older protected history.",
      ),
    ).toBeVisible();
    await expect(row).toContainText("Trusted for protected sharing");
  });

  test("fresh pending device fails closed on a wrong RMS and trusts on the correct RMS", async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await openUs(page, state, DEVICE_NEW);
      await expect(page.getByText("Waiting for approval", { exact: true })).toBeVisible();
      const input = page.getByLabel("Recovery key", { exact: true });

      await input.fill("wrong-recovery-key");
      await page.getByRole("button", { name: "Restore with recovery key" }).click();
      await expect(page.getByText(/could not be verified/i)).toBeVisible();
      await expect(page.getByText("Waiting for approval", { exact: true })).toBeVisible();

      await input.fill(recoveryKey);
      await page.getByRole("button", { name: "Restore with recovery key" }).click();
      await expect(page.getByText("Trusted", { exact: true })).toBeVisible();
      await expect(page.getByText(/recovery capability was restored/i)).toBeVisible();
      expect(await durableText(page)).not.toContain(recoveryKey);
    } finally {
      await context.close();
    }
  });
});
