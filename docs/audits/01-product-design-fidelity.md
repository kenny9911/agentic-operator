# Product Design Fidelity Audit — Agentic Operator

> **Audit scope:** Frozen v1_1 SPA prototype at `agentic-operator_v1_1/` (the canonical design) plus the currently-mounted, partially-modified copy at `apps/web/public/portal/`. Produced as the ground-truth specification for the impending TSX port.
>
> **Methodology:** File-by-file read of every source artifact in the design package, plus byte-level diff of every file mirrored into the running portal. References use `<file>:<line>` notation to point at the exact source of an assertion.

---

## 1. Executive summary

The prototype is a single-page React 18 + Babel-standalone application living in `agentic-operator_v1_1/`, served verbatim (with surgical, well-bounded modifications) from `apps/web/public/portal/`. Visual identity is a dark, monospaced "control plane" aesthetic — electric-lime `#d0ff00` signal color, IBM Plex Sans/Mono + Instrument Serif display, hairline `1px` borders, dense grids, sparing use of color (red/amber/green/blue/violet as semantic accents only). The prototype is *unusually high fidelity for a prototype* — every component carries its full inline style, density/theme/accent tokens are honored via CSS variables, animations (`pulse`, `tick`, `edge-flow`, `dot-flow`, `shimmer`, `fadein`) are defined globally in `index.html`, and views never reach for any external CSS framework. The implementation has zero CSS-in-JS library and zero className conventions — *all* styling is inline-style on each JSX element. This is the dominant risk for the TSX port.

**tl;dr (five bullets):**

- **Design tokens are CSS custom properties** in `index.html:12-60` (dark) with `html[data-theme="light"]` overrides. All views read `var(--*)` directly. The token contract is small, complete, and ports trivially to any system.
- **All styling is inline `style={{}}`** on JSX. There is *no* CSS module, no Tailwind, no styled-components, no className-based styling beyond a handful of utility classes (`.mono`, `.display`, `.muted`, `.dim`, `.nowrap`, `.live-dot`). The TSX port must decide: keep inline (low drift risk), or migrate to a system (faster iteration, risk of pixel drift).
- **Monaco editor is loaded from unpkg CDN** in `components.jsx:353-451` at first mount of any code surface. This contradicts the future production posture (offline-capable, no third-party CDNs); the port must vendor Monaco via `@monaco-editor/react` or `monaco-editor-webpack-plugin`.
- **Data shapes are stable and discoverable.** Every view consumes globals on `window.RAAS_*` (set by `data.js`). The portal already replaces the IIFE-synthesized mock data with an API fetch (`apps/web/public/portal/data.js`) wired to `/api/spa/bootstrap`. The shapes are unchanged — only their provenance.
- **Deltas applied to the mounted portal are deliberate, all behind clear seams**, and all should be kept in the TSX port: a Boot wrapper for async data load, a `testAgent` synthetic run engine, splitters for resizable panels, a fullscreen toggle on the Code tab, TEST badges on test runs, and a sidebar data-source toggle. See §6 for the full inventory.

---

## 2. Design system tokens

### 2.1 Color palette

All colors are CSS custom properties on `:root` in `agentic-operator_v1_1/index.html:12-42`. The light theme overrides eight of them in `index.html:45-60`.

| Token | Dark (hex) | Light (hex) | Intent |
|---|---|---|---|
| `--bg`        | `#0a0a0b` | `#f6f6f4` | App background (outermost) |
| `--bg-2`      | `#0f0f11` | `#efefec` | Sidebar bg, code-block bg, log-view bg |
| `--panel`     | `#131317` | `#ffffff` | Panel/card surface |
| `--panel-2`   | `#18181d` | `#f8f8f6` | Hover state, secondary surface, input bg |
| `--panel-3`   | `#1d1d23` | `#f1f1ee` | Active segmented/tab state |
| `--border`    | `#232329` | `#e3e3df` | Standard 1px divider |
| `--border-2`  | `#2c2c34` | `#d4d4cf` | Button/input border, stronger divider |
| `--border-3`  | `#393942` | `#b8b8b2` | Drag-handle, dashed edge |
| `--text`      | `#ebebef` | `#1a1a1d` | Primary text |
| `--text-2`    | `#a8aab1` | `#5a5b62` | Secondary text, body copy |
| `--text-3`    | `#6f7178` | `#8c8d94` | Tertiary text, labels, meta |
| `--text-4`    | `#46474d` | `#b8b9be` | Disabled, line numbers |
| `--signal`    | `#d0ff00` | `#4d5e00` | Live / active / primary brand (electric lime) |
| `--signal-dim`| `#5a6e00` | `#c8d985` | Dim signal (rarely used directly) |
| `--blue`      | `#84a9ff` | (inherited) | Data / trigger semantics |
| `--green`     | `#65e0a3` | (inherited) | Success / ok / emit |
| `--amber`     | `#ffb547` | (inherited) | Warn / pending human / draft |
| `--red`       | `#ff6470` | (inherited) | Error / failed |
| `--violet`    | `#b594ff` | (inherited) | Human / non-agent actor |

**Accent override:** App overrides `--signal` and `--signal-dim` at runtime from the Tweaks panel (`app.jsx:30-32`). Allowed accents and their dim partners are listed in `app.jsx:15-20`:

```js
{ "#d0ff00": "#5a6e00",  // lime
  "#5deeff": "#1a6770",  // cyan
  "#ffb547": "#7a4f0d",  // amber
  "#b594ff": "#553e87" } // violet
```

**Translucent overlays.** A small fixed set of `rgba()` tints is used for tone-coded panels and badges; these are *not* tokens, just literals (e.g. `rgba(208,255,0,0.08)` for signal-bg, `rgba(101,224,163,0.30)` for green-border). The TSX port should derive these from a small `withAlpha()` helper to keep them in one place.

### 2.2 Typography

Three font families, loaded via Google Fonts in `index.html:7-9`:

| Family | CSS variable | Weights | Where used |
|---|---|---|---|
| IBM Plex Sans      | `--sans`    | 400, 500, 600, 700 | Body, UI chrome, button labels |
| IBM Plex Mono      | `--mono`    | 400, 500, 600       | IDs, code, badges, labels-in-uppercase, KPIs |
| Instrument Serif   | `--display` | 400 (italic available) | View titles (h1/h2), big numbers in modals |

**Body baseline.** `body { font: 13px/1.45 var(--sans); }` (`index.html:67-69`). The site is built for **1440px viewport** (declared `<meta name="viewport" content="width=1440">` in `index.html:6`); there is no responsive design.

**Type scale observed across the codebase:**

| Use | Size (px) | Family | Weight | Letter-spacing |
|---|---|---|---|---|
| ViewHeader title (h1)         | 22   | display | 400 | `-0.015em` |
| Detail h2 (run/agent/task)    | 24-26| display | 400 | `-0.01em` to `-0.015em` |
| Modal title                   | 14   | sans    | 500 | – |
| Section labels (uppercase)    | 10-11| mono    | 500 | `0.08em`–`0.12em` |
| Body                          | 12.5 | sans    | 400 | – |
| Body small / hint             | 11-11.5| sans  | 400 | – |
| Stat KPI value                | 22-28| mono    | 500 | `-0.01em` |
| Badge                         | 9.5-10.5 | mono | 500 | `0.04em` UPPERCASE |
| Code block / Monaco           | 11.5-12 | mono | 400 | – |
| Kbd                           | 10   | mono    | 400 | – |
| Smallest meta (counts, times) | 10-10.5 | mono | 400 | – |

**Anti-aliasing.** Body uses `-webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility` (`index.html:70-71`). These should ship to the TSX port verbatim.

### 2.3 Spacing scale

There is no explicit spacing-token system — spacing is hand-tuned inline. The recurring values can be inferred from the codebase:

- `1, 2, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 24` px are the most common gap/padding values.
- Standard view padding: **`padding: 20` or `24`** for view bodies (`dashboard.jsx:71`, `agents.jsx:154`).
- Standard panel padding: **`padding: 14`** when `padded` is true (`components.jsx:171`).
- Standard table cell: **`padding: 8px 12px`** (`Td` in `dashboard.jsx:225`).
- Standard ViewHeader: **`padding: 18px 24px 16px 24px`** (`components.jsx:313`).
- Standard nav-item gutter: **`padding: 6px 10px`** (`app.jsx:257`).

