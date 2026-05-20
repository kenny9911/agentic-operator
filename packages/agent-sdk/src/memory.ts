/**
 * P3-RT-06 — Memory SDK surface.
 *
 * Agent authors see this as `ctx.memory`. The runtime constructs one
 * `MemoryHandle` per run with `(tenantId, agentName, subject, runId)`
 * pre-bound, so authors never have to thread those through manually:
 *
 *   await ctx.memory.put("plan", { step: 2 }, "run");      // scratch
 *   await ctx.memory.put("preferences", { tz: "PST" }, "subject");
 *   const prefs = await ctx.memory.get("preferences", "subject");
 *
 * Scopes:
 *   - "run"     — agent_memory_short. Evicted when the run finalizes.
 *   - "subject" — agent_memory_long, keyed by (tenant, agent, subject).
 *                 Persists across runs for the same subject.
 *   - "tenant"  — agent_memory_long with empty-string subject; persists
 *                 across runs + subjects within the tenant.
 *
 * The vector `search()` method routes to the optional `MemoryDriver` and
 * throws `NoMemoryDriverError` when none is configured (v1 default).
 */

import type { MemoryDriver, MemoryHit } from "./memory-driver";

export type MemoryScope = "run" | "subject" | "tenant";

export interface MemoryHandle {
  /** Read a value by key + scope. Returns null when missing. */
  get<T = unknown>(key: string, scope?: MemoryScope): Promise<T | null>;

  /** Write a JSON-serialisable value. Upsert semantics. */
  put<T = unknown>(key: string, value: T, scope?: MemoryScope): Promise<void>;

  /** Delete a key from a scope. No-op when missing. */
  delete(key: string, scope?: MemoryScope): Promise<void>;

  /**
   * Vector search across the bound scope. Throws `NoMemoryDriverError` when
   * no driver is configured (v1 default; v2 plugs SQLite-VSS / pgvector /
   * Qdrant). The signature is stable so authors can write
   * `ctx.memory.search(q, 5)` today and pick up real impl later.
   */
  search(query: string, k: number): Promise<MemoryHit[]>;
}

/**
 * What the runtime needs to build a `MemoryHandle` for a run. Spelled out
 * here so adapter packages don't have to depend on @agentic/db just to
 * import the type.
 */
export interface MemoryBinding {
  tenantId: string;
  agentName: string;
  /** Defaults to empty-string when the run isn't subject-scoped. */
  subject: string;
  /** Required for "run" scope. */
  runId: string;
}

/** The optional vector driver, registered globally per process. */
export type MemoryDriverRef = MemoryDriver | null;
