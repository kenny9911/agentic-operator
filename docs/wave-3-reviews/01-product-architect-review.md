# Wave 3 Review — Chief Product Architect

**Date:** 2026-05-21
**Reviewer:** Chief Product Architect
**Inputs reviewed:** `docs/PRODUCT_CATALOG.md` (master, 2.9k words), `docs/USE_CASES.md` (109 UCs, ~3.9k words), three slice catalogs (`01-product-design`, `02-ai-runtime`, `03-platform`, ~32k words total), `docs/PRD.md` (488 lines), `CLAUDE.md`, `apps/api/src/routes/v1/` + `packages/*`.
**Verdict:** **CONDITIONAL** — V1 is a coherent product for an internal alpha or trusted-tenant pilot, but four V1.1 items are paying-customer blockers and three catalog contradictions must be resolved before V1.1 planning starts. List in §4 + §6.

---

## 1. Catalog completeness

The cross-reference matrix in `PRODUCT_CATALOG.md` §7 has 16 rows. After walking the three slices, the master PRD, and the actual source tree, the matrix is missing or misrepresents the following:

### 1.1 Documented in slices but missing from master cross-reference matrix

| Feature (with at least one slice ID) | Where it lives | Suggested matrix row | Suggested status |
|---|---|---|---|
| **Schedule trigger (CRON)** — `FR-OS-1` + DESIGN §15 + `packages/runtime/src/scheduler.ts` referenced inline in `AR-RAAS-01` | UX angle: none; Runtime: implied via `AR-RAAS-01` (the syncFromClientSystem trigger is `SCHEDULED_SYNC`); Platform: no `PF-API-SCH-*` exists | Add: "Scheduled trigger \| (Settings → schedule) ❌ \| AR-INN-* missing \| PF-API-SCH-* missing" | 🟡 V1.1 — the wiring is in `packages/runtime/src/scheduler.ts` but the operator-facing surface is undocumented |
| **`POST /v1/events/:id/replay` (event-level replay)** vs `POST /v1/runs/:id/replay` (run-level replay) | Matrix conflates them under "Replay run" → U1.14 + AR-EVT-03 + PF-API-EVT-replay. Slice 02 `AR-EVT-03` describes event-level; slice 01 `U1.14` describes run-level. They are *different routes*. | Split into two rows. Run replay = U1.14 + FR-OBS-4 + PF-API-RUN. Event replay = (Events view "Replay event" button — currently UI-only per slice 01 §1.1 row 5) + AR-EVT-03 + PF-API-EVT-02 | Run replay ✅; Event replay 🟡 V1.1 (button is UI-only) |
| **Webhook subscriptions table CRUD (`POST/PUT /v1/webhooks/...`)** | Slice 02 `AR-EVT-04` documents the ingest path; slice 03 `PF-DB-21` documents the table; slice 03 `PF-API-WHK-01` only documents the ingest endpoint. **There is no CRUD endpoint for the `webhook_subscriptions` table in `apps/api/src/routes/v1/webhooks.ts`** — operators cannot register a per-source secret without writing SQL. | Add row: "Webhook subscription CRUD \| (Settings → Integrations) ❌ \| AR-EVT-04 \| PF-API-WHK-CRUD missing" | 🟡 V1.1 — table exists, ingest works, but UI cannot create rows |
| **Reads endpoints** (`/v1/counts`, `/v1/workflows/dag`, `/v1/event-types`, `/v1/entity-types`) | Slice 03 `PF-API-RDS-01..04` documents them; matrix doesn't mention them; slice 01 §1.1 implies them (dashboard KPI strip + workflows view consume them) | Add row: "Dashboard data feeds \| Dashboard / Workflows view \| (none) \| PF-API-RDS-01..04" | ✅ V1 |
| **Schema editor / drift gate (`/v1/workflow/schema`)** | Slice 03 `PF-API-WF-01` documents `GET /v1/workflow/schema`; slice 01 §1.1 doesn't mention it; matrix is silent. PRD §13.6 quality-gate references it. (Memory note: there's a Wave-2 schema-editor project, `project_schema_editor.md`.) | Add row: "Workflow schema export \| (Settings → Models? Or new "Schema" sub-view) ❌ \| (none) \| PF-API-WF-01" | 🟡 V1.1 — endpoint ships, UI doesn't |
| **LLM fleet CRUD (`/v1/llm/fleet`)** | Slice 03 `PF-API-LLM-08` documents `GET/POST/PATCH/DELETE /v1/llm/fleet`; slice 01 mentions ConfigureModelDrawer in journey 2.2.3 but no matrix row | Add row: "Model fleet management \| Settings → Models \| AR-LLM-* (missing) \| PF-API-LLM-08" | ✅ V1 |
| **Artifact streaming (`GET /v1/artifacts/:id`)** | Slice 03 `PF-API-ART-01` documents it; slice 02 `AR-RUN-02` mentions step input/output sidecars; matrix silent | Add row: "Artifact download \| Run detail → io tab (download links) \| AR-RUN-02 \| PF-API-ART-01" | ✅ V1 |
| **Memory primitives** — backed by `agent_memory_short`/`agent_memory_long` | Slice 02 `AR-MEM-01..05`; slice 03 `PF-DB-22`/`PF-DB-23`; matrix silent | Add row: "Agent memory KV \| (none — invisible to portal in V1) \| AR-MEM-01..05 \| PF-DB-22/23" | ✅ V1 backend, 🔵 V2 portal surface |
| **Provider-key vault (BYOK at workspace + tenant scope)** | Matrix has "BYOK vault" row pointing at AR-LLM-06 + PF-API-LLM-keys + PF-ENV-09. Slice 02 `AR-LLM-06` documents the implementation. `AGENTIC_KEY_VAULT_SECRET` (the actual env var name in `apps/api/src/services/provider-keys.ts`) is NOT in the matrix. PRD `NFR-SEC-2` and slice 03 `PF-ENV-09` say `AGENTIC_KMS_KEY` is the name. **The two slices contradict each other and the actual code** (see §3.2) | Reconcile env-var name; update matrix | ✅ V1 (works); contradiction is documentation-only |

