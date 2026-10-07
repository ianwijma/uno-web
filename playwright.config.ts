import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  timeout: 60000,
  fullyParallel: false,
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    ...(process.env.UNO_TEST_ONLINE && process.env.HTTPS_PROXY
      ? {
          proxy: {
            server: process.env.HTTPS_PROXY,
            bypass: "localhost,127.0.0.1",
          },
        }
      : {}),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: process.env.UNO_TEST_STATIC
      ? "npm run preview -- --listen 3000"
      : "npm run dev -- --hostname 0.0.0.0",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
