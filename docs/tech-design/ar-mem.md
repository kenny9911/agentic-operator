# Tech Design — Memory & State

**Module ID:** AR-MEM
**Owner:** AI Software Architect
**Status:** V1.1 design
**Source catalog:** `docs/catalog/02-ai-runtime-catalog.md` § 4 (AR-MEM-01..05)

## 1. Purpose

Memory is the **state surface** for agents — the place an agent stashes anything that must outlive a single LLM turn. V1 ships the **contract end-to-end at the SDK level** (`MemoryHandle.{get,put,delete,search}`) but only the K/V backend at the runtime level. The vector-search method is reserved: it exists, returns a clear `NoMemoryDriverError`, and is the seam where V2's pgvector / SQLite-VSS / Qdrant driver plugs in. Two tables (`agent_memory_short`, `agent_memory_long`) and three scopes (`run`, `subject`, `tenant`) cover every state pattern V1 needs — most importantly the "per-candidate state across the RAAS workflow" pattern that keeps a single `subject=candidate_id` row consistent across 17 downstream agents.

## 2. V1 state (citable)

- **Short-term memory** (AR-MEM-01) — `agent_memory_short` table (`packages/db/src/schema.ts`). Keyed by `(run_id, key)`, carries `value_json` blob + `updated_at`. `ON DELETE CASCADE` against `runs.id` so deleting a run row cleans its memory. The run engine also calls `clearRunMemory(runId)` on finalize (`packages/runtime/src/memory.ts:175-184`) so the run-scope behaves like a true scratchpad even when the run row sticks around (which it always does — runs are soft-deleted, not hard-deleted).
- **Long-term memory** (AR-MEM-02) — `agent_memory_long` table. Keyed by `(tenant_id, agent_name, subject, key)` with `value_json` + `updated_at`. The composite key means the same `subject` (e.g., a candidate id) sees the same memory across every run for that agent, *and* every agent sees its own slice. Storage is a drizzle `onConflictDoUpdate` upsert (`packages/runtime/src/memory.ts:114-132`). No TTL, no compaction, no row count cap in V1.
- **Scopes** (AR-MEM-03) — `MemoryScope = "run" | "subject" | "tenant"` discriminator (`packages/agent-sdk/src/memory.ts:25`):
  - `run` → `agent_memory_short` keyed by `(run_id, key)`. Only the agent that owns the run can read/write; cascade-deleted with the run; swept on finalize.
  - `subject` → `agent_memory_long` keyed by `(tenant_id, agent_name, subject, key)`. Cross-agent reads require same `agent_name`, so namespace is implicitly agent-private within tenant.
  - `tenant` → `agent_memory_long` with empty-string subject (`TENANT_SCOPE_SUBJECT = ""` in `memory.ts:33`). Keyed by `(tenant_id, agent_name, "", key)`.
- **`MemoryHandle` API** (AR-MEM-04) — four methods on `packages/agent-sdk/src/memory.ts:27-44`:
  ```ts
  get<T>(key, scope?: MemoryScope): Promise<T | null>     // default scope = "subject"
  put<T>(key, value, scope?: MemoryScope): Promise<void>
  delete(key, scope?: MemoryScope): Promise<void>
  search(query: string, k: number): Promise<MemoryHit[]>  // throws NoMemoryDriverError in V1
  ```
  The handle is built by `createMemoryHandle({ tenantId, agentName, subject, runId })` in `packages/runtime/src/memory.ts:55-167` and passed into both `BaseAgent.run()`'s `AgentContext.memory` and the manifest step engine's `ToolContext.memory`.
- **Subject identity** (AR-MEM-05) — never auto-assigned. Caller responsibility: either stamp `event.data.subject` on the trigger event (standard path; concurrency keying in AR-INN-02 keys on this field) or pass `body.input.subject` to `POST /v1/agents/:name/invoke`. For RAAS, `subject = candidate_id` after `resumeCollection` (`AR-RAAS-08`); before that, `subject = job_requisition_id`. The `correlation_id` is distinct — it's the cross-run trace id, propagated through `__correlationId`.

## 3. V1.1 changes

