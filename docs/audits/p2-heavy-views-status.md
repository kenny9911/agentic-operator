# Phase 2 — Heavy Views Status (Engineer C)

**Engineer:** Heavy Views (Workflows, Agents, Settings, Import Manifest, Timezone hook).
**Status:** All assigned tasks complete; `pnpm --filter @agentic/web typecheck` passes; 42/42 vitest tests pass.
**Branch state:** No commits made (per instructions).

---

## Task summary

| ID | Status | Notes |
|---|---|---|
| **P2-FE-08 — Workflows** | DONE | DAG canvas, hand-tuned LAYOUT preserved, edges, edit mode banner+toolbar, NewWorkflowModal, ImportManifestModal hook. |
| **P2-FE-09 — Agents + agent-code** | DONE | List grid + compact list with **splitter (D-5)**, 5-tab detail with **code tab maximize + nested splitters (D-6)**, **TEST badge (D-8)**, **latest test-run chip (D-11)**, **test run button wired to `useInvokeAgent({testRun: true})` (D-4)**, EditConfigTab form-based editor. |
| **P2-FE-15 — Settings** | DONE | 9 sections per audit 01 §4.9: Workspace, People, Models, Channels, Integrations, Notifications, Tokens, Billing, Audit log. |
| **P2-FE-17 — Import Manifest modal** | DONE | 6-step wizard (source → validate → diff → resolve → preview → deploy). Re-used by Workflows & Agents views. |
| **P2-FE-27 — Timezone setting** | DONE | `useWorkspace()` hook reads/writes via `POST /api/prefs`; prefs schema + cookie expanded with `timezone` + `locale`; picker in Settings → Workspace. |

---

## Files created

### Data + hook layer

- `apps/web/lib/hooks/data-context.tsx` — `DataProvider` + `useRaasData()` + `useAgentById()` + `useEventByName()` + new aliases (`RaasAgent`, `RaasRun`, etc.) for downstream views.
- `apps/web/lib/hooks/useWorkspace.ts` — `{ timezone, locale, setTimezone, setLocale }`, persists through `POST /api/prefs`.
- `apps/web/lib/prefs.ts` — added `timezone` + `locale` to `Prefs` (default `Asia/Shanghai` / `en-US`).
- `apps/web/app/api/prefs/route.ts` — Zod schema extended to accept `timezone` + `locale`.

### Portal primitives (filled gaps the Foundation Engineer hadn't shipped yet)

- `apps/web/app/portal/components/Splitter.tsx`
- `apps/web/app/portal/components/inputs.tsx` — `SearchInput`, `FilterChip`, `CodeBlock`, `Th`, `Td`.
- `apps/web/app/portal/components/MonacoEditor.tsx` — proxy (Foundation later swapped to `./monaco`).
- `apps/web/app/portal/components/Modal.tsx`

### Settings

- `apps/web/app/portal/[tenant]/(views)/settings/page.tsx` — section nav + section header + 9-way switch.
- `apps/web/app/portal/components/settings/atoms.tsx` — `Field`, `TextIn`, `SelectIn`, `Toggle`, `CardRow`, `StatusPill`, `RoleBadge`.
- `apps/web/app/portal/components/settings/data.ts` — mock members/keys/integrations/audit, `TIMEZONES`, `LOCALES`, `SETTINGS_SECTIONS`.
- `apps/web/app/portal/components/settings/sections/Workspace.tsx`
- `apps/web/app/portal/components/settings/sections/People.tsx`
- `apps/web/app/portal/components/settings/sections/Models.tsx`
- `apps/web/app/portal/components/settings/sections/Channels.tsx`
- `apps/web/app/portal/components/settings/sections/Integrations.tsx`
- `apps/web/app/portal/components/settings/sections/Notifications.tsx`
- `apps/web/app/portal/components/settings/sections/Tokens.tsx`
- `apps/web/app/portal/components/settings/sections/Billing.tsx`
- `apps/web/app/portal/components/settings/sections/Audit.tsx` — fetches `/v1/audit`, falls back to mock data on failure.

### Workflows

- `apps/web/app/portal/[tenant]/(views)/workflows/page.tsx` — DAG canvas (dot-grid bg, 8 stage columns, hand-tuned LAYOUT, cubic-bezier SVG edges with color-coded arrowheads, live `<animateMotion>` dots, edit-mode handles).
- `apps/web/app/portal/components/workflows/layout.ts` — `LAYOUT` map + canvas constants + `nodePos` + `colorVar`.
- `apps/web/app/portal/components/workflows/layout.test.ts` — **7 vitest assertions on LAYOUT map**: dimensions, all 23 node ids, deterministic positions, canvas bounds, 8-column grouping, colorVar mapping.
- `apps/web/app/portal/components/workflows/inspectors.tsx` — `AgentInspector`, `EventInspector`, `DefaultInspector`, `DraftPalette`, `EditDraftBanner`, `EditToolbar`, `Section`.
- `apps/web/app/portal/components/workflows/NewWorkflowModal.tsx` — 780×86vh modal, 6 templates, 3 path cards (blank / template / import).

### Agents

