import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["test/workflow-skill-evidence.unit.test.ts"],
    pool: "forks",
  },
});
