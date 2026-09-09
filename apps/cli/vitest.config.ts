import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const sdkRoot = path.resolve(here, "..", "..", "packages", "agent-sdk");

/**
 * Vitest config for the CLI workspace.
 *
 * Coverage gate (P4-TEST-07): lines >= 70%, branches >= 60%.
 * The CLI surface is small and unit-test-friendly — `commands/*.ts`
 * accept stdin/stdout/stderr through ctx so every code path is reachable
 * without spawning a subprocess.
 */
export default defineConfig({
  // `agentic init` scaffolds a tenant package OUTSIDE this workspace, whose
  // files import "@agentic/agent-sdk" and "zod". scaffold-runtime-contract
  // imports those generated files to check them against the REAL SDK — from a
  // tmp dir, where neither specifier resolves. Point both at the workspace
  // copies so the test executes the scaffold instead of asserting on its text.
  resolve: {
    alias: {
      "@agentic/agent-sdk": path.join(sdkRoot, "src", "index.ts"),
      zod: path.join(sdkRoot, "node_modules", "zod"),
    },
  },
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