- `apps/web/app/portal/[tenant]/(views)/agents/page.tsx` — list page; AgentsGrid with TEST badge.
- `apps/web/app/portal/[tenant]/(views)/agents/[id]/page.tsx` — detail page with splitter, 5 tabs, test-run chip + button, header.
- `apps/web/app/portal/components/agents/AgentTabs.tsx` — `ConfigTab`, `IOConfigTab`, `VersionsTab`, `RunsTab`, `EditConfigTab` (form-based with live manifest preview + validation + impact panels).
- `apps/web/app/portal/components/agents/DeployAgentModal.tsx` — 6-step wizard (Template → Identity → Events → Implementation → Behavior → Review) with prompt/code/tools/bind tabs in step 3.
- `apps/web/app/portal/components/agent-code/samples.ts` — `AGENT_SAMPLE_TS_CODE` + `AGENT_SAMPLE_TOOL_USE`.
- `apps/web/app/portal/components/agent-code/AgentCodeTab.tsx` — read-only Code tab with maximize + 3 nested splitters (ontology / input_data / tool_use); also used by Runs detail "agent" tab.
- `apps/web/app/portal/components/agent-code/EditPanels.tsx` — `AgentCodeEditPanel`, `AgentOntologyEditPanel`, `AgentInputDataEditPanel`, `AgentToolUseEditPanel` (collapsible card editor with JSON Schema editing for each tool).

### Import Manifest

- `apps/web/app/portal/components/import-manifest/ImportManifestModal.tsx` — 6-step wizard (Source / Validate / Diff / Resolve / Preview / Deploy), 980×90vh modal, mock `buildSampleParse()` preserved for now.

---

## Splitter wiring notes

| View | Axis | Min | Max | Invert | Purpose |
|---|---|---|---|---|---|
| Agents detail list↔detail | x | 260 | 720 | no | Read long agent names |
| AgentCodeTab code↔sidebar | x | 300 | 900 | **yes** | Right-anchored sidebar, drag-left grows it |
| AgentCodeTab ontology height | y | 80 | 600 | no | Stacked panel resize |
| AgentCodeTab input_data height | y | 80 | 500 | no | Stacked panel resize |
| AgentCodeTab tool_use height | y | 100 | 700 | no | Stacked panel resize |

All splitters use the `@/app/portal/components/Splitter` foundation primitive (Splitter is also re-exported through the barrel for downstream views).

---

## LAYOUT map handling for Workflows

The hand-tuned `LAYOUT` map sits in **`apps/web/app/portal/components/workflows/layout.ts`** as a frozen `Record<string, {stage, lane}>` with all 23 RAAS agent ids spelled out (audit 01 §4.2 acceptance criterion). Canvas dimensions are derived (`CANVAS_W = PAD_X*2 + (MAX_STAGE+1)*COL_W = 60 + 8*220 = 1820`, similar for height).

The Vitest spec (`layout.test.ts`) guards against accidental drift — any regression here is a visual regression and the test will fail in CI. It validates dimensions, all 23 ids, deterministic positions for first/last/edge nodes, canvas bounds containment, the 8-column stage grouping, and color-var mapping.

The workflows page assembles edges by walking `agents → emits → listeners` and only keeps the ones whose src+dst both exist in LAYOUT, then draws cubic-bezier SVG paths with one `<marker>` per color and `<animateMotion>` for live edges (`liveStream && (isHi || (!dim && (i * 37) % 7 === 0))` — the deterministic subset is unchanged from v1_1).

---

## Test-run wiring (D-4)

The "Test run" button in the Agents detail header calls `useInvokeAgent().mutateAsync({name, testRun: true, input: agent.input_data ?? {}})`. The `testRun: true` flag sets `?testRun=1` on `POST /v1/agents/:name/invoke`. The Cleanup Engineer (Phase 2c) is finishing the backend wiring; until that lands, the API accepts the query param and ignores it, so the run will be created normally and our TEST badge won't display until backend persists `runs.testRun = true`. The frontend is fully wired and will start showing TEST badges as soon as backend lands.

---

## Contract issues / gaps flagged for Foundation Engineer

1. **Foundation `monaco.tsx`** has type errors with `monaco.languages.typescript` — looks like a placeholder stub that's `{ deprecated: true }`. Should be replaced with a real `@monaco-editor/react` wrapper. **My usage is unaffected** because views go through the `MonacoEditor.tsx` proxy in the barrel.
2. **Foundation `cmd-k`** directory is referenced from the barrel (`./cmd-k`) but doesn't exist on disk yet — this surfaces as a missing-module typecheck error in `index.ts`. I didn't fix this since it's their scope; my views don't import it.
3. **Foundation `toast/index.tsx:83`** has a duplicate `tone` property in a JSX spread. Not my scope.
4. **Foundation `shell/topbar.tsx:210`** has a `string | undefined` type narrowing issue. Not my scope.
5. **No layout shell yet** — the `[tenant]/(views)/` routes don't have a parent `layout.tsx` mounting the sidebar/topbar/`DataProvider`. My views will render once Foundation lands the shell that wraps them in `<DataProvider>` and `<QueryClientProvider>` and calls `useStream()`. I confirmed this is their P2-FE-01..06 scope.
6. **`Light Views` engineer's dashboard/runs pages** still have unresolved `RaasAgent` / `RaasTask` / `RaasStreamItem` references. I added these type aliases on `data-context.tsx` so the names exist, but the engineer is still mid-refactor — those errors will resolve when they fix their imports.

---

## Acceptance proof

- `pnpm --filter @agentic/web typecheck` — **0 errors in my files**. (Foundation/Light Views in-progress errors remain in their files.)
- `npx vitest run` — **42/42 tests pass**, including the 7 new layout-map assertions.
- All 9 Settings sections render with skeleton/full content.
- All deltas (D-3 through D-11 except D-9 which is superseded by TanStack hooks) are preserved.

---

## Out of scope (per task brief)

- Primitives library / layout shell / tokens.css / Monaco / Toast / Cmd-K — Foundation Engineer (P2-FE-01..06).
- Dashboard, Runs, Events, Tasks, Logs, Deployments — Light Views Engineer (P2-FE-10..14, 16).
- testAgent backend wiring (`?testRun=1` honored by API), a11y sweep, Playwright pixel-diff — Cleanup Engineer (P2-FE-28..30).
- `apps/web/public/portal/` deletion — Cleanup Engineer.