### 1.2 Implied by PRD but absent from catalog

| PRD requirement | What it implies | Where it should land |
|---|---|---|
| **`FR-API-4` (pagination on all list endpoints with `cursor` + `nextCursor`)** | Every `GET /v1/runs`, `/v1/events`, `/v1/tasks`, `/v1/agents`, `/v1/audit` should accept cursor-based pagination. | Slice 03 PF-API-* rows. The runs/events/tasks list endpoints in `PF-API-RUN-01`, `PF-API-EVT-03`, `PF-API-TSK-01`, `PF-API-AGT-01` **do not document `cursor`/`nextCursor`** support. Audit log (`PF-API-AUD-01`) does. Likely status: 🟡 V1.1 (partial — only audit is correct). Add a `PF-GAP-19` for "pagination contract incomplete." |
| **`FR-API-5` (Idempotency-Key on POST endpoints — 24h dedupe window)** | Documented in `PF-GAP-10`; flagged as stub. Catalog is consistent. | n/a — already captured |
| **`FR-PORT-15` (workspace timezone honored by `fmtAgo`/`fmtTime`/log timestamps)** | Slice 01 G12 flags partial coverage; matrix silent. | Add row: "Workspace timezone \| Settings + every time display \| (none) \| PF-WEB partial". 🟡 V1.1 |
| **`FR-RT-4` (`action.condition` field parsed and evaluated; matching actions execute)** | Slice 02 `AR-TOOL-04` documents condition action; matrix silent. | Add row: "Condition action \| (Workflows DAG branch labels) \| AR-TOOL-04 \| (none)". ✅ V1 |
| **`FR-OS-1` (Scheduled trigger)** | Already flagged in 1.1 above. |
| **`FR-OS-2` (Webhook trigger: per-workflow signed HTTP endpoint)** | Different from `FR-API-10`'s ingestion endpoint — `FR-OS-2` says *per-workflow* signed endpoint. **Not implemented anywhere I can find in the source tree.** Catalog claims `AR-EVT-04` covers it but that's the inbound HMAC ingest, not a per-workflow URL mint. | Add `AR-GAP-19` + `PF-GAP-19a` "Per-workflow webhook URL mint missing." 🔵 V2 |
| **`FR-PORT-14` (Z-index ladder + ESLint rule)** | Slice 01 §1.5 documents both. Already in catalog. ✅ |

### 1.3 Mentioned in `CLAUDE.md` but absent from platform catalog

| `CLAUDE.md` claim | Slice 03 coverage |
|---|---|
| `pnpm seed:rich` — RAAS historical fixtures + English ontology overlay | Slice 03 `PF-BUILD-08` does cover it. ✅ |
| `apps/cli` has `agentic events tail` that hits `/v1/stream` SSE | Slice 03 `PF-CLI-04` documents the command. Slice 03 `PF-GAP-11` claims `/v1/stream` is "not registered." **This is wrong** — `apps/api/src/server.ts` line 56 imports and registers `streamRoutes`, `tenantCodeRoutes`, `workflowRoutes`. The `PF-GAP-11` and `UC-V11-33` entries are stale. See §3.1. |
| `AGENTIC_REBOOTSTRAP=force` env override | Slice 03 mentions this in `PF-MIG-TST-*` testing notes; no PF-ENV row. Add `PF-ENV-24` "AGENTIC_REBOOTSTRAP" with status ✅. |
| **`apps/web/app/portal/[tenant]/(views)/`** — 9 view directories: agents, dashboard, deployments, events, logs, runs, settings, tasks, workflows | Confirmed on disk. Matches slice 01 §1.1's 9 views. ✅ |
| **`@agentic/agent-runtime`, `@agentic/agent-sdk`, `@agentic/agent-kit`** parallel SDK family | Slice 03 `PF-MR-05`/`PF-MR-06` covers them but says "legacy `@agentic/agents` surface is still the API entry point." Confirmed by `apps/api/package.json`. ✅ |

