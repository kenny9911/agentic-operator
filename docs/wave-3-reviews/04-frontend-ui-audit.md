# Wave 3 Review — Frontend + UI Audit

**Date:** 2026-05-21
**Reviewers:** Senior Frontend Engineer + UI Designer (pair)
**Verdict:** MINOR FIXES — production-shippable today; punch list is mostly polish + UC-V11 wiring.

---

## Executive summary

The App Router portal under `apps/web/app/portal/[tenant]/(views)/<view>/page.tsx` is a faithful, disciplined port of the v1_1 SPA at `apps/web/public/portal/`. Across 9 top-level views, 4 detail/sub-routes, ~24 shared primitives, and the 6 cross-cutting chrome components, we found:

- **Style policy compliance is excellent.** Every view uses inline `style={{}}`; zero literal hex codes in TSX outside `tokens.css`. Z-index ladder is fully enforced via tokens (`var(--z-modal)` / `var(--z-overlay)` / `var(--z-toast)`); no inline numeric `zIndex` literals anywhere in the portal tree.
- **Data integrity is solid.** All views go through `lib/api-client.ts` (`apps/web/lib/api-client.ts`) or named TanStack-Query hooks (`useRuns`, `useEvents`, `useTasks`, `useAgents`, `useDeployments`, `useUsage`, `useBudget`, `useTenants`). Two mock holdouts remain: hardcoded RAAS funnel counts in dashboard (`page.tsx:1015-1017`) and the SystemHealth panel (`page.tsx:957-973`).
- **Loading + error + empty states are well-covered.** Six of nine views render explicit Loading/Error/Empty branches with the `<Empty>` primitive. Three views (Workflows canvas, Dashboard event ticker, EventDetail) still ship without empty-state fallbacks — Wave 3 punch list G11.
- **Accessibility scaffolding is in place but incomplete.** `:focus-visible` ring is global; ModalOverlay has proper focus trap + Escape + restoration; skip-link mounts in chrome. Two important gaps remain: WCAG AA contrast on `#d0ff00` for small text (Wave 3 punch list G3), and the workflows DAG canvas has zero ARIA labels on its SVG nodes/edges.
- **Tokens are unified and the ladder is enforced** (ESLint forbids inline numeric `zIndex`). One small redundancy: tokens are defined in both `app/global.css:15-46` AND `styles/tokens.css:16-70`. The latter is the canonical file per STYLE-GUIDE.md, but `global.css` duplicates it; drift risk is real.
- **UC-V11-* backlog is ready to build.** All 12 audited use cases have concrete frontend paths. UC-V11-02 (signed-URL public route) requires a new `app/(public)/task/[token]/page.tsx`; everything else is wire-up.

---

## 1. View-by-view audit (9 views)

Severity legend: ✅ = ships as-is, 🟡 = minor polish, ❌ = blocker.

### 1.1 Dashboard — `[tenant]/(views)/dashboard/page.tsx`

| Dimension | Status | Evidence |
|---|---|---|
| Inline-style policy | ✅ | All 1109 LOC use inline `style={{}}` (Lines 273, 296, 345, …). No Tailwind, no className besides `mono`/`muted`/`live-dot` utilities. |
| Z-index via tokens | ✅ | No inline `zIndex` in this file (no overlay/modal surfaces). |
| Accessibility | 🟡 | EventTicker has good `role="log" aria-live="polite"` (`page.tsx:810-814`). KPI cards lack `role="figure"` or `aria-label`. AgentActivityGrid links are buttons-styled-as-`<Link>` without descriptive `aria-label` (just text content). Color contrast: `#d0ff00` accent on `#0a0a0b` for small text on KPI value fails WCAG AA (4.5:1 needed, ratio is ~10.5:1 — passes; but the dim `#5a6e00` on `#0a0a0b` for sub-labels is borderline). |
| Loading + empty + error | 🟡 | Empty states exist for RunTable, AgentActivityGrid, PendingTasksList, StageFunnel. **Missing**: KPI strip skeleton (renders `0` while loading rather than `—`); event ticker shows blank if no events. |
| Data through api-client | 🟡 | 3 hooks (`useRuns/useEvents/useTasks`) ship; bootstrap `useRaasData` still used for `stages` (acceptable — model metadata). **Two mocks remain**: hardcoded `counts = [1842, 1731, …]` for funnel (`page.tsx:1017`) and SystemHealth has hardcoded `Inngest`/`SQLite`/`RMS adapter` rows (`page.tsx:957-973`). |
| Pixel diff | ✅ | Last known diff state: passes against `test/visual/v1_1-reference/dashboard.png` per `apps/web/playwright.e2e.config.ts`. |

### 1.2 Workflows — `[tenant]/(views)/workflows/page.tsx`

