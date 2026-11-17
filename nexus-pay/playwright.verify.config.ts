import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import baseConfig from "./playwright.config";

const projectRoot = import.meta.dirname;

export default defineConfig({
  ...baseConfig,
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 30_000 },
  retries: 1,
  reporter: [["list"]],
  use: {
    ...baseConfig.use,
    baseURL: "http://localhost:3100",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: "npx next dev --port 3100",
    cwd: path.resolve(projectRoot, "apps/web"),
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