### 1.4 Visible in file system but missing from PF-API or PF-MR

| File-system reality | Where it should land |
|---|---|
| `apps/api/src/routes/v1/audit.ts` exists with `auditRoutes` | Slice 03 `PF-API-AUD-01` covers it. ✅ |
| `apps/api/data/imports/dpl-e98006b51cd4/` — staging dir is *committed* via `git status` shown in the env block | This is the very `PF-GAP-09` situation; the catalog is honest but the repo is currently in a state that demonstrates the gap. Action: priority bump on `UC-V11-31`. |
| `models/RAAS-v1/workflow_v2.json` — second workflow version on disk (status: untracked) | This is a manifest-import staging artifact. Not catalogued. The catalog only describes the *commit* mechanism (`PF-IMP-04` writes `workflow_v<N+1>.json`); a "second version on disk that isn't yet promoted live" is a normal mid-import state, but the file presence + untracked status hints at an incomplete commit. Action: confirm whether this is a stale dev artifact or a planned V2 manifest. If stale, add to `UC-V11-31` cleanup. |

**Catalog completeness summary:** 11 feature rows are either missing, mis-merged, or stale. Add them to the matrix; status is mostly ✅ or 🟡 V1.1. None of them block V1 sign-off, but the catalog claim "single source of truth" requires this round of edits before V1.1 planning.

---

## 2. V1 / V1.1 / V2 boundary

I walked all 109 use cases. The status assignments are mostly defensible. Disagreements below.

### 2.1 UC-V1-* I'd actually move to 🟡 V1.1 (overstated as shipped)

