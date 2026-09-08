CREATE TABLE run_skill_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  execution_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('root','run','test')),
  agent_id TEXT,
  parent_snapshot_id TEXT REFERENCES run_skill_snapshots(id) ON DELETE RESTRICT,
  root_snapshot_id TEXT REFERENCES run_skill_snapshots(id) ON DELETE RESTRICT,
  content_digest TEXT NOT NULL,
  catalog_json TEXT NOT NULL,
  activations_json TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX run_skill_snapshots_execution_uq ON run_skill_snapshots(tenant_id,execution_id,kind);
--> statement-breakpoint
CREATE INDEX run_skill_snapshots_owner_idx ON run_skill_snapshots(tenant_id,id);
--> statement-breakpoint
CREATE TABLE skill_legacy_bundles (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name TEXT NOT NULL, description TEXT NOT NULL, content_digest TEXT NOT NULL,
  bundle_json TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX skill_legacy_bundles_content_uq ON skill_legacy_bundles(tenant_id,content_digest);
--> statement-breakpoint
CREATE TABLE skill_invocation_grants (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  parent_run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
  parent_snapshot_id TEXT NOT NULL REFERENCES run_skill_snapshots(id) ON DELETE RESTRICT,
  step_id TEXT NOT NULL REFERENCES steps(id) ON DELETE RESTRICT,
  recipient TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX skill_invocation_grants_step_uq ON skill_invocation_grants(tenant_id,step_id,recipient);
--> statement-breakpoint
CREATE TRIGGER run_skill_snapshots_no_update BEFORE UPDATE ON run_skill_snapshots BEGIN SELECT RAISE(ABORT, 'Skill snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER run_skill_snapshots_no_delete BEFORE DELETE ON run_skill_snapshots BEGIN SELECT RAISE(ABORT, 'Skill snapshots are retained'); END;
--> statement-breakpoint
CREATE TRIGGER skill_legacy_bundles_no_update BEFORE UPDATE ON skill_legacy_bundles BEGIN SELECT RAISE(ABORT, 'Legacy Skill bundles are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER skill_legacy_bundles_no_delete BEFORE DELETE ON skill_legacy_bundles BEGIN SELECT RAISE(ABORT, 'Legacy Skill bundles are retained'); END;
--> statement-breakpoint
CREATE TRIGGER skill_invocation_grants_no_update BEFORE UPDATE ON skill_invocation_grants BEGIN SELECT RAISE(ABORT, 'Skill invocation grants are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER skill_invocation_grants_no_delete BEFORE DELETE ON skill_invocation_grants BEGIN SELECT RAISE(ABORT, 'Skill invocation grants are retained'); END;
