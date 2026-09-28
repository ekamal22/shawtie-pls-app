import { expect, test } from "@playwright/test";

test("SEC1 production serving enforces CSP while preserving required browser capabilities", async ({
  page,
  context,
}) => {
  const cspViolations: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /content security policy|csp/i.test(message.text())) {
      cspViolations.push(message.text());
    }
  });

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  const headers = response?.headers() ?? {};
  const csp = headers["content-security-policy"] ?? "";
  expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(csp).not.toContain("'unsafe-eval'");
  expect(csp).not.toContain("'unsafe-inline'");
  expect(csp).toContain("style-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("ws://127.0.0.1:4180");
  expect(csp).toContain("http://127.0.0.1:4190");

  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["permissions-policy"]).toContain("camera=(self)");
  expect(headers["permissions-policy"]).toContain("microphone=(self)");

  expect(await page.locator("[style]").count()).toBe(0);
  expect(cspViolations).toEqual([]);

  const evalResult = await page.evaluate(() => {
    try {
      window.eval("1 + 1");
      return "allowed";
    } catch (error) {
      return error instanceof Error ? error.name : "blocked";
    }
  });
  expect(evalResult).not.toBe("allowed");
  cspViolations.length = 0;

  const openMlsLoaded = await page.evaluate(
    async (moduleUrl) => {
      const module = (await import(moduleUrl)) as {
        default?: () => Promise<unknown> | unknown;
        ShawtieMlsClient?: unknown;
      };
      if (typeof module.default === "function") {
        await module.default();
      }
      return typeof module.ShawtieMlsClient === "function";
    },
    "/crypto/openmls/shawtie_openmls_wasm.js",
  );
  expect(openMlsLoaded).toBe(true);

  const serviceWorkerScope = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    return registration.scope;
  });
  expect(serviceWorkerScope).toBe("http://127.0.0.1:4180/");

  const socketOpened = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const socket = new WebSocket("ws://127.0.0.1:4180/api/v1/realtime");
        const timer = window.setTimeout(() => {
          socket.close();
          resolve(false);
        }, 5_000);
        socket.addEventListener(
          "open",
          () => {
            window.clearTimeout(timer);
            socket.close();
            resolve(true);
          },
          { once: true },
        );
        socket.addEventListener(
          "error",
          () => {
            window.clearTimeout(timer);
            resolve(false);
          },
          { once: true },
        );
      }),
  );
  expect(socketOpened).toBe(true);

  const media = await page.evaluate(async () => {
    const response = await fetch("http://127.0.0.1:4190/media", {
      credentials: "omit",
      cache: "no-store",
    });
    return { status: response.status, body: await response.text() };
  });
  expect(media).toEqual({ status: 200, body: "sec1-ciphertext" });

  await page.reload({ waitUntil: "domcontentloaded" });
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveTitle("Shawtie pls");
  await context.setOffline(false);

  expect(cspViolations).toEqual([]);
});
