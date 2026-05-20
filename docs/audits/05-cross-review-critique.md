# 05 — Cross-Review Critique (Staff-Engineer Sign-off Pass)

> **Reviewer:** Staff Engineer (final pre-build read)
> **Date:** 2026-05-19
> **Scope:** PRD.md v1.0-DRAFT, DESIGN.md v2.0-DRAFT, IMPLEMENTATION.md v1.0-DRAFT vs audits 01–04
> **Output:** ruthless cross-doc consistency, traceability, contradictions, orphans, testability, sign-off readiness

---

## 1. Executive verdict

**Verdict: NEEDS REVISION before code starts.** The three synthesized docs are 80–85% consistent with the audit findings — most criticals are wired through (the auth bypass, `__system` leak, manifest schema drift, branching emit, hardcoded `mock-model-v1`, migrations-on-boot all have IDs in PRD + sections in DESIGN + tasks in IMPLEMENTATION). The shape is good. However, several material gaps would silently leak through:

**Top 5 critique items (most material):**

1. **`tool_use` contract drift between docs.** PRD `FR-RT-1`/DESIGN `§10.1` define `tool_use` as `Array<{name, description, input_schema}>`; IMPLEMENTATION's contracts diff (§14.1, line 709) defines it as `z.string().optional()`. The very fix Audit #3 §3.4 demanded is shipped as the wrong type in the contracts patch.
2. **PRD says BYOK is a v1 goal AND v1.1 trade-off in the same document.** §5.1 #3 says "per-tenant API keys (BYOK)" is a v1 goal; `FR-OS-10` (line 205) says "Deferred to v1.1 per IMPLEMENTATION P1 trade-off." IMPLEMENTATION never schedules BYOK (no `P*-LLM-BYOK*` task exists). DESIGN §9.5 specifies it as a v1 NEW deliverable. Three docs, three answers.
3. **Phase 4 cleanup must include `data/agentic.sqlite` retention but NFR-REL-5 (PRD line 255) names file `data/agentic.sqlite` while DESIGN §13.5 / IMPLEMENTATION P4-OPS-06 / P4-API-04 all call it `data/agentic.db`.** A backup script that writes to the wrong filename ships green tests and an empty backup.
4. **Q1–Q15 open questions in PRD §12 are almost all answered downstream — but PRD §12 itself was not updated.** A reader of the PRD sees 15 unresolved questions; in fact 11 are decided by DESIGN/IMPLEMENTATION. This is a documentation-discipline failure that makes the PRD untrustworthy.
5. **Audit #4 MUST-have #15 (worker isolation) is explicitly out-of-scope v1 in PRD §11 + DESIGN §11.4 + IMPLEMENTATION §2.3 — but R-7 in PRD §14 marks "tenant code crashes the API process" as a HIGH risk with mitigation "future: worker isolation."** That is a deferred mitigation for a high-severity production risk. No corresponding production guard ships in v1 (try/catch around dynamic-import is the only barrier; not enforced anywhere in IMPLEMENTATION). The risk is not retired and the trade-off is unwritten.

The docs are not ship-ready as a unit. ~10 concrete edits below will bring them there.

---

## 2. Traceability matrix

**Legend:** ✅ traced fully · ⚠️ partial (missing one of PRD/DESIGN/IMPL/test) · 🔴 orphan (finding has no home)

### 2.1 Audit #2 — Backend critical findings

| Audit finding | Source | PRD ID | DESIGN § | IMPL task | Test | Status |
|---|---|---|---|---|---|---|
| Auth dev-bypass on every non-prod request | #2 §13 #1, §7.1 | `FR-API-1`, `NFR-SEC-1` | §17.1 | P0-AUTH-01 | tc-6 (new) | ✅ |
| `__system` cross-tenant fallback on `/v1/runs/:id` + logs | #2 §13 #2, §7.3, §7.5 | `FR-API-2` | §12.2, §17.2 | P0-AUTH-02 | tc-6 (new) | ✅ |
| `?tenant=` query param bypass on `/v1/agents` | #2 §13 #2, §7.4 | `FR-API-2` | §14.3 (Agents row), §17.2 | P0-AUTH-03 | tc-6 (new) | ✅ |
| Hardcoded `tenantSlug: "__system"` in agent-invoke | #2 §13 #2 | `FR-API-2` | §12.2 (v1 fix #3) | P0-AUTH-04 | tc-6 (new) | ✅ |
| Migrations not run on boot | #2 §13 #3, §4.2 | `FR-RT-8`, `NFR-DEP-5` | §13.3 | P0-MIG-01 | integration (P0 exit) | ✅ |
| `bootstrapAll` silently flips deployments to live on every restart | #2 §13 #3, §5.1 | `FR-RT-9` | §11.3 (v1 atomic) | P0-RT-07 | integration | ✅ |
| Hardcoded models dir `/Users/kenny/…` | #2 §10.6 | `FR-RT-10` | §3 (env contract), §13.5 | P0-RT-08 | unit | ✅ |
| No production build target (no Dockerfile, no SIGTERM) | #2 §13 #4, §10.5 | `NFR-DEP-1..4`, `NFR-REL-3` | §3.2 | P4-OPS-01..04, P4-API-01 | docker build green | ✅ |
| No rate limit / body limit / helmet | #2 §13 #5, §9.2 | `FR-API-9`, `NFR-SEC-3..5` | §17.4, §17.5, §17.6 | P4-API-03 | unit | ✅ |
| Test DB pollution; no tenant-isolation tests | #2 §13 #6, §11.2 | `FR-API-2` (acceptance), §13.6 (70%) | n/a (testing strategy) | P4-TEST-06, tc-6 | self-evident | ✅ |
| Request IDs / log redaction / 5xx scrubbing | #2 §13 #7, §6.2 | `FR-OBS-1`, `NFR-SEC-1` (implicit) | §14.1, §16.1 | P4-API-02 | unit | ✅ |
| Webhook anti-replay + tenant routing | #2 §13 #8, §7.6 | `FR-API-10`, `FR-OS-2`, `NFR-SEC-5` | §7.3 | P3-RT-03, P3-RT-04, P3-RT-05 | integration | ✅ |
| Pagination + audit-log read endpoint + soft-delete retention | #2 §13 #9, §3.2 | `FR-API-4`, `FR-OBS-6`, `FR-OS-8` | §14.1, §14.3 | P1-API-02, P1-API-03 | unit | ⚠️ (no soft-delete / retention task; only `audit` read + cursor pagination shipped) |
| SPA bootstrap data-plane unification | #2 §13 #10, §12.2 | `FR-PORT-8` | §3.4 | P1-FE-01 | E2E | ✅ |
| `/v1/llm/providers` is anonymous | #2 §3 (table line 142) | `FR-API-1` | §14.3 (LLM introspection row marked FIX) | n/a (covered under blanket auth) | unit | ⚠️ (no explicit task ID for this specific FIX; depends on P0-AUTH-01 being applied to *all* `/v1/*`) |
| Live API keys in repo `.env` | #2 §9.4 | `NFR-SEC-7` | §17.3 | P0-AUTH-05 | manual | ✅ |
| Replay id mints via `${id}-replay-${Date.now()}` (collides) | #2 §3 (events table line 124) | n/a — implied under `FR-OBS-4` | §7.4 (calls out fix) | n/a — **no IMPL task ID** | n/a | 🔴 **Orphan.** DESIGN says "v1 fix" but no `P*-API-*` task closes it. |
| Tenant-missing returns 500 (should be 4xx) | #2 §6.3 | n/a | n/a | n/a | n/a | 🔴 **Orphan.** Stylistic but in audit's enumerated inconsistencies. |
| Dead-code `verifyHmac` in `auth.ts:96-103` | #2 §9.7 | n/a | n/a | n/a | n/a | 🔴 **Orphan.** Code cleanup never scheduled. |
| `created_at` / `updated_at` missing on `agents`, `agent_versions`, `event_listeners`, etc. | #2 §4.4 | n/a | §13.1 silent on this | n/a | n/a | 🔴 **Orphan.** Won't be caught until someone files a bug. |
| Step `ord` not UNIQUE within run | #2 §4 row `steps` | n/a | §13.1 / §13.2 silent | n/a | n/a | 🔴 **Orphan.** Audit says "could add"; docs neither accept nor reject. |
| Webhook ingest tenant hardcoded to `AGENTIC_DEV_TENANT` | #2 §7.6 | `FR-OS-2` (via "per-workflow signed endpoint") | §7.3 (`webhook_subscriptions`) | P3-RT-05 | integration | ✅ |
| `failRun` writes outside `step.run` (status flip race) | #2 §5.2 | n/a | n/a (silent) | n/a | n/a | 🔴 **Orphan.** Concrete race, no fix scheduled. |

