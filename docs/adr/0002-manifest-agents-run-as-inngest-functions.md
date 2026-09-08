# Manifest agents run as Inngest functions, and every DB write lives inside `step.run`

Each declarative agent in a workflow manifest becomes exactly one Inngest function (id `tenant.agent`, concurrency keyed on the event's subject, retries from the manifest else 3, cancellation via a per-tenant `run.cancel` event matched on subject). Inngest replays handlers, so a database write outside `step.run(...)` duplicates on replay and `inngest.send` inside a step body double-emits; `step.sendEvent` is the only idempotent emit, and a human-in-the-loop pause is a `tasks` row written inside `step.run` followed by `step.waitForEvent`. We accepted two operational costs for durable, replayable execution: Inngest dev mode is not crash-safe (a file-watch reload can drop an in-flight handler, so re-fire under a fresh subject), and running the API without the Inngest dev server makes event dispatch fail with `fetch failed`.

_Backfilled 2026-09-07 from `CLAUDE.md` and `docs/architecture.md` §4._
