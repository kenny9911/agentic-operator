/**
 * P3-RT-12 — load the system-agent roster.
 *
 * Historically this re-exported `data/system-agents/` (a tiny pnpm workspace
 * named `@agentic/system-agents`). That workspace lives under `data/` which
 * is NOT in `pnpm-workspace.yaml#packages` (top-level scans `apps/*`,
 * `packages/*`, `tenants/*`), so the import could not resolve and the api
 * typecheck baseline carried a TS2882 error here for the whole sprint.
 *
 * `apps/api/src/bootstrap.ts` performs the same registration via
 * `import "@agentic/agents/system"`, which IS a workspace package. This
 * shim is preserved as a no-op so any external module that still
 * `import "./system-agents-shim"` keeps loading without errors.
 */

export {};
