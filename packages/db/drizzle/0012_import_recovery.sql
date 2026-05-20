-- Import-workflow-manifest wizard support (post-review A2).
--
-- The deployment row's own `id` (e.g. `dpl-…`) IS the import session token —
-- no separate `import_session_id` column exists (per review A2). Two
-- additive columns drive lifecycle + crash recovery:
--
--   expires_at  Unix-ms TTL for `status='pending'` rows. Boot sweep
--               (`reconcileImports`) drops expired rows and the
--               `data/imports/<deployment_id>/` staging dirs.
--   file_path   On-disk location of the manifest. Between phases 3 and 4 of
--               the commit transaction this points at the tmp file under
--               `data/imports/<deployment_id>/workflow.json`. After the
--               atomic rename in phase 4 it points at
--               `models/<slug>-vN/workflow_v<N+1>.json`. The boot reconciler
--               uses this to complete crashed renames (`LIKE
--               'data/imports/%'` survivors) and to detect missing on-disk
--               files (re-emit from `workflow_versions.manifest_json`).
--
-- Indexes:
--   deployments_expires_at_idx — GC scan for expired pending rows.
--   deployments_file_path_idx  — reconciler queries for crashed renames.
--
-- Rollback story: columns are additive and nullable. No down-migration; we
-- never delete a workflow_version or deployment row.
ALTER TABLE `deployments` ADD COLUMN `expires_at` integer;
--> statement-breakpoint
ALTER TABLE `deployments` ADD COLUMN `file_path` text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `deployments_expires_at_idx` ON `deployments` (`expires_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `deployments_file_path_idx` ON `deployments` (`file_path`);
--> statement-breakpoint
UPDATE `_meta` SET `value` = '10', `updated_at` = (unixepoch() * 1000) WHERE `key` = 'schema_version';