The TSX port should freeze these as a `space.*` token map even if the source uses literals.

### 2.4 Border radii

Three named tokens, used inconsistently — the codebase mixes the tokens with literal `3`, `4`, `5`, `6`, `8` values:

| Token | Value | Where used (declared / observed) |
|---|---|---|
| `--r-sm` | `4px`  | Defined but rarely referenced directly; inline `4` used instead |
| `--r-md` | `6px`  | Defined; inline `6` used instead |
| `--r-lg` | `10px` | Defined but unreferenced |

**Observed radii (literal values in the codebase):**

| Radius | Where |
|---|---|
| `3` | Badges, kbd, small chips, swatch (`components.jsx:100`, `:301`) |
| `4` | Inputs, code blocks, secondary panels (`components.jsx:508`, `runs.jsx:314`) |
| `5` | Buttons, tenant switcher dropdown, top-bar pills (`components.jsx:226`, `app.jsx:193`) |
| `6` | Stat cards, KPI cards, modals (`dashboard.jsx:149`, `tasks.jsx:90`) |
| `8` | Panel / section root (`components.jsx:153`) |
| `50%` | Avatars, dots (StatusDot, user chip) |

The TSX port should standardize on the named tokens and audit all 3/4/5/6/8 literals against them.

### 2.5 Density modes

Defined in `index.html:73-74`:

```css
html[data-density="comfortable"] { --density: 1.18; }
html[data-density="compact"]     { --density: 0.88; }
```

The `--density` variable is declared but **not actually consumed anywhere** in the components (a search across the codebase confirms zero `calc(var(--density)...)` usages). This is a latent feature — the Tweaks panel exposes the toggle (`app.jsx:75-79`) but it currently only sets the data attribute. Either the TSX port wires density-aware spacing through these tokens, or removes the control. Recommend wiring it (small effort, big payoff for ops users at varying display densities).

### 2.6 Animation tokens

All defined as global `@keyframes` in `index.html:91-122`. None are parameterized; the timing functions live in inline `animation:` strings on usage sites.

| Keyframe | Duration (typical) | Iteration | Where invoked |
|---|---|---|---|
| `pulse`      | `1.4s` | infinite | `.live-dot`, `StatusDot` running/waiting |
| `tick`       | `0.4s ease-out` | one-shot | First row of event ticker on each tick (`dashboard.jsx:290`) |
| `edge-flow`  | (declared, used in SVG `stroke-dashoffset`) | – | Workflow edges (latent) |
| `dot-flow`   | (declared via `offset-distance`) | infinite | Animated dots travelling along workflow edges (`workflows.jsx:223`) |
| `spin`       | `0.9s linear` | infinite | Monaco loader spinner, Boot splash |
| `shimmer`    | `1.5s linear` | infinite | Active step bar in run timeline (`runs.jsx:230`) |
| `fadein`     | `0.14s ease` | one-shot | Modal overlay reveal (`workflows.jsx:992`, etc.) |

**Live-dot effect:** Class `.live-dot` (`index.html:123-133`) adds a 7px lime dot with a 6px-radius glow box-shadow and the `pulse` animation. Variants: `.live-dot.green`, `.amber`, `.red`. These are visible across the dashboard, top bar, sidebar nav counts, and logs.

---

## 3. Component inventory

All components are defined as plain function components and exposed on `window` (no ES modules — the prototype is single-file-per-script via `<script type="text/babel">`). The TSX port will translate `window.Foo = Foo` to named ESM exports.

### 3.1 Core primitives (`components.jsx`)

| Component | Signature (props) | Source | Variants / quirks |
|---|---|---|---|
| `Icon` | `{ name, size=14, color?, style? }` | `components.jsx:6-76` | 27 named icons rendered as inline SVG (16-viewBox). `currentColor` for stroke. Missing icon returns `null` — no fallback. |
| `Badge` | `{ children, tone="default", style? }` | `components.jsx:79-107` | Tones: `default, signal, green, blue, amber, red, violet, muted, solid`. All-caps mono 10.5px with 0.04em letter-spacing. Border + bg+fg colored by tone. |
| `ActorTag` | `{ actor, compact? }` | `components.jsx:110-120` | Maps `"Agent"` → signal-tone badge with dot icon, `"Human"` → violet-tone with human icon. `compact` prop accepted but **unused** (latent). |
| `StatusDot` | `{ status, size=7 }` | `components.jsx:123-145` | Statuses: `running` (lime+glow+pulse), `ok` (green), `failed` (red), `waiting` (amber+pulse), `paused` (blue), `idle` (gray). |
| `Panel` | `{ title?, subtitle?, action?, children, style?, padded=true, scroll=false }` | `components.jsx:148-182` | Workhorse container. Header is hidden if no `title`. `scroll=true` flips `overflow: hidden` on root and `auto` on body. **No `as` / polymorphic prop** — always `<section>`. |
| `Stat` | `{ label, value, sub?, tone?, accent?, mono=true, big? }` | `components.jsx:185-201` | KPI display. `big` → 28px value, else 22px. `tone: "up"\|"down"` colors the `sub`. |
| `Button` | `{ children, tone="default", icon?, onClick?, small?, style?, title? }` | `components.jsx:204-236` | Tones: `default, primary, ghost, danger`. `small` shrinks padding to `4px 8px` and font to 11. **Hover state is local `useState`** — not CSS `:hover`. Means hover doesn't trigger via keyboard focus. **No disabled prop**. |
| `Sparkline` | `{ values, width=80, height=22, color, filled=true }` | `components.jsx:239-258` | Inline SVG line. `filled` adds an area path at 12% opacity. Returns `null` when `values` is empty. |
| `Kbd` | `{ children }` | `components.jsx:291-306` | Two-stroke "keycap" effect via `border-bottom: 2px solid`. Mono 10px. |
| `ViewHeader` | `{ title, subtitle?, badge?, action? }` | `components.jsx:309-335` | Always `padding: 18px 24px 16px 24px`, bottom-bordered. Title is display-font 22px. `action` accepts a node or an array of nodes (used as `key`-bearing children). |
| `Empty` | `{ title, hint? }` | `components.jsx:338-346` | Center-aligned, 60px top padding, dim text. |
| `MonacoEditor` | `{ value, onChange?, language="typescript", height=320, readOnly?, minHeight? }` | `components.jsx:453-525` | Lazy loads `monaco-editor@0.46.0` from unpkg on first mount. Defines `agentic-dark` theme matching tokens. **Worker bootstrap is a data-URL with embedded `importScripts(...)` from unpkg** — major change for the port. |
| **Formatters** | `fmtAgo, fmtDur, fmtBytes, fmtNum, fmtTime` | `components.jsx:261-288` | Exposed on `window`. Time formatters operate in local TZ. |
| **Helper** | `eventTone(color)` | `components.jsx:349-351` | Maps `data.js` color strings to Badge tone strings. |

#### 3.1.1 Accessibility gaps (core)

- `Button` builds hover via JS state, not CSS — keyboard focus and high-contrast hover both miss.
- `Icon` SVGs have no `aria-hidden` / `role` annotations.
- `Badge` is a `<span>` with no semantic role; screen readers read it as plain text (fine, but tone is lost).
- `StatusDot` is a colored circle with no `aria-label`.
- `Panel` header has no `<h>` element — it's a styled `<span>`. Document outline is missing.
- `Kbd` is `<kbd>` (good).
- Focus rings: no `:focus-visible` styling anywhere. Browser default ring is the only focus indicator.

### 3.2 Tweaks panel primitives (`tweaks-panel.jsx`)

These ship as a self-contained drop-in: the panel is **bottom-right floating** (not part of the layout grid), with its own scoped stylesheet injected via `<style>{__TWEAKS_STYLE}</style>`. It communicates with a host iframe via `postMessage` (`__edit_mode_*` protocol).

