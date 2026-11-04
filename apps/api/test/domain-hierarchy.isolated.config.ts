import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/domain-hierarchy.test.ts"],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 30_000,
    env: { AGENTIC_SQLITE_TEST_WRITER: "1", DATABASE_URL: "file::memory:" },
  },
});
