# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Toolchain

- **Node 26** (`.nvmrc` = 26). `better-sqlite3` (native module) is compiled against Node 26's MODULE_VERSION; running on a different major will crash with `ERR_DLOPEN_FAILED`. Run `nvm use` after switching shells.
- **pnpm 11** workspaces — `pnpm install` (auto-builds the natives allow-listed in `pnpm-workspace.yaml`).
- README claims Node 22; that is stale — trust `.nvmrc` + `package.json#engines`.

## Common commands

```bash
pnpm dev                  # web :3500 + api :3501 + inngest dev :8288 (predev frees those ports + 8289/50052/50053)
pnpm build                # turbo run build across all workspaces
pnpm lint                 # turbo run lint (Next.js ESLint on web only)
pnpm typecheck            # turbo run typecheck (every package has its own tsc --noEmit)
pnpm test                 # turbo run test → vitest in apps/api
pnpm db:migrate           # apply drizzle migrations to data/agentic.db
pnpm db:seed              # 3 tenants + 1 admin
pnpm seed:rich            # RAAS historical fixtures + English ontology overlay (idempotent)
pnpm db:generate          # drizzle-kit generate after editing packages/db/src/schema.ts
pnpm db:studio            # drizzle-kit studio
```

Single test (api workspace): `pnpm --filter @agentic/api exec vitest run test/tc-3-test-agent-happy.test.ts`. Vitest config uses `pool: "forks"` and `sequence.concurrent: false` because the SQLite handle isn't worker-thread safe and tests share `data/agentic.db`.

A single workspace's dev server: `pnpm --filter @agentic/api run dev` (or `@agentic/web`). The api `dev` script loads both `../../.env` and `apps/api/.env.local` via `tsx --env-file`.

## Architecture

**Two-process split with a shared Zod contract package.** `apps/web` (Next.js 16, React 19) is UI-only — it has zero database access. Every read goes through `/v1/*` to `apps/api` (Fastify 5). `next.config.mjs` rewrites `/v1/*` and `/health` to `http://localhost:3501`. `@agentic/contracts` Zod schemas are the single source of truth: api validates requests with them; web parses responses with them via `apps/web/lib/api-client.ts`.

**Two parallel agent execution paths share the same `runs`/`steps` schema and SSE log tail.**
1. **Declarative manifest agents** (`packages/runtime`). `models/<slug>-v<n>/workflow*.json` is loaded at boot; each `AgentSpec` becomes one Inngest function with `id = "${tenantSlug}.${agentName}"`, concurrency keyed on `event.data.subject`, retries=3. Events are namespaced `${tenantSlug}/${name}`. See `packages/runtime/src/register.ts` for the durability contract.
2. **Code-defined agents** (`packages/agents`). Subclass `BaseAgent`, register at import time via `agentRegistry.register(...)`. `BaseAgent.run()` is sealed; subclasses override `buildMessages()` and optionally `parseOutput()`. The run engine handles run-row + step-row + file-log + gateway dispatch. Invoked synchronously at `POST /v1/agents/:name/invoke`; async via Inngest is reserved for v2.

**Inngest durability discipline.** Inngest replays handlers; every DB write must be inside a `step.run("name", ...)` so exactly one row is produced per actual execution. `step.sendEvent` is the only idempotent way to emit downstream events — never `inngest.send` inside a step body. HITL: create a `tasks` row inside `step.run`, then `step.waitForEvent("task.resolved", { if: 'async.data.taskId == "<id>"' })`. See `packages/runtime/src/register.ts:165-280`.

