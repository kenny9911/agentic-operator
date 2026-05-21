/**
 * vitest setup — runs once per worker before any test file.
 *
 * Forces test-friendly env defaults:
 *   - LLM_DEFAULT_PROVIDER=mock + LLM_DEFAULT_MODEL=mock-model-v1
 *   - AGENTIC_LOGS_DIR / AGENTIC_ARTIFACTS_DIR redirected to data/test-logs etc.
 *   - DATABASE_URL pointed at the main dev DB (test rows coexist with dev rows;
 *     each test asserts on its own runId so isolation is by record, not by file).
 *
 * Also drains accumulated test-tenant residue. The 2026-05-20 QA found 286
 * test-residue rows in `tenants` from suites that never cleaned up (the
 * sidebar was unusable once the production switcher was wired). Each well-
 * known prefix corresponds to a suite; budget-* / evt-tester-* / etc. are
 * deleted on setup so the dev DB stays browsable. We never touch real
 * tenants — `raas`, `__system`, `support`, `finance` are explicitly
 * preserved (and the prefix list makes incidental matches impossible).
 *
 * Individual tests can override via env when needed (e.g. TC-1 forces
 * ANTHROPIC_API_KEY to flip its `hasKey` to true).
 */

import path from "node:path";
import { existsSync } from "node:fs";
import { getRawSqlite, closeDb } from "@agentic/db";
// @agentic/db reads `DATABASE_URL` lazily inside `getDb()` — the env
// vars below are set before we invoke `getRawSqlite`, so the import
// itself is safe.

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
const dbPath = path.join(repoRoot, "data", "agentic.db");
process.env.DATABASE_URL = process.env.DATABASE_URL ?? `file:${dbPath}`;

// One-time test-tenant residue sweep. Runs synchronously at setup time so
// the first test suite's `beforeAll` sees a drained tenants table — the
// QA at 2026-05-20 found 286 residue rows that made the sidebar switcher
// unusable. Skip if the dev DB hasn't been migrated yet so first-time
// contributors see the migration error instead of a swallow.
function dropTestTenantResidue(): void {
  if (!existsSync(dbPath)) return;
  // Suite-prefixed slugs we know are residue. The compound `NOT IN`
  // safety-pins the four real slugs even if a future suite reuses one.
  const prefixes = [
    "budget-",
    "aud-",
    "webhook-tenant-",
    "mem-",
    "evt-tester",
    "mi-",
    "micommit",
    "miconc",
    "miconf",
    "miog",
    "qa-probe-",
  ];
  try {
    const sqlite = getRawSqlite();
    try {
      const orClauses = prefixes.map(() => "slug LIKE ?").join(" OR ");
      const params = prefixes.map((p) => `${p}%`);
      // Foreign keys are ON DELETE CASCADE across the schema, so deleting
      // the tenant row also drains memberships / api_tokens / runs / etc.
      // The NOT IN clause pins the four real slugs.
      sqlite
        .prepare(
          `DELETE FROM tenants WHERE (${orClauses}) AND slug NOT IN ('raas', '__system', 'support', 'finance')`,
        )
        .run(...params);
    } finally {
      // Close so the test suites' first getDb() builds a fresh handle —
      // avoids stale-cache surprises between worker startup and the
      // first beforeAll. (Re-open is cheap with WAL.)
      closeDb();
    }
  } catch {
    // Best-effort: if the schema isn't ready yet, leave residue and let
    // tests fail with a clearer error than a setup crash.
  }
}

dropTestTenantResidue();