| Component | Signature | Source | Notes |
|---|---|---|---|
| `useTweaks` | `(defaults) → [values, setTweak]` | `tweaks-panel.jsx:162-177` | State + persistence via `window.parent.postMessage({type:'__edit_mode_set_keys', edits})`. Also fires `tweakchange` CustomEvent. |
| `TweaksPanel` | `{ title='Tweaks', noDeckControls?, children }` | `tweaks-panel.jsx:186-312` | Hidden until host sends `__activate_edit_mode`. Draggable via header. Has special deck-stage rail toggle for slide decks (irrelevant here — `noDeckControls` exists but is unused). |
| `TweakSection` | `{ label, children }` | `tweaks-panel.jsx:316-323` | Section header inside the panel. |
| `TweakRow` | `{ label, value?, children, inline? }` | `tweaks-panel.jsx:325-335` | Row with label + value. |
| `TweakSlider` | `{ label, value, min, max, step, unit, onChange }` | `tweaks-panel.jsx:339-346` | Range slider with value display. |
| `TweakToggle` | `{ label, value, onChange }` | `tweaks-panel.jsx:348-357` | iOS-style green toggle. |
| `TweakRadio` | `{ label, value, options, onChange }` | `tweaks-panel.jsx:359-429` | Segmented control; **auto-falls-back to `<select>` when labels exceed a per-option char budget** (see `:374`). Drag-to-scrub between segments. |
| `TweakSelect` | `{ label, value, options, onChange }` | `tweaks-panel.jsx:431-443` | Plain select. |
| `TweakText` | `{ label, value, placeholder?, onChange }` | `tweaks-panel.jsx:445-452` | Text input. |
| `TweakNumber` | `{ label, value, min?, max?, step, unit, onChange }` | `tweaks-panel.jsx:454-486` | Number with horizontal scrub on label. |
| `TweakColor` | `{ label, value, options?, onChange }` | `tweaks-panel.jsx:514-555` | Color/palette chip grid, with contrast-aware check icon. Falls back to native `<input type="color">` when no `options`. |
| `TweakButton` | `{ label, onClick, secondary? }` | `tweaks-panel.jsx:557-562` | Plain button. |

**Quirk:** The Tweaks panel CSS is in a *light* aesthetic (`background: rgba(250,249,247,.78)` with `backdrop-filter`) — visually distinct from the rest of the app. This is intentional (debug/dev tooling) and should be preserved in the TSX port.

### 3.3 View-local primitives (defined inside `views/*.jsx` and exposed on `window`)

| Component | Origin | Source | Public via |
|---|---|---|---|
| `Th` / `Td` | dashboard.jsx | `dashboard.jsx:217-227` | `window.Th`, `window.Td` |
| `SearchInput` | runs.jsx | `runs.jsx:93-112` | `window.SearchInput` |
| `FilterChip` | runs.jsx | `runs.jsx:114-127` | `window.FilterChip` |
| `CodeBlock` | runs.jsx | `runs.jsx:308-326` | `window.CodeBlock` |
| `KV` | tasks.jsx | `tasks.jsx:280-288` | `window.KV` |
| `AgentCodeTab` | agent-code.jsx | `agent-code.jsx:141-241` | `window.AgentCodeTab` |
| `AgentCodeEditPanel` | agent-code.jsx | `agent-code.jsx:256-285` | `window.AgentCodeEditPanel` |
| `AgentOntologyEditPanel` | agent-code.jsx | `agent-code.jsx:289-316` | `window.AgentOntologyEditPanel` |
| `AgentInputDataEditPanel` | agent-code.jsx | `agent-code.jsx:318-354` | `window.AgentInputDataEditPanel` |
| `AgentToolUseEditPanel` | agent-code.jsx | `agent-code.jsx:358-417` | `window.AgentToolUseEditPanel` |
| `ImportManifestModal` | import-manifest.jsx | `import-manifest.jsx:67` | `window.ImportManifestModal` |
| **`Splitter`** *(portal delta)* | portal/views/agent-code.jsx | `:141-194` | `window.Splitter` — added during portal mounting |
| `testAgent` *(portal delta)* | portal/data.js | `:147-277` | `window.testAgent` — added during portal mounting |

The cross-file dependency graph (e.g. `agents.jsx` calls `window.AgentCodeTab` from `agent-code.jsx`) is enforced only by script load order in `index.html:155-172`. The TSX port should make this an ESM import graph.

---

## 4. View-by-view UI spec

There are nine top-level views in the side nav plus two sub-views that are not directly navigable (`agent-code` exposes `AgentCodeTab`, used by Agents and Runs; `import-manifest` exposes `ImportManifestModal`, used by Workflows and Agents).

### 4.1 Dashboard

**File:** `views/dashboard.jsx`
**Purpose:** Live overview of the RAAS workload. The "home" landing surface.

**Layout** (`dashboard.jsx:60-141`):
- Outer: `flex column`, `height: 100%`. ViewHeader on top, then a single scrollable body.
- Body padding: `20`.
- **KPI row:** `grid-template-columns: repeat(5, 1fr); gap: 12; margin-bottom: 16`. Five `KPICard`s.
- **Main grid:** `grid-template-columns: 1.4fr 1fr; gap: 12`.
  - Left column (1.4fr): Active runs Panel + Agent activity Panel, `gap: 12`.
  - Right column (1fr): Event stream Panel (`minHeight: 320`), Pending tasks Panel, Runtime Panel.
- **Stage funnel:** Full-width Panel below the main grid, `margin-top: 12`.

**Data dependencies:**
- `window.RAAS_AGENTS`, `window.RAAS_RUNS`, `window.RAAS_EVENT_STREAM`, `window.RAAS_TASKS`, `window.RAAS_STAGES` (`dashboard.jsx:5-8`).

**Key interactions:**
- KPI cards are static (no click handler).
- Active runs table rows: `onClick → navigate("runs", {runId})`. Row hover bg `var(--panel-2)`.
- Agent activity buttons: `onClick → navigate("agents", {agentId})`. Left-edge "heat bar" colored by error/intensity.
- Event ticker: auto-scroll every 1.5s when `liveStream` is true (`dashboard.jsx:50-54`); first row plays `tick` animation.
- Pending tasks: `onClick → navigate("tasks", {taskId})`.
- Action buttons in header: Deploy, Replay window — wired but no behavior.

**States:**
- Empty: `RunTable` renders `Empty` when no active runs (`dashboard.jsx:163`). All other panels assume non-empty data — no skeleton/empty for the others.
- Loading: none. The whole view assumes `window.RAAS_*` is populated synchronously (this is the v1_1 baseline; the mounted portal uses the Boot wrapper).
- Error: none.

**TSX acceptance criteria:**
- All five KPI cards reflect live counts derived from `runs`/`stream`/`tasks` arrays exactly per `dashboard.jsx:10-79`.
- StageFunnel uses the hard-coded `counts = [1842, 1731, 1612, 1598, 1480, 1109, 743, 412]` values until a real funnel data source is wired (`dashboard.jsx:364`).
- Event ticker advances on a 1500ms interval when liveStream is on; first row animates `tick`.
- Per-agent activity grid is `repeat(4, 1fr)` with a 1px `var(--border)` background creating the hairline grid look (`dashboard.jsx:233`).
- TEST badge appears next to run ID for any `r.testRun` row (portal delta — see §6).

### 4.2 Workflows

**File:** `views/workflows.jsx` — 1000 lines, the most complex view.
**Purpose:** Static + editable DAG canvas of agents wired by events.

**Layout** (`workflows.jsx:117-340`):
- Outer: `flex column`, `height: 100%`. ViewHeader, optional DraftBanner, then a 2-column grid.
- Grid: `grid-template-columns: 1fr 280px; min-height: 0`.
- Left = canvas; right = inspector aside.
- **Canvas:** absolute-positioned nodes on a dot-grid bg (`background-image: radial-gradient(circle, var(--border) 1px, transparent 1px); background-size: 22px 22px`). Edges drawn as SVG cubic bezier paths with end arrows.

**Layout grid for nodes** (`workflows.jsx:6-37`):
- Node size: `184 × 64`.
- Column spacing: `220` (`COL_W`).
- Row spacing: `90` (`ROW_H`).
- Outer padding: `30` (`PAD_X`, `PAD_Y`).
- 8 stages × up to 5 lanes; node position resolved via the explicit `LAYOUT` map.

**Edges** (`workflows.jsx:194-229`):
- Cubic bezier from `(srcX+NODE_W, srcY+NODE_H/2)` to `(dstX, dstY+NODE_H/2)` with control points at 50% offsets.
- Color by event color (`evColor`); dim when something is selected and edge is not in highlight set.
- Live mode: animated `<circle>` travelling along the path via `<animateMotion>`.

