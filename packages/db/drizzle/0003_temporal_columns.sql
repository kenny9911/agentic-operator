-- P0-DB-01 — add created_at / updated_at to agents, agent_versions,
-- event_listeners, event_types, entity_types.
--
-- SQLite restriction: ALTER TABLE ADD COLUMN with NOT NULL requires a
-- constant default, so we backfill existing rows with the current epoch
-- and a follow-up UPDATE. New rows fall through to the Drizzle-side
-- default (unixepoch() * 1000) since the column itself carries no
-- runtime DEFAULT clause; the application layer supplies it.
--
-- Step 1: add the columns with a static seed default so the NOT NULL
--         constraint succeeds against existing rows.
-- Step 2: bump the seed to the migration moment for any rows that
--         already exist (best-effort temporal anchor).
ALTER TABLE `agents` ADD `created_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agents` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_versions` ADD `created_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_versions` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `event_listeners` ADD `created_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `event_listeners` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `event_types` ADD `created_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `event_types` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `entity_types` ADD `created_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `entity_types` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `agents` SET `created_at` = unixepoch() * 1000, `updated_at` = unixepoch() * 1000 WHERE `created_at` = 0;--> statement-breakpoint
UPDATE `agent_versions` SET `created_at` = unixepoch() * 1000, `updated_at` = unixepoch() * 1000 WHERE `created_at` = 0;--> statement-breakpoint
UPDATE `event_listeners` SET `created_at` = unixepoch() * 1000, `updated_at` = unixepoch() * 1000 WHERE `created_at` = 0;--> statement-breakpoint
UPDATE `event_types` SET `created_at` = unixepoch() * 1000, `updated_at` = unixepoch() * 1000 WHERE `created_at` = 0;--> statement-breakpoint
UPDATE `entity_types` SET `created_at` = unixepoch() * 1000, `updated_at` = unixepoch() * 1000 WHERE `created_at` = 0;
