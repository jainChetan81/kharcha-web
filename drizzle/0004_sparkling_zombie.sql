CREATE TABLE `receipt_jobs` (
	`id` integer PRIMARY KEY NOT NULL,
	`transaction_id` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`error` text,
	`model` text,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `transaction_items` ADD `confidence` real;--> statement-breakpoint
ALTER TABLE `transaction_items` ADD `sort_order` integer DEFAULT 0 NOT NULL;