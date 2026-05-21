-- UC-V11-32 / PF-GAP-10 — persistent Idempotency-Key store.
--
-- Today `apps/api/src/routes/v1/tenants.ts` keeps a process-local in-memory
-- LRU (`idempotencyCache`) and the `/v1/events`, `/v1/agents/:name/invoke`
-- routes accept the `Idempotency-Key` header without doing anything with it.
-- That makes the contract `tc-71` tests against a stub and gives operators
-- no protection across api restarts or multi-instance deploys.
--
-- This migration introduces a real backing table:
--   - PK is (tenant_id, key) so each tenant gets its own keyspace.
--   - response_json holds the cached body (JSON-stringified) so retries see
--     byte-identical responses, including any mint tokens.
--   - status_code lets the route replay the original HTTP status.
--   - expires_at carries the wall-clock TTL (24h from insert per V1.1 spec)
--     and is indexed for the retention sweep to purge in bulk.
--
-- Reads happen via a single (tenant_id, key) lookup — the PK index
-- already satisfies that; no extra non-PK index is needed for hot path.

CREATE TABLE IF NOT EXISTS `idempotency_keys` (
  `tenant_id` text NOT NULL,
  `key` text NOT NULL,
  `response_json` text NOT NULL,
  `status_code` integer NOT NULL DEFAULT 200,
  `created_at` integer NOT NULL DEFAULT (unixepoch() * 1000),
  `expires_at` integer NOT NULL,
  PRIMARY KEY (`tenant_id`, `key`),
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idempotency_keys_expires_at_idx`
  ON `idempotency_keys` (`expires_at`);
