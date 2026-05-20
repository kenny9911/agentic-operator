-- P5-TEN-01 — tenant lifecycle columns.
--
-- Adds `archived_at` (soft-archive tombstone) and `updated_at` (last-mutation
-- timestamp) to the tenants table. Both default to NULL/now-on-create
-- respectively. The archived index keeps the default list (WHERE archived_at
-- IS NULL) fast even with many archived tenants.
--
-- Lifecycle states:
--   archived_at IS NULL  →  active tenant; appears in the switcher
--   archived_at IS NOT NULL → archived; hidden from default list,
--                             Inngest functions de-registered,
--                             API tokens disabled by the auth plugin.
--
-- Hard-delete remains a separate platform-admin operation (cascade is
-- defined on every FK referencing tenants(id) — no orphan rows possible).
ALTER TABLE `tenants` ADD COLUMN `archived_at` integer;
--> statement-breakpoint
ALTER TABLE `tenants` ADD COLUMN `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL;
--> statement-breakpoint
CREATE INDEX `tenants_archived_at_idx` ON `tenants` (`archived_at`);
--> statement-breakpoint
UPDATE `_meta` SET `value` = '9', `updated_at` = (unixepoch() * 1000) WHERE `key` = 'schema_version';
