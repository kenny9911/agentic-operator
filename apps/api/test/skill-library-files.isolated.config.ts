import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["test/skill-library-files.unit.test.ts"],
    pool: "forks",
    sequence: { concurrent: false },
    testTimeout: 15_000,
  },
});
