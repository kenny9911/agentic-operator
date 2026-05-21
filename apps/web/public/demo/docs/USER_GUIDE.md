# User Guide — Agentic Operator

> A tour of the admin portal for **operators** and **workflow authors**.
> Open `index.html` at the project root to follow along — every screen
> described below is live in the prototype.

---

## 1 · Concepts in 60 seconds

- An **event** is a typed message (`JD_APPROVED`, `RESUME_PROCESSED`,
  `MATCH_FAILED`, …). Anything in the system can produce or consume one.
- An **agent** is a node that listens for one or more events, runs a
  series of steps, and emits a result event. Some agents are automated
  (`Agent`); some are human (`Human`) — humans show up as tasks in your
  inbox.
- A **workflow** is the graph of agents wired by events. RAAS, the demo
  workload, has 22 agents and 33 event types.
- A **run** is one execution of one agent. Each run has steps, logs, a
  trigger event, and (if it succeeds) an emitted event.
- A **tenant** is an isolated customer of the platform. The switcher in
  the sidebar lets you change the active tenant.

---

## 2 · The sidebar

The left sidebar is your map. It's grouped into three sections:

### Run
- **Dashboard** — live state of everything
- **Workflows** — the agent graph
- **Agents** — every agent in this workflow
- **Runs** — every execution, with a pulse on what's running now

### Observe
- **Events** — the firehose, filterable and replayable
- **Human tasks** — your inbox (the orange chip in the sidebar = open
  task count)
- **Logs** — file-backed log explorer

### Manage
- **Deployments** — versions and rollback
- **Settings** — RBAC, credentials, quotas (v2)

The **tenant switcher** at the top of the sidebar shows the active
customer. The **footer** shows runtime health: Inngest workers + SQLite.

---

## 3 · Top bar

- **Breadcrumb** on the left — shows where you are; click to navigate
  back up
- **⌘K search** in the middle — jump to any agent, event, or run by ID
- **LIVE / PAUSED toggle** — controls whether the ticker, flow dots, and
  log tails auto-advance. Pause when you want a stable view to debug
- **User chip** — sign-out menu

---

## 4 · Dashboard — what's happening right now

Read it left-to-right, top-to-bottom:

### KPI row (top)
- **Active runs** — how many agent runs are executing this instant
- **Events / hr** — throughput
- **Errors / hr** — failed runs with a percentage
- **Pending tasks** — your inbox depth (high-priority count called out)
- **Tokens / hr** — LLM spend signal

### Active runs panel
Live table of every executing run. Click any row to drill into its
timeline. Watch for runs that have been "running" longer than the
agent's p50 — usually a tool stall.

### Agent activity grid
Every agent in the workflow as a tile. The **left bar** is a heat meter
of runs in the last hour; **red** = errors. Idle agents go gray. Quick
way to spot which agents are working hard and which are silent.

### Event stream (right)
Tickers in newest-first. When LIVE is on, new events animate in. Each
row: timestamp · event name · source agent · subject. Click to open the
event detail.

### Awaiting humans
The five oldest open tasks, with priority chips. Click to jump into the
inbox.

### Runtime panel
Inngest, SQLite, log volume, and per-channel adapter health. Yellow
status means rate-limited or degraded — not down.

### RAAS funnel (bottom)
End-to-end conversion through the 8 pipeline stages. The percent drop
between stages tells you where candidates are leaking.

---

## 5 · Workflows — the agent graph

This is the centerpiece. Every agent appears as a node, positioned by
its **stage** (column) and **lane** (row). Edges are events.

### Reading the graph
- **Signal-colored nodes** = agent (automated)
- **Violet-colored nodes** = human node (gated by a task)
- **Solid edges** = normal event flow
- **Pulsing dots traveling along edges** (when LIVE is on) = events
  passing through that edge right now
- **Dashed edges in amber/red** = conditional or alert events

### Interactions
- **Click a node** to open the inspector on the right. It shows the
  agent's description, triggers, emits, steps, tools, model, and recent
  runs.
