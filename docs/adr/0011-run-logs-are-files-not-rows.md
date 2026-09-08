# Run logs and the event ledger are append-only files; SQLite stays the system of record

Each run's log is an append-only file (one JSON object per line) under `data/logs/<tenant>/runs/`, and the event ledger is a per-tenant, per-day NDJSON file that the `events` row references instead of duplicating, while SQLite in WAL mode remains the system of record for every row. File appends keep the SSE tail cheap and let a run's history outlive row retention; the same execution records feed SQLite, the files and the live stream, so there is exactly one dataset and a subscriber joining mid-run backfills from the file and then streams.

_Backfilled 2026-09-07 from `CLAUDE.md` ("Storage layout") and `docs/architecture.md` §4, §9._
