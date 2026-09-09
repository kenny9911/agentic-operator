import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/db-skills-migrations.test.ts"],
    pool: "forks",
    sequence: { concurrent: false },
    testTimeout: 60_000,
  },
});
