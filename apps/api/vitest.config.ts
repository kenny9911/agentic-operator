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
    // `sequence.concurrent: false` only serializes within a worker. Without
    // `singleFork: true`, vitest spawns one worker per test file and they
    // race for SQLite's exclusive writer lock — the manifest-import commit
    // tx is heavy enough that two parallel runs trip SQLITE_BUSY (5 s
    // timeout) before either finishes. Pin to one worker.
    poolOptions: { forks: { singleFork: true } },
  },
});