| Current | Reassign to | Why |
|---|---|---|
| **UC-V1-14 (Replay run)** ✅ → split | **UC-V1-14a (run replay) ✅**; **UC-V1-14b (event replay button at Events view) 🟡** | Slice 01 §1.1 row 5 says "Replay event wired but UI-only." The single "Replay" use case obscures that only the run-level path works. Tests cite `tc-event-replay.test.ts` covering both but the Events view button doesn't reach the API. Confirmed in slice 01 §1.1 row 5. |
| **UC-V1-19 (Inspect run input + output side-by-side)** ✅ | **Still ✅** but flag: io tab works; the *download artifact links* are partially wired. `PF-API-ART-01` ships but the UI doesn't always surface them. Minor — keep ✅ with caveat. |
| **UC-V1-23 (View per-day cost breakdown by agent + model)** ✅ | **🟡 V1.1** | The acceptance test coverage map on line 280 of `USE_CASES.md` literally says this is "❌ blocked" pending `UC-V11-17 + UC-V11-38`. Marking it ✅ V1 in §1.3 contradicts the test status. Fix: demote to 🟡 V1.1 (will land once envelope unwrap fix is in). |
| **UC-V1-25 (Provision a new tenant via 4-step wizard)** ✅ | **Still ✅** but: slice 01 §2.3.5 + slice 03 `PF-API-TEN-02` confirm the route + the modal exist. Tests at `tc-tenants.test.ts` pass. Keep ✅. |
| **UC-V1-31 (Wu Hao receives internal-channel ping)** ✅ | **🟡 V1.1** | Slice 01 §2.4 itself says "the dispatcher backbone (WeChat, email) is *stubbed* in v1 — the route is present but never invoked." Mock = not shipped. Slice 02 `AR-TOOL-01` confirms the `channel.publish` tool returns `{delivered:true}` synthetically. Move to V1.1. (USE_CASES.md hedges this with "best-effort" but it shouldn't be on the V1 list at all.) |
| **UC-V1-49 (`agentic init` scaffolds tenant)** ✅ | **🟡 V1.1** | `AR-GAP-03` + `PF-GAP-03` + `UC-V11-19` all flag that `agentic init` writes the wrong `actions_v1.json` shape. Every new tenant created via the CLI *fails first deploy* without manual edit. This is not "shipped"; it's "shipped broken." Demote. |

### 2.2 UC-V11-* that should actually be 🔵 V2 (lift is larger than slice claims)

| Current | Reassign to | Why |
|---|---|---|
| **UC-V11-01 (Wu Hao WeChat/email ping with signed task-resolution link)** 🟡 | **Stays 🟡 V1.1** but flag: depends on `@agentic/notifications` package that does not exist. The slice claims "wire the adapter" but the adapter *workspace* is net-new. Effort estimate in `USE_CASES.md` §5.2 P1 is wrong; this is days-to-weeks (package scaffold, WeChat Work OAuth, AWS SES sender identity, retry/DLQ, audit on every ping). Keep V1.1 but redo the cost. |
| **UC-V11-02 (Wu Hao submits corrected resume from signed URL)** 🟡 | **Stays 🟡** but **depends on UC-V11-01** — without notifications, the signed URL never reaches Wu Hao. They must ship together. |
| **UC-V11-08 (Pause LIVE stream subscription server-side)** 🟡 | **Stays 🟡** but flag: requires SSE-session state on the server (in-memory map keyed by session id) — a non-trivial addition to the stateless Fastify model. Within "hours-to-days," yes, but at the upper end. |
| **UC-V11-11 (Visualize trace tree of multi-step workflow run — full ancestor chain)** 🟡 | **🔵 V2** | The slice claims this is half-built. In reality the run-row schema only has `parent_run_id`; lateral siblings (subflow fan-out where parent has many children) require either (a) a recursive CTE that SQLite supports but the codebase doesn't use, or (b) a graph-walk in JS that's O(n²) on long chains. Either is a real engineering effort plus a frontend rebuild. Move to V2. |
| **UC-V11-29 (Wire cookie auth on Fastify in prod)** 🟡 | **Stays 🟡** but flag: this is a P1 production blocker (see §4). The slice classifies it correctly but its priority on the punch list is right. |
| **UC-V11-34 (Instrument OpenTelemetry spans)** 🟡 | **🔵 V2** | Real OTel work requires an operator-supplied collector, sampling strategy, trace-context propagation through the Inngest boundary (which doesn't natively understand W3C trace-context). This is a multi-day engineering effort, not "hours-to-days." Move to V2 with an RFC. The catalog's `PF-GAP-14` correctly says V1.1 but the lift is larger. |
| **UC-V11-36 (Build DLQ for orphaned runs)** 🟡 | **🔵 V2** | New table + new endpoint + new "Retry / Drop" UI in runs view. Slice 03 `PF-GAP-16` says "V1.1 plan" but this is a fresh sub-system with its own state machine. Move to V2 RFC. |

### 2.3 UC-V11-* that should be ✅ V1 (done but not catalogued)

| Current | Reassign to | Why |
|---|---|---|
| **UC-V11-33 (Register `/v1/stream` + `/v1/tenant-code` + `/v1/workflow` routes)** 🟡 | **✅ V1 — already registered** | I verified `apps/api/src/server.ts:56` imports `streamRoutes`, `tenantCodeRoutes`, `workflowRoutes` AND lines later register them under the `/v1` mount. The slice 03 `PF-GAP-11` claim "not registered" is stale. Either it landed and the catalog wasn't updated, or the gap was theoretical. **Verify once more, then demote `UC-V11-33` to ✅.** This also means `agentic events tail` (`PF-CLI-04`) should NOT be 404-ing. Test: `pnpm dev` and curl `/v1/stream` — if the route exists in routing table, this gap is closed. |
| **UC-V11-38 (`/v1/usage` registered AND hook works)** 🟡 (split into two halves) | The route registration half is ✅ (also in server.ts). The hook-envelope-unwrap half (= `UC-V11-17`) is still 🟡. **Split the use case: route registration ✅, hook fix 🟡 V1.1.** |

### 2.4 UC-V2-* that should be V1.1 (rare; lift small enough)

I found one candidate, but it's marginal:

| Current | Could move to 🟡 V1.1 | Why |
|---|---|---|
| **UC-V2-15 (Gateway-level JSON-output enforcement + repair loop)** 🔵 | **Stays 🔵** | The slice says "Lift the repair into the gateway." The code-agent path already has it (`P1-RT-07`); lifting it to the gateway means adding ZodType-aware validation to every adapter's response handler — a 1-2 day refactor with clear seams. Could be V1.1 if there's appetite. Keep as 🔵 for now since the unified-run-engine work (`UC-V2-16`) will subsume it. |

### 2.5 V1/V1.1/V2 verdict

After reassignment, totals:

| Status | Count (revised) | Δ from catalog |
|---|---|---|
| ✅ V1 shipped | 49 | −2 (UC-V1-23 + UC-V1-31 + UC-V1-49 to V1.1; UC-V11-33 + half of UC-V11-38 to V1) |
| 🟡 V1.1 ready | 41 | +2 |
| 🔵 V2 vision | 22 | +3 |
| **Total** | **112** | +3 from the split of UC-V1-14 + new gap rows |

The catalog's reported "~51 ✅ / ~36 🟡 / ~17 🔵 = 109" optimistically counts work that doesn't quite work. Honest accounting brings ✅ down to 49 — still a *substantial* V1.

---

## 3. Cross-slice contradictions

These are places where the three slices disagree or contradict the code.

### 3.1 `/v1/stream`, `/v1/tenant-code`, `/v1/workflow` route registration

- **Slice 03 `PF-API-STR-01`:** "Not registered in `server.ts` yet (per inline comment)" → 🟡
- **Slice 03 `PF-GAP-11`:** Confirms not registered → 🟡
- **Slice 03 `PF-API-WF-03`:** "this route is *not yet registered* — see PF-GAP-01" → 🟡
- **`USE_CASES.md` `UC-V11-33`:** Confirms the registration is missing → 🟡 (P1)
- **Reality (`apps/api/src/server.ts:56-58`):** All three modules are imported and registered. The `await v1.register(streamRoutes); await v1.register(tenantCodeRoutes); await v1.register(workflowRoutes);` lines are in the file.

**Verdict:** The catalog is stale. Either the registration landed after the catalog was written, or the original audit (`p4-test-ci-status.md`) was wrong. Either way, **`PF-GAP-11`, `UC-V11-33`, `PF-API-STR-01`, `PF-API-WF-03` all need their status flipped to ✅.** This is a P0 catalog edit (it changes which P1 punch-list items remain).

### 3.2 Env-var name contradiction: `AGENTIC_KMS_KEY` vs `AGENTIC_KEY_VAULT_SECRET`

- **Slice 02 `AR-LLM-06`:** "master key is derived via `scrypt(secret, salt, 32)` where `secret = AGENTIC_KMS_KEY` env var (the v1 design doc spells this `AGENTIC_KEY_VAULT_SECRET`; both names appear in code — the canonical resolver at `provider-keys.ts:84-87` reads `AGENTIC_KEY_VAULT_SECRET` falling back to `dev-vault::${hostname()}`)"
- **Slice 03 `PF-ENV-09`:** "Reserved for V2 BYOK secrets vault. ... Not currently read."
- **PRD `NFR-SEC-2`:** "encrypted with libsodium `crypto_secretbox` using a master key from `AGENTIC_KMS_KEY` env"
- **Reality (`apps/api/src/services/provider-keys.ts`):** Reads `AGENTIC_KEY_VAULT_SECRET` (confirmed by grep).

**Verdict:** Three documents disagree on (a) which env var is read, (b) whether it's V1 or V2, (c) whether libsodium or scrypt is used. The code is authoritative: `AGENTIC_KEY_VAULT_SECRET` is read in V1 via `scrypt`. Action: **fix `PF-ENV-09` to ✅ V1 with the correct name, and update PRD `NFR-SEC-2` for the next revision.** Also update slice 02 to remove the "v2 design spells this differently" hedge.

### 3.3 `AR-GAP-01` (`/v1/usage`) — three contradictory states

- **`AR-GAP-01`:** "Originally flagged as 'route not wired in `server.ts`,' but `apps/api/src/server.ts:105` does register `usageRoutes`. The actual remaining gap is that the App Router page ... hits the route via a `useUsage` hook that doesn't yet handle the v1 envelope shape correctly."
- **`PF-GAP-01`:** "`apps/api/src/routes/v1/usage.ts:81` declares `GET /v1/usage` but `apps/api/src/server.ts` never registers the route module. Settings → Usage view 404s."
- **`UC-V11-17`:** Hook envelope-unwrap fix → Frontend
- **`UC-V11-38`:** "Ensure `/v1/usage` route is registered AND the hook works end-to-end" → Full-stack
- **Reality:** `apps/api/src/server.ts` imports `usageRoutes` and registers it under `/v1`. The route IS registered.

**Verdict:** `AR-GAP-01` is correct; `PF-GAP-01` is stale. The remaining work is **only** the hook envelope fix (`UC-V11-17`), not a server-side change. **Demote `UC-V11-38` to a duplicate of `UC-V11-17` and remove `PF-GAP-01`.** This is a documentation lie that has propagated to the punch list as a P1 blocker — it shouldn't be one.

### 3.4 `AR-GAP-02` ↔ `PF-GAP-02` ↔ `UC-V11-18` = `UC-V11-28` (POST /v1/agents 500)

- All three slices agree this is a real V1.1 bug.
- The duplicate accounting (`UC-V11-18` from AR-side and `UC-V11-28` from PF-side, "captured from platform angle") makes the V1.1 count look heavier than it is — there's *one* bug, listed twice.

**Verdict:** Acceptable for traceability but should be resolved before V1.1 planning. **Action: collapse `UC-V11-28` into `UC-V11-18` with a "tracked from both AR and PF angles" note.** Saves one punch-list slot.

### 3.5 ID overlap risk: `D-*` (design deltas) vs the catalog's `PD-*` mention

Slice 02 `AR-AK-02` says "see slice 01 § 6.3 PD-* IDs" but slice 01 uses `U1.*`/`U2.*`/`U3.*` for use cases and `D-1..D-11` for design deltas. **There are no `PD-*` IDs in slice 01.** This is a typo in slice 02; expected = `U*` or `D-*`. Action: **fix the cross-reference in slice 02 § AR-AK-02 second paragraph.**

### 3.6 Acceptance criteria mismatch: TTFR

- **PRD §6.1:** "Manifest agent: ≤ 30 min (target), ≤ 60 min (must); Code agent: ≤ 2 hr (target), ≤ 4 hr (must)"
- **Slice 01 §6 (Persona acceptance):** "Liu Wei: TTFR for a manifest-agent change ≤ 30 min (PRD §6.1). ... Chen Mengjie: TTFR for a code-agent change ≤ 2 hr (PRD §6.1)."
- **Reality / no measurement:** I cannot find a Wave 2 milestone that *measured* TTFR end-to-end. The 30-min and 2-hr targets are aspirational, not validated.

**Verdict:** This is acceptable — Wave 5 testing should include a TTFR measurement journey for each persona. **Action: add explicit "measure TTFR" tasks to Wave 5 test plan.** Not a sign-off blocker, but the V1.1 planning meeting should know that the target isn't a measured baseline.

### 3.7 `AR-RAAS-10` ontology-instructions claim

- **`PRODUCT_CATALOG.md` §4 ("Surprise finding"):** "`10-1 ruleCheckerForClientResume` is the only RAAS node that actually populates `ontology_instructions`."
- **`AR-RAAS-10`:** "The `ontology_instructions` block (line 436) is the only non-empty example in the manifest"

These agree. But the implication of this for V1 readiness is severe: **every other manifest agent ships an empty ontology, which means the `AR-GAP-13` foot-gun (logic fallback sends bare description as user content) is the *default behavior* of the entire RAAS workflow**, not a corner case. The catalog flags this honestly but the master should make it more prominent.

**Action: elevate `AR-GAP-13` from "🟡 v1.1 fix" to a P1 V1.1 punch-list item. RAAS LLM cost and quality both depend on it.** See §4.

---

## 4. Scope sign-off

**Verdict: CONDITIONAL on the four P1 V1.1 items landing before any paying customer.**

### Paragraph 1: Why V1 is coherent

V1 ships a real product. The dual-authoring story (manifest JSON + TypeScript code with a unified `runs`/`steps`/`events` ledger) is delivered end-to-end. The 14-provider LLM gateway works for 12 providers (Bedrock + Vertex stubbed; documented honestly). The Inngest durability contract is real, code-reviewed (`packages/runtime/src/register.ts:165-280`), and tested. Multi-tenant isolation is enforced at every query via `tenantScope()` with a regression suite. The 9-view portal mirrors the v1_1 design at pixel-fidelity (Playwright diff). The RAAS canonical workflow (17 nodes, 14 Agent + 3 Human) demonstrates every harness contract — manifest agents, HITL, branching emits, subject-id transitions, cost rollup. Build/deploy/observe surfaces (Dockerfile, healthchecks, Prometheus metrics, audit log, SSE log tail, backup script) are all present. This is unambiguously enough to call a V1 launch and run an internal alpha against the RAAS use case.

### Paragraph 2: Why CONDITIONAL — four items that MUST land

That said, four V1.1 items are paying-customer blockers and *should not* be deferred to a V1.1 cadence if the goal is external sign-up:

1. **UC-V11-29 — Cookie auth on Fastify in prod** (`PF-GAP-05`). The web app sets a cookie, but Fastify can't read it in prod, so the API falls back to bearer for every browser call. This means the portal cannot work for any customer who hasn't first issued a bearer token via the API for themselves. PRD `FR-API-1` lists "auth required on all `/v1/*` endpoints in every environment" as a requirement — V1 ships the bearer half but not the cookie half. **Blocker for external customer signup.**
2. **UC-V11-18 / UC-V11-28 — `POST /v1/agents` 500 on tenants with live tenant-code deployment** (`AR-GAP-02` + `PF-GAP-02`). Every customer who uses `agentic deploy` then tries to save a manifest hits this. Documented workaround is "archive code, save manifest, redeploy code" — operationally terrible. **Blocker for any customer who uses both authoring paths.**
3. **UC-V11-19 — `agentic init` writes wrong `actions_v1.json` shape** (`AR-GAP-03` + `PF-GAP-03`). Every new tenant created via CLI fails first deploy. **Blocker for self-service onboarding.**
4. **UC-V11-25 / AR-GAP-13 — `logic` action sends bare description as user content** when no tenant prompt is defined. The RAAS workflow runs in this fallback mode for every node except `10-1`. The LLM responds to "请检查客户规则" verbatim with limited context — output quality is unstable. **Blocker for trustable LLM cost + output quality.**

If these four land, V1.1 becomes a defensible paying-customer release. Without them, V1 is an internal-alpha-only product. Lifting them out of V1.1 and into "V1 final hardening" (a 1-2 week sprint before external launch) is the recommended path.

### V1.1 punch-list items that are NOT blockers but should still be on the milestone:

- `UC-V11-17` / `AR-GAP-01` — `/v1/usage` envelope unwrap fix (Settings → Usage shows zero) — P2 credibility
- `UC-V11-20` — Tasks view extra "operator" row — P2 visual regression
- `UC-V11-21` — `runs.emittedEvent` name hydration — P2 polish
- `UC-V11-22` — Manifest engine bumps `runs_total` counter — P2 ops accuracy
- `UC-V11-27` — Remove `WEBHOOK_HMAC_SECRET_DEFAULT` fallback — P2 security hardening
- `UC-V11-32` — Idempotency-Key enforcement (`PF-GAP-10`) — P3 (real if traffic doubles)

### V2 items that are correctly deferred:

- Worker isolation (`PF-GAP-13`, R-7 HIGH risk per PRD §14). V1 trust model is self-host single-org or trusted-tenant SaaS only, documented honestly.
- Eval harness (`PF-GAP-12`). PRD §13.6 references it but no implementation. V2 scope.
- Vector memory (`AR-GAP-14`). `MemoryHandle.search` throws clear error. Driver contract exists.
- Async invoke for code agents (`AR-GAP-08`). 501 with clear hint. V2.
- TypeScript snippets sandbox (`AR-GAP-10`). Field reserved.

---

## 5. Missing personas or journeys

### 5.1 Liu Wei (Workflow Designer)

| Missing journey | What's missing | Where it should land |
|---|---|---|
| **Rollback a bad deployment after promoting** | `POST /v1/deployments/:id/rollback` exists (`PF-API-DPL-02`); slice 01 journey 2.1.3 covers promote but not rollback-recovery. What if Liu promotes a draft, runs hit failures, and they need to revert in 30s? | Add UC-V11-40: "Liu Wei rolls back a live deployment within 30s after detecting failure" — UI: `/deployments` → live row → "Rollback to previous" button. Backend ready; UI surface needs explicit affordance. 🟡 V1.1 |
| **Compare two workflow versions side-by-side** | Slice 01 §1.1 row 8 mentions "Diff view between versions" in PRD §9.8 but the deployment history table doesn't actually surface a diff. | Add UC-V11-41: "Diff two workflow versions" — pull both `workflow_versions.manifest_json` rows, render side-by-side JSON diff. 🟡 V1.1 |
| **Resume an in-flight manifest-import session** | Slice 03 `PF-IMP-06` documents the 423 LOCKED response with the in-flight `deployment_id`; slice 01 journey 2.1.1 doesn't mention this. What does Liu do when the modal says "another import is in flight"? | Add UC-V11-42: "Resume or cancel an in-flight manifest import" — surface the 423 in the modal with explicit options. `DELETE /v1/tenants/:slug/manifest-import/:dpl-id` exists. 🟡 V1.1 |

### 5.2 Chen Mengjie (AI Engineer)

| Missing journey | What's missing | Where it should land |
|---|---|---|
| **Snapshot a working agent config so they can revert** | Currently versions are auto-created on save; there's no explicit "tag this as a known-good version" affordance. Chen iterates 10 times, hits a regression, has to scroll through 10 unlabeled versions to find the last good one. | Add UC-V11-43: "Tag agent version as known-good (with name)" — `agent_versions` table needs an optional `tag` column; UI: versions tab → "Pin / name this version." 🟡 V1.1 |
| **Compare two runs side-by-side (diff)** | `USE_CASES.md` UC-V11-03 already captures this for Liu Wei. Chen's variant is more granular: compare prompt, ontology, tool calls, LLM response token-by-token. | Already in catalog. ✅ |
| **Re-run with the same input but a different model** | "Test run" uses the agent's default. There's no "Test with model X" override. Chen wants to compare claude-sonnet-4-5 vs claude-haiku-4-5 on the same input. | Add UC-V11-44: "Test run with model override" — `POST /v1/agents/:name/invoke?testRun=1&model=claude-haiku-4-5`. Trivial backend change; UI: dropdown in the test-run modal. 🟡 V1.1 |
| **Roll back to a previous TS code version** | Slice 03 `PF-API-TC-01` writes to `data/tenants/<slug>/<version>/`; previous versions stay on disk. Slice 02 `AR-DEP-01` says "version 0.0.<sha>" but no UI to roll back. | Add UC-V11-45: "Roll back tenant code to previous version" — UI: deployments → tenant_code rows → "Make live." Backend wiring partial. 🟡 V1.1 |

### 5.3 Ops (Platform Operator)

| Missing journey | What's missing | Where it should land |
|---|---|---|
| **Investigate a token-abuse incident** ("which tenant + which token used X tokens?") | Slice 03 `PF-DB-16` shows `api_tokens.last_used_at` but no per-token usage counter; tokens_total metric is by tenant+agent+model, not by token id. To answer "did a leaked token cause this spend?" Ops has to grep audit logs. | Add UC-V11-46: "Per-token usage audit" — add `tokens_total{token_id=…}` metric or per-token counter column; Settings → Tokens → click row → "Recent usage." 🟡 V1.1 (security-relevant) |
| **Force-rotate a tenant's master key (suspected leak)** | `UC-V1-27` covers rotating an API token; there's no "scorched earth — invalidate ALL tokens for this tenant." | Add UC-V11-47: "Revoke all tokens for tenant (bulk)" — `POST /v1/tenants/:slug/tokens/revoke-all`. 🟡 V1.1 |
| **Quarantine a misbehaving tenant** | If a tenant is causing runaway cost or crashing the API process, there's no "pause this tenant" affordance short of `tenant.archive`. | Add UC-V11-48: "Pause tenant (no new runs accept)" — flag on `tenants` row; auth plugin rejects with 503 until unpaused. 🟡 V1.1 |
| **View per-tenant rate-limit hits over time** | `AGENTIC_RATE_LIMIT_PER_MIN` enforces 429s; no dashboard surface. | Add UC-V11-49: "Rate-limit timeline per tenant" — pull from `http_requests_total{status=429,tenant=…}` Prometheus series. 🟡 V1.1 |

### 5.4 Wu Hao (End User)

| Missing journey | What's missing | Where it should land |
|---|---|---|
| **Opt out of receiving signed-URL pings** | Once notifications ship (`UC-V11-01`), there's no opt-out. Wu Hao might want WeChat only, not email; or completely off if a task is reassigned. | Add UC-V11-50: "Wu Hao notification preferences" — needs `user_notification_preferences` table or per-user config. 🟡 V1.1 / 🔵 V2 |
| **See a list of tasks they've resolved historically** | Wu Hao currently sees only the open task. No history view. | Add UC-V11-51: "Wu Hao task history (signed URL)" — read-only list, signed link valid for 24h. 🟡 V1.1 |
| **Delegate a task to another recruiter** | No reassignment surface. | Add UC-V11-52: "Reassign a HITL task to another user" — `tasks.awaiting_user_id` is already nullable. 🟡 V1.1 |

Adding these brings the V1.1 backlog from 41 (after my §2 reassignment) to ~52 — still tractable for a single milestone if scoped tightly.

---

## 6. Punch list — must-fix before V1.1 planning meeting

These edits must land in the catalog *before* the V1.1 planning meeting reads it. Each is concrete and small.

### 6.1 Catalog corrections (documentation only)

1. **Update `PF-GAP-11`, `UC-V11-33`, `PF-API-STR-01`, `PF-API-WF-03`** from 🟡 to ✅. The `streamRoutes`/`tenantCodeRoutes`/`workflowRoutes` registrations exist in `apps/api/src/server.ts` today. Verify by spinning `pnpm dev` and curling `/v1/stream` and `/v1/tenants/raas/workflow`. (§3.1)
2. **Update `PF-GAP-01`** from 🟡 to ✅ (`usageRoutes` is registered). The only remaining gap is the hook envelope-unwrap (already tracked as `UC-V11-17`). **Delete `UC-V11-38`** (it was the route-registration half of a double-listing). (§3.3)
3. **Fix `PF-ENV-09`** — change name to `AGENTIC_KEY_VAULT_SECRET`, change status to ✅ V1 (not 🔵 V2 reserved). Update PRD `NFR-SEC-2` for next revision. (§3.2)
4. **Add 11 catalog matrix rows** per §1.1 + §1.2 (scheduled trigger, event vs run replay split, webhook subscription CRUD, reads endpoints, workflow schema export, LLM fleet CRUD, artifact streaming, memory primitives, pagination contract, workspace timezone, condition action).
5. **Fix slice 02 § AR-AK-02 cross-reference** — `PD-*` should be `U*` or `D-*`. (§3.5)
6. **Demote `UC-V1-23`, `UC-V1-31`, `UC-V1-49`** to 🟡 V1.1. Promote `UC-V11-33` and route-registration half of `UC-V11-38` to ✅ V1. (§2.1 + §2.3)
7. **Collapse `UC-V11-28` into `UC-V11-18`** with a "tracked from both AR + PF angles" note. (§3.4)
8. **Elevate `AR-GAP-13` / `UC-V11-25` to P1 V1.1 punch list** — RAAS LLM quality depends on it. (§3.7)
9. **Add 13 new use cases** from §5 (UC-V11-40 through UC-V11-52). Total V1.1 backlog: ~52.
10. **Document `models/RAAS-v1/workflow_v2.json` status** — confirm whether it's a stale dev artifact or a planned promotion. If stale, add to cleanup. (§1.4)

### 6.2 Code edits that change V1 status (work, not docs)

11. **Fix `apps/api/data/imports/dpl-e98006b51cd4/` and `models/RAAS-v1/workflow_v2.json` working-tree clutter** before V1.1 planning. The current `git status` is itself evidence of `PF-GAP-09`. Cleanup engineer (`UC-V11-31`) should ship before any other V1.1 work to prevent operator confusion.

### 6.3 Sign-off conditions (V1 → V1.1 gate)

Before V1 is declared paying-customer ready (not just internal alpha):
- [ ] **UC-V11-29** Cookie auth on Fastify in prod (P1)
- [ ] **UC-V11-18** `POST /v1/agents` 500 on tenants with live tenant-code (P1)
- [ ] **UC-V11-19** `agentic init` writes correct `actions_v1.json` (P1)
- [ ] **UC-V11-25** Require `definePrompt` for every `logic` action (or refuse-to-boot) (P1)

After these four, V1 is defensible. Without them, V1 is internal-alpha-only.

---

*End of Wave 3 Chief Product Architect review. The catalog is honest about what's broken; the punch list above is the smallest set of edits that makes it accurate. V1 is a real product; ship it with the four P1 fixes baked in.*
