import { defineConfig } from "vitest/config";
import path from "node:path";

const projectRoot = import.meta.dirname;

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    exclude: ["**/node_modules/**", "tests/e2e/**"],
    reporters: ["default"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(projectRoot, "apps/web"),
    },
  },
});
