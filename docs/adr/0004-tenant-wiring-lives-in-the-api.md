# Tenant code packages are registered in `apps/api`, not in `@agentic/runtime`

A tenant's custom code package is wired in exactly one place, the tenant registries table in the API's bootstrap, and the runtime package stays tenant-agnostic. pnpm's isolated module resolution requires each package to own its own dependencies, so the runtime cannot depend on tenant packages without every tenant becoming a runtime dependency. A manifest-only tenant (global tools only) needs no code package at all: its model root is discovered at boot.

_Backfilled 2026-09-07 from `CLAUDE.md` ("Adding a tenant") and `docs/architecture.md` §3._
