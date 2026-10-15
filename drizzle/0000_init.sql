CREATE TABLE `budgets` (
	`category` text PRIMARY KEY NOT NULL,
	`monthly_limit` real NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY NOT NULL,
	`mini_id` integer,
	`source` text NOT NULL,
	`type` text NOT NULL,
	`amount` real NOT NULL,
	`merchant` text NOT NULL,
	`category` text,
	`date` text NOT NULL,
	`raw_text` text,
	`bank_name` text,
	`account_last4` text,
	`reference_number` text,
	`parsed_by` text,
	`currency` text,
	`original_amount` real,
	`needs_review` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`edited_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT "transactions_amount_check" CHECK("transactions"."amount" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_mini_id_unique` ON `transactions` (`mini_id`);--> statement-breakpoint
CREATE INDEX `transactions_date_idx` ON `transactions` (`date`);