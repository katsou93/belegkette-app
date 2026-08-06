import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], testTimeout: 60_000, hookTimeout: 120_000, pool: "forks" },
  resolve: { alias: { "@": new URL(".", import.meta.url).pathname } },
});
