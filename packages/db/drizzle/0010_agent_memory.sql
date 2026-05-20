-- P3-DB-01 — agent memory primitive (DESIGN §5.7).
--
-- Two tables, two scopes:
--
--   1. `agent_memory_short` — per-run KV. Evicted when the run terminates.
--      Composite PK on (run_id, key). Lives only as long as the run does.
--      Use case: scratch storage inside a multi-turn agent loop.
--
--   2. `agent_memory_long` — per-(tenant, agent, subject) KV. Persists
--      across runs for the same subject. Composite PK on
--      (tenant_id, agent_name, subject, key).
--      Use case: "remember what this candidate said in the last
--      conversation" — survives between runs.
--
-- A tenant-wide scope (no subject) reuses the long table with
-- `subject = ''` so the composite key stays consistent and the SDK
-- doesn't need a third table.
--
-- Values are stored as JSON text so callers can stash any
-- JSON-serialisable shape (string, number, array, object).
CREATE TABLE `agent_memory_short` (
  `run_id` text NOT NULL,
  `key` text NOT NULL,
  `value_json` text NOT NULL,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  PRIMARY KEY (`run_id`, `key`),
  FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_memory_short_run_idx` ON `agent_memory_short` (`run_id`);
--> statement-breakpoint
CREATE TABLE `agent_memory_long` (
  `tenant_id` text NOT NULL,
  `agent_name` text NOT NULL,
  `subject` text NOT NULL,
  `key` text NOT NULL,
  `value_json` text NOT NULL,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  PRIMARY KEY (`tenant_id`, `agent_name`, `subject`, `key`),
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_memory_long_tenant_agent_idx` ON `agent_memory_long` (`tenant_id`, `agent_name`);
--> statement-breakpoint
CREATE INDEX `agent_memory_long_subject_idx` ON `agent_memory_long` (`tenant_id`, `subject`);
--> statement-breakpoint
UPDATE `_meta` SET `value` = '8', `updated_at` = (unixepoch() * 1000) WHERE `key` = 'schema_version';
