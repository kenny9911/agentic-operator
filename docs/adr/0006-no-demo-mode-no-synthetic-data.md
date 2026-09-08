# There is no demo mode; production mode runs zero mock, seed or synthetic data

The demo-mode flag, its routes and runner, and the static Babel portal were deleted on 2026-07-20 and must stay deleted. Every row on a dashboard is evidence of a real event: demo data is produced by publishing real events, never by a mode switch that silently falls back to synthetic data. The same rule is enforced at boot: a non-test API refuses to start against a mock-like provider or model, and `/health` reports whether the gateway is mock so one request settles whether a stack is real. Corollary: the App Router portal is the only application UI; the earlier static portal is a visual reference and never a runtime surface.

_Backfilled 2026-09-07 from `AGENTS.md` ("Demo mode"), `CLAUDE.md` ("Frontend layout note"), `docs/merge/2026-07-20-kenny-merge-playbook.md` and `docs/architecture.md` §1, §10._