**LLM Gateway** (`packages/llm-gateway`) fronts 14 providers (`mock`, `anthropic`, `openai`, `openrouter`, `gemini`, `azure`, `groq`, `together`, `mistral`, `deepseek`, `qwen`, `bedrock`, `vertex`, `custom`). A single gateway singleton is constructed in `apps/api/src/services/llm.ts` and injected into both consumers at boot (`setAgentGateway` for BaseAgent, `setRuntimeGateway` for the manifest step engine's `logic`/`llmCall` action) — see `apps/api/src/bootstrap.ts`. Provider catalog metadata lives in `@agentic/contracts/providers`. Background design: `docs/design/llm-gateway-and-baseagent.md`.

**Tenant scoping.** Every user-visible table carries `tenant_id`. Use `tenantScope(ctx, table)` from `@agentic/db` to build the predicate — direct `getDb()` access leaks across tenants. In dev (`AUTH_MODE=dev` or `NODE_ENV !== "production"`) the auth plugin returns the tenant matching `AGENTIC_DEV_TENANT` (default `raas`). Tests set `AGENTIC_DEV_TENANT=__system`.

**Storage layout.** SQLite WAL at `data/agentic.db` (19 tables, see `packages/db/src/schema.ts`). Run logs are NDJSON-ish per-line at `data/logs/<tenant>/runs/<date>/<run-id>.log` and stream over SSE at `GET /v1/runs/:runId/logs?follow=1`. Event ledger NDJSON at `data/logs/<tenant>/events/<date>.ndjson`. Everything under `data/` is gitignored.

## Frontend layout note

The active UI is a **static SPA served from `apps/web/public/portal/index.html`** (uses Babel/React via CDN; fetches `/api/spa/bootstrap` for tenant data). `next.config.mjs` rewrites `/` and any unmatched path to that file. The Next.js App Router pages that used to render the portal now sit under `apps/web/app/_portal_legacy/` (the leading underscore makes Next ignore them) and are not reached at runtime — do not edit them expecting visual changes. The only live App Router routes are `apps/web/app/(auth)/sign-in` and the `app/api/*` API routes (`prefs`, `spa/bootstrap`).

**SPA global-scope gotcha.** All `<script type="text/babel">` view files share one global scope. A top-level `function Foo()` in one view file shadows the same name in any other view loaded earlier — last load wins. This bit us when both `views/logs.jsx` and `views/schema-editor.jsx` declared `function TreeNode`. Convention: **prefix internal components with the view name** (`SchemaTreeNode`, `LogsTreeNode`) so they can't collide. Only the top-level view component (`SchemaEditor`, `Workflows`, …) should use a bare name. Cross-view shared components live in `components.jsx` and attach to `window.*` once at the bottom of that file.

## Adding a tenant

Pure-declarative (manifest-only): drop `models/<slug>-v<n>/` with the five JSON files, add a row to `packages/db/src/seed.ts`, `pnpm db:seed`, restart api. Bootstrap auto-discovers and registers Inngest functions; the new tenant appears in the sidebar switcher.

With custom tools/prompts: also create `tenants/<slug>/` (copy `tenants/raas/`), declare `"@tenants/<slug>": "workspace:*"` in `apps/api/package.json`, and register it in `TENANT_REGISTRIES` in `apps/api/src/bootstrap.ts`. This wiring lives in the api (not in `@agentic/runtime`) because pnpm's isolated module resolution requires each package to own its own deps. Slug derivation: lowercase the folder, strip `-vN` suffix (`RAAS-v1` → `raas`).

## Conventions worth knowing

- IDs are prefixed strings (`run-…`, `evt-…`, `agt-…`, `tsk-…`) generated by `makeId(prefix)` from `@agentic/shared`. Timestamps are unix-ms.
- `apps/web` uses **inline CSS-in-JS** to match the design prototype 1:1 — no Tailwind. Pseudo-selectors / media queries / `@keyframes` live in `apps/web/app/global.css`.
- The RAAS canonical workflow ships with Chinese titles. `pnpm seed:rich` overlays English from the handoff prototype via `seedAgentMetadata()`; rerun it after `db:seed` if you want English-labeled agents in the UI.
- Don't introduce `/portal/*` URLs in the new UI — the legacy portal route group lived at root. (Static SPA fallback now serves `/`.)
- Workflow DAG layout is hand-tuned (stage + lane per kebab id) in the legacy workflows page — do not replace with auto-packing if you ever revive it.
