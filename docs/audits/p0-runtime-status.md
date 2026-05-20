# Phase 0 — Runtime correctness status

Implementation track: §4.1 + §4.2 of `docs/IMPLEMENTATION.md`.
Engineer: Runtime
Date: 2026-05-19

## Per-task status

| ID | Status | Files changed | Test added | Acceptance proof |
|---|---|---|---|---|
| P0-RT-01 | DONE | `packages/runtime/src/manifest.ts`, `packages/contracts/src/agents.ts` | `apps/api/test/tc-7-manifest-schema-fields.test.ts` | Parses with all 4 new fields (`input_data`, `ontology_instructions`, `tool_use`, `typescript_code`), rejects bad `tool_use`, tolerates legacy `""` strings, round-trips a synthetic fixture through `agent_versions.manifest_json` end-to-end. |
| P0-RT-02 | DONE | `packages/runtime/src/register.ts` (`pickEmittedEvent`, `extractEmitField`, step output `emit`) | `apps/api/test/tc-8-branch-emit.test.ts` | Step output `{__emit:"X"}` selects `triggered_event[X]`; missing override falls back to `[0]`; rogue overrides are ignored. `StepOutput.emit` is now a typed contract field. |
| P0-RT-03 | DONE | `packages/runtime/src/step-engine.ts` (`buildSystemPrompt`, `buildUserPrompt`, both auto-built and tenant-prompt paths) | `apps/api/test/tc-10-runtime-step-engine.test.ts` (test "auto-built logic prompt includes runtime prelude + ontology + lastResult JSON") | Captured-call mock gateway verifies system carries runtime prelude + agent description + `ontology_instructions`; user carries action description + event payload JSON + `lastResult` JSON. |
| P0-RT-04 | DONE | `packages/runtime/src/register.ts` (writes `response.model` from last LLM step into `runs.model` and `steps.model`); `step-engine.ts` (StepOutput now carries `provider`, `model`) | `apps/api/test/tc-10-runtime-step-engine.test.ts` ("step output carries the gateway's real `model` string") | StepOutput.model is `"mock-model-v7"` (gateway's reported value), not the hardcoded `"mock-model-v1"`. Existing TC-3 still passes (mock provider really returns `mock-model-v1`, so `runs.model` correctly remains that string only when the mock ran). |
| P0-RT-05 | DONE | `packages/runtime/src/condition.ts` (new), `register.ts` (`evaluateCondition` gate + `status='skipped'` row insert) | `apps/api/test/tc-9-condition-eval.test.ts` | 11 cases: numeric compare, equality, event.data access, logical chains, negation, malformed → fail-open, banned syntax → fail-open, undefined-deep → fail-open. |
| P0-RT-06 | DONE | `packages/runtime/src/register.ts` (`computeFunctionRetries` for the Inngest function-level cap, per-action `AbortController` for `timeout_s`, inner retry loop with linear backoff) | `apps/api/test/tc-12-register-helpers.test.ts` | `computeFunctionRetries` derives the per-function cap from per-action `retries` (max, floored at 3, capped at 10). Per-step `AbortController` driven by `action.timeout_s` raises a `step_timeout` error and short-circuits the inner retry loop. |
| P0-RT-07 | DONE | `packages/runtime/src/bootstrap.ts` (idempotency check around `deployments` insert), `packages/agents/src/bootstrap.ts` (mirrors the check for code agents). `AGENTIC_REBOOTSTRAP=force` env opts back into forced flip. | `apps/api/test/tc-11-bootstrap-idempotency.test.ts` | No-op reboot leaves the live deployment row untouched (same `id`). `AGENTIC_REBOOTSTRAP=force` inserts a fresh deployment row even when the hash hasn't changed. |
| P0-RT-08 | DONE | `packages/runtime/src/bootstrap.ts` (env-driven `modelsRoot()` with no fallback; relative paths resolved against cwd); `.env.example` + `apps/api/.env.example` (`AGENTIC_MODELS_DIR=./models`); `apps/api/test/setup.ts` (default for tests). | `apps/api/test/tc-12-register-helpers.test.ts` ("AGENTIC_MODELS_DIR resolver") | Missing env throws a clear error; relative path resolves under `process.cwd()` to an absolute path that ends in `/models`. No hardcoded `/Users/kenny/...` remains. |
| P0-RT-09 | DONE | `packages/runtime/src/artifacts.ts` (new, shared `writeArtifact` + `artifactsRoot`); `step-engine.ts` (writes `step-<N>-{input,output}.json` when `runId`+`stepOrd` supplied); `register.ts` (passes them through); `packages/agents/src/run-engine.ts` (imports the shared helper instead of its own private copy). | `apps/api/test/tc-10-runtime-step-engine.test.ts` ("writes input + output artifact sidecars") | Synthetic step run leaves `step-1-input.json` + `step-1-output.json` under `<AGENTIC_ARTIFACTS_DIR>/<runId>/`; replay-friendly trail now present for manifest engine too. |
| P0-RT-10 | DONE | `packages/runtime/src/register.ts` (`manualTaskTimeout` derives the `waitForEvent` timeout from `action.task_timeout_s`, falls back to 7d when missing); `manifest.ts` + `contracts/agents.ts` (new `task_timeout_s` field on `ActionSchema`). | `apps/api/test/tc-12-register-helpers.test.ts` ("manualTaskTimeout") | `task_timeout_s: 60` → `"60s"`; missing or non-positive → `"604800s"` (7 days, prior default). |
| P0-RT-11 | DONE | `packages/runtime/src/step-engine.ts` (`buildSystemPrompt` accepts an override; tenant-prompt path passes `prompt.system`). | `apps/api/test/tc-10-runtime-step-engine.test.ts` ("tenant prompt's `system` field is the first system message") | `TENANT-OVERRIDE-FIRST` appears before the runtime prelude and before `ONTOLOGY-BEHIND` in the system message. |
| P0-MIG-02 | DONE | `packages/runtime/src/bootstrap.ts` + `packages/agents/src/bootstrap.ts`: every insert with a natural unique key now uses `onConflictDoNothing({ target: [...] })` (workflows, workflow_versions, agents, agent_versions, event_listeners, event_types, entity_types, tenants). | `apps/api/test/tc-11-bootstrap-idempotency.test.ts` ("two back-to-back bootstrapTenant calls don't crash on uniqueness conflicts" + "agents/agent_versions inserts don't double-add on second boot") | Two sequential `bootstrapTenant` calls succeed; row counts for agents + agent_versions are unchanged after the second call. |

## Public-shape changes (called out per quality-bar requirement)

1. `@agentic/contracts` — `AgentSpec` now exports `input_data`, `ontology_instructions`, `tool_use`, `typescript_code` as optional fields. New `AgentToolUse` schema published. `ActionSpec` gains `retries`, `timeout_s`, `task_timeout_s` optional fields. Schema is `.passthrough()` (per DESIGN §10.1 migration window).
2. `@agentic/runtime` — `AgentSpec`/`ActionSpec` mirror the contract changes. New exports: `AgentToolUseSchema`, `AgentToolUse`, `writeArtifact`, `artifactsRoot`, `evaluateCondition`, `ConditionContext`, `StepInput`, `StepOutput`, `AgentPromptContext`. `StepOutput` now carries `provider`, `model`, `emit`, `inputArtifact`, `outputArtifact` — additive optional fields, no breaking change.
3. `runAction({ ... })` now accepts (and pass-throughs) an optional `agent: AgentPromptContext` plus `runId` + `stepOrd` (for artifact paths). All optional — no existing call sites break.
4. `bootstrapTenant` result type gains `deploymentInserted: boolean` — additive.
5. Env contract:
   - `AGENTIC_MODELS_DIR` is **required**; missing → throws on first discovery.
   - `AGENTIC_REBOOTSTRAP=force` newly recognized.

## Blockers

None.

## Sanity

- `pnpm typecheck` green across all 11 packages (`@agentic/{contracts,runtime,agents,api,db,llm-gateway,shared,tools,agent-kit,web}` + `@tenants/raas`).
- `pnpm --filter @agentic/api test` — 83/83 tests pass across 13 test files (5 pre-existing + 1 auth track from the other engineer + 1 DB track + 6 new from this track: TC-7, TC-8, TC-9, TC-10, TC-11, TC-12).

## Notes for the next engineer

1. **Inngest `step.run` doesn't accept per-step retries/timeout options** (the `StepOptions` type in v4.4.0 is only `{ id, name?, parallelMode? }`). The per-action `retries`/`timeout_s` are therefore enforced inside the body that `step.run` wraps:
   - retries: an inner loop with linear backoff (100ms × attempt); the function-level Inngest `retries` is sized from the **max** action retries declared on the agent so genuinely-flaky infrastructure errors still get the Inngest replay treatment.
   - timeout_s: an `AbortController` racing against `runAction`. We DON'T currently pass the signal down into `gateway.chat` — that would close a remaining gap (the runtime gateway's `ChatRequest` already accepts a `signal`). Wire that in Phase 1 when the tool-use loop lands; the action-level timeout currently aborts the JS race but a long-running provider call inside `runAction` would still drain.