**Inspector aside** (`workflows.jsx:303-336`):
- Three states:
  - `selectedAgent && !editing` → `AgentInspector` (read-only details)
  - `selectedAgent && editing` → `NodeEditor` (editable form)
  - `selectedEvent` → `EventInspector` (emitters/listeners/recent)
  - else if editing → `DraftPalette` (drag targets + diff list)
  - else → `DefaultInspector` (legend + event browser)

**Data dependencies:** `RAAS_AGENTS`, `RAAS_EVENTS`, `RAAS_STAGES`, `RAAS_EVENT_STREAM`.

**Key interactions:**
- Click node → select agent (highlight incoming/outgoing edges and connected nodes).
- Click edge → select event (highlight all edges carrying that event).
- Edit mode: toggle via "Edit workflow" header button. Adds dashed borders to all nodes, the EditDraftBanner, the EditToolbar, and shows the DraftPalette in the aside.
- Modals: NewWorkflowModal (`workflows.jsx:812-962`), ImportManifestModal (sourced from `import-manifest.jsx`).

**States:** No empty / loading / error states for the canvas itself. (Implicit assumption: a workflow always has nodes.)

**TSX acceptance criteria:**
- LAYOUT map preserved exactly (`workflows.jsx:13-37`). Node ID → `{stage, lane}` is the canonical placement.
- 8 stages columns labeled `00 · Intake` through `07 · Submit` (`workflows.jsx:158-170`).
- 5 arrow markers (one per color: green/blue/amber/red/muted) defined in `<defs>` (`workflows.jsx:187-193`).
- Selection highlight ring on node uses `box-shadow: 0 0 0 3px rgba(208,255,0,0.12)`.
- Live edges show animated dots via `<animateMotion>` on a deterministic subset (`workflows.jsx:223`).
- Edit-mode selection handles (4 corners + 4 edges) render only on `editing && isSel`.
- New workflow modal opens at 780×86vh; 6 hardcoded template cards.
- Modal overlay has `backdrop-filter: blur(2px)` + `fadein 0.14s ease`.

### 4.3 Agents

**File:** `views/agents.jsx` (1065 lines).
**Purpose:** List + detail surface for every agent in the active workflow; site of the 5-step "Deploy agent" wizard.

**Layout** (`agents.jsx:30-72`):
- Outer: `flex column`, `height: 100%`. ViewHeader.
- Body: `grid-template-columns: 440px 1fr` when an agent is selected; `1fr` otherwise.
- Left aside: search input, actor filter chips (All / Agents / Human), then either AgentsGrid (no selection) or AgentsListCompact (with selection).
- Right pane: AgentDetail with header + 4-stat strip + 5 tabs (config | io | code | versions | runs).

**Tabs in AgentDetail** (`agents.jsx:186-203`):
- `config` (default) → `ConfigTab` or `EditConfigTab` if `editing` is true
- `io` → `IOConfigTab`
- `code` → `window.AgentCodeTab` (from `agent-code.jsx`)
- `versions` → `VersionsTab` (filters `RAAS_DEPLOYMENTS` by `agent.name`)
- `runs` → `RunsTab` (recent runs for the agent, last 10)

**Data dependencies:** `RAAS_AGENTS`, `RAAS_RUNS`, `RAAS_DEPLOYMENTS`, `RAAS_TASKS`, `RAAS_EVENTS`, `RAAS_STAGES`, `RAAS_TENANTS`, `RAAS_SAMPLE_TS_CODE`, `RAAS_SAMPLE_TOOL_USE`.

**Key interactions:**
- AgentsGrid card: `onClick → navigate("agents", {agentId})`.
- "View in graph" → navigate("workflows").
- "Edit" → toggle local `editing` state, replaces ConfigTab with EditConfigTab.
- "Test run" → **portal delta** (see §6): calls `window.testAgent(agent)` and navigates to the new run.
- "Deploy agent" header button → opens DeployAgentModal (1080px, 5-step wizard, full agent definition flow).

**States:**
- Empty (filtered list): no explicit empty state — just renders an empty grid.
- AgentDetail with no `selectedId.agent`: renders `<Empty title="Agent not found" />`.
- RunsTab empty: renders `<Empty title="No recent runs" />`.

**TSX acceptance criteria:**
- AgentsGrid: `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12; padding: 16`.
- Card left edge: `3px solid var(--signal)` (Agent) or `var(--violet)` (Human).
- StatCellA strip: `repeat(4, 1fr)` with hairline borders between cells, no gap.
- EditConfigTab: `grid-template-columns: minmax(0, 1fr) 360px` (live manifest preview on right).
- Deploy wizard step indicator: numbered circles → checkmark when done, lime stroke on active step.

### 4.4 Runs

**File:** `views/runs.jsx` (350 lines).
**Purpose:** Stream of all runs (running / ok / failed), plus detail timeline of one run.

**Layout** (`runs.jsx:25-91`):
- Outer: `flex column`, `height: 100%`. ViewHeader.
- Body: `grid-template-columns: 440px 1fr`.
- Left aside: SearchInput + status filter chips, then a list of runs (full-bleed list rows with status dot, mono run-id, agent title, subject/trigger).
- Right pane: `RunDetail` — header + 5-cell stats strip + 4 tabs (timeline | logs | io | events).

**Tabs in RunDetail** (`runs.jsx:158-173`):
- `timeline` (default) → `TimelineTab` (step-bar gantt-style; each step renders a colored bar with start% and width%, animated shimmer for running steps)
- `logs` → `LogsTab` (renders `RAAS_SAMPLE_LOG`, coloring by level)
- `io` → `IOTab` (two side-by-side CodeBlocks)
- `events` → `RunEventsTab` (trigger + emit summary)
- **`agent`** *(portal delta)* → embeds `window.AgentCodeTab` for the run's agent

**Data:** `RAAS_RUNS`, `RAAS_AGENTS`, `RAAS_SAMPLE_LOG`.

**Key interactions:**
- List row click → `navigate("runs", {runId})`.
- Open agent button (portal delta): top-right of detail header → `navigate("agents", {agentId})`.
- Status filter chips: All / Running / Ok / Failed.

**States:**
- TimelineTab: renders `<Empty title="No steps recorded" hint="Manual / human task — see Events tab" />` when `run.steps` is empty.
- Failed run with `run.error`: renders an Error panel below tab content with red mono text + Retry / View error trace buttons.
- TEST RUN badge appears in detail header when `run.testRun` is true (portal delta).

**TSX acceptance criteria:**
- Timeline bar:
  - Grid row: `grid-template-columns: 26px 220px 1fr 80px; gap: 12` (`runs.jsx:211`).
  - Bar height 16px, background `var(--bg-2)`, fill colored by status, `border-left: 2px solid` matching color.
  - Running step gets a shimmer overlay via `linear-gradient` + `animation: shimmer 1.5s linear infinite`.
- StatCell strip: 5 equal columns with hairline right-borders.
- Logs colorization: ERROR → red, WARN → amber, DEBUG → text-3, lines containing `emit` or `run.end` → signal.

### 4.5 Events

**File:** `views/events.jsx` (283 lines).
**Purpose:** Live event ledger with histogram, type-filtered list, detail view.

**Layout** (`events.jsx:51-143`):
- Outer: `flex column`, `height: 100%`. ViewHeader.
- Histogram strip: 12px 24px padding, `var(--panel)` bg, full-width.
- Body: `grid-template-columns: 260px 1fr 360px`.
  - Left aside: search + category filters + scrollable event-type list with counts.
  - Center: sticky header showing count + active filter chip, then a table of events.
  - Right aside: EventDetail (Source / Listeners / Payload sections + replay button).

**Data:** `RAAS_EVENT_STREAM`, `RAAS_EVENTS`, `RAAS_AGENTS`.

**Key interactions:**
- Histogram is decorative (no click).
- Category filter chips toggle `catFilter`.
- Type list rows toggle `typeFilter`.
- Table row click → set `selectedId`.
- Source agent / listener rows → `navigate("agents", {agentId})`.
- "Replay event" / "Inngest console" buttons → wired, no behavior.

**States:** No empty states for the histogram or list. EventDetail renders nothing if no event is selected (latent: should show an Empty).

