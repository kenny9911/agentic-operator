import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["test/codeact-skills.docker.test.ts"],
    pool: "forks",
    sequence: { concurrent: false },
    testTimeout: 30000,
  },
});
