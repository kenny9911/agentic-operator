CREATE TABLE `entity_types` (
	`tenant_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`primary_key_name` text,
	`properties_json` text,
	PRIMARY KEY(`tenant_id`, `entity_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `event_types` (
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text,
	`color` text,
	`description` text,
	`payload_json` text,
	PRIMARY KEY(`tenant_id`, `name`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
