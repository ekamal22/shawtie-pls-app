import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "m3-browser.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  outputDir: "node_modules/.cache/shawtie-m3-playwright",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command:
      "npm run dev --workspace @shawtie/web -- --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173/m3-e2e.html",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_M3_TEST_CRYPTO: "1",
    },
  },
});