### 2.2 Audit #3 — AI runtime critical findings

| Audit finding | Source | PRD ID | DESIGN § | IMPL task | Status |
|---|---|---|---|---|---|
| Manifest schema drops 4 forward-extended fields | #3 §3.1, §15 #1 | `FR-RT-1` | §10.1, §10.3 | P0-RT-01 | ✅ |
| `triggered_event[0]` always emitted; no branching | #3 §9.1 #4, §15 #2 | `FR-RT-2` | §7.6, §8.6 | P0-RT-02 | ✅ |
| Auto-built `logic` prompt is `${name}: ${description}` only | #3 §4.2, §15 #3 | `FR-RT-3` | §5.8 (composition order), §8.1 | P0-RT-03 | ✅ |
| `mock-model-v1` hardcoded in manifest runs | #3 §15 #5 | `FR-RT-5` | §6.3 (v1 target table) | P0-RT-04 | ✅ |
| `action.condition` parsed but never evaluated | #3 §15 #6, §4.3 | `FR-RT-4` | §8.1, §8.4 | P0-RT-05 | ✅ |
| Per-action `retries` + `timeout_s` ignored | #3 §15 #12, §3.3 #6, §4.3 | `FR-RT-7`/§7.3 (table row), via DESIGN §8.3 | §8.3, §10.1 ActionSchema | P0-RT-06 | ⚠️ (PRD does not enumerate `retries`/`timeout_s` honoring as its own ID; bundled into `FR-RT-7` for new step types — actually mis-categorized) |
| No tool-use loop; `ChatMessage.content` is string-only | #3 §5.4, §15 #4 | `FR-RT-6` | §9.2 | P1-LLM-01..04, P1-RT-01..02, P1-CON-01..02 | ✅ |
| BaseAgent never sets `req.providers` (failover dead) | #3 §5.6 | n/a | §9.1 (mentioned as "v1 NEW" but no explicit FIX) | n/a | 🔴 **Orphan.** Audit calls it out; docs never schedule a fix. |
| No structured-output enforcement / repair retry | #3 §5 inferred, §15 #7 | n/a | §4.3 (BaseAgent.outputSchema declared in v1) but no validate+repair task | n/a | 🔴 **Orphan.** `outputSchema` exists in the type, but no task implements the JSON-mode + repair-retry loop. |
| Manifest agents don't write artifacts | #3 §10.2, §11.2 | n/a | §6.3 (v1 target column says yes) | n/a — **no task** | 🔴 **Orphan.** DESIGN promises it; no `P*-RT-*` task wires it. |
| Per-tenant BYOK absent | #3 §5.5, §15 #8 | `FR-OS-10` (deferred to v1.1) | §9.5 (v1 NEW) | **none** | ⚠️ **Contradiction** — see §3. |
| Cost not computed; no per-tenant cost cap | #3 §5.5, §15 #10 (via "Honorable mentions") | `FR-OS-9` | §9.6 | P1-LLM-05, P1-DB-01, P1-API-04 | ✅ |
| Eval harness absent | #3 §14, §15 #9 | n/a (mentioned in §13.6 quality gates "70% coverage" only) | n/a | n/a | 🔴 **Orphan.** Important enough to be in Audit #3 top-10. Skipped silently. |
| Orphaned-run sweep + audit-log writes | #3 §13, §15 #10 | `NFR-REL-1` (DLQ), `FR-OS-8` | §16.5 (audit log writes added) | P4-API-05 (orphan sweep), P1-API-02 (audit writes) | ✅ |
| 7-day manual-task timeout hardcoded | #3 §4.6 | n/a explicitly; bundled into `FR-RT-7`? No — actually no ID | §5.9, §10.1 ActionSchema `task_timeout_s` (v1 NEW) | n/a — **no task** | 🔴 **Orphan.** DESIGN added the field; no `P*-RT-*` makes step engine honor it. |
| Empty-trigger agents silently not registered | #3 §9.1 #1 | n/a | n/a | n/a | 🔴 **Orphan.** Low severity but no decision. |
| Concurrency limit hardcoded `8`; not per-agent | #3 §9.1 #2 | n/a | §4.3 (`BaseAgent.concurrency` in contract) | n/a | 🔴 **Orphan.** DESIGN declares the type; no task makes the engine read it. |
| No cancellation primitive | #3 §9.1 #5, §9.4 | n/a | n/a | n/a | 🔴 **Orphan.** |
| Code agents not registered as Inngest functions | #3 §9.1 #6 | `FR-RT-12` | §6.3 (v1 target), §6.1 ("Async invocation (v1.1)") | n/a — **no task** | ⚠️ **Contradiction with itself**. PRD says v1; DESIGN §6.1 says v1.1; no task implements it. |
| Tenant code import side-effect coupling | #3 §2.1 | n/a | §11.2 `agentic.json` registry | P3-RT-08 | ✅ |
| Subject not auto-bound to `input_data.candidate_id` | #3 §8.3 | n/a | n/a | n/a | 🔴 **Orphan.** Audit recommendation; no decision. |

### 2.3 Audit #4 — Agent OS MUST-haves (15 items)

| MUST | Audit #4 | PRD ID | DESIGN § | IMPL task | Status |
|---|---|---|---|---|---|
| #1 CLI (`agentic`) | §13 #1 | n/a (mentioned in §15 conventions only) | §19 (new `apps/cli` package row) | **no task** (Phase 1 IMPL §5 has no CLI tasks; §3.2 lists `apps/cli` as Phase 3) | 🔴 **Orphan.** DESIGN tables it as `apps/cli` (NEW v1); IMPL §3.2 says CLI is Phase 3 but Phase 3 §7 has no CLI tasks either. |
| #2 Atomic deploy via API | §13 #2 | `FR-OS-12` (in-portal authoring includes deploy) | §11.3, §14.3 (`POST /v1/agents` atomic deploy) | P3-API-02 (rollback only); atomic-deploy itself not scheduled as its own task | ⚠️ **Partial.** DESIGN promises atomic deploy in v1; IMPL only schedules rollback explicitly. |
| #3 Rollback endpoint + UI | §13 #3 | `FR-OS-7` | §14.3 deployments row | P3-API-02 | ✅ |
| #4 Per-tenant BYOK | §13 #4 | `FR-OS-10` (deferred) | §9.5 (v1 NEW) | none | ⚠️ **Contradiction.** |
| #5 Per-tenant cost cap | §13 #5 | `FR-OS-9` | §9.6 | P1-LLM-05, P1-DB-01, P1-API-04 | ✅ |
| #6 Schedule / cron triggers | §13 #6 | `FR-OS-1` | §7.2 | P3-RT-01, P3-RT-02 | ✅ |
| #7 Webhook ingest contract | §13 #7 | `FR-OS-2`, `FR-API-10` | §7.3 | P3-RT-03..05 | ✅ |
| #8 Tool-use loop | §13 #8 | `FR-RT-6` | §9.2 | P1-LLM-01..04, P1-RT-01..02 | ✅ |
| #9 Sub-agent / spawn | §13 #9 | `FR-OS-4` | §7.5 | P1-RT-03 (subflow step), P1-RT-04 (parentRunId) | ⚠️ **Partial.** `subflow` manifest step is scheduled, but a *code agent* calling `this.invoke('other', ...)` per DESIGN §7.5 is not. |
| #10 Memory primitive | §13 #10 | `FR-OS-5` | §5.7 (TODO — see issue below), §13.1 `agent_memory` | P3-DB-01, P3-RT-06, P3-RT-07 | ✅ |
| #11 Replay UI + endpoint | §13 #11 | `FR-OBS-4` | §7.4 | n/a — no `P*-FE-*` task for the Replay button | ⚠️ **Partial.** Endpoint already exists (audit notes it's partial); UI button not scheduled. |
| #12 Per-step retries + timeouts honored | §13 #12 | bundled into `FR-RT-7` mis-cited | §8.3, §10.1 | P0-RT-06 | ⚠️ (PRD mis-cites; see §3) |
| #13 Cost dashboard | §13 #13 | `FR-OBS-5` | §16.5 | P3-FE-03 | ✅ |
| #14 Streaming LLM responses | §13 #14 | §5.2 #8 (out of scope v1) | §9.4 (v2 contract reserved) | n/a (deferred) | ✅ (explicitly deferred) |
| #15 Worker isolation (sandbox) | §13 #15 | §5.2 #7 (out of scope) | §11.4 (v2) | n/a (deferred) | ⚠️ **R-7 in PRD §14 mitigates "via future worker isolation" — that's the deferred fix being treated as the mitigation.** |

