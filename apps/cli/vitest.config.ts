import { defineConfig } from "vitest/config";

/**
 * Vitest config for the CLI workspace.
 *
 * Coverage gate (P4-TEST-07): lines >= 70%, branches >= 60%.
 * The CLI surface is small and unit-test-friendly — `commands/*.ts`
 * accept stdin/stdout/stderr through ctx so every code path is reachable
 * without spawning a subprocess.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globals: true,
    environment: "node",
    testTimeout: 15_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      include: ["src/**"],
      exclude: ["**/*.d.ts", "**/*.test.*", "scripts/**"],
      thresholds: {
        lines: 70,
        branches: 60,
        functions: 60,
        statements: 70,
      },
    },
  },
});
