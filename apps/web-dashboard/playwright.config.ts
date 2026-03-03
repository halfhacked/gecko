import { defineConfig, devices } from "@playwright/test";

/**
 * L4: BDD E2E — Playwright browser tests for core user flows.
 *
 * Server runs on port 27028 with E2E_SKIP_AUTH=true so we bypass
 * Google OAuth. Tests drive a real Chromium browser.
 */
export default defineConfig({
  testDir: "./src/__tests__/bdd",
  outputDir: "./test-results",
  fullyParallel: false, // serial — pages share state (e.g. settings changes)
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: "http://localhost:27028",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "E2E_SKIP_AUTH=true bunx vinext dev --port 27028",
    port: 27028,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
    reuseExistingServer: !process.env.CI,
  },
});