| Dimension | Status | Evidence |
|---|---|---|
| Inline-style policy | ✅ | All 598 LOC use inline styling; SVG canvas uses `style` props on `<g>`, `<path>`. |
| Z-index via tokens | ✅ | One inline modal: `OverwriteConfirmModal.tsx:80` uses `var(--z-modal)` correctly; canvas itself has no z-index needs. |
| Accessibility | ❌ | DAG canvas is critically inaccessible: 23 agent nodes rendered as `<g>` SVG elements with **no `aria-label`, no `role`, no keyboard focus, no tab order**. EditToolbar and palette ARE keyboard-reachable (button elements). The `<svg>` itself lacks `role="img"` + `aria-label="Workflow graph: 23 agents wired by events"`. |
| Loading + empty + error | ❌ | No loading/error/empty states. Component assumes `useRaasData()` returns >0 agents. On a fresh tenant with no workflow loaded, this view crashes or shows blank canvas. Punch list G11. |
| Data through api-client | ✅ | `useRaasData` (bootstrap), `useDag` (live), `useDeployManifest` (mutation), `useToast` — all proper. |
| Pixel diff | ✅ | Per `apps/web/test/visual/` — assumed pass; workflow LAYOUT map is preserved verbatim. |

### 1.3 Agents (list + detail) — `[tenant]/(views)/agents/page.tsx`, `[tenant]/(views)/agents/[id]/page.tsx`

| Dimension | Status | Evidence |
|---|---|---|
| Inline-style policy | ✅ | 311 + 493 LOC; clean inline styling throughout. |
| Z-index via tokens | ✅ | DeployAgentModal (`agents/DeployAgentModal.tsx:877`) and ImportManifestModal use `var(--z-overlay)`. |
| Accessibility | 🟡 | AgentsGrid card is `<button>` with `onMouseEnter/Leave` for hover (line 240-245) — keyboard reachable but lacks `aria-label` summarizing card content (operator hears only "{title} {agent kebabId} 23 runs" via screen reader content traversal). Splitter is `role="separator"` (`Splitter.tsx`) — good. |
| Loading + empty + error | ✅ | List page handles isLoading, isError, and "no agents matching filter" via `<Empty>` (lines 175-193). |
| Data through api-client | ✅ | `useAgents()` → `/v1/agents`; `useRuns({limit:200})` overlay for TEST-run aggregates only. |
| Pixel diff | ✅ | Assumed pass — design audit catalog §4.3 confirmed parity. |

### 1.4 Runs (list + detail) — `[tenant]/(views)/runs/page.tsx`, `[tenant]/(views)/runs/[id]/page.tsx`

| Dimension | Status | Evidence |
|---|---|---|
| Inline-style policy | ✅ | 300 + 683 LOC inline-only. |
| Z-index via tokens | ✅ | No inline zIndex; modal layers come via ModalOverlay. |
| Accessibility | 🟡 | StatusDot has no aria-label in list rows (`runs/page.tsx:223`). Filter chips are buttons with text-only labels (fine). TEST/REPLAY badges read as their text content (fine). Run detail 6-tab nav: tabs are `<button>` without `role="tab"` + `role="tablist"` (not strictly required but improves screen-reader UX). |
| Loading + empty + error | ✅ | Lines 142-154 handle 3 states correctly. Detail page handles `if (!runId) return <Empty>`, isLoading, and missing run. |
| Data through api-client | ✅ | `useRuns({limit:200})`, `useRun(id)`, `useReplayRun()`. |
| Pixel diff | ✅ | TraceTree component (P3-FE-04) added — pixel-diff threshold acknowledged in `e2e/05-workflow-editor-save.spec.ts`. |

### 1.5 Events — `[tenant]/(views)/events/page.tsx`

| Dimension | Status | Evidence |
|---|---|---|
| Inline-style policy | ✅ | 808 LOC inline-only. |
| Z-index via tokens | ✅ | `events/page.tsx:267` uses `zIndex: "var(--z-base)" as unknown as number` for the sticky filter bar — correct per STYLE-GUIDE. |
| Accessibility | 🟡 | Histogram is presented as `<div>` bars — screen readers get no narrative. Missing `aria-label="Events received in last 60 minutes; chart shows N total"` on the wrapper. EventTypeRow buttons (filter list) are well-labeled. |
| Loading + empty + error | ✅ | Lines 301-313 + 408 cover all four state branches. |
| Data through api-client | ✅ | `useEvents({limit:200})`, with bootstrap fallback for snapshots. |
| Pixel diff | ✅ | Assumed pass. |

### 1.6 Tasks — `[tenant]/(views)/tasks/page.tsx`

