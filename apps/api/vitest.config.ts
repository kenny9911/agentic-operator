import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globals: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ["./test/setup.ts"],
    pool: "forks", // ensures the better-sqlite3 binding isn't shared across worker threads
    sequence: { concurrent: false }, // tests use the same SQLite — serialize to avoid lock contention
  },
});
