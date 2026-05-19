/**
 * vitest setup — runs once per worker before any test file.
 *
 * Forces test-friendly env defaults:
 *   - LLM_DEFAULT_PROVIDER=mock + LLM_DEFAULT_MODEL=mock-model-v1
 *   - AGENTIC_LOGS_DIR / AGENTIC_ARTIFACTS_DIR redirected to data/test-logs etc.
 *   - DATABASE_URL pointed at the main dev DB (test rows coexist with dev rows;
 *     each test asserts on its own runId so isolation is by record, not by file).
 *
 * Individual tests can override via env when needed (e.g. TC-1 forces
 * ANTHROPIC_API_KEY to flip its `hasKey` to true).
 */

import path from "node:path";

const repoRoot = path.resolve(__dirname, "../../..");

process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.AUTH_MODE = "dev";
process.env.AGENTIC_DEV_TENANT = "__system";
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "warn";

process.env.LLM_DEFAULT_PROVIDER = "mock";
process.env.LLM_DEFAULT_MODEL = "mock-model-v1";

// Redirect file artifacts away from the dev workspace so we can clean them up.
process.env.AGENTIC_LOGS_DIR = path.join(repoRoot, "data", "test-logs");
process.env.AGENTIC_ARTIFACTS_DIR = path.join(repoRoot, "data", "test-artifacts");

// Use the same DB that migrations have been applied to. Tests insert rows
// (mostly runs) and look them up by runId; they don't depend on row counts.
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? `file:${path.join(repoRoot, "data", "agentic.db")}`;
