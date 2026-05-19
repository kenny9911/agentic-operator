ALTER TABLE `agents` ADD `kind` text DEFAULT 'manifest' NOT NULL;--> statement-breakpoint
ALTER TABLE `agents` ADD `enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `steps` ADD `provider` text;--> statement-breakpoint
ALTER TABLE `steps` ADD `model` text;--> statement-breakpoint
ALTER TABLE `steps` ADD `tokens_in` integer;--> statement-breakpoint
ALTER TABLE `steps` ADD `tokens_out` integer;