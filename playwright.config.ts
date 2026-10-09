import { defineConfig, devices } from "@playwright/test";

const TEST_PORT = 3001;
const TEST_BASE_URL = `http://localhost:${TEST_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL: TEST_BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "msedge",
      use: {
        ...devices["Desktop Chrome"],
        channel: "msedge",
      },
    },
  ],
  webServer: {
    command: `npx.cmd next start -p ${TEST_PORT}`,
    url: TEST_BASE_URL,
    reuseExistingServer: false,
    timeout: 120 * 1000,
    env: {
      DEV_MOCK_AUTH: "false",
      PORT: `${TEST_PORT}`,
    },
  },
});