**TSX acceptance criteria:**
- Histogram bars: 60 buckets (one per minute), height proportional to count, last bucket lit lime to indicate "now".
- Event tone colors:
  - `green` → `var(--green)` (success-class)
  - `blue` → `var(--blue)` (data / trigger)
  - `amber` → `var(--amber)` (warn)
  - `red` → `var(--red)` (alert)
  - `muted` → `var(--text-3)`

### 4.6 Tasks (Human tasks)

**File:** `views/tasks.jsx` (291 lines).
**Purpose:** Inbox of pending human-in-the-loop tasks; per-task review surface with type-specific payload renderers.

**Layout** (`tasks.jsx:13-39`):
- ViewHeader with `{tasks.length} OPEN` amber badge.
- Body: `grid-template-columns: 420px 1fr`.
- Left: priority filter chips (All/HIGH/MED/LOW) + list of TaskRow.
- Right: TaskDetail (header + payload-typed body + decision actions panel + workflow context panel).

**Type-specific payload renderers** (`tasks.jsx:134-278`):
- `JDReviewPayload` — generated JD on left, agent reasoning on right.
- `PackagePayload` — candidate package + submission preview (1.4fr / 1fr).
- `ResumeFixPayload` — parse error display with re-upload buttons.
- `ClarificationPayload` — open questions with inline answer fields.
- `SupplementPayload` — list of missing items with Attach buttons.
- `ManualPublishPayload` — manual instructions + open-helper-page button.

**Decision actions** (`tasks.jsx:90-100`): Two primary/secondary action buttons per task type (mapped in `decisionLabel()`), plus a Snooze button and keyboard hints (`⌘+↵` approve, `⌘+R` reject — currently UI-only, no real key handler).

**Data:** `RAAS_TASKS`, `RAAS_AGENTS`.

**TSX acceptance criteria:**
- Priority badges: high → amber, med → blue, low → muted.
- Each TaskRow has left-edge selection indicator (`2px solid var(--signal)` when active).
- KV component (`tasks.jsx:280-288`): `grid-template-columns: 120px 1fr; gap: 8; font-size: 12.5`.

### 4.7 Logs

**File:** `views/logs.jsx` (190 lines).
**Purpose:** File-tree log explorer with grep/level filtering and live tailing.

**Layout** (`logs.jsx:12-56`):
- ViewHeader with "File-backed logs · /var/agentic/logs · rotated daily".
- Body: `grid-template-columns: 280px 1fr`.
- Left: `FileTree` (recursive, with chevron toggles, live indicators).
- Right: toolbar (path display + 14.2 KB badge + tail badge + grep input + level select) + log body.

**Mock tree** (`logs.jsx:60-100`): `logs/runs/2026-05-16/run-XXXXX.log`, `logs/events/2026-05-16.ndjson`, `logs/system/*.log`.

**LogView** (`logs.jsx:155-187`):
- Renders `RAAS_SAMPLE_LOG` line by line.
- Two-column grid per line: 44px right-aligned line number + flex log text.
- Coloring by inferred level.
- When `live`, appends a "waiting for next line…" pulsing-dot row.

**TSX acceptance criteria:**
- File tree node padding scales with depth: `depth * 14 + 24` px for files, `depth * 14 + 8` for directories.
- Line numbers use `var(--text-4)` (`#46474d`).
- Grep filter applies case-insensitively to entire line.

### 4.8 Deployments

**File:** `views/deployments.jsx` (243 lines).
**Purpose:** Versions + rollback table + a 3-method "Deploy new version" wizard.

**Layout** (`deployments.jsx:9-72`):
- ViewHeader with "Deploy new version" primary button.
- Body: scrollable, 20px padding.
- Optional `DeployWizard` inline at top (toggled).
- "Live versions" Panel: 3-column grid of `LiveCard`s for Workflow / Runtime / Inngest worker.
- "Deployment history" Panel: table with Status / Version / Target / By / When / Notes / actions.

**Deploy wizard** (`deployments.jsx:92-132`):
- 3 method cards (Manifest upload / Code package / Visual builder).
- Each method has its own step renderer.

**TSX acceptance criteria:**
- LiveCard left edge: signal-colored `LIVE` badge.
- Wizard panel uses a signal-tinted box-shadow: `0 0 0 1px rgba(208,255,0,0.08), 0 12px 32px -16px rgba(208,255,0,0.18)`.

### 4.9 Settings

**File:** `views/settings.jsx` (2234 lines — largest view in the codebase).
**Purpose:** Workspace configuration spanning 9 sections (General / Members / Keys / Integrations / Models / Usage / Quotas / Audit / Danger).

**Layout** (`settings.jsx:80-117`):
- ViewHeader with workspace + region + operator info.
- Body: `grid-template-columns: 232px 1fr`.
- Left aside: nav with 9 SectionNavItem rows (`bg-2`).
- Right: SectionHeader + section component (`maxWidth: 1080`).

**Section navigator items** (`settings.jsx:59-69`):
```
general, members, keys, integrations, models, usage, quotas, audit, danger
```

**Reusable atoms** (settings-local, `settings.jsx:160-271`): `Field`, `TextIn`, `SelectIn`, `Toggle`, `CardRow`, `StatusPill`, `RoleBadge`.

**Sub-modals/drawers in settings:**
- `ProviderKeyModal` (`:842`)
- `ConfigureModelDrawer` (`:937`) — right-side drawer
- `AddProviderModal` (`:1382`)
- `AddModelModal` (`:1574`)
- `ModalOverlay` (`:1126`) — supports `side="right"` for drawers

**TSX acceptance criteria:**
- Field component: `grid-template-columns: 200px 1fr; gap: 16; padding: 14px 0; border-bottom: 1px solid var(--border)`.
- Toggle is custom (not native checkbox); 36×20, lime when on (`settings.jsx:219-237`).
- Each section is a stand-alone React function; the section nav merely switches which one renders.

### 4.10 Agent Code (sub-view)

**File:** `views/agent-code.jsx` (used by Agents detail Code tab and — in the portal — Runs detail Agent tab).
**Purpose:** Read-only display of TypeScript code + ontology + input_data + tool_use bindings.

**Layout (v1_1, read-only Code tab)** (`agent-code.jsx:155-241`):
- `grid-template-columns: minmax(0, 1fr) 380px; gap: 12`.
- Left: Monaco editor (height 520, readOnly) for `typescript_code`.
- Right column: ontology Panel, input_data Panel, tool_use Panel, Runtime Panel.

**Portal modification:** See §6 — the right column is collapsible via maximize toggle, splitters allow per-block resizing.

**TSX acceptance criteria:**
- Monaco theme name `agentic-dark` exactly matches the token system (mapping in `components.jsx:382-426`).
- tool_use param chips use `*` suffix on required params, blue type label, mono name.

### 4.11 Import Manifest (sub-view modal)

**File:** `views/import-manifest.jsx` (809 lines).
**Purpose:** 6-step modal wizard for uploading and deploying a workflow.json + actions.json manifest pair.

**Steps** (`import-manifest.jsx:14-21`):
```
source → validate → diff → resolve → preview → deploy
```

**Layout:** 980×90vh modal with stepper, content body, footer.

**Mock validation result** (`import-manifest.jsx:24-65`): hardcoded `buildSampleParse()` returns a fake parse summary with cycles=0, orphans=0, issues array, diff, conflicts.

---

## 5. Sidebar / TopBar / Tweaks panel shell

### 5.1 Sidebar

**Defined in:** `app.jsx:108-164`.

**Dimensions:**
- Width: **232px** (set by parent grid `grid-template-columns: 232px 1fr` in `app.jsx:43-47`).
- Background: `var(--bg-2)`.
- Right border: `1px solid var(--border)`.

**Sections (top to bottom):**

| Section | Source | Height | Notes |
|---|---|---|---|
| Logo block | `app.jsx:117-123` | ~52px | 24x24 lime SVG logo + "Agentic Operator" + `v0.6.2` version |
| TenantSwitcher | `app.jsx:181-238` | ~57px | Button with 22x22 swatch + tenant name + subtitle + chevron-down; dropdown popover when open |
| Nav | `app.jsx:129-147` | flex 1 | Three NavGroups: **Run** (Dashboard, Workflows, Agents, Runs), **Observe** (Events, Human tasks, Logs), **Manage** (Deployments, Settings) |
| Footer | `app.jsx:150-161` | ~55px | Two status rows: "Inngest 3w · 0 lag" and "SQLite 8.4 MB", each with green StatusDot |

