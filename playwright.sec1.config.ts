import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "sec1-security.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  outputDir: "node_modules/.cache/shawtie-sec1-playwright",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:4180",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "node scripts/test/sec1-web-backend.mjs",
      url: "http://127.0.0.1:4190/health",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command:
        "npm run build --workspace @shawtie/contracts && npm run build --workspace @shawtie/crypto && npm run build:s1-wasm && npm run build --workspace @shawtie/web && node scripts/test/sec1-web-server.mjs",
      url: "http://127.0.0.1:4180/health",
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