### 2.4 Audit #1 — Frontend / portal findings

| Finding | Audit #1 | PRD ID | DESIGN § | IMPL task | Status |
|---|---|---|---|---|---|
| Babel-standalone in browser; needs TSX build | §1 tl;dr, §7 R-1 | `FR-PORT-1` | §15.1, §15.5 | P2-FE-01, P2-FE-21 | ✅ |
| Monaco from unpkg CDN | §3.1.1, §7 R-2 | `FR-PORT-4` | §15.1, §15.2 (line ref) | P2-FE-04 | ✅ |
| Pixel-parity port | §9 acceptance | `FR-PORT-3` | §15.2, §15.3 | P2-FE-03, P2-FE-05..17 + Playwright | ✅ |
| 11 deltas (D-1..D-11) preserved except D-9 | §6 | `FR-PORT-5` | §14.4 (SSE replaces useLiveData) | P2-FE-05..18, P2-FE-19 | ✅ |
| `--density` declared but unused | §2.5, §7 R-8 | `FR-PORT-6` | n/a explicit; §15.3 mentions tokens | P2-FE-20 | ✅ |
| Inline-style verbatim port | §1 tl;dr, §7 R-1 | `FR-PORT-2` | §15.1, §15.3 | P2-FE-03 | ✅ |
| Live data via SSE (replace `useLiveData`) | §6 D-9, §8 open #3 | `FR-PORT-8` | §14.4 | P1-FE-02, P1-FE-03 | ✅ |
| Auth flow + login surface | §8 open #1 | `FR-PORT-9` | §15.1 (cookie session), §17.1 | P2-FE-19 | ✅ |
| Per-route URL params / deep linking | §8 open #11 | n/a — no PRD ID | §15.4 | P2-FE-01 | ⚠️ **PRD silent.** DESIGN/IMPL aligned. |
| Tenant in URL pathname | §8 open #2 | n/a | n/a | n/a | 🔴 **Orphan.** Audit recommends; nobody addressed. |
| Toast/snackbar system | §8 open #4 | n/a | n/a | n/a | 🔴 **Orphan.** Audit recommends specifying a toast component before the port; PRD §9 enumerates view capabilities but never lists toast/snackbar. |
| `⌘+K` command palette | §8 open #5 | n/a | n/a | n/a | 🔴 **Orphan.** Cmd-K button is in v1_1 but never wired; no decision in any doc. |
| Optimistic updates / save model | §8 open #6 | n/a | n/a | n/a | 🔴 **Orphan.** |
| Drag-and-drop workflow canvas | §8 open #7 | §5.2 #3 + §11 (no graph-rewrite GUI) | n/a explicit | n/a | ⚠️ PRD says non-goal; resolved by exclusion. |
| Light-theme contrast audit | §8 open #9 | n/a | n/a | n/a | 🔴 **Orphan.** Quality gate for accessibility; no task. |
| Z-index ladder undefined | §7 R-11 | n/a | n/a | n/a | 🔴 **Orphan.** |
| Latent / unused props (`compact`, `disabled`, `--r-sm/md/lg`) | §7 R-8 | partial (`FR-PORT-6` covers density only) | n/a | n/a | 🔴 **Orphan** (everything else in R-8). |
| Workflow editor in-portal | §6 D-9 + §8 open #6 + §10 | `FR-OS-12` | §15.2 (view) | P3-FE-01 | ✅ |
| Test-run badge / TEST partitioning | §6 D-8 | `FR-RT-12`? — no, **PRD has no test-run requirement** | n/a explicit | P2-FE-18 | ⚠️ PRD silent on test runs; IMPL ships `is_test` column without a PRD requirement. |
| TZ handling / workspace timezone | §7 R-10 | n/a | n/a | n/a | 🔴 **Orphan.** |

---

## 3. Contradictions found

Concrete contradictions between the three synthesized docs, with file+line refs.

### 3.1 BYOK timing (CRITICAL)

| Doc | Quote | File:line |
|---|---|---|
| PRD §5.1 #3 | "Production multi-tenancy: zero cross-tenant data leakage, per-tenant cost caps, **per-tenant API keys (BYOK)**." | `docs/PRD.md:100` |
| PRD §7.4 `FR-OS-10` | "Per-tenant BYOK: encrypted-at-rest API keys per provider per tenant; gateway resolves at call time. **(Deferred to v1.1 per IMPLEMENTATION P1 trade-off; v1 uses platform keys with cost cap.)**" | `docs/PRD.md:205` |
| PRD §13.5 release criteria | "Live OpenRouter/OpenAI/Google keys rotated, replaced with placeholder + **per-tenant BYOK or platform key**" | `docs/PRD.md:415` |
| DESIGN §9.5 | "**Per-tenant BYOK (v1, NEW)** ... Keys encrypted at rest using libsodium ..." | `docs/DESIGN.md:867-882` |
| DESIGN §4.5 status snapshot table | "Per-tenant BYOK — v1 target: **YES** — Current: NO" | `docs/DESIGN.md:321` |
| IMPLEMENTATION §5.6 cost-control tasks | No BYOK task. `tenant_provider_keys` table not in §13 file inventory. `P1-LLM-05` only covers cost caps using platform keys. | `docs/IMPLEMENTATION.md:240-246` |
| IMPLEMENTATION §13.4 Phase 3 file inventory | No `tenant_provider_keys` schema task, no `apps/api/src/routes/v1/llm-keys.ts` task. | `docs/IMPLEMENTATION.md:644-668` |
| DESIGN §14.3 LLM gateway introspection | "`POST /v1/llm/keys` — **NEW v1** — add BYOK provider key" + `DELETE /v1/llm/keys/:id` | `docs/DESIGN.md:1250-1251` |

**Status:** Three different answers in three docs. Either PRD `FR-OS-10` and §5.1 #3 must agree (v1 or v1.1), and DESIGN §9.5 must align, and IMPLEMENTATION must add a `P*-LLM-BYOK-*` task with a `0005a_tenant_provider_keys.sql` migration — or DESIGN §9.5 must be marked deferred and §14.3's `/v1/llm/keys` rows removed.

### 3.2 DB filename

