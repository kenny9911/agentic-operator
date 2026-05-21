/**
 * SQLite client with WAL mode + edge-runtime guard.
 *
 * Risk #2 from build plan: better-sqlite3 is a native module and CANNOT run
 * on Edge runtime. Any Next.js route that imports this file (directly or
 * transitively) must declare `export const runtime = 'nodejs'`.
 *
 * We enforce this with a runtime check — if anything imports this module in
 * an edge context we throw before any query runs, surfacing the mistake
 * loudly instead of producing a cryptic native-binding error.
 */

import path from "node:path";
import fs from "node:fs";
import Database, { type Database as DatabaseInstance } from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate as drizzleMigrate } from "drizzle-orm/better-sqlite3/migrator";
import { schema } from "./schema";

// Pre-resolve the .node file path. better-sqlite3's `bindings` loader walks
// the JS stack to find its native binding, which fails in webpack contexts
// where webpack-compiled frames have null fileNames. Passing `nativeBinding`
// skips `bindings` entirely (better-sqlite3 then uses __non_webpack_require__).
// Strategy: walk up from process.cwd() looking for node_modules; check both
// hoisted (node_modules/better-sqlite3) and pnpm (.pnpm/better-sqlite3@*) layouts.
function resolveNativeBinding(): string {
  // Allow override (production may install to a non-standard location).
  if (process.env.AGENTIC_SQLITE_BINDING)
    return process.env.AGENTIC_SQLITE_BINDING;

  let dir = process.cwd();
  while (true) {
    const nm = path.join(dir, "node_modules");
    // Hoisted layout
    const hoisted = path.join(
      nm,
      "better-sqlite3",
      "build",
      "Release",
      "better_sqlite3.node",
    );
    if (fs.existsSync(hoisted)) return hoisted;
    // pnpm layout
    const pnpm = path.join(nm, ".pnpm");
    if (fs.existsSync(pnpm)) {
      const candidates = fs.readdirSync(pnpm).filter((d) => d.startsWith("better-sqlite3@"));
      for (const c of candidates) {
        const p = path.join(
          pnpm,
          c,
          "node_modules",
          "better-sqlite3",
          "build",
          "Release",
          "better_sqlite3.node",
        );
        if (fs.existsSync(p)) return p;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // root
    dir = parent;
  }
  throw new Error(
    "[db/client] could not locate better_sqlite3.node — set AGENTIC_SQLITE_BINDING env",
  );
}

const NATIVE_BINDING_PATH = resolveNativeBinding();

export type DB = BetterSQLite3Database<typeof schema>;

let _db: DB | null = null;
let _sqlite: DatabaseInstance | null = null;

function assertNodeRuntime() {
  // Edge runtime exposes globals like `EdgeRuntime` or `__nccwpck_require__`.
  // Cheap, fast, runs only once per process.
  if (typeof (globalThis as { EdgeRuntime?: string }).EdgeRuntime === "string") {
    throw new Error(
      "@agentic/db cannot run in Edge runtime. Add " +
        "`export const runtime = 'nodejs'` to the importing route.",
    );
  }
}

function databasePath(): string {
  const env = process.env.DATABASE_URL;
  if (env) {
    return env.startsWith("file:") ? env.slice(5) : env;
  }
  // No env — walk up from cwd looking for the monorepo's data/agentic.db
  // (RF-1.5 convention) or the legacy packages/db/agentic.db location.
  let dir = process.cwd();
  const candidates = [
    ["data", "agentic.db"],
    ["packages", "db", "agentic.db"],
  ];
  while (true) {
    for (const segs of candidates) {
      const candidate = path.join(dir, ...segs);
      if (fs.existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "./agentic.db";
}

export function getDb(): DB {
  if (_db) return _db;
  assertNodeRuntime();

  const dbPath = databasePath();
  _sqlite = new Database(dbPath, { nativeBinding: NATIVE_BINDING_PATH });
  // WAL mode is the central correctness requirement — without it the first
  // writer holds an exclusive lock and other connections block.
  _sqlite.pragma("journal_mode = WAL");
  _sqlite.pragma("foreign_keys = ON");
  _sqlite.pragma("synchronous = NORMAL");
  _sqlite.pragma("busy_timeout = 5000");

  _db = drizzle(_sqlite, { schema });
  return _db;
}

/** For migrations / test teardown — closes the connection cleanly. */
export function closeDb() {
  _sqlite?.close();
  _sqlite = null;
  _db = null;
}

/** Direct SQLite handle — only for migration runner. Prefer getDb() in app code. */
export function getRawSqlite(): DatabaseInstance {
  if (!_sqlite) getDb();
  return _sqlite!;
}

/**
 * Apply drizzle migrations from the given folder against the singleton DB.
 *
 * Used by tests that bootstrap the DB without going through the full api boot
 * sequence (tc-16, tc-17, tc-30). Production code applies migrations via the
 * dedicated `pnpm db:migrate` script (`migrate.ts`); this helper just exposes
 * the same operation as a callable function for in-process callers.
 *
 * Idempotent: drizzle's migrator tracks applied migrations in
 * `__drizzle_migrations` so re-running is a no-op.
 */
export function runMigrations(migrationsFolder: string): void {
  drizzleMigrate(getDb(), { migrationsFolder });
}
