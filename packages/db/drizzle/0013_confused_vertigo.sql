-- Event Tester (2026-05-20) — covering index for the SSE poll query.
--
-- `GET /v1/events/stream` without a `?names=` filter runs
--   SELECT … FROM events WHERE tenant_id = ? AND received_at > ? ORDER BY received_at
-- The existing `evt_tenant_name_received_idx (tenant_id, name, received_at)`
-- cannot serve this because `name` sits between the equality predicate and
-- the range predicate, forcing a tenant-wide scan. On a tenant with 100k+
-- events and 5 concurrent SSE tabs polling at 250ms cadence this becomes a
-- hot scan; the covering index below keeps the poll a B-tree seek.
--
-- NOTE: The previously generated migration also reflected a wider, pre-
-- existing schema/migration drift unrelated to Event Tester. That drift is
-- being addressed separately so this PR's diff stays focused.

CREATE INDEX IF NOT EXISTS `evt_tenant_received_idx` ON `events` (`tenant_id`,`received_at`);