| Doc | Quote | File:line |
|---|---|---|
| PRD `NFR-REL-5` | "Backup: `data/agentic.sqlite` snapshotted daily; retention 30 days." | `docs/PRD.md:255` |
| DESIGN §13.5 | "`data/agentic.db` (Drizzle)" | `docs/DESIGN.md:1128` |
| IMPLEMENTATION P0-MIG-01 | "delete `data/agentic.db`, start API ..." | `docs/IMPLEMENTATION.md:158` |
| IMPLEMENTATION P4-OPS-06 | "nightly `pnpm db:backup` script that runs `VACUUM INTO`" — implicitly to `agentic.db` | `docs/IMPLEMENTATION.md:429` |

**Status:** PRD uses `.sqlite`; DESIGN + IMPL use `.db`. A backup script written against PRD's filename will fail silently. Fix PRD.

### 3.3 Code agent runtime — v1 vs v1.1

| Doc | Quote | File:line |
|---|---|---|
| PRD `FR-RT-12` | "Code agents register through `bootstrapCodeAgents` and execute via Inngest (no special inline path); a `?async=false` flag is available for sync request/response style **on the same code path**." | `docs/PRD.md:190` |
| DESIGN §6.1 | "Sync invocation: `POST /v1/agents/:name/invoke` → run executes inline ... **Async invocation (v1.1)**: `POST /v1/agents/:name/invoke?async=1` → enqueues an Inngest event" | `docs/DESIGN.md:536-538` |
| DESIGN §6.3 differences table | "Inngest registration — manifest: yes · code: no → **Both registered as Inngest functions** (sync inline path still allowed for `?async=0`)" — marked v1 target | `docs/DESIGN.md:598` |
| IMPLEMENTATION | No `P*` task to register code agents as Inngest functions. P1-RT-01 only wires the tool-use loop inside `run-engine.ts`. | n/a |

**Status:** PRD says v1, DESIGN says v1 (table) but also v1.1 (§6.1 prose), IMPL ships neither. Audit #3 §9.1 #6 marked this critical. The doc trio drifts vs itself and the audit.

### 3.4 PRD §5.2 vs IMPL §2.3 — Phase 3 graph editor

| Doc | Quote | File:line |
|---|---|---|
| PRD §5.2 #3 (non-goals) | "No graph-rewrite GUI for workflows — the JSON manifest editor + agent graph view is sufficient." | `docs/PRD.md:108` |
| PRD §11 #8 (out of scope) | "GUI for workflow graph rewrites (drag-drop with auto-save is in scope; visual graph rewriting macros are not)" | `docs/PRD.md:355` |
| IMPLEMENTATION §2.3 | "Visual workflow *builder* with drag-drop create-from-scratch (Phase 3 ships an editor of existing manifests; from-scratch composition is v2)." | `docs/IMPLEMENTATION.md:59` |
| IMPLEMENTATION P3-FE-01 | "Workflow editor: graph view of agents + events, save back to `models/<slug>/workflow_v1.json` via `POST /v1/agents`. Persists `workflow_versions`." | `docs/IMPLEMENTATION.md:379` |

**Status:** PRD §5.2 #3 says "no graph-rewrite GUI" but PRD §11 #8 says "drag-drop with auto-save is in scope" and IMPL P3-FE-01 implements an editor. Three statements, one says no, two say yes-but-limited. Tighten the PRD prose.

### 3.5 `tool_use` field shape (Audit #3 §3.4 fix)

| Doc | Quote | File:line |
|---|---|---|
| DESIGN §10.1 AgentSchema | "`tool_use: z.array(z.object({ name: z.string(), description: z.string().optional(), input_schema: z.record(z.string(), z.unknown()).optional() })).optional()`" | `docs/DESIGN.md:953-957` |
| IMPLEMENTATION §14.1 Contracts diff (Phase 0) | "`tool_use: z.string().optional(),         // documentation slot in v1`" | `docs/IMPLEMENTATION.md:709` |
| PRD `FR-RT-1` | "Manifest schema includes `input_data`, `ontology_instructions`, `tool_use`, `typescript_code`" (shape unspecified) | `docs/PRD.md:179` |
| Audit #3 §3.4 | "Should become `tool_use: { name: string; input_schema: JSONSchema }[]` if it's to map to Anthropic/OpenAI function-calling." | `docs/audits/03-ai-runtime-review.md:137` |

**Status:** **DESIGN follows the audit recommendation; IMPLEMENTATION's contract diff ships the wrong shape.** A Phase 0 implementer reading IMPL §14.1 will produce a contract that contradicts DESIGN §10.1. This is the single most damaging contradiction because it ships into typed code. Fix IMPL §14.1.

### 3.6 Run trace tree — parent linkage timing

| Doc | Quote | File:line |
|---|---|---|
| PRD `FR-OS-4` | "Sub-agent invocation: an agent can `emit` an event that another agent in the same tenant consumes; **correlation IDs propagate**." | `docs/PRD.md:199` |
| DESIGN §5.5 | "`parentRunId  // NEW v1 — for sub-agent trace trees (Audit #4 §15 #9)`" | `docs/DESIGN.md:398` |
| DESIGN §7.5 | "Sub-agent trigger **(v1.1)**" | `docs/DESIGN.md:677` |
| IMPLEMENTATION P1-RT-04 | "`runs.parentRunId` column (Drizzle migration). `subflow` step populates it on the child run." — Phase 1 | `docs/IMPLEMENTATION.md:220` |
| IMPLEMENTATION P3-FE-04 | "Trace tree view on run detail: ... using `runs.parentRunId` (P1-RT-04)." — Phase 3 | `docs/IMPLEMENTATION.md:382` |

**Status:** PRD says correlation IDs propagate (general); DESIGN §7.5 says "v1.1"; DESIGN §5.5 schema says "v1"; IMPL ships column in Phase 1 + UI in Phase 3. Schema in v1, sub-agent invocation primitive in v1.1, UI in v1 Phase 3 — that's actually consistent if you read carefully, but readers will not. Fix DESIGN §7.5 to align "manifest `subflow` step is v1; code-agent `this.invoke(...)` is v1.1" — explicit split.

### 3.7 Auth provider decision

| Doc | Quote | File:line |
|---|---|---|
| PRD `Q7` open question | "Auth provider: in-house JWT vs Clerk/Auth0/Supabase?" | `docs/PRD.md:370` |
| DESIGN §17.1 | "Browser session: cookie-based. ... sends an email via Resend with a one-time token ... HttpOnly + SameSite=Strict cookie ... CLI / external: bearer tokens issued via `/v1/auth/tokens`" | `docs/DESIGN.md:1364` |
| DESIGN §21 #6 | "Magic-link vs SSO. Resend magic-link is implemented in v1. SSO (OIDC, SAML) is enterprise. **Lean:** magic-link for v1, OIDC for v1.1." | `docs/DESIGN.md:1525` |
| IMPLEMENTATION P2-FE-19 | "Authentication: cookie-session via Next route handlers. `/api/auth/login` issues a signed cookie; Fastify auth plugin reads cookie OR Bearer." | `docs/IMPLEMENTATION.md:310` |

**Status:** PRD §12 lists Q7 as open. DESIGN + IMPL both pick cookie + magic-link + bearer (in-house JWT-ish session). Open question stale. (See §5 below for the full list.)

### 3.8 Test coverage gate timing

| Doc | Quote | File:line |
|---|---|---|
| PRD §13.6 | "Unit + integration test line coverage ≥ 70%" | `docs/PRD.md:421` |
| IMPLEMENTATION §9.4 | Phase 0: 60% line coverage. Phase 1: 65%. Phase 2: 70%. | `docs/IMPLEMENTATION.md:499-503` |
| IMPLEMENTATION P4-TEST-05 | "Coverage gate: 70% lines, 60% branches" — Phase 4 | `docs/IMPLEMENTATION.md:439` |

**Status:** Consistent (PRD = Phase 4 endpoint); document the ramp explicitly in PRD release criteria so reviewers don't think coverage gates at 70% from day one.

---

## 4. Orphan findings (audit findings that never made it into the synthesized trio)

These are findings the audits flagged where no PRD requirement, DESIGN section, or IMPL task addresses them. Listed once each — see traceability matrix (§2) for the audit reference.

