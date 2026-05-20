-- P1-API-04b — soft-delete tombstones on events, runs, tasks.
--
-- Retention sweeps stamp `deleted_at` rather than hard-deleting so:
--   1. Causal traces survive the period (rolled-back deploys can read history).
--   2. Audit queries see the row's terminal state.
--   3. Final hard-delete is decoupled from the sweep; ops can run it later.
--
-- All three columns are nullable, no default. Live rows have `deleted_at IS
-- NULL`; tombstoned rows carry the sweep moment.
ALTER TABLE `events` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `runs` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `deleted_at` integer;--> statement-breakpoint
CREATE INDEX `events_deleted_at_idx` ON `events` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `runs_deleted_at_idx` ON `runs` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `tasks_deleted_at_idx` ON `tasks` (`deleted_at`);