The V1 memory surface ships cleanly — no use cases in the UC-V11-* backlog directly target it (vector-search is UC-V2-14, V2-reserved). The V1.1 changes here are **clarifications and tightening** discovered during catalog work that need a documented contract before V1.1 lands, so consumer code doesn't accidentally rely on undefined behavior.

### Scopes precedence rule for write-then-read
**Site:** `packages/agent-sdk/src/memory.ts` (default-scope behavior) and `packages/runtime/src/memory.ts:55-167` (handle implementation).
**Issue (latent, not a UC entry):** The default scope on `get`/`put`/`delete` is `"subject"` per the doc-string at `memory.ts:29-35`. This is **load-bearing** — an agent that calls `ctx.memory.put("foo", 1)` is writing to `agent_memory_long(tenant, agent, subject, "foo")`, not the run scratchpad. If a developer reads the SDK signature without the comment they may assume defaults are run-scoped. Worse: if `subject` is empty string at run start (because the trigger event omitted it), the write lands in the `tenant` scope row by accident.
**Fix:**
- **Explicit default in code (V1.1):** Make the default scope a named export, `MEMORY_DEFAULT_SCOPE: MemoryScope = "subject"`, in `packages/agent-sdk/src/memory.ts`. Document the choice with a comment block tying it to RAAS (the candidate-centric workflow that motivated this default).
- **Empty-subject guard rail:** In `createMemoryHandle()` (`packages/runtime/src/memory.ts:55-167`), when `binding.subject === ""` AND `scope === "subject"`, throw `MemoryScopeError("write to subject scope requires a non-empty subject — use scope:'tenant' explicitly or stamp event.data.subject")` rather than silently falling through to the tenant row. The tenant row is still reachable by explicit `scope:"tenant"`.
- **Write-then-read consistency:** Document that a `put(k, v, scope)` followed immediately by `get(k, scope)` in the same run sees the written value. This holds today because better-sqlite3 is synchronous and the run engine's event loop sees a single connection — but is not stated anywhere. Add to the SDK doc-string.

**New types:**
```ts
// packages/agent-sdk/src/memory.ts
export const MEMORY_DEFAULT_SCOPE: MemoryScope = "subject";
export class MemoryScopeError extends Error {
  override readonly name = "MemoryScopeError";
  constructor(message: string) { super(message); }
}
```

**Migration:** None at DB level.

**Tests:** `tc-memory-empty-subject-guard.test.ts` (new) — handle with `subject=""`, call `put("k", "v")` without scope → assert throws `MemoryScopeError`. `put("k", "v", "tenant")` → assert succeeds. `tc-memory-write-then-read.test.ts` (new) — `put("k", 1, "subject")` then `get("k", "subject")` in same run → returns 1.

### Scope-write audit emission
**Site:** `packages/runtime/src/memory.ts:114-132` (upsert path).
**Issue:** Memory writes are not currently surfaced in the audit log. For RAAS, the operator often wants to know "when did agent X write `client_rules_passed` to candidate Y" — today the only way is to read the run logs. This is fine for V1, but V1.1 surfaces "memory-keys-by-agent" in the agent detail view (PD-D-12 — not yet implemented), which needs an audit emission.
**Fix:** After every `put()` and `delete()`, append a single NDJSON log line to the run-log (NOT to the audit_log table — too noisy):
```
INFO  memory.write  scope=subject key=client_rules_passed agent=ruleCheckerForClientResume subject=CAND-7
INFO  memory.delete scope=run key=plan agent=ruleCheckerForClientResume run_id=run-AB12
```
The audit_log table remains for explicit operator actions (budget update, tenant create, etc.) — memory operations are too high-cardinality to live there.

**New types:** None.
**Migration:** None.
**Tests:** `tc-memory-log-emit.test.ts` — call `put`, assert NDJSON line in the run log contains `event="memory.write"` with correct fields.