### 4.1 Audit #2 orphans (silent in synth docs)

1. **Replay id collision (`Date.now()` concat)** — Audit #2 §3 events table line 124. DESIGN §7.4 calls out the fix; no `P*` task implements it. **Fix:** add `P0-API-01` (1-line change in `apps/api/src/routes/v1/events.ts:57`).
2. **`tenant_missing` returns 500** — Audit #2 §6.3. Stylistic; defer to ongoing error-handling cleanup.
3. **Dead `verifyHmac` function in `auth.ts:96-103`** — Audit #2 §9.7. Delete in Phase 0; trivial.
4. **Missing `created_at` / `updated_at` on `agents`, `agent_versions`, `event_listeners`, `event_types`, `entity_types`** — Audit #2 §4.4. Should be addressed before audit-log readers (`P1-API-03`) ship, otherwise audit views lack temporal context.
5. **`steps.ord` UNIQUE within run** — Audit #2 §4 (steps row). Should be a one-line schema constraint in `P1-RT-04`'s migration. Cheap defense.
6. **`failRun` writes status outside `step.run`** — Audit #2 §5.2. Race condition; concrete fix path needed in `P0-RT-*`.
7. **Schema-version `_meta` table guard** — DESIGN §13.3 calls for it; no IMPL task ships it. Required by migrate-on-boot to detect "DB ahead of code" (which can happen on rollback).

### 4.2 Audit #3 orphans

8. **BaseAgent never sets `req.providers` (failover dead from code agents)** — Audit #3 §5.6. DESIGN §9.1 implies providers chain is honored; no task verifies BaseAgent passes the chain.
9. **JSON-mode + repair-retry loop** — Audit #3 §15 #7. DESIGN §4.3 declares `BaseAgent.outputSchema` but no `P*-RT-*` implements the validate+repair behavior. Without this, structured-output agents will silently return malformed JSON to callers.
10. **Manifest runs don't write artifact sidecars** — Audit #3 §10.2, §11.2. DESIGN §6.3 v1 target column says both kinds should; no IMPL task wires the manifest step engine to write step-input/output JSON.
11. **Eval harness** — Audit #3 §14, §15 #9. Completely absent in PRD/DESIGN/IMPL. Important for prompt-regression detection. Should be `P3-TEST-01` or a `pnpm eval` script.
12. **Manual-task `task_timeout_s` enforcement** — Audit #3 §4.6. DESIGN §10.1 added the field; no task makes `step.waitForEvent(..., timeout: action.task_timeout_s)` read it.
13. **Empty-trigger agents silently not registered** — Audit #3 §9.1 #1. Low severity; just document the behavior in the manifest schema docs or fail boot loudly.
14. **Per-agent concurrency limit** — Audit #3 §9.1 #2. DESIGN §4.3 ships `BaseAgent.concurrency` typed; no task makes the engine consume it.
15. **Subject auto-binding** — Audit #3 §8.3. Subject is threaded but not bound into `input_data.candidate_id`. Audit recommendation never landed.
16. **Inngest cancellation semantics** — Audit #3 §9.4. Low priority but flagged; no decision recorded.
17. **Tenant prompts: `PromptDescriptor.system` ignored by engine** — Audit #3 §7.2. Engine fix (Phase 0?) but no task addresses it.

### 4.3 Audit #4 orphans

18. **`apps/cli` package** — Audit #4 §13 #1 (P0). DESIGN §19 lists it; IMPLEMENTATION never schedules its creation. P1, P2, P3, P4 all silent on CLI. **This is a Must-Have that was synthesized into DESIGN but never into IMPL.**
19. **Atomic deploy of Inngest function re-registration** — Audit #4 §13 #2. DESIGN §11.3 says "atomic re-registration"; no task implements the dynamic re-register (P3-API-02 is rollback only).
20. **Code-agent invocation primitive (`this.invoke('other', ...)`)** — Audit #4 §13 #9. DESIGN §7.5 specifies it (v1.1). IMPL never schedules. Should be future v1.1 task list.
21. **`audit_log` read view on Settings → Audit** — Audit #2 §13 #9 + Audit #4 §9. PRD `FR-OBS-6` says yes; IMPL has `P1-API-03` (audit endpoint) but no `P*-FE-*` task adds the Settings → Audit view to Phase 2 or 3.

### 4.4 Audit #1 orphans

22. **Toast / snackbar system** — Audit #1 §8 #4. No PRD requirement, no DESIGN component, no IMPL task. Without this, every failed mutation in the portal is silent. **Pre-port blocker per audit recommendation.**
23. **Cmd-K command palette** — Audit #1 §8 #5. v1_1 ships the button visually; no implementation in synth docs. Either implement or remove the button — current state is misleading.
24. **Tenant in URL pathname** — Audit #1 §8 #2. Audit recommends `/portal/:tenant/...`. DESIGN §15.4 says App Router routes from day one but never specifies tenant-in-URL.
25. **Light-theme contrast audit** — Audit #1 §8 #9. 8 of 19 tokens have light overrides. No accessibility QA gate.
26. **Z-index ladder** — Audit #1 §7 R-11. No `tokens.css` z-scale defined in DESIGN §15.3 nor `P2-FE-02`.
27. **Workspace timezone setting** — Audit #1 §7 R-10. PRD §9.9 enumerates Settings sections but timezone is not called out.
28. **TEST run partitioning + retention** — Audit #1 §8 #12 + §6 D-8. IMPL `P2-FE-18` adds `is_test` column without a PRD requirement; no retention policy.
29. **Accessibility: `:focus-visible`, ARIA, keyboard nav** — Audit #1 §3.1.1 + §7 R-5. Zero coverage in PRD/DESIGN/IMPL. WCAG-blocking.

**Orphan count:** 29 distinct findings. Of these, ~15 are P0/P1 quality (tool-use loop wiring, atomic deploy, BYOK trade-off, replay id, toast system, audit log view, CLI). The rest are documented technical debt.

---

## 5. Open questions reality check (PRD §12)

PRD §12 lists 15 questions. Below: which are actually answered downstream, where, and whether PRD §12 reflects it.