**NavItem structure** (`app.jsx:249-289`):
- Padding `6px 10px`.
- Left edge: `2px solid var(--signal)` when active, transparent otherwise.
- Background: `var(--panel-2)` when active.
- Right-side accessory: `liveCount` (mono signal pill with pulsing dot), or `count` (rounded muted pill, amber if `highlight`).

**Active state precedence:** Active item is determined by string equality `view === id`. The Tasks nav item has `highlight` prop set to true, which gives it an amber pill bg even when not active (`app.jsx:139`).

### 5.2 TopBar

**Defined in:** `app.jsx:291-374`.

**Dimensions:**
- Height: **44px** fixed (`app.jsx:305`).
- Background: `var(--bg)` (not panel — sits flush against canvas).
- Bottom border: `1px solid var(--border)`.
- Padding: `0 18px`.
- Gap between children: `14`.

**Children (left to right):**

1. **Breadcrumb** (`app.jsx:314-329`):
   - When `params.runId` / `agentId` / `eventName` / `taskId` is set → `[parent button] > [chevron] > [final label]`.
   - Else → capitalized view name.
   - Crumb segments use `chevron-right` icon (size 10) and `var(--text-4)` color.

2. **Cmd-K search button** (`app.jsx:332-346`):
   - `margin-left: auto` pushes it right.
   - 240px min-width, panel bg + border-2.
   - Contents: search icon + placeholder "Jump to agent, event, run…" + two Kbd elements (`⌘` `K`).
   - **No actual command palette is wired up** — pure visual prop.

3. **Live toggle** (`app.jsx:349-365`):
   - Toggles `tweaks.liveStream`.
   - When live: lime tint bg (`rgba(208,255,0,0.08)`), lime border, pause icon + "LIVE" label.
   - When paused: transparent bg, border-2 border, play icon + "PAUSED" label.

4. **User chip** (`app.jsx:368-372`):
   - 22x22 violet circle with "LW" initials + "Liu Wei" name.
   - No menu / no click handler.

### 5.3 Tweaks panel

**Defined in:** `tweaks-panel.jsx` (entire file). Mounted by `app.jsx:66-103`.

**Position:** Fixed bottom-right (`right: 16px; bottom: 16px`).
**Width:** 280px.
**Max-height:** `calc(100vh - 32px)`.
**Z-index:** `2147483646` (max-but-one int — designed to sit above everything else).
**Styling:** Light glass card (`background: rgba(250,249,247,.78); backdrop-filter: blur(24px) saturate(160%); border: .5px solid rgba(255,255,255,.6); border-radius: 14px`).

**Visibility:** Only renders when `__activate_edit_mode` message arrives via `postMessage` (`tweaks-panel.jsx:252-257`). Default hidden.

**Controls present in App** (`app.jsx:68-101`):
1. `TweakRadio` — Theme: dark / light
2. `TweakRadio` — Density: compact / default / comfortable
3. `TweakColor` — Accent: 4 swatches (lime / cyan / amber / violet)
4. `TweakToggle` — Live event stream
5. `TweakToggle` — Show debug panels
6. `TweakSelect` — Active tenant (from `window.TENANTS`)
7. **(Portal delta)** `TweakRadio` — Data source: json / neo4j (`apps/web/public/portal/app.jsx:118-123`)

**Keyboard shortcuts:** None inside the panel. Drag handle is the header (`tweaks-panel.jsx:295`).

**Persistence:** `useTweaks` posts every edit to `window.parent` via `postMessage({type: '__edit_mode_set_keys', edits})`. The `EDITMODE-BEGIN…EDITMODE-END` block in `app.jsx:6-13` is the source of truth that the host writes back to disk. In the TSX port, this should be replaced with `localStorage` (or a real `/api/settings/preferences` endpoint).

---

## 6. Deltas applied since v1_1

Below: every divergence the mounted portal has from the canonical `agentic-operator_v1_1/` source. Each is intentional, scoped, and worth preserving.

| # | Delta | Why | Files touched | Keep in TSX port? |
|---|---|---|---|---|
| **D-1** | **Boot wrapper** — gating App render on `RAAS_BOOTSTRAP` Promise; renders `BootSplash` while loading, `BootError` if fetch fails. | The original mock data was synchronous (IIFE). The mounted version fetches from `/api/spa/bootstrap`, which is asynchronous — without a wrapper, views would crash on first render reading empty globals. | `apps/web/public/portal/app.jsx:398-477` | **KEEP.** Required for real backend wiring. Translate to Suspense / loading boundary in the TSX port. |
| **D-2** | **API-backed bootstrap** — `data.js` replaced by an IIFE that fetches `/api/spa/bootstrap?source=json` and sets `window.RAAS_*`. Empty defaults populate before fetch resolves. | Same as D-1 — wires the SPA to real data. | `apps/web/public/portal/data.js` (entirely rewritten) | **KEEP** the wiring approach. The TSX port should fetch on a per-resource basis with React Query / SWR rather than one big bootstrap blob. |
| **D-3** | **`window.RAAS_RELOAD` + data-source toggle** — Tweaks panel exposes a `dataSource` radio (json / neo4j); changing it re-fetches bootstrap. | Demo / debug capability to swap the storage backend (Neo4j stub vs JSON files). | `apps/web/public/portal/app.jsx:9-49`, `apps/web/public/portal/app.jsx:118-123`, `apps/web/public/portal/data.js:85-102` | **KEEP** as a debug-only setting (gated behind `showDebug`). |
| **D-4** | **`window.testAgent`** — synthetic run engine that creates a "running" run for an agent, advances each step on a 600-2000ms random timer, emits the first declared event when done. Dispatches `raas-runs-updated` and `raas-events-updated` CustomEvents. Supports `opts.subject` override and `opts.fail` to force last-step failure. | The "Test run" button in `AgentDetail` previously had no behavior. Real backend integration is not yet ready, so this provides a believable visual + functional test path. | `apps/web/public/portal/data.js:147-277` | **KEEP** until real test-run API is wired. The behavior maps naturally to a `POST /api/agents/:id/test-runs` endpoint. |
| **D-5** | **Agents detail splitter** — `Agents` view changed from a fixed `grid-template-columns: 440px 1fr` to a flex layout with a draggable `Splitter` between list and detail (min 260, max 720). | Improves ergonomics when reading long agent names / code. | `apps/web/public/portal/views/agents.jsx:62-101`, splitter sourced from `agent-code.jsx:141-194` | **KEEP.** Useful UX. Translate to a controlled resize component. |
| **D-6** | **Code-tab splitters + maximize** — `AgentCodeTab` got resizable sidebar (default 340px) and per-block heights for ontology/input_data/tool_use, plus a maximize toggle that hides the sidebar entirely. | A 380px sidebar was cramped for serious code review. Maximize is for full-screen reading. | `apps/web/public/portal/views/agent-code.jsx:141-…` | **KEEP.** Pattern is clean. Translate to splitter + an explicit panel-state machine. |
| **D-7** | **Runs detail "agent" tab** — adds a 5th tab to `RunDetail` ("agent") that renders `window.AgentCodeTab` for the run's owning agent. Adds "Open agent" button in the detail header. | Closes a navigation gap — previously you had to leave the run view to inspect the agent's code. | `apps/web/public/portal/views/runs.jsx:131-204` | **KEEP.** The cross-link is fundamental to the operator workflow. |
| **D-8** | **TEST badges + AgentDetail latest-test chip + AgentsGrid test count + RunsTab "X test" subtitle** — visual markers everywhere a `r.testRun: true` run appears. AgentDetail header shows a clickable "TEST · {ago}" chip pointing to the most recent test run. | Distinguishes synthetic test runs from real production runs visually. | `apps/web/public/portal/views/agents.jsx:35-46, :143, :199-217, :419-440`, `apps/web/public/portal/views/runs.jsx:75, :158`, `apps/web/public/portal/views/dashboard.jsx:203-208` | **KEEP** while the platform supports test runs. The badge tone is `signal` to match other "live/active" affordances. |
| **D-9** | **`useLiveData` re-render hook** — listens for `raas-runs-updated` / `raas-events-updated` CustomEvents and bumps a local tick to force re-render. Used in Agents, Runs, Dashboard. | The window-global mutation pattern doesn't trigger React renders on its own. | `apps/web/public/portal/views/agents.jsx:6-19`, `apps/web/public/portal/views/runs.jsx:6-13`, `apps/web/public/portal/views/dashboard.jsx:5-16` | **REPLACE.** In the TSX port, use real React state for runs/events (via React Query or a store), not window globals. |
| **D-10** | **Absolute script paths in index.html** — every `src=` prefixed with `/portal/`. | The portal is served from `/portal/` rather than the SPA root. | `apps/web/public/portal/index.html:156-172` | **REPLACE** entirely — the TSX port has its own bundler. |
| **D-11** | **Models prop threading + window mirror** — `App` owns `models` state, mirrors to `window.RAAS_SETTINGS_MODELS`, passes to Agents/Settings. The model dropdowns in Agents now consume the live list instead of hardcoded options. | Lets the operator add/remove models in Settings and have the Agent / Deploy dropdowns reflect those changes immediately. | `apps/web/public/portal/app.jsx:27-49, :71-77`, `apps/web/public/portal/views/agents.jsx:184, :459, :525-527, :741, :893-895` | **KEEP** the model-fleet-driven dropdowns. Replace the window mirror with a context provider in the TSX port. |