### `MemoryDriver` boilerplate hardening
**Site:** `packages/agent-sdk/src/memory-driver.ts` and `packages/runtime/src/memory.ts:setMemoryDriver`.
**Issue:** Today `setMemoryDriver(driver)` accepts any object matching the interface (`search`, optional `index`). V2 drivers (pgvector / SQLite-VSS) will need a small bootstrap dance — the driver may need a connection pool, must accept a `MemoryDriverContext { tenantId, dataDir }` at registration time. The SDK contract should make this discoverable without locking us in.
**Fix (V1.1, contract-only — no impl change):** Extend `MemoryDriver` to `MemoryDriver | MemoryDriverFactory` where the factory shape is `(ctx: MemoryDriverContext) => MemoryDriver | Promise<MemoryDriver>`. The K/V path (V1) does not use this. Vector drivers (V2) can construct against a connection pool. This is a **forward-compatible signature change** — V1 callers continue to call `setMemoryDriver(impl)`.

**New types:**
```ts
export interface MemoryDriverContext {
  tenantId?: string;
  dataDir: string;
}
export type MemoryDriverFactory = (ctx: MemoryDriverContext) => MemoryDriver | Promise<MemoryDriver>;
export function setMemoryDriver(driver: MemoryDriver | MemoryDriverFactory): void;
```

**Migration:** None.
**Tests:** `tc-memory-driver-factory.test.ts` — register a factory that returns a stub driver; assert `ctx.memory.search()` dispatches correctly. Existing `tc-memory-search.test.ts` (no driver → `NoMemoryDriverError`) still passes.

## 4. Interfaces (the contract)

**Public SDK (`packages/agent-sdk/src/memory.ts`):**
```ts
export type MemoryScope = "run" | "subject" | "tenant";
export const MEMORY_DEFAULT_SCOPE: MemoryScope = "subject";        // V1.1
export class MemoryScopeError extends Error { ... }                // V1.1

export interface MemoryHandle {
  get<T = unknown>(key: string, scope?: MemoryScope): Promise<T | null>;
  put<T = unknown>(key: string, value: T, scope?: MemoryScope): Promise<void>;
  delete(key: string, scope?: MemoryScope): Promise<void>;
  search(query: string, k: number): Promise<MemoryHit[]>;
}

export interface MemoryBinding {
  tenantId: string;
  agentName: string;
  subject: string;       // empty string → tenant-scope sentinel
  runId: string;
}
```

**Driver interface (`packages/agent-sdk/src/memory-driver.ts`):**
```ts
export interface MemoryHit {
  key: string;
  value: unknown;
  score: number;
  scope: MemoryScope;
}
export interface MemoryDriver {
  search(query: string, k: number, binding: MemoryBinding): Promise<MemoryHit[]>;
  index?(key: string, value: unknown, binding: MemoryBinding): Promise<void>;
}
export type MemoryDriverFactory = (ctx: MemoryDriverContext) => MemoryDriver | Promise<MemoryDriver>;  // V1.1
```

**DB tables (`packages/db/src/schema.ts`):**
```
agent_memory_short:
  PK (run_id, key)
  value_json text NOT NULL
  updated_at timestamp_ms NOT NULL
  FK run_id -> runs.id ON DELETE CASCADE

agent_memory_long:
  PK (tenant_id, agent_name, subject, key)
  value_json text NOT NULL
  updated_at timestamp_ms NOT NULL
  index (tenant_id, agent_name) for the "list-all-keys-for-this-agent" query
```

**Runtime constructor (`packages/runtime/src/memory.ts:55-167`):**
```ts
export function createMemoryHandle(binding: MemoryBinding): MemoryHandle;
export function clearRunMemory(runId: string): void;     // called by run engine finalize
export function setMemoryDriver(driver: MemoryDriver | MemoryDriverFactory): void;  // V1.1 factory variant
```

## 5. Data flow

Write/read inside a single agent run:

```
agent code: ctx.memory.put("client_rules_passed", true, "subject")
                                |
                                v
  validate scope ≠ "subject" || binding.subject !== ""  (V1.1 guard)
                                |
                                v
  scope === "run"      ->  INSERT/UPDATE agent_memory_short(run_id, key, value_json)
  scope === "subject"  ->  INSERT/UPDATE agent_memory_long(tenant, agent, subject, key, value_json)
  scope === "tenant"   ->  INSERT/UPDATE agent_memory_long(tenant, agent, "", key, value_json)
                                |
                                v
  writeRunLog INFO memory.write scope=subject key=client_rules_passed (V1.1)


agent code: ctx.memory.get("client_rules_passed", "subject")
                                |
                                v
  SELECT value_json FROM <table-by-scope> WHERE <composite-key>
                                |
                                v
  parsed JSON returned to caller (null if missing)


run finalize (register.ts:402-448 or run-engine.ts):
   clearRunMemory(runId)  -> DELETE FROM agent_memory_short WHERE run_id = ?
   agent_memory_long is UNCHANGED — that's the durable surface


vector search (V2; today throws):
   ctx.memory.search(query, k)
        |
        v
   driver === null  ->  throw NoMemoryDriverError
   driver !== null  ->  driver.search(query, k, binding)
        |
        v
   MemoryHit[] returned
```

## 6. Failure modes

| Failure | What happens | Recovery |
|---|---|---|
| `put` with empty subject and `scope:"subject"` (V1.1) | Throws `MemoryScopeError` synchronously | Caller stamps subject or uses `scope:"tenant"` explicitly |
| `get` for missing key | Returns `null` | Caller falls back to default |
| Concurrent writes to same `(run_id, key)` | better-sqlite3 serializes writes; last writer wins (upsert) | None needed — writes inside `step.run` are memoized, so retries don't compete |
| `search` with no driver | Throws `NoMemoryDriverError("vector search not configured")` | Register driver via `setMemoryDriver()` (V2) |
| Run row deleted (soft-delete) | Memory rows survive (only hard delete cascades) | Operator restores via `runs.deleted_at = null`; memory rows still queryable |
| Agent renamed in manifest | Long-memory rows keyed by old name become orphans | V1.1 acceptable (no UI for it); V2 may add a rename migration helper |
| Subject collision across agents | Two agents sharing same subject have distinct rows because `agent_name` is in the key | None needed |
| Subject collision across tenants | `tenant_id` is in the key | None needed |

## 7. V2 roadmap

- **UC-V2-14 / AR-GAP-14** — Vector memory driver. The `MemoryHandle.search` contract exists; V2 plugs SQLite-VSS for self-host (BLOB column + `vss_search`), pgvector for cloud (matching `pgvector` extension migration), Qdrant as a plug-in (via the `MemoryDriverFactory` indirection from V1.1).
- **TTL + janitor cron.** Add a `ttl_ms` column to `agent_memory_long` and a daily janitor that drops rows past expiry. Today there's no compaction — long-running tenants accumulate rows.
- **Cross-agent shared-tenant scope.** Today two agents cannot share state directly — they have to write through a third agent or pick the same `agent_name` by convention. V2 ticket considers a `"shared"` scope keyed by `(tenant_id, "_shared", subject, key)`.
- **Per-key audit emission.** V1.1 writes a log line per memory op; V2 surfaces it in a "memory key audit" view at `/portal/[tenant]/agents/[id]/memory`.

## 8. Acceptance tests

- `tc-memory-empty-subject-guard.test.ts` — V1.1 guard rail.
- `tc-memory-write-then-read.test.ts` — same-run consistency.
- `tc-memory-log-emit.test.ts` — V1.1 audit emission.
- `tc-memory-driver-factory.test.ts` — V1.1 factory signature.
- `tc-memory.test.ts` (existing) — put/get/delete across all three scopes; tenant-scope sentinel.
- `tc-memory-search.test.ts` (existing) — `NoMemoryDriverError` shape when no driver registered.
- `tc-memory-cascade.test.ts` (new) — delete a run row, assert `agent_memory_short` rows for that runId are gone, `agent_memory_long` rows are not.
- `tc-memory-subject-isolation.test.ts` (new) — two subjects under same agent, assert reads don't bleed.

Coverage gates: the V1.1 changes here are smaller than the other modules and live entirely within the memory package. The existing `tc-memory.test.ts` exercises the K/V backend; the new tests cover the guard rail, audit emission, and the factory contract.