| Q | Question | Answered? | By whom | PRD §12 stale? |
|---|---|---|---|---|
| Q1 | Memory primitive: platform KV vs tool-implemented vs external? | **YES** | DESIGN §21 #3 ("platform KV in v1.1, external integration as a tool in v2"); IMPL Phase 3 §7.2 (P3-DB-01..P3-RT-07). PRD `FR-OS-5` explicitly picks SQLite-backed KV. | **YES — stale.** PRD §12 row says "AI Architect" needs to decide; already decided. |
| Q2 | Manifest `.passthrough()` cutover date — when do we lock to strict? | PARTIAL | DESIGN §10.1 says "v1.1 removes it"; no specific date. PRD `FR-RT-1` "locked strict by v1.1 with migration script". | NO — partially answered; specific date still open. |
| Q3 | `__system` tenancy: parking slot or `agents.scope='system'`? | **YES** | DESIGN §21 #1 ("Lean: parking lot only"); Audit #4 §15 #8 recommends promoting to `agents.scope`. IMPL P0-AUTH-04 keeps `__system` as tenant. No `agents.scope` migration scheduled. | **YES — stale.** Decision is "keep `__system` tenant," not the `scope` enum from the audit. |
| Q4 | Code-agent `?async=` flag duality — consolidate or keep both? | PARTIAL | DESIGN §6.1 says "Sync v1, Async v1.1" (different from PRD `FR-RT-12` saying both v1). | NO — and the contradiction blocks decisiveness. See §3.3. |
| Q5 | Per-tenant BYOK in v1 vs v1.1? | **CONTRADICTORY** | PRD `FR-OS-10` says v1.1; PRD §5.1 #3 says v1; DESIGN §9.5 says v1; IMPL has no task. | **YES — stale and contradictory.** See §3.1. |
| Q6 | SSE vs WebSocket for real-time? | **YES** | DESIGN §15.1 ("Real-time: SSE subscription"); IMPL P1-API-01 ships SSE. | **YES — stale.** |
| Q7 | Auth provider: in-house JWT vs Clerk/Auth0/Supabase? | **YES** | DESIGN §17.1 + §21 #6 ("magic-link for v1, OIDC for v1.1"); IMPL P2-FE-19 ships cookie-session. | **YES — stale.** |
| Q8 | Workflow editor: drag-drop graph vs JSON-only for v1? | **YES (with contradiction)** | IMPL P3-FE-01 ships a graph editor that saves manifests. PRD §5.2 #3 says "no graph-rewrite GUI." PRD §11 #8 says drag-drop is in scope. | **YES — stale.** See §3.4. |
| Q9 | Tenant onboarding: self-serve sign-up vs operator-invitation? | NO | Not addressed in any doc. | NO — legitimately open. |
| Q10 | Logo/branding | NO | Not addressed. | NO — legitimately open. |
| Q11 | Pricing: open-source vs source-available vs SaaS-only? | NO | Not addressed. | NO — legitimately open. |
| Q12 | Production DB: SQLite single-node OK, or Postgres day-one? | **YES** | DESIGN §21 #2 ("trigger is multi-instance"); IMPL §2.3 implicitly keeps SQLite. PRD §10 #3 says "SQLite + Drizzle for v1, with a Postgres migration path." | **YES — stale.** |
| Q13 | Tool-use loop max iterations cap? | **YES** | IMPL R-E-8 caps `maxSteps ≤ 10`; DESIGN §4.3 `BaseAgent.maxSteps` (no value). | **YES — stale.** |
| Q14 | Rate limit per tenant defaults vs configurable? | **YES** | DESIGN §17.5 (defaults documented per-route); PRD `FR-API-9` says 100 req/min default. | **YES — stale.** |
| Q15 | Error catalog standardization | PARTIAL | DESIGN §14.1 + §9.7 (LLMError taxonomy extended) but no comprehensive `ErrorCodes` enum doc. | NO — partially. |

**Tally:** 11 of 15 questions are answered (or partially answered with a clear lean) by DESIGN or IMPL. PRD §12 has not been updated to reflect this. **A reader of the PRD sees 15 unresolved questions; in reality only 4 are truly open.** This makes the PRD untrustworthy as a strategic doc and gives a false signal of readiness.

**Recommended PRD §12 rewrite:** mark Q1, Q3, Q5, Q6, Q7, Q8, Q12, Q13, Q14 as decided (with one-line links to DESIGN section); keep Q2, Q4, Q9, Q10, Q11, Q15 open with explicit owners + deadlines. See §7 rec #5.

---

## 6. Testability gaps

Requirements that read like aspirations vs. concrete measurable contracts.

### 6.1 PRD requirements without clear testability

| ID | Text | Why untestable |
|---|---|---|
| `NFR-PERF-3` | "Portal initial render TTI ≤ 1.5 s on a 10 Mbps connection (cold)" | No fixture data size, no browser version, no CPU envelope. A 1.5s TTI on a single Mac may pass; a Chrome AdBlock variant may not. |
| `FR-PORT-3` | "≤ 1% tolerance" Playwright screenshot diff | IMPL §6.5 says "≤ 0.1%". PRD says 1%; IMPL says 0.1%. Tenfold mismatch. **Pick one.** |
| `FR-PORT-5` | "All 11 deltas preserved, except D-9 replaced by ..." | "Preserved" is not enumerated against the 11 deltas; PRD does not list them. Reader has to read Audit #1 §6 to know what D-1..D-11 are. |
| `FR-RT-7` | "Step engine new types: `condition`, `delay`, `subflow`" | No acceptance test for any one of them. IMPL P1-RT-03 covers the three but PRD does not. |
| `FR-OS-5` | "Platform-provided KV memory ... SQLite-backed in v1; pluggable in vNext" | Behavior under concurrent writes? TTL? Size cap per key? Unspecified. |
| `FR-OS-9` | "Per-tenant cost cap: gateway pre-flight check fails LLM call with `cost_cap_exceeded`" | Pre-flight uses *expected* cost; the actual cost is post-call. A 10x-token response that exceeds budget should still be allowed once or fail mid-call? IMPL P1-LLM-05 says "expected then actual"; PRD silent on the policy. |
| `NFR-SEC-2` | "Secrets at rest: BYOK API keys encrypted with platform key (Argon2-derived); rotated every 90 days" | "Argon2-derived" — Argon2 is a KDF for passwords; using it for encryption keys is unconventional. DESIGN §17.3 says libsodium with master key from env/KMS. **Contradiction:** Argon2 vs libsodium. |
| `NFR-DEP-4` | "Healthcheck endpoints ... return `{ ok, version, dbReady, inngestReady }`" | DESIGN §3.1 / §3.2 specifies `db / inngest / llmGateway`. IMPL §14.5 ContractDiff: `db, inngest, llmGateway`. PRD includes `inngestReady` but not `llmGatewayReady`. **Mismatch.** |
| `FR-OS-6` | "Tenant code shipping ... hot-reloaded on file change in dev, dynamic-imported at boot in prod" | What constitutes a "file change"? `.ts` only? Inngest function re-registration is involved — IMPL P3-RT-09 has the watcher but acceptance is vague. |
| Personas §4.1–4.3 | "Day in the life" prose | Acceptance: "Liu opens the **Workflows** view ... clicks **Deploy**. The node is live for the tenant in <5 minutes, end-to-end." There is no E2E test for this exact persona flow in IMPL P4-TEST-* — only the abstract "manifest agent run" test. |

### 6.2 Acceptance criteria thin or missing