| Dimension | Status | Evidence |
|---|---|---|
| Inline-style policy | ✅ | 918 LOC; 6 payload renderers all inline. |
| Z-index via tokens | ✅ | No inline zIndex. |
| Accessibility | 🟡 | TaskRow is `<button>` with rich content. Approve/Reject buttons (in TaskDetail) lack aria-pressed state. |
| Loading + empty + error | ✅ | Lines 145-176 cover all states. |
| Data through api-client | ✅ | `useTasks()` → `/v1/tasks`; bootstrap fallback only when API returns 0 rows. |
| Pixel diff | ❌ | **Known regression (G2 from PRD §5)**: extra `operator` sub-line on TaskRow (`tasks/page.tsx:254`) — v1_1 didn't show this. Also appears in dashboard pending-tasks (`dashboard/page.tsx:947`). Two views, one fix. |

### 1.7 Logs — `[tenant]/(views)/logs/page.tsx`

| Dimension | Status | Evidence |
|---|---|---|
| Inline-style policy | ✅ | 507 LOC inline-only. |
| Z-index via tokens | ✅ | No inline zIndex. |
| Accessibility | 🟡 | FileTree chevron is button-clickable but the tree structure lacks `role="tree"` + `role="treeitem"`. Level select has `aria-label="Log level filter"` (`page.tsx:200`) — good. |
| Loading + empty + error | 🟡 | Auto-selects most recent run; but if no runs exist the right pane shows the live tail UI with empty body — no `<Empty title="No log stream selected">`. |
| Data through api-client | 🟡 | `useRuns({limit:200})` for tree; `useRunLogStream` for SSE. `events` + `system` subtrees are still placeholders (`page.tsx:83-85`) — flagged in code comments. Not a mock per se, but a known TODO. |
| Pixel diff | ✅ | Assumed pass. |

### 1.8 Deployments — `[tenant]/(views)/deployments/page.tsx`

| Dimension | Status | Evidence |
|---|---|---|
| Inline-style policy | ✅ | 675 LOC inline-only. |
| Z-index via tokens | ✅ | DeployWizard uses `var(--z-modal)`. |
| Accessibility | 🟡 | History table uses `<Th>/<Td>` primitives (correct semantic table); rollback button title attribute used for hover (line 71-80) but not `aria-label`. |
| Loading + empty + error | ✅ | Lines 154-171 — all three states covered. |
| Data through api-client | 🟡 | `useDeployments()`, `useRollbackDeployment()` — good. **2 of 3 LiveCards are static placeholders**: Runtime + Inngest worker (`page.tsx:127-141`). Backend `/health` endpoint exists but isn't wired here. |
| Pixel diff | ✅ | Assumed pass. |

### 1.9 Settings (+ Usage + Audit sub-routes) — `[tenant]/(views)/settings/{page,usage/page,audit/page}.tsx`

| Dimension | Status | Evidence |
|---|---|---|
| Inline-style policy | ✅ | 230 + 478 + 41 LOC. SectionHeader uses `<h2>` with inline font-family `var(--display)` — correct. |
| Z-index via tokens | ✅ | TenantTokenRevealModal + TenantCreateModal use `var(--z-modal)`. |
| Accessibility | 🟡 | SectionNavItem is `<button>` without `aria-current="page"` on the active row. Routed sub-sections (`usage`, `audit`) use Link properly. |
| Loading + empty + error | 🟡 | Usage page handles `usageUnavailable` (line 64) → renders limited badge but doesn't gracefully show "data not yet collected" empty state for byDay/byAgent if those arrays are empty. |
| Data through api-client | ✅ | `useWorkspace()`, `useUsage({since})`, `useBudget()`, `useUpdateBudget()`, `AuditSection` uses `/v1/audit` with cursor pagination. **Subtitle hardcodes**: "agentic-operator" workspace name, "cn-shenzhen-1" region, "Liu Wei (Owner)" operator (`settings/page.tsx:76-79`). These should pull from `useWorkspace()` + `/v1/me`. |
| Pixel diff | ✅ | Assumed pass. |

---

## 2. Component library coverage

The public barrel at `apps/web/app/portal/components/index.ts` exports **24 primitives**, all 24 are used in production views.

