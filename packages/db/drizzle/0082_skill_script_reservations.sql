CREATE TABLE skill_script_reservations (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
  root_snapshot_id TEXT NOT NULL REFERENCES run_skill_snapshots(id) ON DELETE RESTRICT,
  agent_id TEXT NOT NULL, skill_id TEXT NOT NULL, version_id TEXT NOT NULL,
  content_digest TEXT NOT NULL, policy_digest TEXT NOT NULL,
  script_path TEXT NOT NULL, interpreter TEXT NOT NULL, input_digest TEXT NOT NULL,
  timeout_ms INTEGER NOT NULL CHECK(timeout_ms > 0),
  input_bytes INTEGER NOT NULL CHECK(input_bytes > 0),
  output_bytes INTEGER NOT NULL CHECK(output_bytes > 0),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
--> statement-breakpoint
CREATE INDEX skill_script_reservations_root_idx ON skill_script_reservations(tenant_id,root_snapshot_id);
--> statement-breakpoint
CREATE TRIGGER skill_script_reservations_no_update BEFORE UPDATE ON skill_script_reservations BEGIN SELECT RAISE(ABORT, 'Skill script reservations are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER skill_script_reservations_no_delete BEFORE DELETE ON skill_script_reservations BEGIN SELECT RAISE(ABORT, 'Skill script reservations are retained'); END;
