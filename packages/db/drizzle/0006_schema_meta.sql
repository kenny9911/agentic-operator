-- P1-DB-02 — _meta table holds the schema_version key that the API boot
-- check reads to refuse start when the DB schema is newer than the code
-- supports (operator deployed an older binary against a newer DB).
--
-- The migration also seeds the current schema_version so a fresh boot has a
-- valid row; bumps happen in future migrations via UPDATE.
CREATE TABLE `_meta` (
  `key` text PRIMARY KEY NOT NULL,
  `value` text NOT NULL,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `_meta` (`key`, `value`) VALUES ('schema_version', '6');