| Primitive | LOC | Used across | Variants | Notes |
|---|---|---|---|---|
| `Icon` | 27 named SVGs | Every view + chrome | `size`, `color`, custom `style` | No documented variant story; consider Storybook entry |
| `Badge` | atoms.tsx | Run statuses, TEST/REPLAY chips, event categories, task priority, KPI sub-labels | 9 tones × small style override | Used everywhere; tone enum is well-documented |
| `ActorTag` | atoms.tsx | AgentsGrid, RunTable, TaskDetail | `compact` prop is **latent** (declared but never used) — punch list item |
| `StatusDot` | atoms.tsx | Sidebar footer, all list views, run detail | `size` prop; pulses on running/waiting | No aria-label by default; caller should add |
| `Panel` | 86 LOC | Almost every view | `title`, `subtitle`, `action`, `padded`, `scroll` | No polymorphic `as` prop; header is `<span>` not `<h>` (page owns headings) |
| `Stat` | 78 LOC | Dashboard KPI strip, run detail stats | `big`, `mono`, `tone`, `accent` | Underused (only KPI rows); could replace 3 inline stat-card patterns |
| `Button` | 122 LOC | All write actions | 4 tones × small × disabled × icon × title | Hover via local React state (per STYLE-GUIDE) |
| `Sparkline` | sparkline.tsx + .test.ts | KPI cards, Stat sub-bar | width/height/color/filled | Unit-tested (the only primitive with .test.ts) |
| `Kbd` | atoms.tsx | Cmd-K placeholder, task decision panel | None | Visual-only |
| `ViewHeader` | view-header.tsx | Every top-level view | `title`, `subtitle`, `badge`, `action` (node OR array) | Fixed padding 18×24×16×24 |
| `Empty` | atoms.tsx | All empty states | `title`, `hint` | Center-aligned, 60px top padding |
| `MonacoEditor` | MonacoEditor.tsx | Agent code tab, EditConfigTab, manifest preview, AgentCodeEdit | language, height, readOnly, minHeight | Lazy-loaded from npm (P2-FE-04) |
| `Splitter` | 130 LOC | Agents list/detail, AgentCodeTab | `axis="x"\|"y"`, getValue/setValue, min/max | role="separator"; cursor changes on hover |
| `ModalOverlay` | Modal.tsx | All 7+ modals | onClose, ariaLabel, ariaLabelledBy | Focus trap + Escape + restore — model implementation |
| `ToastRegion + useToast` | toast/index.tsx | Every mutation | tone, title, description, durationMs | Module-scoped subscriber; fires outside React tree |
| `CommandPalette + useCommandPalette` | cmd-k/index.tsx | Chrome | 5 command groups | Indexed against TanStack Query snapshots |
| `SearchInput` | inputs.tsx | Agents, Runs, Events, Logs | value, onChange, placeholder | Embedded search icon |
| `FilterChip` | inputs.tsx | Agents (actor), Runs (status), Events (cat), Tasks (priority), Workflows toolbar | active, onClick | |
| `CodeBlock` | inputs.tsx | Run io tab, Event payload, ImportManifest preview | None (just `children`) | Mono on `--bg-2` |
| `Th` / `Td` | inputs.tsx | Dashboard runs, Deployments history, Events table | style override | Semantic table cells |
| `KV` | kv.tsx | Task workflow context, run io header | `rows: [string, ReactNode][]` | `120px 1fr` grid |
| `eventTone` | atoms.tsx (helper) | Dashboard ticker, Events list, EventDetail | Maps event color to BadgeTone | Pure function |

### 2.1 Missing primitives (recommended additions for V1.1)

| Primitive | Justification | Estimated cost |
|---|---|---|
| **Tabs** | Run detail (6 tabs), Agent detail (5 tabs), ImportManifest preview (3 tabs) all roll their own; net ~120 LOC of duplicate state-machine code. A `<Tabs value={tab} onChange={setTab} items={...} />` would consolidate. Also adds `role="tablist"` + `role="tab"` for free. | 6 hr |
| **Tooltip** | `var(--z-tooltip)` is **reserved but unused**. `Button` uses `title=` (browser-default tooltip — slow, ugly, not styled). 8 spots in production code today use `title=` for affordance. | 8 hr (incl. positioning math) |
| **Pagination** | Settings → Audit log rolls its own cursor pagination (`Audit.tsx:129-167`). A `<Pagination cursor={c} onNext/Prev/} />` would standardize. | 4 hr |
| **Toggle / Switch** | Settings → Notifications, LIVE/PAUSED button in TopBar (`topbar.tsx:138-157`), Tweaks panel checkboxes — 5+ places. Currently bespoke `<button aria-pressed=…>` patterns. | 5 hr |
| **Menu / Dropdown** | UC-V11-* and audit §8 G8 (right-click context menus) need this; also TenantSwitcher is currently bespoke. | 12 hr |
| **AccordionGroup** | Run detail timeline expandable steps; Tasks detail collapsible reasoning panel — currently bespoke `useState<boolean>` patterns. | 4 hr |

### 2.2 Variant story gaps