**Files that are byte-for-byte unchanged from v1_1 in the portal copy:**

- `components.jsx` ✓
- `tweaks-panel.jsx` ✓
- `views/workflows.jsx` ✓
- `views/events.jsx` ✓
- `views/tasks.jsx` ✓
- `views/logs.jsx` ✓
- `views/deployments.jsx` ✓
- `views/settings.jsx` ✓
- `views/import-manifest.jsx` ✓

This is encouraging — the visual design has held up. The deltas concentrate around data-loading plumbing, splitters, and the test-run loop.

---

## 7. Risk register for the TSX port

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| **R-1** | **Inline-style proliferation.** Every JSX node carries 5-30 inline style props. Migrating naively to Tailwind or a CSS-in-JS lib will cause subtle pixel drift on every element. | **High** | Phase 1: keep inline styles verbatim, just translate `<script>` to ESM. Phase 2: extract recurring patterns to `clsx` + utility classes. Use screenshot diff per view to catch regressions. |
| **R-2** | **Monaco CDN dependency.** `components.jsx:357-450` builds a `data:text/javascript` worker shim that `importScripts` from `https://unpkg.com/monaco-editor@0.46.0/min/`. This breaks offline builds, breaks any environment with strict CSP, and breaks if unpkg changes. | **High** | Vendor Monaco via `@monaco-editor/react` and `monaco-editor-webpack-plugin`. Re-apply the `agentic-dark` theme (`components.jsx:382-426`) verbatim. Validate with the same `editor.lineHighlightBackground`, `editorCursor.foreground = #d0ff00`, etc. |
| **R-3** | **Seeded synthetic data removal.** The v1_1 `data.js` builds 80 runs and 140 events deterministically via a seeded LCG (`data.js:354-475`). The mounted portal now fetches real data from `/api/spa/bootstrap`. *Any* view that assumes ≥1 active run or ≥1 task will render an Empty or worse if the backend returns fewer. | **Medium** | Inventory every view's empty/error path during the port. The Risk audit found at least 3 missing Empty states (Workflows canvas, Events list when no events match, EventDetail when nothing is selected). |
| **R-4** | **Window-global state mutation.** `testAgent` and the bootstrap mutate `window.RAAS_*` directly and dispatch CustomEvents. React components subscribe via `useLiveData()`. This is brittle, leaks across navigation, and is invisible to React DevTools. | **Medium** | Replace with React Query for server state, a Zustand/Jotai/Context store for client-only test runs. The mutation pattern is OK for a prototype but not production. |
| **R-5** | **No keyboard accessibility, no focus styles, no ARIA.** The buttons use JS-driven hover. Custom selects are pure `<select>` (good), but custom toggles, segmented controls, kbd hints, and the Cmd-K placeholder are not keyboard-operable. | **Medium** | Add `:focus-visible` styling matching the signal color. Wire `⌘+K` to a real palette. Test every interactive surface with a screen reader before launch. |
| **R-6** | **Pixel parity testing strategy.** With ~30 components × 11 views × 2 themes × 3 densities, there is no realistic way to manually verify the port matches v1_1. | **Medium** | Stand up a Playwright + screenshot diff harness against the v1_1 prototype as the gold reference. Per-component visual stories help; per-view full-page screenshots are non-negotiable. |
| **R-7** | **Tweaks panel `postMessage` plumbing.** The panel posts to `window.parent` assuming an iframe host (the design tool). Outside that context, every preference write is dropped. | **Low** | Replace with `localStorage` writes in the TSX port; keep the postMessage as a feature-flagged fallback for the prototype workflow. |
| **R-8** | **Latent / unused props and tokens.** `--density` is set on `<html>` but unused. `ActorTag` accepts `compact` but ignores it. `Button` has no `disabled` state. `--r-sm/md/lg` are declared but the codebase uses literal `4/6/10`. | **Low** | Either wire them up (1-2 days) or remove them. Recommend wiring `--density` and `disabled`. |
| **R-9** | **Random IDs / `Date.now()` in IIFE data synthesis.** `RAAS_RUNS` / `RAAS_EVENT_STREAM` use `Date.now()` at module-load to backdate items. Any snapshot test will be non-deterministic. | **Low** | The portal already moved past this by fetching from the API; for v1_1-style tests, fix `Date.now` to a known epoch. |
| **R-10** | **`fmtAgo` / `fmtTime` use local TZ.** `dashboard.jsx`/`runs.jsx` display times like `08:14:02` based on `toTimeString()`. In a multi-tenant ops console, this will confuse cross-timezone teams. | **Low** | Add a workspace-timezone setting and a `formatInTz()` helper. Settings already exposes a TZ field (`settings.jsx:298-302`); wire it up. |
| **R-11** | **Z-index ladder undefined.** Modal overlays use `100`, tweaks panel uses `2147483646`, tenant dropdown uses `50`. No documented hierarchy. | **Low** | Define a `z` token map: `zBase=0`, `zDropdown=10`, `zSticky=20`, `zModalBackdrop=100`, `zModalContent=110`, `zToast=200`, `zTweaks=999`. Migrate every literal. |

---

## 8. Open design questions

These are decisions that block "exact parity" because the prototype either takes a stance the team may want to revisit, or leaves the door ambiguous.

1. **Auth flow.** The Sidebar shows a hardcoded "Liu Wei" user chip and a fixed tenant switcher. There is no login surface, no logout button, no session-expiry handling. What happens at `/portal` when unauthenticated? Redirect to a login page? Show a banner? **Recommend:** add a minimal `/login` route + an `Authenticated` wrapper before the port begins.
2. **Multi-tenant tenant switch.** The TenantSwitcher (`app.jsx:181-238`) writes to `tweaks.tenant`, which would also re-fetch bootstrap (D-3 wiring). What about: (a) URL reflecting active tenant? (b) cross-tenant runs/events appearing during the transition? (c) confirm prompt when switching away from unsaved Workflow draft? **Recommend:** put tenant in the URL pathname (`/portal/:tenant/...`), confirm on unsaved drafts.
3. **Real-time updates UX.** The "LIVE / PAUSED" toggle currently controls only client-side simulation (event ticker auto-advance). With a real backend, do we use SSE? WebSocket? Long-poll? Does the toggle pause server-side subscription, or just freeze the UI? **Recommend:** SSE, with the toggle freezing UI but keeping subscription alive.
4. **Error toast pattern.** There is no toast/snackbar system in the prototype. Failed actions (e.g., a click on "Deploy to prod") would currently fail silently. **Recommend:** specify a toast component before the port — corner-anchored, max 3 stacked, auto-dismiss 4s, manual dismiss via X.
5. **Command palette.** `⌘+K` is shown but not wired. What's its scope — agents only? Everything? Recent items? **Recommend:** kbar-style modal with three sections (jump-to navigation, run lookup, agent lookup).
6. **Optimistic updates.** Editing an agent's config (`EditConfigTab`) currently has no save behavior. What's the round-trip? Stale-while-revalidate? Block until success? **Recommend:** optimistic with rollback on 4xx/5xx.
7. **Drag-and-drop in the workflow canvas.** Edit mode shows handles and the DraftPalette has `draggable` cards, but no drop handler is wired. **Recommend:** decide before the port whether the visual builder ships in v1 or v2 — it's a big effort.
8. **Density mode.** Wire `--density` through spacing, or remove the control. (See R-8.)
9. **Light theme readiness.** Only 8 of the 19 tokens have light overrides (`index.html:45-60`). The other 11 (the accent rainbow + signal-dim) are likely to be too saturated against a light bg. Audit all light-theme contrast ratios before shipping.
10. **Right-click / context menus.** Not present in the prototype. Should runs / events / agents support a context menu? **Recommend:** out of scope for v1.
11. **Per-route URL params.** The prototype keeps `view` + `params` in a single `useState` (`app.jsx:24-25`). Browser back/forward, bookmarking, deep-linking — all broken. **Recommend:** Next.js App Router routes from day one (DESIGN.md §2 already plans this).
12. **Test-run ergonomics.** The `testAgent` engine emits one event downstream — should test runs cascade? Show in production dashboards? Be deleted after some retention? **Recommend:** keep test runs in a separate `testRun: true` partition, hide from prod dashboards by default, retain 24h.

