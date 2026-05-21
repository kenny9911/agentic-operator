# Tech Design — Inngest Durability

**Module ID:** AR-INN
**Owner:** AI Software Architect
**Status:** V1.1 design
**Source catalog:** `docs/catalog/02-ai-runtime-catalog.md` § 3 (AR-INN-01..05)

## 1. Purpose

Inngest is the **durability substrate** for every async run — code agents enqueued via `?async=1` (V2-reserved) and every manifest agent invocation. The framework guarantees at-least-once delivery and replay-with-memoization of `step.run()` blocks. The contract for using it correctly is captured at `packages/runtime/src/register.ts:165-280`, and is the single most-reviewed code path in the runtime. This module also covers the Option-B sync→async fallback in the agent-invoke route (`AR-INN-05`), the daily retention cron, and the HITL `step.waitForEvent` pattern that lets manifest agents pause for human action.

## 2. V1 state (citable)

- **`step.run` contract** (AR-INN-01) — every DB write lives inside `step.run("name", async () => {...})`. Inngest replays the handler on every retry; outside `step.run()`, code re-runs on each replay (would produce duplicate rows). Inside `step.run()` the result is memoized — runs exactly once per actual execution. The handler at `packages/runtime/src/register.ts:104-499` has `step.run` blocks for init (line 122-170 — allocate `runId` + `correlationId` + insert `runs` row), one per action (line 316-382 — insert `steps` row + execute), and finalize (line 402-448 — close `runs` row + emit triggered event). `step.sendEvent()` (line 454-462) is the only idempotent way to emit downstream events.
- **Concurrency keying** (AR-INN-02) — `register.ts:86-103` sets `concurrency: { limit, key: "${tenantSlug}:" + event.data.subject }`. Tenant prefix (P5-TEN-01) prevents cross-tenant slot starvation. The cap honors `agent.concurrency.max_concurrent_executions` from the manifest; default 8.
- **HITL pattern** (AR-INN-03) — `register.ts:199-313` implements `manual` actions: (1) `step.run("init-task-${ord}")` inserts `steps` row + `tasks` row, (2) `step.waitForEvent("wait-task-${ord}", { event: "task.resolved", if: 'async.data.taskId == "<id>" && async.data.tenantId == "<tenantId>"', timeout: "7d" })`, (3) `step.run("close-task-${ord}")` updates both rows. The resolution endpoint `POST /v1/tasks/:id/resolve` (`apps/api/src/routes/v1/tasks.ts`) emits `task.resolved` with `taskId` + `tenantId` so a leaked taskId across tenants cannot resume the wrong run. Timeout is currently hard-coded to `"7d"` (`register.ts:249`); `action.task_timeout_s` schema field exists (P0-RT-10) but isn't yet read.
- **Retention cron** (AR-INN-04) — `packages/runtime/src/retention.ts` runs once per day via Inngest cron `0 3 * * *`. (1) Purges `data/logs/<tenant>/runs/<date>/*.log` older than `LOG_RETENTION_DAYS` (default 30). (2) Purges `data/logs/<tenant>/events/<date>.ndjson` older than `EVENT_RETENTION_DAYS` (default 90). (3) Emits `agentic_agents_total{state}` gauges. Log rotation per-file at 64 MB lives in `packages/runtime/src/log-rotate.ts`.
- **Option-B fallback** (AR-INN-05) — `apps/api/src/routes/v1/agent-invoke.ts:74-165`. When `agentRegistry.get(name)` returns undefined, the route looks up the manifest agent's first declared trigger via `findManifestAgentTrigger()` (`apps/api/src/queries/agents.ts`), computes a subject from `body.input.{subject,candidate_id,job_requisition_id}` or fabricates `TEST-${eventId.slice(4,12)}`, stamps `__triggerEventId/__correlationId/__invokedAgent/__test`, then `inngest.send()`. Returns 202 `{ kind: "manifest", status: "queued", eventId, eventName, subject, correlationId, note }`.

## 3. V1.1 changes

