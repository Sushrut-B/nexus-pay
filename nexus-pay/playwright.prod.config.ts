import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import baseConfig from "./playwright.config";

const projectRoot = import.meta.dirname;

/** Production-mode E2E: no Fast Refresh/HMR, deterministic navigation. */
export default defineConfig({
  ...baseConfig,
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 30_000 },
  retries: 0,
  reporter: [["list"]],
  use: {
    ...baseConfig.use,
    baseURL: "http://localhost:3000",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: "npx next start --port 3000",
    cwd: path.resolve(projectRoot, "apps/web"),
    url: "http://localhost:3000",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      E2E_TEST_MODE: "1",
      RATE_LIMIT_TEST_MULTIPLIER: "50",
    } as Record<string, string>,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