- `FR-PORT-7` "all write actions ... reflect server-confirmed state" — no test for optimistic-update + rollback behavior (Audit #1 §8 open #6 explicitly flagged this).
- `FR-OS-11` (package renames) — no acceptance test beyond `pnpm typecheck` green. Doesn't verify external `@agentic/agent-sdk` imports work for a *new* tenant project consuming the SDK as an external package.
- `FR-OS-13` "New trigger sources, new tool kinds, new step types are added by registering an adapter" — extensibility goal with no measurable test.

### 6.3 Personas — RAAS grounding strength

- Liu Wei (Workflow Designer): grounded in RAAS-v1 (`models/RAAS-v1/`). ✅
- Chen Mengjie (AI Engineer): grounded in `data/tenants/raas/src/agents/` (which **doesn't exist yet** per IMPL §13.4 Phase 3 file list — `data/tenants/<slug>/<version>/` is created in P3-RT-08). Persona implies the path is current. ⚠️
- Ops: grounded in real workflows. ✅
- Wu Hao (End User): explicitly out-of-scope but acceptance criteria for notifications and signed task-resolution URLs are not in any FR-* ID. 🔴 **Persona without acceptance criteria.**

---

## 7. Recommended fixes (ranked, with file refs)

Numbered list of concrete edits with rationale and audit reference.

### #1 — Fix `tool_use` shape in IMPLEMENTATION §14.1 (CRITICAL)

**File:** `docs/IMPLEMENTATION.md:709`
**Current text:**
```ts
tool_use: z.string().optional(),         // documentation slot in v1
```
**Proposed change:**
```ts
tool_use: z.array(z.object({
  name: z.string(),
  description: z.string().optional(),
  input_schema: z.record(z.string(), z.unknown()).optional(),
})).optional(),
```
**Rationale:** Align with DESIGN §10.1 and Audit #3 §3.4. Today's IMPL contract diff ships the bug, not the fix.
**Audit ref:** #3 §3.4, §15 #1, §15 #4.

### #2 — Resolve BYOK timing across PRD/DESIGN/IMPL (CRITICAL)

**Files:** `docs/PRD.md:100`, `docs/PRD.md:205`, `docs/PRD.md:415`, `docs/DESIGN.md:867-882`, `docs/IMPLEMENTATION.md` (add tasks).
**Proposed change:** Pick one of two paths:

- **Path A (recommended): BYOK in v1.** Remove deferred note from `FR-OS-10`. Add `P1-DB-02 (tenant_provider_keys table)`, `P1-LLM-06 (gateway BYOK resolution)`, `P1-API-05 (POST /v1/llm/keys + DELETE)`, `P3-FE-05 (Settings → Keys UI)`. Update IMPL §13.2 file inventory.
- **Path B: BYOK in v1.1.** Strike "(BYOK)" from PRD §5.1 #3. Strike "or per-tenant BYOK" from PRD §13.5. Mark DESIGN §9.5 as **v1.1, not v1**. Remove DESIGN §14.3 `/v1/llm/keys` rows. Add explicit V1.1 backlog section to PRD.

**Rationale:** Three docs, three answers. Audit #4 P0-Must-Have #4 says v1; PRD §5.1 says v1; PRD `FR-OS-10` says v1.1; IMPL silent. Cannot ship.

**Audit ref:** #2 §13 (no priority), #3 §15 #8, #4 §13 #4.

### #3 — Fix DB filename in PRD `NFR-REL-5`

**File:** `docs/PRD.md:255`
**Current text:** "Backup: `data/agentic.sqlite` snapshotted daily; retention 30 days."
**Proposed change:** "Backup: `data/agentic.db` snapshotted daily; retention 30 days."
**Rationale:** DESIGN §13.5 and IMPL P0-MIG-01 / P4-OPS-06 use `.db`. PRD outlier.
**Audit ref:** consistency only.

### #4 — Add task IDs for orphan critical fixes

**File:** `docs/IMPLEMENTATION.md` add to §4 (Phase 0) and §8 (Phase 4).
**Proposed additions:**
- **P0-API-01** — Fix `events.replay` id mint (use `makeId("evt")` instead of `${id}-replay-${Date.now()}`). File: `apps/api/src/routes/v1/events.ts:57`. Effort XS. Test: two replays in same ms produce different ids. **Audit ref:** #2 §3 events row.
- **P0-RT-09** — Manifest engine writes step-input/output artifact sidecars (parity with code path). File: `packages/runtime/src/step-engine.ts`, new helper `writeArtifact`. Effort S. Test: a manifest run completes → `data/artifacts/<runId>/step-1-{input,output}.json` exists. **Audit ref:** #3 §10.2, #3 §11.2.
- **P0-RT-10** — Manifest `task_timeout_s` honored (replace hardcoded `7d`). File: `packages/runtime/src/register.ts:209-215`. Effort XS. **Audit ref:** #3 §4.6.
- **P0-RT-11** — `PromptDescriptor.system` honored by step engine. File: `packages/runtime/src/step-engine.ts:127-156`. Effort XS. **Audit ref:** #3 §7.2.
- **P0-RT-12** — Delete dead `verifyHmac` in `apps/api/src/plugins/auth.ts:96-103`. Effort XS. **Audit ref:** #2 §9.7.
- **P1-RT-06** — BaseAgent code path passes `req.providers` chain to gateway. File: `packages/agents/src/run-engine.ts:165`. Effort S. Test: code agent with `providers: ["mock", "anthropic"]` falls over to mock on anthropic failure. **Audit ref:** #3 §5.6.
- **P1-RT-07** — Structured-output validate + repair-retry loop. File: `packages/agents/src/run-engine.ts`. Reads `BaseAgent.outputSchema`; on parse-fail re-prompts once with schema error. Effort M. **Audit ref:** #3 §15 #7.
- **P1-DB-02** — Schema-version `_meta` table + boot-time guard ("refuse to start if DB schema_version > supported"). File: `packages/db/src/schema.ts` + `apps/api/src/bootstrap.ts`. Effort S. **Audit ref:** #2 §4.2.
- **P2-FE-22** — Toast/snackbar component + global error toast for failed mutations. File: `apps/web/app/portal/components/Toast.tsx`. Effort S. **Audit ref:** #1 §8 #4 (pre-port blocker).
- **P2-FE-23** — Cmd-K command palette OR remove the button from TopBar. Decide. Effort S/M. **Audit ref:** #1 §8 #5.
- **P3-FE-05** — Settings → Audit view that reads `GET /v1/audit`. File: `apps/web/app/portal/settings/audit/page.tsx`. Effort S. **Audit ref:** #2 §13 #9, #4 §9.
- **P1-CLI-01** through **P1-CLI-04** — `apps/cli` package: `init`, `deploy`, `logs`, `events tail`. Effort M total. **Audit ref:** #4 §13 #1 (P0 Must-Have).
- **P3-API-03** — Atomic Inngest function re-registration on `POST /v1/agents` and `POST /v1/deployments/:id/rollback`. File: `apps/api/src/bootstrap.ts` (extract `registerAgentFns` so it can be re-called); `apps/api/src/routes/v1/agents.ts`. Effort M. **Audit ref:** #4 §13 #2.

### #5 — Rewrite PRD §12 to reflect resolved questions

**File:** `docs/PRD.md:362-379`
**Proposed change:** Mark Q1, Q3, Q5 (after fix #2), Q6, Q7, Q8 (after fix #6), Q12, Q13, Q14 as **DECIDED** with one-line decision + link to DESIGN section. Keep Q2, Q4, Q9, Q10, Q11, Q15 open with assigned owner and a deadline pre-Phase-0.
**Rationale:** PRD §12 is the single most misleading section. 11 of 15 questions are decided downstream; reader sees them as open. See §5 above.

### #6 — Fix PRD §5.2 #3 + §11 #8 internal contradiction on graph editor

**File:** `docs/PRD.md:108`, `docs/PRD.md:355`
**Proposed change:** Replace both bullets with one consistent statement:
> "**Workflow editor for existing manifests** (graph view + JSON editor, save back to `workflow_v1.json`) is in scope for v1 (Phase 3, P3-FE-01). **Drag-drop create-from-scratch** of new workflows is out of scope (v2 visual builder)."

**Rationale:** Resolves §3.4 contradiction.
**Audit ref:** #1 §8 #7.

### #7 — Clarify code-agent runtime path (sync v1, async v1.1)

**Files:** `docs/PRD.md:190` (`FR-RT-12`), `docs/DESIGN.md:535-538` (§6.1), `docs/DESIGN.md:598` (§6.3 row), `docs/IMPLEMENTATION.md` (add or defer task).
**Proposed change:** Pick one:
- **Path A:** Sync inline AND Inngest registration both in v1. Add `P1-RT-08` task: bootstrap code agents as Inngest functions; expose `?async=1` toggle. Update DESIGN §6.1 prose to drop "(v1.1)".
- **Path B:** Sync inline only in v1; Inngest registration v1.1. Update PRD `FR-RT-12` to say "code agents execute via direct invocation; Inngest function registration is v1.1."
**Rationale:** Audit #3 §9.1 #6 critical; PRD and DESIGN disagree internally. See §3.3.

### #8 — Resolve BYOK encryption primitive (Argon2 vs libsodium)

**File:** `docs/PRD.md:243` (`NFR-SEC-2`), `docs/DESIGN.md:1380` (§17.3).
**Proposed change:** Replace `NFR-SEC-2` text "encrypted with platform key (Argon2-derived)" with "encrypted with libsodium `crypto_secretbox` using a master key from `AGENTIC_KMS_KEY` env (or KMS in prod); rotated every 90 days."
**Rationale:** Argon2 is a password KDF, not an encryption primitive. DESIGN already chose libsodium.

### #9 — Pin pixel-diff tolerance

**File:** `docs/PRD.md:151` (`FR-PORT-3`), `docs/IMPLEMENTATION.md:315`.
**Proposed change:** Pick one: 0.1% or 1%. Update both docs.
**Rationale:** §6.1 testability gap.
**Audit ref:** #1 §7 R-6.

### #10 — Add explicit `FR-PORT-*` IDs for missing portal capabilities

**File:** `docs/PRD.md:145-159`.
**Proposed additions:**
- `FR-PORT-11` — Toast/snackbar surface for all failed mutations (Audit #1 §8 #4).
- `FR-PORT-12` — Tenant in URL pathname (Audit #1 §8 #2). Map to `P2-FE-01`.
- `FR-PORT-13` — `:focus-visible` styling + ARIA labels on interactive primitives (Audit #1 §3.1.1, §7 R-5). Map to new `P2-FE-24`.
- `FR-PORT-14` — Z-index ladder defined as design tokens (Audit #1 §7 R-11). Map to `P2-FE-02`.
- `FR-PORT-15` — Workspace timezone setting honored by `fmtAgo`/`fmtTime` (Audit #1 §7 R-10).

### #11 — Document the runtime trust model trade-off (R-7)

**File:** `docs/PRD.md:436` (R-7).
**Proposed change:** Expand mitigation column from "Wrap dynamic-imported code in try/catch + Inngest function boundary; future: worker isolation" to:
> "v1: self-host single-org or trusted-tenant SaaS only. Document in `docs/SECURITY.md` (new). Wrap dynamic-imported code in try/catch + Inngest function boundary. Crash-resistant Inngest function boundary catches process-level errors and marks the run failed. **Not deployable to adversarial multi-tenant SaaS until P-v1.1-SANDBOX lands** (Audit #4 §13 #15)."
**Rationale:** §1 critique point 5; the high risk currently has a deferred mitigation. Make the trust model explicit.

### #12 — Add the missing audit + retention tasks

**File:** `docs/IMPLEMENTATION.md`, new tasks.
**Proposed additions:**
- **P1-API-04b** — Soft-delete + retention policy: `events.deleted_at`, `runs.deleted_at`, `tasks.deleted_at`. Nightly Inngest cron sweeps `WHERE received_at < now() - retention`. **Audit ref:** #2 §13 #9.
- **P0-DB-01** — Add `created_at` / `updated_at` to `agents`, `agent_versions`, `event_listeners`, `event_types`, `entity_types`. **Audit ref:** #2 §4.4.

### #13 — Persona acceptance criteria for Wu Hao

**File:** `docs/PRD.md:84-92` (§4.4).
**Proposed change:** Add explicit `FR-PORT-16`: signed task-resolution URL endpoint, email/WeChat notification dispatch (already in §9.6 prose but no `FR-*` ID).
**Audit ref:** #4 §3 (manual / HITL).

---

## 8. Sign-off checklist

What MUST be fixed before docs are sealed (P0 blockers), what SHOULD be fixed (P1, do before any related task starts), and what is nice-to-have.

### 8.1 MUST FIX before docs are sealed (blocks Phase 0 start)

- [ ] **MUST-1** — IMPL §14.1 `tool_use` shape (Rec #1). One-line fix; the wrong type ships into typed code.
- [ ] **MUST-2** — BYOK timing decided (Rec #2). Three docs three answers; pick one.
- [ ] **MUST-3** — PRD `NFR-REL-5` DB filename (Rec #3). One-word fix.
- [ ] **MUST-4** — PRD §12 rewrite to mark decided questions (Rec #5). Without this, the PRD is misleading.
- [ ] **MUST-5** — PRD §5.2 #3 vs §11 #8 graph-editor contradiction (Rec #6).
- [ ] **MUST-6** — Code-agent runtime path decided (Rec #7). Without this, P1 builders block on "does this register an Inngest function or not?"
- [ ] **MUST-7** — BYOK encryption primitive consistent (Rec #8). Argon2 vs libsodium must be resolved before NFR-SEC-2 ships as testable.
- [ ] **MUST-8** — Pixel-diff tolerance pinned (Rec #9). 0.1% vs 1% changes the FE acceptance gate by 10x.
- [ ] **MUST-9** — Add P0-API-01 (replay id collision) — Audit #2 critical-adjacent.
- [ ] **MUST-10** — Add P1-CLI-* tasks for `apps/cli` (Audit #4 #13 #1 is P0 Must-Have, but invisible in IMPL).
- [ ] **MUST-11** — Add `P3-API-03` atomic Inngest re-registration task (Audit #4 #13 #2 P0; DESIGN promises it; IMPL is silent).

### 8.2 SHOULD FIX before related work starts

- [ ] **SHOULD-1** — Add P0-RT-09..12 + P1-RT-06..07 + P1-DB-02 (Rec #4). Phase 0 needs them on its critical path.
- [ ] **SHOULD-2** — Add P2-FE-22..24 (toast, Cmd-K decision, a11y) before Phase 2 start.
- [ ] **SHOULD-3** — Add P3-FE-05 (Settings → Audit view) before Phase 3 lockdown.
- [ ] **SHOULD-4** — Risk R-7 trust-model documentation (Rec #11).
- [ ] **SHOULD-5** — Soft-delete + retention tasks (Rec #12).
- [ ] **SHOULD-6** — `FR-PORT-11..16` portal capabilities (Rec #10, Rec #13).

### 8.3 NICE-TO-HAVE (post-launch)

- [ ] Cancellation primitive (Audit #3 §9.4).
- [ ] Per-agent concurrency from `BaseAgent.concurrency` (Audit #3 §9.1 #2).
- [ ] Subject auto-binding to `input_data.candidate_id` (Audit #3 §8.3).
- [ ] Step `ord` UNIQUE constraint (Audit #2 §4 steps row).
- [ ] Eval harness scaffolding (`pnpm eval` + `evals/<agent>/cases.json`) — Audit #3 §14.
- [ ] Light-theme contrast audit (Audit #1 §8 #9).
- [ ] Test-run retention policy (Audit #1 §8 #12).

### 8.4 Continuous discipline

- [ ] Every commit closing an audit finding includes `Closes audit NN-… §X.Y` in commit body (IMPL §3.5 already mandates).
- [ ] PRD §12, IMPL §13 status table, and DESIGN §4.5 status snapshot must update with every merged task. The current state is 2026-05-19 baseline; drift will mount fast.
- [ ] Once MUST-* items are merged, re-run this critique. Expect ~5 remaining orphans (eval harness, sandbox, a11y, retention, cancellation) — all v1.1 acceptable.

---

## 9. Appendix — files cited

| File | Where in this critique |
|---|---|
| `docs/PRD.md:100, 108, 145-159, 179, 190, 199, 205, 243, 255, 355, 362-379, 415, 421, 436` | Contradictions §3, Open questions §5, Recs §7 |
| `docs/DESIGN.md:321, 398, 535-538, 598, 677, 867-882, 953-957, 1128, 1250-1251, 1364, 1380, 1525` | Contradictions §3, Open questions §5, Orphans §4 |
| `docs/IMPLEMENTATION.md:59, 158, 220, 240-246, 310, 315, 379, 382, 429, 439, 499-503, 644-668, 709, 855` | Contradictions §3, Orphans §4, Recs §7 |
| `docs/audits/01-product-design-fidelity.md` §2.5, §3.1.1, §7 R-1..R-11, §8 #1..#12, §9 | §2.4, §4.4, §6 |
| `docs/audits/02-backend-implementation-review.md` §3, §4, §5, §6, §7, §9, §10, §11, §12, §13 | §2.1, §4.1, §6.1 |
| `docs/audits/03-ai-runtime-review.md` §3.1, §3.4, §4.2, §4.3, §4.6, §5.4, §5.6, §7.2, §8.3, §9.1, §10.2, §11.2, §14, §15 | §2.2, §4.2, §7 Rec #1, #4, #7 |
| `docs/audits/04-agent-os-readiness.md` §3, §13 (15 MUST-haves), §15 (10 refinements), §16 (roadmap) | §2.3, §4.3 |

---

*End of cross-review critique. The docs are close but not yet sealed. Apply MUST-1..MUST-11 before any code lands on `main`.*