---

## 9. Acceptance checklist for "exactly the same as v1_1"

A designer or QA can walk this list with the ported app open next to `agentic-operator_v1_1/` to confirm parity.

### Global

- [ ] Page background `#0a0a0b`; sidebar background `#0f0f11`.
- [ ] Body font is IBM Plex Sans 13px / 1.45.
- [ ] Mono font (badges, IDs, KPIs) is IBM Plex Mono.
- [ ] View titles (Dashboard, Agents, etc.) render in Instrument Serif 22px italic-capable.
- [ ] Scrollbar is 10px wide, thumb `var(--border-2)` with 2px transparent border, hover `var(--border-3)`.
- [ ] Text selection background is electric lime `#d0ff00`, text `#000`.
- [ ] `LIVE` toggle in top bar tints lime when on, gray when paused, with correct play/pause icon.

### Sidebar

- [ ] 232px wide.
- [ ] Logo is a 24px lime square with 4 black dots + lines, "Agentic Operator" / "v0.6.2".
- [ ] Tenant switcher shows RAAS (lime swatch) by default; clicking opens a dropdown of 3 tenants + "New tenant" footer.
- [ ] Nav has 3 labeled groups: Run / Observe / Manage with mono-uppercase headers.
- [ ] Agents nav item shows `(22)` count pill.
- [ ] Runs nav item shows a pulsing dot + count when ≥1 run is running.
- [ ] Tasks nav item shows amber `(6)` pill (highlighted).
- [ ] Footer shows two ok-status lines: Inngest and SQLite.

### Top bar

- [ ] 44px high, `var(--bg)` background.
- [ ] Breadcrumb capitalizes the view name when no params.
- [ ] Search button is right-aligned, ~240px wide, mono Kbd `⌘ K`.
- [ ] Live toggle and user chip ("LW" violet circle + "Liu Wei") right of search.

### Dashboard

- [ ] 5 KPI cards in a `repeat(5, 1fr)` row with mono 26px numbers.
- [ ] Active runs table has running-row hover, mono signal-colored "current step" column.
- [ ] Agent activity grid is `repeat(4, 1fr)` with 1px hairline-grid look.
- [ ] Event ticker auto-advances every 1.5s when live; first row plays `tick` animation.
- [ ] Pending tasks rows are clickable.
- [ ] System health shows 6 rows with status dots.
- [ ] Stage funnel: 8 columns, lime gradient bars, mono 16px counts.

### Workflows

- [ ] Canvas has dotted background (`radial-gradient`, 22px spacing).
- [ ] Stage headers `00 · Intake` through `07 · Submit` align with their columns.
- [ ] Edges are colored by event color, with directional arrowheads.
- [ ] Animated travelling dots on a subset of edges when live.
- [ ] Click a node → highlight in/out edges + connected nodes, dim everything else to 0.10 opacity.
- [ ] Selected node gets a 3px lime glow box-shadow.
- [ ] Edit mode banner is amber with auto-saved timestamp + kbd hints (⌘+Z / V / C / N).

### Agents

- [ ] Grid view: `repeat(auto-fill, minmax(280px, 1fr))`, lime/violet left edges per actor.
- [ ] Detail header: ActorTag + ID badge + agent name + action buttons.
- [ ] Stats strip: 4 cells with hairline dividers — Runs 24h / Errors / P50 / Last run.
- [ ] 5 tabs (config/io/code/versions/runs) with lime underline on active.
- [ ] Code tab loads Monaco with the `agentic-dark` theme.
- [ ] tool_use cards show param chips with type + required asterisks.

### Runs

- [ ] List rows have status dot + mono run-id + agent title + subject/trigger.
- [ ] Selected row has lime left-edge marker.
- [ ] Detail header shows status dot + run-id + status badge + trigger/emit badges.
- [ ] Timeline tab: step rows with status dot + name + bar + duration; running steps shimmer.
- [ ] Logs tab: colored log lines (ERROR red, WARN amber, DEBUG dim, emit lines lime).
- [ ] IO tab: two side-by-side CodeBlocks.

### Events

- [ ] Histogram strip with 60 bars + axis labels.
- [ ] 3-column body: filters / list / detail.
- [ ] Event tones match the `data.js` color attribute on each event.

### Tasks

- [ ] Header shows amber `(6) OPEN` badge.
- [ ] Priority filter chips: All / HIGH / MED / LOW.
- [ ] Type-specific payload renderer chosen by `task.type`.
- [ ] Decision actions panel with primary/secondary buttons + Snooze + Kbd hints.

### Logs

- [ ] File tree with chevron toggles.
- [ ] Toolbar with path + size badge + tail indicator + grep input + level select.
- [ ] Log body: 44px line numbers + content; level-colored.

### Deployments

- [ ] 3 LiveCards (Workflow / Runtime / Inngest worker) with `LIVE` lime badges.
- [ ] History table with status badges, mono versions, rollback/restore buttons.
- [ ] Deploy wizard inline with 3 method cards and method-specific bodies.

### Settings

- [ ] Two-column layout: 232px nav + body capped at 1080.
- [ ] 9 sections wire to 9 components.
- [ ] Field component has `200px / 1fr` two-column layout.
- [ ] Toggle is custom (not native checkbox), lime when on.

### Tweaks panel

- [ ] Renders only after `__activate_edit_mode` postMessage.
- [ ] Bottom-right, light glass look, draggable.
- [ ] 6 controls (7 in portal): theme, density, accent (chip swatches), liveStream, showDebug, tenant, (portal) dataSource.

### Modals & overlays

- [ ] Backdrop `rgba(0,0,0,0.5)` with `backdrop-filter: blur(2px)`.
- [ ] `fadein 0.14s ease` entry animation.
- [ ] Close on backdrop click; stop propagation on content click.

### Portal deltas (also acceptance items)

- [ ] Boot splash appears with spinner + "LOADING WORKFLOW…" until bootstrap resolves.
- [ ] Boot error screen offers a retry button.
- [ ] Tweaks panel has "Data source" radio with json / neo4j.
- [ ] "Test run" button in AgentDetail creates a synthetic running run and navigates to it; steps advance every 0.6-2s; final emit appears in the event stream.
- [ ] Test runs show a lime `TEST` badge next to their run-id in dashboard, runs list, runs detail, and AgentDetail Runs tab.
- [ ] AgentDetail shows a clickable `TEST · {ago}` chip in its header when there is a recent test run for that agent.
- [ ] Agents detail splitter resizable between 260 and 720px.
- [ ] AgentCodeTab sidebar resizable; maximize toggle hides the sidebar.
- [ ] RunDetail has a 5th tab `agent` that embeds AgentCodeTab for the run's agent.
- [ ] RunDetail header has an "Open agent" button.

---

*End of audit. Compiled from a complete walk of every file in `agentic-operator_v1_1/` and a byte-level diff of every file in `apps/web/public/portal/`. References are precise to file:line; if any item appears imprecise, file a follow-up rather than guessing.*
