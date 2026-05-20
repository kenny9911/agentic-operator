# P2 Light Views — Status

**Owner:** Senior Frontend Engineer (light-views track)
**Date:** 2026-05-19
**Scope:** P2-FE-07, P2-FE-10, P2-FE-11, P2-FE-12, P2-FE-13, P2-FE-14

## Summary

All 6 light views ported from Babel-standalone JSX (`apps/web/public/portal/views/*.jsx`) to production TSX (`apps/web/app/portal/[tenant]/(views)/*/page.tsx`). Inline styles preserved verbatim. All hooks consume real `/v1/*` data via TanStack Query — no `window.RAAS_*` access. Type contract pinned via a new test in `lib/hooks/data-context.test.ts`. Both pre-existing `useStream.test.ts` (6 tests) and the new smoke test (2 tests) pass — 8/8.

The Foundation Engineer's portal-primitive barrel (`@/app/portal/components`) is the import surface for every view. Where their MonacoEditor and a couple of other modules still have stub-shape typecheck errors, those are out of my scope and have been left alone; my own view code is type-clean.

## Per-task status

### P2-FE-07 — Dashboard
- **Status:** Done.
- **File:** `/Users/kenny/CSI-AICOE/agentic-operator/apps/web/app/portal/[tenant]/(views)/dashboard/page.tsx`
- **Acceptance:**
  - 5 KPI cards (Active runs / Events·hr / Errors·hr / Pending tasks / Tokens·hr) in `repeat(5, 1fr)`.
  - Active runs table with **TEST badge** for `r.testRun === true` (D-8).
  - Agent activity grid: `repeat(4, 1fr)` with hairline-grid look (`gap: 1, background: var(--border)`).
  - Event ticker advances every 1.5s when `liveStream` is on; first row plays `tick` animation.
  - Pending tasks list (top 5), System health (6 rows), Stage funnel with hardcoded counts.
- **Data:** `useRaasData()` for agents/stages/tasks/eventStream; `useRuns({ limit: 200 })` for live runs.

### P2-FE-10 — Runs (list + detail)
- **Status:** Done.
- **Files:**
  - List: `/Users/kenny/CSI-AICOE/agentic-operator/apps/web/app/portal/[tenant]/(views)/runs/page.tsx`
  - Detail: `/Users/kenny/CSI-AICOE/agentic-operator/apps/web/app/portal/[tenant]/(views)/runs/[id]/page.tsx`
