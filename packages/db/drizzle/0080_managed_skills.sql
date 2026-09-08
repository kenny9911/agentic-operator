CREATE TABLE managed_skills (
  id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name TEXT NOT NULL, description TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'tenant' CHECK (visibility IN ('tenant','shared')),
  latest_version_id TEXT REFERENCES skill_versions(id) ON DELETE RESTRICT,
  created_by TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000), updated_at INTEGER NOT NULL DEFAULT (unixepoch()*1000), archived_at INTEGER
);
--> statement-breakpoint
CREATE UNIQUE INDEX managed_skills_owner_name_uq ON managed_skills(tenant_id,name);
--> statement-breakpoint
CREATE INDEX managed_skills_available_idx ON managed_skills(visibility,archived_at,updated_at);
--> statement-breakpoint
CREATE TABLE skill_drafts (
  skill_id TEXT PRIMARY KEY NOT NULL REFERENCES managed_skills(id) ON DELETE RESTRICT,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK(revision>0), bundle_json TEXT NOT NULL, diagnostics_json TEXT NOT NULL, provenance_json TEXT, creator_notes_json TEXT,
  updated_by TEXT, updated_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
--> statement-breakpoint
CREATE INDEX skill_drafts_owner_idx ON skill_drafts(tenant_id,skill_id);
--> statement-breakpoint
CREATE TABLE skill_draft_revisions (
  id TEXT PRIMARY KEY NOT NULL, skill_id TEXT NOT NULL REFERENCES managed_skills(id) ON DELETE RESTRICT,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT, revision INTEGER NOT NULL CHECK(revision>0),
  source TEXT NOT NULL CHECK(source IN ('create','import','manual','generate','restore')),
  bundle_json TEXT NOT NULL, diagnostics_json TEXT NOT NULL, provenance_json TEXT, creator_notes_json TEXT, updated_by TEXT, updated_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX skill_draft_revisions_number_uq ON skill_draft_revisions(skill_id,revision);
--> statement-breakpoint
CREATE INDEX skill_draft_revisions_owner_idx ON skill_draft_revisions(tenant_id,skill_id);
--> statement-breakpoint
CREATE TABLE skill_versions (
  id TEXT PRIMARY KEY NOT NULL, skill_id TEXT NOT NULL REFERENCES managed_skills(id) ON DELETE RESTRICT,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  version_no INTEGER NOT NULL CHECK(version_no>0), draft_revision INTEGER NOT NULL CHECK(draft_revision>0),
  name TEXT NOT NULL, description TEXT NOT NULL, content_digest TEXT NOT NULL, bundle_json TEXT NOT NULL,
  created_by TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX skill_versions_number_uq ON skill_versions(skill_id,version_no);
--> statement-breakpoint
CREATE INDEX skill_versions_owner_idx ON skill_versions(tenant_id,skill_id);
--> statement-breakpoint
CREATE TABLE skill_evaluations (
  id TEXT PRIMARY KEY NOT NULL, skill_id TEXT NOT NULL REFERENCES managed_skills(id) ON DELETE RESTRICT,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  version_id TEXT REFERENCES skill_versions(id) ON DELETE RESTRICT, draft_revision INTEGER,
  status TEXT NOT NULL CHECK(status IN ('pending','running','completed','passed','failed','cancelled')),
  result_json TEXT, created_by TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000), completed_at INTEGER
);
--> statement-breakpoint
CREATE INDEX skill_evaluations_owner_idx ON skill_evaluations(tenant_id,skill_id);
--> statement-breakpoint
CREATE TRIGGER skill_versions_no_update BEFORE UPDATE ON skill_versions BEGIN SELECT RAISE(ABORT,'Skill publications are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER skill_versions_no_delete BEFORE DELETE ON skill_versions BEGIN SELECT RAISE(ABORT,'Skill publications cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER skill_draft_revisions_no_update BEFORE UPDATE ON skill_draft_revisions BEGIN SELECT RAISE(ABORT,'Skill draft history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER skill_draft_revisions_no_delete BEFORE DELETE ON skill_draft_revisions BEGIN SELECT RAISE(ABORT,'Skill draft history cannot be deleted'); END;
