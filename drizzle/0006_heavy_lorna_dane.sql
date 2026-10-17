CREATE TABLE `sip_mandates` (
	`id` integer PRIMARY KEY NOT NULL,
	`source_key` text NOT NULL,
	`holding_id` integer NOT NULL,
	`amount` real NOT NULL,
	`day` integer NOT NULL,
	`next_date` text,
	`note` text,
	`observed_on` text NOT NULL,
	FOREIGN KEY (`holding_id`) REFERENCES `holdings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sip_mandates_source_key_unique` ON `sip_mandates` (`source_key`);--> statement-breakpoint
ALTER TABLE `holdings` ADD `manual_invested` real;