- **Click an event chip** in the legend (or in any node's detail) to
  highlight every edge carrying that event and every agent involved.
- **Click an edge** to focus that one event flow.
- **Test run** in the inspector — fires the agent with a sample event so
  you can dry-run new logic.

When the canvas gets large (RAAS has 22 nodes), use the **stage labels
at the top** to jump-navigate.

---

## 6 · Agents — the catalog

Default view is a grid: one card per agent, with last-run timestamp,
24h run count, and error count. Filter by **All / Agents / Human**.

### Agent detail (click a card)

Four tabs:

- **Config** — the full manifest, plus visual breakouts of triggers,
  emits, tool bindings, and model.
- **IO** — input/output schemas. Useful for debugging type mismatches.
- **Versions** — every version that's ever been deployed for this agent,
  who shipped it, when, and notes. **Rollback** is one click.
- **Runs** — every run of this agent, newest first.

The header has:
- **View in graph** — jump back to the canvas with this node selected
- **Test run** — sample-data dry-run

---

## 7 · Runs — what happened (or is happening)

A run is one agent execution. The Runs view is a master/detail:

### Left list
Filter by **All / Running / Ok / Failed**. Search by ID, agent, or
subject (e.g. `CAN-88412`). Each row shows status dot, run ID, agent
title, subject, and duration.

### Detail (right)

**Header**: status, trigger event, emitted event (if any), agent
title.

**Stats row**: started, duration, step count, tokens in/out, subject.

**Tabs**:
- **Timeline** — a waterfall of steps with start, duration, and status.
  The active step shimmers; failed steps are red.
- **Logs** — the file-backed log for this run. Color-coded by level:
  errors red, warns amber, info white, debug gray, emits + run-end
  signal-green.
- **IO** — the JSON event that started the run + the JSON output.
- **Events** — every event this run consumed or emitted.

If a run failed, an **Error panel** appears at the bottom with the
message and a **Retry** button.

---

## 8 · Events — the firehose

### Histogram (top)
60-minute event volume bucketed per minute. The rightmost bar = the
current minute, highlighted signal-green.

### Filters (left)
- **Search** by event name, ID, or subject
- **Category** — agent / human / data / external / alert / system
- **Event type** — drill into one specific event name

### List (center)
Newest-first. Each row: time · event chip · source agent · subject ·
payload size.

### Detail (right)
- **Source** — which agent emitted this (click to open it)
- **Downstream listeners** — every agent that will be triggered by
  events of this name (click to open)
- **Payload** — the full JSON, exactly as it landed in the event ledger
- **Replay** — re-emit this event. Use this to test fixes or fan a
  payload to a new listener you just added.

---

## 9 · Human tasks — your inbox

The orange chip in the sidebar is your open-task count. The view is a
master/detail inbox.

### Task list (left)
Filter by **All / HIGH / MED / LOW**. Each row shows priority, task ID,
title, awaiting role, and age.

### Task detail (right)

Each task type has its own review surface:

- **JD Review** — side-by-side: generated JD on the left, agent
  reasoning on the right. Approve, reject with notes, or snooze.
- **Package Review** — candidate package preview + submission preview.
  Approve to fire `PACKAGE_APPROVED`, which lets the submit agent fire.
- **Resume Fix** — parse error + re-upload + edit-parsed-fields options.
- **Clarification** — typed input fields for each open question. Submit
  to fire `CLARIFICATION_RETRY`.
- **Supplement** — file-attach UI for missing items.
- **Manual Publish** — open generated helper page → confirm posted.

The bottom of every detail shows **what event will fire on approve**
and **which agents listen for it** — so you always know what your click
will do downstream.

Keyboard shortcuts:
- `⌘ + ↵` approve
- `⌘ + R` reject

---

## 10 · Logs — file-backed truth

The log explorer is structured exactly like the filesystem:

```
logs/
├── runs/
│   ├── 2026-05-16/
│   │   ├── run-01000.log
│   │   └── ...
│   ├── 2026-05-15/  (1872 files)
│   └── ...
├── events/
│   ├── 2026-05-16.ndjson
│   └── ...
└── system/
    ├── inngest.log
    ├── scheduler.log
    └── errors.log
```

Live files (the current day's runs) show a pulsing green dot. Files
with errors are highlighted red.

### Toolbar
- **Tail** — when LIVE is on, the log auto-scrolls as new lines write
- **Grep** — substring filter, live
- **Level select** — DEBUG / INFO / WARN / ERROR

### Reading a log
Each line is:

```
2026-05-16T08:14:02.001Z  INFO   run.start  run_id=run-01000 agent=matchResume ...
```

Color: error = red, warn = amber, debug = gray, emits/run-end =
signal-green.

---

## 11 · Deployments

### Live versions (top)
Three cards: the live **Workflow** version, the live **Runtime**
version, and the live **Inngest worker** version. Each shows version
string, deployed-by, and age.

### History (table)
Every deploy in this tenant, newest-first. Columns: status (LIVE /
ROLLED-BACK / pending), version, target agent or workflow, deployer,
time, notes, actions (Diff / Rollback).

### Deploy new version (button → wizard)

Three methods:

#### Manifest upload
Drop `workflow.json` + `actions.json`. The system:
1. Validates the schema
2. Shows a diff: agents added, modified, removed; events added/removed
3. Lets you deploy to staging or prod

This is the simplest path — and the path the prototype was built for
since RAAS ships as a manifest.

#### Code package
From your shell:

```bash
$ npx agentic deploy raas --version 2026.05.16-b --target prod
```

Or git-push style:

```bash
$ git push agentic main:raas/prod
```

The CLI bundles your TypeScript workflow package (manifest + custom
tools), uploads it, registers it with the Inngest worker, and migrates
in-flight runs to the new version atomically.

#### Visual builder
Drag agents from a palette onto a canvas, connect them with events,
save. The builder outputs a manifest and drops you into the upload
flow.

### Rollback
One click on any historical row. The live pointer flips to that
version. In-flight runs finish on their original version (each run is
pinned to its `agent_version_id`).

---

## 12 · Tweaks panel

Toggle it from the toolbar (look for the Tweaks toggle). Controls:

- **Theme** — Dark or Light
- **Density** — Compact / Default / Comfortable
- **Accent** — Signal lime, cyan, amber, or violet (changes the live
  signal color throughout)
- **Live event stream** — pause/resume the ticker and flow dots
- **Show debug panels** — surfaces extra technical detail
- **Active tenant** — RAAS, SupportFlow, FinanceClose

Your settings persist across reloads.

---

## 13 · Common workflows for operators

### A run is stuck — what do I do?

1. Dashboard → **Active runs** → find the run with the highest duration
2. Click it → **Timeline** tab → see which step is shimmering
3. **Logs** tab → look for the last DEBUG line before things stopped
4. If it's a tool timeout, the run will retry per its policy. If it's
   something fatal, hit **Retry** after fixing
5. If it's blocked on a human task, go to **Human tasks** and resolve

### A whole event type is failing

1. Events view → filter by that event name → look at recent occurrences
2. Click one → see the source agent (probably the same for all)
3. Open that agent → Runs tab → see if all recent runs failed
4. Roll back to the prior version from **Versions** tab, or push a fix

### I want to test a new agent before promoting it

1. Deployments → Deploy new version → target **staging**
2. Use **Events → Replay event** to fire a real production payload at
   the staging version
3. Watch the run in Runs view
4. Promote to prod when satisfied

### I want to add a brand new workflow (e.g., SupportFlow)

1. Sidebar tenant switcher → **+ New tenant**
2. Deployments → Deploy new version → Manifest upload (or CLI)
3. Provide your `workflow.json` matching the same schema as RAAS
4. POST a sample event to `/api/events` with your tenant token
5. Watch the run light up

---

## 14 · Glossary

See [PRD.md → Glossary](./PRD.md#10--glossary). Short version:

| Term | One-liner |
|---|---|
| Agent | A node in a workflow — automated or human |
| Event | A typed message between agents |
| Workflow | The graph of agents wired by events |
| Run | One execution of one agent |
| Step | One sub-unit inside a run (tool/logic/manual) |
| Task | A pending human action that pauses a run |
| Deployment | A pointer to a workflow version marked "live" |
| Tenant | An isolated customer of Agentic Operator |
| Tool | A capability an agent can call (HTTP, DB, OCR, LLM, …) |
