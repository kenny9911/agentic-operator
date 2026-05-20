-- P1-RT-04 — add runs.parent_run_id for subflow tracing.
--
-- A `subflow` step composes another agent's run; we record the parent so the
-- portal can build a trace tree (parent → child → grand-child).
--
-- Nullable, no default — backfill leaves NULL, which is correct (existing
-- runs were never composed by a subflow).
ALTER TABLE `runs` ADD `parent_run_id` text;--> statement-breakpoint
CREATE INDEX `runs_parent_run_idx` ON `runs` (`parent_run_id`);
