import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globals: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ["./test/setup.ts"],
    pool: "forks", // ensures the better-sqlite3 binding isn't shared across worker threads
    sequence: { concurrent: false }, // tests use the same SQLite — serialize to avoid lock contention
    // `sequence.concurrent: false` only serializes within a worker. Without
    // `singleFork: true`, vitest spawns one worker per test file and they
    // race for SQLite's exclusive writer lock — the manifest-import commit
    // tx is heavy enough that two parallel runs trip SQLITE_BUSY (5 s
    // timeout) before either finishes. Pin to one worker.
    poolOptions: { forks: { singleFork: true } },
    // Pin `AGENTIC_MODELS_DIR` to the repo-root `models/` so tests that read
    // the RAAS-v1 fixtures (TC-11, TC-33, …) don't depend on the developer
    // setting it in the shell. Setting via `env` makes it visible to test
    // code at module-top-level — `setup.ts` runs after import resolution,
    // which is too late for tests that read the env in a top-level const.
    env: {
      AGENTIC_MODELS_DIR: path.join(REPO_ROOT, "models"),
    },
  },
});