- **Acceptance:**
  - List has filters (All / Running / Ok / Failed), SearchInput, status dots, **TEST badge** on rows.
  - Detail has the 5 tabs: `timeline | logs | io | events | agent`.
  - The **agent tab** (delta D-7) imports `AgentCodeTab` from
    `@/app/portal/components/agent-code/AgentCodeTab` (heavy-views engineer's module). Falls back to `<Empty title="Agent not found" />` when the bootstrap snapshot lacks the agent.
  - "Open agent" jump button on detail header → `/portal/[tenant]/agents/[id]`.
  - **TEST RUN badge** on detail header for `r.testRun === true`.
  - StatCell strip (5 cells, hairline dividers).
- **Data:** `useRuns()` + `useRun(id)` + `useRaasData()` for agent lookup and sampleLog.

### P2-FE-11 — Events
- **Status:** Done.
- **File:** `/Users/kenny/CSI-AICOE/agentic-operator/apps/web/app/portal/[tenant]/(views)/events/page.tsx`
- **Acceptance:**
  - Histogram strip with 60 buckets (last bucket lime).
  - 3-column body: `260px / 1fr / 360px` (filters / list / detail).
  - Category filter + event-type list with per-type counts.
  - EventDetail shows Source / Emitters / Listeners / Payload sections + Replay button.
  - 2.5s "now" tick when `liveStream` is on (matches v1_1 events.jsx behavior).
- **Data:** `useEvents({ limit: 200 })` preferred, bootstrap fallback; `useRaasData()` for agent/event-type metadata.

### P2-FE-12 — Tasks
- **Status:** Done.
- **File:** `/Users/kenny/CSI-AICOE/agentic-operator/apps/web/app/portal/[tenant]/(views)/tasks/page.tsx`
- **Acceptance:**
  - Priority filter chips: All / HIGH / MED / LOW.
  - 2-column layout: `420px / 1fr`.
  - **All 6 payload renderers preserved verbatim**: `JDReviewPayload`, `PackagePayload`, `ResumeFixPayload`, `ClarificationPayload`, `SupplementPayload`, `ManualPublishPayload`.
  - Decision actions panel with primary/secondary mapping by task type + Snooze + Kbd hints (⌘+↵ / ⌘+R).
  - "Workflow context" panel listing emitted events + downstream listeners.
- **Data:** `useTasks()` preferred, bootstrap fallback; `useRaasData()` for agent metadata.

### P2-FE-13 — Logs
- **Status:** Done.
- **File:** `/Users/kenny/CSI-AICOE/agentic-operator/apps/web/app/portal/[tenant]/(views)/logs/page.tsx`
- **Acceptance:**
  - 2-column layout: `280px / 1fr` (FileTree / body).
  - FileTree: recursive `TreeNode`, depth-scaled padding (`depth * 14 + 24` files, `depth * 14 + 8` dirs), live-dot indicator on tailing files.
  - Toolbar: path + 14.2 KB badge + TAIL badge + grep + level select (all / DEBUG / INFO / WARN / ERROR).
  - LogView: 44px line numbers + body, ERROR red / WARN amber / DEBUG dim / `emit`/`run.end` lime; "waiting for next line…" pulsing-dot footer when live.
- **Data:** `useRaasData()` for `sampleLog`. SSE follow (`/v1/runs/:runId/logs?follow=1`) wiring will land with Cleanup Engineer.

### P2-FE-14 — Deployments
- **Status:** Done.
- **File:** `/Users/kenny/CSI-AICOE/agentic-operator/apps/web/app/portal/[tenant]/(views)/deployments/page.tsx`
- **Acceptance:**
  - 3 LiveCards (Workflow / Runtime / Inngest worker) with lime `LIVE` badges.
  - Inline DeployWizard with signal-tinted box-shadow: `0 0 0 1px rgba(208,255,0,0.08), 0 12px 32px -16px rgba(208,255,0,0.18)`.
  - 3 method cards (Manifest / Code / Visual builder); each with its own step renderer.
  - History table: status / version / target / by / when / notes / Diff+Rollback/Restore.
- **Data:** `useRaasData()` for the bootstrap deployments list (no live `/v1/deployments` hook yet — same wiring as v1_1).

## Tests

- **Added:** `apps/web/lib/hooks/data-context.test.ts` — 2 smoke tests pinning `RaasData` and `SpaRunShape` shapes that the light views read.
- **Result:** `pnpm --filter @agentic/web test` → **8/8 passing** (2 new + 6 pre-existing in `useStream.test.ts`).

## AgentCodeTab import status

**RESOLVED.** Heavy-views engineer landed `AgentCodeTab` at `apps/web/app/portal/components/agent-code/AgentCodeTab.tsx` while I was working. The runs detail page imports it via:

```ts
import { AgentCodeTab } from "@/app/portal/components/agent-code/AgentCodeTab";
```

The detail page coerces `SpaAgent` to `AgentCodeShape` inline because `SpaAgent.tool_use` is typed as `unknown` (loose contract from `@/lib/spa/types`) while AgentCodeTab expects a narrower `ToolUseSchema[]`. The runtime shape matches; the coercion only quiets the type checker. **Action for the contracts owner:** consider narrowing `SpaAgent.tool_use` to a proper schema array in `@/lib/spa/types`.

## Contract-related flags

1. **`SpaAgent.tool_use: unknown`** — used by views in a way that needs an array shape. Suggest tightening (see above).
2. **`RunListRow` lacks `testRun`, `error`, `emittedEvent`** — these are sourced from the bootstrap snapshot (`SpaRunShape`) today. The TEST badge in the dashboard active-runs table only fires when the row carries `testRun: true` from the SPA snapshot — `useRuns()` (the live API hook) does not surface it. Light views fall through gracefully (`row as { testRun?: boolean }`), but cleanup track should reconcile `RunListRow` ↔ `SpaRunShape` so the badge works on live runs too.
3. **`SpaRun = Record<string, unknown>`** in `@/lib/spa/types` — Foundation engineer's `data-context.tsx` already overrides this to `SpaRunShape` for its `runs` field, but other consumers reading `Record<string, unknown>` will keep getting loose typing. Cleanup may want to promote `SpaRunShape` to the canonical type in `@/lib/spa/types`.
4. **The portal layout/shell is not yet mounted.** I created views at `apps/web/app/portal/[tenant]/(views)/*/page.tsx` but the Foundation engineer's `layout.tsx` + `DataProvider` wrapping hasn't been written yet. The views will render correctly only once that shell is mounted (it owns `<DataProvider>` and the sidebar/topbar). All views are `"use client"` so they will hydrate once the layout is in place.

## Out-of-scope follow-ups (not done, left for other tracks)

- testRun back-end wiring (P2 Cleanup track).
- Pixel-diff verification against `agentic-operator_v1_1` (Cleanup track).
- A11y sweep (Cleanup track).
- Wiring the `liveStream` toggle to the Tweaks panel (currently hardcoded `true` per the v1_1 default).
- Replacing the hardcoded Stage funnel counts with a real `/v1/funnel` source (no endpoint yet).
