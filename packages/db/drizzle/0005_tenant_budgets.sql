-- P1-DB-01 — tenant_budgets table.
--
-- One row per tenant, holds caps + usage counters for the current billing
-- period. The LLM gateway reads + writes this table on every chat() call.
-- USD is stored in integer cents to avoid float drift.
CREATE TABLE `tenant_budgets` (
  `tenant_id` text PRIMARY KEY NOT NULL,
  `monthly_token_cap` integer,
  `monthly_usd_cap` integer,
  `used_tokens_month` integer DEFAULT 0 NOT NULL,
  `used_usd_month` integer DEFAULT 0 NOT NULL,
  `period_start` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
