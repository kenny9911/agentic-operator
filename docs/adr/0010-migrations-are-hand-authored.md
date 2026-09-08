# Drizzle migrations are hand-authored, and the journal is code

Migrations under `packages/db/drizzle/` are written by hand rather than generated, because `drizzle-kit generate` hangs on the incomplete snapshot chain, and `meta/_journal.json` is maintained as source: it once silently dropped 11 of 17 entries and had to be rebuilt. Adding a migration therefore means writing the SQL and its journal entry together. Two naming facts follow from the history: the enterprise batch was renumbered `0055`–`0061` to follow `0054`, and `0055_rename_llm_call_telemetry` moved the old factory telemetry table to `llm_call_telemetry` so the usage ledger owns the `llm_calls` name.

_Backfilled 2026-09-07 from `CLAUDE.md` ("Conventions worth knowing") and `docs/architecture.md` §9._
