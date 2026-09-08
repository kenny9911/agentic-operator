import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["test/codex-skill-runtime.unit.test.ts"],
    pool: "forks",
    sequence: { concurrent: false },
    testTimeout: 30000,
  },
});
