import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "ux2-home.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  outputDir: "node_modules/.cache/shawtie-ux2-playwright",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4178",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev --workspace @shawtie/web -- --host 127.0.0.1 --port 4178 --strictPort",
    url: "http://127.0.0.1:4178/index.html",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
