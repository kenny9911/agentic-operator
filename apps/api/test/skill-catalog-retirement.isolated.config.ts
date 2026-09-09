import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/skill-catalog-retirement.unit.test.ts"],
    pool: "forks",
    sequence: { concurrent: false },
    testTimeout: 15_000,
  },
});
