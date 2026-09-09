-- Keep existing managed Skills usable; this independent switch preserves drafts,
-- publications and bindings when administrators temporarily disable a Skill.
ALTER TABLE managed_skills ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1));