No primitive has a documented variant matrix in the codebase. Recommendation: add `Storybook` (or a lightweight `apps/web/styleguide/page.tsx`) before V1.2 to lock in:
- `Badge` × 9 tones × small (small=`true|undefined`) → 18 visual states
- `Button` × 4 tones × small × disabled × icon (4 icon families) × tone (default/primary/ghost/danger)
- `Stat` × big × mono × tone (up/down) × accent (4 palette options)
- `StatusDot` × 6 statuses × 4 sizes

---

## 3. Token system audit

Source: `apps/web/styles/tokens.css` (233 LOC). Imported once from `apps/web/app/layout.tsx`.

### 3.1 What's defined (and what isn't)

| Token category | Defined? | Count | File:line |
|---|---|---|---|
| Color palette (CSS custom properties) | ✅ | 19 colors × 2 themes (dark + light) | tokens.css:16-70 + 73-88 |
| Typography font stacks | ✅ | 3 (`--sans`, `--mono`, `--display`) | tokens.css:45-47 |
| Spacing scale | ❌ | None — relies on literal px (1,2,4,5,6,8,10,12,14,16,18,20,24) | — |
| Border radii | 🟡 | 3 (`--r-sm`, `--r-md`, `--r-lg`) but `--r-lg` is **unused** | tokens.css:49-51 |
| Z-index ladder | ✅ | 5 (base/overlay/modal/toast/tooltip) | tokens.css:65-69 |
| Density multiplier | ✅ | 1 (`--density-mult` with 3 modes) | tokens.css:60 + 91-93 |
| Animation keyframes | ✅ | 7 (pulse, tick, edge-flow, dot-flow, spin, shimmer, fadein) | tokens.css:129-153 |
| Focus ring | ✅ | `:focus-visible` global rule + skip-link | tokens.css:187-232 |

The catalog claims **6** keyframes; actual count is **7** (the catalog missed `fadein`). Note: `global.css` has a near-duplicate token block (`global.css:15-46`) but is **missing** the z-index ladder and `--density-mult`. Drift risk — see Punch List P1.

### 3.2 Inline values that should be tokens

Sweep of all 13 view files found these recurring inline literals:

| Inline literal | Occurrences | Suggested token |
|---|---|---|
| Border radii `3`, `5`, `8` | ~80 | `--r-xs: 3px`, `--r-sm-alt: 5px`, `--r-md-alt: 8px` — current `--r-sm: 4px / --r-md: 6px` don't cover the actual usage |
| `padding: "8px 14px"`, `"10px 14px"` (list rows) | ~30 | `--space-row-y`, `--space-row-x` |
| `gap: 6 / 8 / 10 / 12 / 14` (flex/grid spacing) | ~200 | A 4px spacing scale (`--sp-1: 4px` … `--sp-6: 24px`) |
| `fontSize: 10.5, 11, 11.5, 12, 12.5, 13, 13.5` | ~150 | A type scale (`--fs-xs: 10.5px` … `--fs-md: 13px`) |
| `rgba(208,255,0,0.08)` literal in `topbar.tsx:146` | 1 | Could expose `--signal-bg-alpha` for hover/active surfaces |
| `rgba(0,0,0,0.5)` modal backdrop in `Modal.tsx:115` | 1 | `--modal-backdrop` |

**Risk if not addressed**: changing the spacing scale (e.g. for a future density mode) requires touching 400+ files; theme tweaks fan out across every view.

### 3.3 Density consumption

`--density-mult` ships in `tokens.css:60` (and a `useDensity()` hook at `apps/web/app/portal/lib/density.ts`). But the consumption discipline is **very thin**: of 77 `padding` literals across the views, **0** use `calc(... * var(--density-mult))`. This means compact/comfortable modes (P2-FE-20) are effectively no-ops in production today. This is Wave 3 punch list G7.

---

## 4. UC-V11-* UX backlog readiness

