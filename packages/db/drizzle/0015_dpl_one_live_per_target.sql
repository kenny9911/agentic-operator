-- Defense — DB-level guard for "one live deployment per (tenant, target)"
-- for the targets where the app expects that invariant (workflow + tenant_code).
--
-- The app already enforces this in code:
--   • workflow:     apps/api/src/services/manifest-import.ts (commit phase 3)
--                   demotes prior live rows before promoting the new one.
--   • tenant_code:  apps/api/src/routes/v1/tenant-code.ts upsert path does
--                   the same.
--
-- This index promotes that invariant from convention to enforcement: a
-- future code path that forgets to demote will hit SQLITE_CONSTRAINT_UNIQUE
-- instead of silently leaving two live rows for getDag() to pick from
-- (which previously masked the corruption because the read path picks the
-- newest by deployed_at — works by accident, not by guarantee).
--
-- `code_agent` is INTENTIONALLY excluded — its semantics is one live row
-- per (tenant, target, agent), not per (tenant, target). Each registered
-- code agent owns its own live row in `packages/agents/src/bootstrap.ts`.
-- A blanket constraint would crash boot the moment a tenant registers two
-- code agents. The unused targets (`agent`, `runtime`) are also excluded
-- because they have no current write path; if they get one, this index
-- should be revisited to decide whether they belong in the predicate.

CREATE UNIQUE INDEX IF NOT EXISTS `dpl_one_live_per_tenant_target_idx`
  ON `deployments` (`tenant_id`, `target`)
  WHERE `status` = 'live' AND `target` IN ('workflow', 'tenant_code');
