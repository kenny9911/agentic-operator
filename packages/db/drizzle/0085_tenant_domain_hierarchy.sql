-- Keep legacy runtime ownership and every historical id intact. A Domain
-- owns one exclusive runtime namespace; additional Domains receive new ones.
CREATE TABLE `domains` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL REFERENCES `tenants` (`id`) ON DELETE CASCADE,
  `slug` text NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `runtime_tenant_id` text NOT NULL REFERENCES `tenants` (`id`) ON DELETE CASCADE,
  `is_default` integer NOT NULL DEFAULT 0,
  `runtime_enabled_before_archive` integer,
  `created_at` integer NOT NULL DEFAULT (unixepoch() * 1000),
  `updated_at` integer NOT NULL DEFAULT (unixepoch() * 1000),
  `archived_at` integer,
  CHECK (`is_default` IN (0, 1)),
  CHECK ((`is_default` = 1) = (`tenant_id` = `runtime_tenant_id`))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domains_tenant_slug_uq` ON `domains` (`tenant_id`, `slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `domains_runtime_tenant_uq` ON `domains` (`runtime_tenant_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `domains_one_default_per_tenant_uq` ON `domains` (`tenant_id`) WHERE `is_default` = 1;
--> statement-breakpoint
CREATE INDEX `domains_tenant_archived_idx` ON `domains` (`tenant_id`, `archived_at`);
--> statement-breakpoint
CREATE TABLE `domain_memberships` (
  `domain_id` text NOT NULL REFERENCES `domains` (`id`) ON DELETE CASCADE,
  `user_id` text NOT NULL REFERENCES `users` (`id`) ON DELETE CASCADE,
  `role` text NOT NULL CHECK (`role` IN ('admin', 'operator', 'viewer')),
  `created_at` integer NOT NULL DEFAULT (unixepoch() * 1000),
  `created_by` text REFERENCES `users` (`id`) ON DELETE SET NULL,
  PRIMARY KEY (`domain_id`, `user_id`)
);
--> statement-breakpoint
CREATE INDEX `domain_memberships_user_idx` ON `domain_memberships` (`user_id`);
--> statement-breakpoint
INSERT INTO `domains` (`id`, `tenant_id`, `slug`, `name`, `description`, `runtime_tenant_id`, `is_default`, `created_at`, `updated_at`, `archived_at`)
SELECT 'dom-legacy-' || t.`id`, t.`id`, t.`slug`, t.`name`, t.`subtitle`, t.`id`, 1, t.`created_at`, t.`updated_at`, NULL
FROM `tenants` t
WHERE NOT EXISTS (
  SELECT 1 FROM `tenant_runtime_namespaces` n WHERE n.`tenant_id` = t.`id`
);
--> statement-breakpoint
INSERT INTO `domain_memberships` (`domain_id`, `user_id`, `role`, `created_at`, `created_by`)
SELECT d.`id`, m.`user_id`, m.`role`, m.`created_at`, m.`created_by`
FROM `memberships` m JOIN `domains` d ON d.`tenant_id` = m.`tenant_id` AND d.`is_default` = 1;
--> statement-breakpoint
-- Identity rebinding would silently reassign all historical namespace data.
CREATE TRIGGER `domains_immutable_ownership`
BEFORE UPDATE OF `tenant_id`, `runtime_tenant_id`, `slug`, `is_default` ON `domains`
WHEN NEW.`tenant_id` <> OLD.`tenant_id` OR NEW.`runtime_tenant_id` <> OLD.`runtime_tenant_id`
  OR NEW.`slug` <> OLD.`slug` OR NEW.`is_default` <> OLD.`is_default`
BEGIN SELECT RAISE(ABORT, 'domain ownership, namespace and slug are immutable'); END;