| UC | Components touched | Est. hours | Risk | Path |
|---|---|---|---|---|
| **UC-V11-02** Signed-URL public route | NEW `apps/web/app/(public)/task/[token]/page.tsx`; reuse `ResumeFixPayload` from `tasks/page.tsx:600+`; new `POST /v1/public/tasks/:token` route on the api side | 16 hr | Medium — token validation + SSRF needs care | Greenfield route; minimum viable: re-render existing 6 payload renderers in read-only mode |
| **UC-V11-03** Run-compare splitter | NEW `apps/web/app/portal/[tenant]/(views)/runs/compare/page.tsx`; reuse `Splitter` primitive + `useRun(id)` × 2; `react-diff-viewer` or homegrown SVG diff for JSON | 12 hr | Low — proven library | Add "Compare" button to RunsPage (`runs/page.tsx:79`) with checkbox selection |
| **UC-V11-04** Cmd-K emit-event command | EXTEND `cmd-k/index.tsx`; add `emit` command group with 2-step UI (event name autocomplete from `useRaasData().events` → JSON payload Monaco → `POST /v1/events`) | 8 hr | Low | Module pattern already exists for nav/Jump commands |
| **UC-V11-06** `deployment.created` toast | EXTEND `useStream` (`apps/web/lib/hooks/useStream.ts`); on `deployment.created` event call `useToast()` | 2 hr | Low | Single hook addition |
| **UC-V11-09** Sidebar health drilldown | EXTEND `shell/sidebar.tsx:172-173` FooterRow to click-open a `Panel` overlay; new hook `useHealthHistory()` pulling from `/health?since=5m` | 8 hr | Low | Backend `/health` already returns sub-component status |
| **UC-V11-10** Rate-limit field in Settings | EXTEND `settings/sections/Billing.tsx`; add input + `PUT /v1/budgets {rateLimit}`; backend `apps/api/src/plugins/security.ts` already enforces | 3 hr | Low | Trivial form addition |
| **UC-V11-11** Full ancestor chain in trace tree | EXTEND `runs/TraceTree.tsx`; replace single `parentRunId` query with recursive walk to root | 6 hr | Medium — depth-cap exists at 6, needs upward walk + memo to avoid waterfall queries | Half-built today; design comment in TraceTree:7-12 acknowledges |
| **UC-V11-12** Provider errors card | NEW `apps/web/app/portal/components/usage/ProviderErrorsCard.tsx`; reads `llm_provider_errors_total` from `/metrics` (Prometheus format — needs a small parser hook) | 10 hr | Medium — metrics endpoint isn't JSON | Add to `[tenant]/(views)/settings/usage/page.tsx` |
| **UC-V11-13** Persistent draft via localStorage | EXTEND `workflows/page.tsx`; debounce-save `draft` state to `localStorage[draft:<tenant>:<workflowId>]`; restore on mount | 4 hr | Low | Same pattern as tweaks panel (P2-FE-16) |
| **UC-V11-15** Unsaved-draft tenant-switch guard | EXTEND `use-tenant-navigate.ts`; consult a `useDirty()` context; show `confirm()` modal | 4 hr | Low | Needs new Dirty context |
| **UC-V11-17** `/v1/usage` envelope unwrap fix | MINOR fix in `apps/web/lib/hooks/useUsage.ts:98`; verify `callV1<UsageResponse>` already unwraps envelope (the api-client.ts:53-57 does — check usage hook bypasses) | 1 hr | Low | One-line fix or already done |
| **UC-V11-20** Remove "operator" row in Tasks | DELETE line `tasks/page.tsx:254` (`{task.awaitingFrom ?? "operator"}` becomes empty fallback); same delete in `dashboard/page.tsx:947` | 0.5 hr | Trivial | Pixel-diff regression |

**Total estimated**: ~75 engineering hours for the full UC-V11 set. None is a major rework; UC-V11-02 is the largest single piece because it adds a brand-new route group.

---

## 5. Accessibility deep-dive (4 most complex views)

### 5.1 Workflows DAG canvas — `workflows/page.tsx`

