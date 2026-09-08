# The portal has no database access; every read and write crosses `/v1`

The web app (Next.js) and the API (Fastify) run as two processes. The portal never opens the database: every read and write goes over `/v1/*`, which the web server rewrites to the API, and both ends validate the same Zod contracts from `@agentic/contracts`. The alternative, letting Next.js server code read SQLite directly, was rejected so that the API stays the only writer of durable state, one dataset feeds rows, run logs, SSE and the observability APIs, and a contract change is caught at both ends by `pnpm typecheck`. Consequence: a UI feature that needs data gets an API route and a contract first.

_Backfilled 2026-09-07 from `CLAUDE.md` and `docs/architecture.md` §1–3._
