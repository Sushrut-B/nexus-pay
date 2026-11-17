import { defineConfig } from "vitest/config";
import path from "node:path";

const projectRoot = import.meta.dirname;

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "packages/**/tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "tests/integration/**", "tests/e2e/**"],
    reporters: ["default"],
    testTimeout: 15_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(projectRoot, "apps/web"),
    },
  },
});
