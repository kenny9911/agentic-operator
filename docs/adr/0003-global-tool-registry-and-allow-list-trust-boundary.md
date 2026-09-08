# Tools live in the global registry; the agent's allow-list, not registration, is the trust boundary

Any tool more than one tenant could want lives in `packages/tools` and is exported into the global registry, where it is callable by any agent in any tenant; a tenant package may shadow a global tool by name but does not own tools. Registration only makes a tool exist: an agent can call a tool only if the agent's definition names it in its allow-list (`tool_use[]`), and per-tenant settings ride on that entry as tool config instead of per-tenant TypeScript. We chose this over per-tenant tool code (which made onboarding a tenant a code change) and over "registered means callable" (which left no trust boundary). Corollary: back-compat aliases are allowed, but a real business operation must never alias a diagnostic probe, so a missing integration fails closed instead of resolving to a ping.

_Backfilled 2026-09-07 from `CLAUDE.md` and `docs/architecture.md` §5._
