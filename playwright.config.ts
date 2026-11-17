import { defineConfig } from "@playwright/test";

// Runs against a production build. Needs a migrated and seeded database (npm run db:migrate && npm run db:seed).
// Set PW_CHANNEL=chrome to use an installed Chrome instead of Playwright's downloaded Chromium.
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3100",
    channel: process.env.PW_CHANNEL || undefined,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run start -- --port 3100",
    url: "http://localhost:3100/login",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // The assistant uses a scripted stand-in for Claude in tests, so no API key or spending is needed.
    env: { ASSISTANT_FAKE: "1" },
  },
});