### UC-V11-22 / AR-GAP-07 — Bump `runs_total` counter from manifest engine
**Site:** `packages/runtime/src/register.ts:402-448` (the `finalize` step.run block) and `apps/api/src/services/metrics.ts:103-208` (the counter definition).
**Bug:** `runs_total{tenant,agent,model,status}` is incremented by the code-agent run engine (`packages/agents/src/run-engine.ts`'s close path) but **not** by the manifest engine's `finalize` block. Result: the metrics scrape shows 0 runs for the RAAS workflow even when runs are happening. The operator dashboard's runtime panel reads from this counter.
**Fix:** Inside the existing `step.run("finalize", async () => {...})` (`register.ts:402-448`), after the `runs` UPDATE succeeds, call `metrics.runs.inc({ tenant: tenantSlug, agent: agent.name, model: "mock-model-v1", status: "ok" })`. Wrap the call in a `try/catch` that logs but does not throw — metric emission must never break a successful run. For the `failRun()` path (`register.ts:478-497`), also increment with `status: "failed"` after the runs row update.
**Important durability note:** the `metrics.runs.inc()` call lives **inside** `step.run()` so Inngest memoization makes the increment exactly-once even across replays. Putting it outside `step.run()` would double-count on every retry — this is the same discipline that prevents duplicate rows.
**New types:** None.
**Migration:** None.
**Tests:** `tc-runs-total-manifest.test.ts` (new) — boot a tenant, fire a trigger event, assert (a) `runs_total{agent="testManifestAgent",status="ok"}` is exactly 1 after one successful run, (b) is exactly 0 after one failure path, (c) is exactly 1 (not 2) after a forced Inngest replay of the same event. Existing `tc-metrics.test.ts` covers the counter exposition shape.

### UC-V11-35 / PF-GAP-15 / AR-GAP-15 — `failRun` race window
**Site:** `packages/runtime/src/register.ts:478-497` (the `failRun` helper closure).
**Bug:** `failRun()` writes the `runs` UPDATE **outside** any `step.run()` block. On any error path inside the handler, the runs UPDATE happens, then the code `throw`s, then Inngest retries the entire handler. On retry, the init `step.run("init")` is memoized, but `failRun` runs again — it writes a second UPDATE that re-sets `status="failed"` and `ended_at` to a new timestamp. Worse, if the retry then succeeds (replays past the failure point with a memoized step result), the finalize step writes `status="ok"`, overwriting the prior `status="failed"`. The race is narrow (transient errors that succeed on retry) but real.
**Fix:** Move the `runs` UPDATE inside a dedicated `step.run("finalize-failed", ...)` block. Pattern:
```ts
await step.run(`finalize-failed-${runId}`, async () => {
  const ended = new Date();
  db.update(runs).set({...failed-fields...}).where(eq(runs.id, runId)).run();
});
await writeRunLog(logCtx, "ERROR", "run.end", { status: "failed", error: message });
throw new Error(message);  // re-throw so Inngest does not mark the function "ok"
```
The `step.run` ensures the UPDATE is exactly-once. The `throw` after is the existing pattern — Inngest distinguishes "the handler threw" from "the handler returned a value." The `writeRunLog` is intentionally outside the `step.run` because the log writer is append-only and idempotent (`O_APPEND` + replay-safe — multiple log lines for the same run.end with status=failed are acceptable; they just look like retries in the log).
**New types:** None.
**Migration:** None.
**Tests:** `tc-fail-run-race.test.ts` (new) — handler that throws a transient error on first call, succeeds on second call (via an external retry-counter); assert the final `runs.status` is `"ok"`, not `"failed"`. Existing `tc-1-manifest-happy.test.ts` and `tc-9-condition-false.test.ts` (skipped status assertion) still pass.

### Adjacent V1.1 housekeeping (not in UC backlog but coupled)
- **Honor `action.task_timeout_s`.** `register.ts:249` currently hard-codes `timeout: "7d"`. Read `action.task_timeout_s` (P0-RT-10 added the schema field); fall back to `7d` when missing or non-positive. This unblocks operators who want shorter SLAs for HITL tasks.
- **Surface `subject` in Inngest event payload for code agents.** Today the `?async=1` path is V2-reserved (`AR-GAP-08`), but the registered code-agent function exists at `packages/agents/src/code-agent-fn.ts`. When V1.1 wires the queue (if scope expands), surface the subject in the payload so concurrency-keying-by-subject works there too.

## 4. Interfaces (the contract)

**Inngest function shape (register.ts:86-103):**
```ts
inngest.createFunction({
  id: `${tenantSlug}.${agentName}`,
  name: agent.title ?? agent.name,
  concurrency: {
    limit: agent.concurrency?.max_concurrent_executions ?? 8,
    key: `"${tenantSlug}:" + event.data.subject`,
  },
  retries: 3,
  triggers: agent.trigger.map(t => ({ event: `${tenantSlug}/${t}` })),
}, handler);
```

**HITL contract:**
- Event the handler waits on: `"task.resolved"`.
- Match condition: `async.data.taskId == "<id>" && async.data.tenantId == "<tenantId>"`.
- Timeout: derived from `action.task_timeout_s` (V1.1) or `"7d"` default.
- Resolution endpoint payload (`POST /v1/tasks/:id/resolve` body): `{ decision: "approve"|"reject", payload?: unknown }`. The route emits `inngest.send({ name: "task.resolved", data: { taskId, tenantId, decision, payload } })`.

**Option-B fallback response (202):**
```ts
{
  ok: true,
  data: {
    kind: "manifest",
    status: "queued",
    runId: null,                  // pre-allocation gap — see AR-GAP-08
    eventId: "evt-...",
    eventName: "raas/REQUIREMENT_LOGGED",
    subject: "REQ-2041" | "TEST-AB12CD34",
    correlationId: "cor-...",
    note: "Manifest agent invoked via Option B (event emit). Poll /v1/runs?correlationId=... for the run row."
  }
}
```

**Cron schedule (Inngest):** `0 3 * * *` for retention (`packages/runtime/src/retention.ts`); `*/5 * * * *` for the scheduled-sync poller (`packages/runtime/src/scheduler.ts`).

## 5. Data flow

```
trigger event arrives on Inngest bus
   |
   v
inngest.createFunction handler fires
   |
   v
step.run("init")  --memoized--> runId, correlationId, runs row inserted
   |
   v
for each action[ord]:
   |
   +-- action.type === "manual"
   |     step.run("init-task-${ord}")     --memoized--> steps row + tasks row
   |     step.waitForEvent("wait-task-${ord}", { if: taskId+tenantId match })
   |          |
   |          +-- (resolved within timeout)
   |          |     step.run("close-task-${ord}")  --memoized--> close steps + tasks rows
   |          |
   |          +-- (timeout fires)
   |                step.run("timeout-task-${ord}")
   |                failRun() -> step.run("finalize-failed", ...)  (V1.1)
   |                throw -> Inngest marks function failed
   |
   +-- action.type === "tool" or "logic"
         step.run(action.name)  --memoized--> steps row + runAction()
         on error: step.run("finalize-failed", ...) (V1.1) + throw
         on success: continue loop
   |
   v
step.run("finalize")  --memoized-->  runs UPDATE (status=ok) + emit event + metrics.runs.inc() (V1.1)
   |
   v
step.sendEvent(`emit.${emittedName}`, { name: `${tenantSlug}/${emittedName}`, data: ... })
   |
   v
downstream agent's handler picks it up via its trigger[] subscription
```

## 6. Failure modes

| Failure | What happens | Recovery |
|---|---|---|
| Handler throws inside a `step.run` body | Inngest retries (up to 3 times). The `step.run` did NOT memoize because the function threw, so the inner code re-runs on retry | Eventually retried successfully OR retried 3× then marked failed |
| `step.waitForEvent` times out | The wait returns `null`. The `register.ts:252-269` block updates step/task rows to failed/snoozed, calls `failRun`, throws | Operator sees `tasks.status='snoozed'` in the UI; can re-emit the trigger manually |
| Inngest dev server is down | New events go to a local queue; existing handlers still complete | `pnpm dev` boots `inngest dev :8288`; on missing server, `inngest.send` silently no-ops in tests |
| Concurrency cap reached | Inngest queues the incoming event until a slot frees | Bounded by per-`(tenant, subject)` slot; operator can raise via manifest's `concurrency.max_concurrent_executions` |
| Replay produces duplicate side effects | `step.sendEvent` memoizes the send; DB writes inside `step.run` memoize. Side effects **outside** `step.run` (e.g. metric emission today for manifest path) double-count | V1.1 fix: move metric emit inside `step.run` (UC-V11-22) |
| `failRun` race with retry-success | Without V1.1 fix: final `runs.status` can be wrong | V1.1 fix: wrap `failRun` body in `step.run("finalize-failed", ...)` (UC-V11-35) |

## 7. V2 roadmap

- **UC-V2-11 / AR-GAP-08** — Wire async invoke via Inngest for `POST /v1/agents/:name/invoke?async=1`. Today returns 501. Needs API-side queue tracking and run-row pre-creation alignment (the pre-allocated `run-…` id should be threaded into `executeAgentRun` so the eventual run row uses it).
- **UC-V2-16 / AR-GAP-17** — Collapse the two run engines (`packages/agents/src/run-engine.ts` + `packages/runtime/src/register.ts`) so HITL works in code agents too. Today only manifest agents can `step.waitForEvent`.
- **Native scheduled cron triggers per manifest.** Today `packages/runtime/src/scheduler.ts` polls a single cron and emits `SCHEDULED_SYNC` for any agent that subscribes. V2 should let manifest authors declare `"cron": "0 */6 * * *"` directly on an agent and have Inngest's native cron trigger fire it.

## 8. Acceptance tests

- `tc-runs-total-manifest.test.ts` — UC-V11-22 counter increments exactly-once per run.
- `tc-fail-run-race.test.ts` — UC-V11-35 race window closed.
- `tc-task-timeout-honor.test.ts` (new) — `action.task_timeout_s` honored.
- `tc-1-manifest-happy.test.ts` (existing) — happy-path manifest run with `step.run`+`step.sendEvent` discipline.
- `tc-5-hitl-approve.test.ts` (existing) — HITL approve, run completes ok.
- `tc-5b-hitl-reject.test.ts` (existing) — HITL reject, run.status=failed.
- `tc-12-manual-task-timeout.test.ts` (existing) — HITL timeout triggers failRun.
- `tc-14-replay-idempotent.test.ts` (existing) — Inngest replay produces no duplicate rows.
- `tc-17-async-code-agent-enqueue.test.ts` (existing) — `?async=1` path (V2-reserved 501 today; the test asserts the 501 + the hint message).
- `tc-21-operator-publish-manifest.test.ts` (existing) — Option-B fallback materializes the run with subject + correlationId propagated.
- `tc-retention.test.ts` (existing) — cron purges files older than cutoff.

Coverage gates: every UC-V11-* listed has a paired failing-then-passing test per the TDD mandate in `docs/USE_CASES.md` § 6.
