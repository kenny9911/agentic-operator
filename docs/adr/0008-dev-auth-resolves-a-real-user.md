# `AUTH_MODE=dev` resolves a real user, has no hard-coded fallback, and is refused under `NODE_ENV=production`

Dev-mode authentication requires an explicit `AGENTIC_DEV_TENANT`, resolves a real active user of that tenant from the database, and the process refuses to start when the flag is combined with `NODE_ENV=production`. Tenant identity always comes from the authenticated principal; the `x-agentic-tenant` header only selects among tenants whose membership and role the server re-derives on every request. The earlier design (a default tenant fallback and an advisory header) meant that if the flag leaked into a production deploy, every unauthenticated request became an authenticated one. This supersedes the description of dev auth still present in `AGENTS.md`.

_Backfilled 2026-09-07 from `CLAUDE.md` ("Tenant scoping"), `apps/api/src/plugins/auth.ts` and `docs/architecture.md` §10._