2. **Legacy `tool_use: ""` and `typescript_code: ""`** are coerced to `undefined` by a `z.preprocess` shim on the `AgentSchema`. v1.1 should regenerate tenant manifests to the canonical shapes and drop the shim. Look for `coerceEmptyToUndef` in `packages/runtime/src/manifest.ts`.

3. **Condition evaluator is intentionally minimal.** It rejects assignment, indexing, function decls, semicolons, template strings, and any top-level identifier that isn't `lastResult` / `event`. Everything else fails open with a logged warning. If product wants more expressiveness (regex matchers, `in`/`includes`, etc.), grow the grammar deliberately and add fixtures.

4. **`response.model` vs. mock provider.** The mock provider really does return `model: "mock-model-v1"`, so a TC-3-style assertion (`runs.model === "mock-model-v1"`) still passes — the bug was that the literal string was hardcoded regardless of provider. Phase 1 providers will report real model strings (e.g. `"claude-3-7-sonnet-20250930"`).

5. **Artifacts are best-effort.** A failing `writeArtifact` should NOT mask a successful step (`.catch(() => undefined)` is intentional). The output artifact path IS surfaced on `StepOutput.outputArtifact` and ends up in `steps.output_ref` — replay UIs can look there.

6. **Test infrastructure tip.** `apps/api/test/harness.ts` boots the Fastify app and runs `bootstrapAll()`. The DB persists across test files (by design — see `apps/api/test/setup.ts`). New tests that assert on `agent_versions.manifest_json` should either build a synthetic tenant in a tmp dir (as TC-7 does) or use a fresh DB path; deleting rows is blocked by FK constraints from `runs` / `events`.

7. **`@tenants/raas` already typechecks** against the widened contracts (no shape changes needed). Tenants writing manifests can adopt the new fields immediately; legacy tenants are tolerated by the preprocess shim.