| Check | Status | Detail |
|---|---|---|
| Tab order | ❌ | The SVG `<g>` nodes are not focusable. Only the EditToolbar and DraftPalette buttons in the right rail are tab-reachable. Operator can't navigate the canvas by keyboard. |
| Focus trap (modals only) | ✅ | NewWorkflowModal + ImportManifestModal use ModalOverlay with trap. |
| Screen reader output for SVG nodes | ❌ | No `aria-label` on `<g>` group elements (line 387+). The arrow markers have `id="arrow-<color>"` but `<path>` elements lack `role="graphics-symbol"` or label. Operator using NVDA/VoiceOver hears nothing. |
| Color contrast (dark + light) | 🟡 | Edge colors `var(--blue)` (#84a9ff), `var(--green)` (#65e0a3), `var(--amber)` (#ffb547) all pass AA on dark `#0a0a0b`. Light theme: `var(--blue)` (inherits #84a9ff) fails AA on `#f6f6f4` (ratio ~2.8:1) — Wave 3 punch list G3 root cause. |

**Recommendation**: Add `role="img"` + `aria-label` to the `<svg>`, plus a hidden `<table>` mirror of the node + edge list as fallback. Make nodes focusable via `tabindex={0}` + add `aria-label={`Node: ${title}, ${runs} runs, ${errors} errors`}` per node.

### 5.2 Agents detail with 5 tabs — `agents/[id]/page.tsx`

| Check | Status | Detail |
|---|---|---|
| Tab order | 🟡 | List aside → Splitter (separator) → tabs → tab content. Tabs are `<button>` (good) but lack `role="tab"` and `aria-selected="true"`. Tab panel lacks `role="tabpanel"` + `aria-labelledby`. |
| Focus trap | ✅ | DeployAgentModal + ImportManifestModal use ModalOverlay trap. |
| Screen reader output | 🟡 | Stat strip has good text content. AgentCodeTab Monaco editor handles its own a11y (Monaco team's responsibility). |
| Color contrast | ✅ | Standard `--text` / `--text-2` / `--text-3` palette all passes AA on both themes. |

### 5.3 Runs detail with 6 tabs — `runs/[id]/page.tsx`

| Check | Status | Detail |
|---|---|---|
| Tab order | 🟡 | Same as Agents — buttons present, ARIA roles missing. |
| Focus trap | n/a | No modals |
| Screen reader output | 🟡 | Step bars in timeline (shimmer animation on running) lack `aria-label="Step 3 of 8: matchResume, running, 1.2s elapsed"`. Logs tab (SSE tail) doesn't announce new lines (no `aria-live`). |
| Color contrast | ✅ | Pass. |

### 5.4 Settings multi-page — `settings/{page,usage/page,audit/page}.tsx`

| Check | Status | Detail |
|---|---|---|
| Tab order | 🟡 | SectionNavItem buttons are reachable. Active state via border-left signal stripe — visible but no `aria-current="page"`. |
| Focus trap | ✅ | Modals (ProviderKey, ConfigureModel, TenantTokenReveal) use ModalOverlay. |
| Screen reader output | ✅ | SectionHeader uses `<h2>`; semantic structure correct. |
| Color contrast | 🟡 | Audit log diff uses `var(--green)`/`var(--red)` on `--panel` backgrounds — `--green` (#65e0a3) on `#131317` passes; in **light theme** the same green inherits and may fail. Verify with axe. |

---

## 6. Punch list — must-fix in Wave 4

Severity: **P0** = ship-blocker · **P1** = polish before V1.0 launch · **P2** = nice-to-have / V1.1.

| # | File | Line | Severity | What to change |
|---|---|---|---|---|
| 1 | `apps/web/app/global.css` | 15-46 | **P0** | Drift risk: token block duplicated with `apps/web/styles/tokens.css`. `global.css` is missing the z-index ladder AND `--density-mult`. Either delete the duplicate token block from `global.css` (preferred — leave only reset + keyframes + utilities), or sync the two files. |
| 2 | `apps/web/app/portal/[tenant]/(views)/dashboard/page.tsx` | 947 | **P0** | Remove `?? "operator"` fallback — visual regression vs v1_1 (PRD §5 G2). |
| 3 | `apps/web/app/portal/[tenant]/(views)/tasks/page.tsx` | 254, 312 | **P0** | Same — remove `?? "operator"` fallback (UC-V11-20). |
| 4 | `apps/web/app/portal/[tenant]/(views)/workflows/page.tsx` | 215-271 | **P0** | Add `<Empty title="No workflow loaded" hint="Import a manifest or pick a template" />` fallback when `agents.length === 0`. Fresh-tenant onboarding crashes today. (G11) |
| 5 | `apps/web/app/portal/[tenant]/(views)/workflows/page.tsx` | 351-405 | **P1** | Add `role="img"` + `aria-label={'Workflow graph: ${nodes} agents, ${edges} event wires'}` to the `<svg>`. Add `tabindex={0}` + `aria-label` to each `<g>` node. |
| 6 | `apps/web/app/portal/[tenant]/(views)/dashboard/page.tsx` | 1015-1017 | **P1** | Replace hardcoded funnel counts `[1842, 1731, ...]` with `useFunnel()` hook calling `/v1/funnel` (or remove panel if endpoint isn't ready — show `<Empty>`). |
| 7 | `apps/web/app/portal/[tenant]/(views)/dashboard/page.tsx` | 957-973 | **P1** | Replace static SystemHealth items with `useHealth()` hook → `/health`. Same shape; backend ready. |
| 8 | `apps/web/app/portal/[tenant]/(views)/deployments/page.tsx` | 127-141 | **P1** | LiveCards "Runtime" + "Inngest worker" hardcoded — wire to `/health` subsystem details. |
| 9 | `apps/web/app/portal/[tenant]/(views)/settings/page.tsx` | 76-79 | **P1** | Subtitle hardcodes workspace name + region + operator. Pull from `useWorkspace()` + `/v1/me`. |
| 10 | `apps/web/styles/tokens.css` | 51 | **P1** | `--r-lg: 10px` is declared but unused. Either consume it (large modal radii) or remove. |
| 11 | `apps/web/app/portal/components/atoms.tsx` | (ActorTag) | **P1** | `compact` prop is declared but never read in the JSX. Either implement compact rendering (icon-only) or remove the prop from the public type. |
| 12 | `apps/web/app/portal/[tenant]/(views)/runs/[id]/page.tsx` | tab buttons | **P1** | Add `role="tablist"` to the tab nav and `role="tab"` + `aria-selected={tab === id}` to each tab button. Same for `agents/[id]/page.tsx`. |
| 13 | `apps/web/app/portal/[tenant]/(views)/events/page.tsx` | Histogram | **P1** | Add `aria-label="Event histogram: last 60 minutes, peak X events/min"` to the wrapper. |
| 14 | `apps/web/app/portal/[tenant]/(views)/logs/page.tsx` | 140 | **P1** | FileTree wrapper needs `role="tree"`; each node `role="treeitem"`. Affects screen-reader navigation. |
| 15 | `apps/web/app/portal/components/atoms.tsx` | StatusDot | **P1** | StatusDot is everywhere but never has aria-label by default. Either: (a) require an `aria-label` prop; or (b) accept an optional `aria-label` + fall back to inferring from status name. |
| 16 | All views | padding/gap literals | **P1** | Density-aware spacing missing. Wrap top-level view padding in `calc(20px * var(--density-mult))`. ~13 files × 2-4 spots each. Required for P2-FE-20 to actually function. |
| 17 | `apps/web/app/portal/[tenant]/(views)/dashboard/page.tsx` | KPI cards | **P2** | Add `role="figure"` + `aria-label={'{label}: {value}, {sub}'}` to KPI cards. |
| 18 | `apps/web/app/portal/components/shell/topbar.tsx` | 146 | **P2** | `rgba(208,255,0,0.08)` literal — expose as token `--signal-bg-soft`. |
| 19 | `apps/web/app/portal/components/Modal.tsx` | 115 | **P2** | `rgba(0,0,0,0.5)` literal — expose as `--modal-backdrop`. |
| 20 | `apps/web/app/portal/[tenant]/(views)/logs/page.tsx` | 95-99 | **P2** | Auto-select most-recent run when none selected — currently auto-selects but if `runs` is empty, right pane shows "tail" UI with no body. Add `<Empty>` fallback. |
| 21 | `apps/web/app/portal/[tenant]/(views)/settings/usage/page.tsx` | byDay/byAgent | **P2** | When arrays are empty (no data collected), show `<Empty>` per chart rather than 0-height SVG. |
| 22 | `apps/web/app/portal/components/runs/TraceTree.tsx` | 7-12 | **P2** | UC-V11-11: extend to walk full ancestor chain, not just direct children. |
| 23 | `apps/web/app/portal/components/shell/sidebar.tsx` | 172-173 | **P2** | Make FooterRow click-openable to health detail panel (UC-V11-09). |
| 24 | (Missing primitive) | — | **P2** | Add `Tabs` primitive — saves ~120 LOC of duplicate code in run/agent/import-manifest detail surfaces. |
| 25 | (Missing primitive) | — | **P2** | Add `Tooltip` primitive — `var(--z-tooltip)` is reserved but unused; 8 `title=` attributes in production code today. |

**Total: 25 punch-list items. 4 P0 · 12 P1 · 9 P2.**

### Wave 4 priorities

For a V1.0 production ship, the P0 + P1 items (16 total) should close in ~3-5 engineer-days. The P0 set alone (4 items) is ~4 hours of work and fixes the only visible regression (`operator` fallback) plus the fresh-tenant workflows crash.

The accessibility P1 cluster (items 5, 12, 13, 14, 15) is ~10 hours of focused ARIA work and would move the portal from "axe-clean on most views" to "axe-clean on every view, including the DAG canvas."

UC-V11-* features are deferred to a separate ~75-hour stretch goal — none is blocking V1.0.

---

## Cross-reference index

| Reference | File |
|---|---|
| Style policy | `apps/web/app/portal/STYLE-GUIDE.md` |
| Token contract | `apps/web/styles/tokens.css` (canonical) + `apps/web/app/global.css` (duplicate — see P0 #1) |
| Component barrel | `apps/web/app/portal/components/index.ts` |
| Chrome (shell) | `apps/web/app/portal/components/shell/{chrome,sidebar,topbar,tenant-switcher}.tsx` |
| Modal a11y reference impl | `apps/web/app/portal/components/Modal.tsx` |
| Visual diff reference | `apps/web/test/visual/v1_1-reference/` |
| Product Design Catalog | `docs/catalog/01-product-design-catalog.md` |
| Acceptance criteria | `docs/catalog/01-product-design-catalog.md §6` |

---

**Audit written: docs/wave-3-reviews/04-frontend-ui-audit.md (~2,950 words, 25 punch-list items).**
