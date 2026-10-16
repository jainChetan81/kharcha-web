CREATE TABLE `ask_log` (
	`id` integer PRIMARY KEY NOT NULL,
	`question` text NOT NULL,
	`spec_json` text,
	`answer_json` text,
	`model` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` integer PRIMARY KEY NOT NULL,
	`transaction_id` integer,
	`path` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`read_status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`name` text NOT NULL,
	`type` text NOT NULL,
	`color_token` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`name`, `type`)
);
--> statement-breakpoint
CREATE TABLE `digests` (
	`week_start` text PRIMARY KEY NOT NULL,
	`facts_json` text NOT NULL,
	`text` text,
	`model` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `holding_txns` (
	`id` integer PRIMARY KEY NOT NULL,
	`holding_id` integer NOT NULL,
	`transaction_id` integer,
	`date` text NOT NULL,
	`amount` real NOT NULL,
	`units` real,
	`nav` real,
	`source` text NOT NULL,
	FOREIGN KEY (`holding_id`) REFERENCES `holdings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `holding_txns_transaction_id_unique` ON `holding_txns` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `holding_txns_holding_idx` ON `holding_txns` (`holding_id`,`date`);--> statement-breakpoint
CREATE TABLE `holdings` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`asset_class` text DEFAULT 'Other' NOT NULL,
	`scheme_code` text,
	`target_pct` real,
	`is_closed` integer DEFAULT false NOT NULL,
	`manual_value` real,
	`manual_value_date` text,
	`sip_amount` real,
	`sip_day` integer,
	`sms_match` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `insights` (
	`id` integer PRIMARY KEY NOT NULL,
	`detector` text NOT NULL,
	`key` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`dismissed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `insights_detector_key` ON `insights` (`detector`,`key`);--> statement-breakpoint
CREATE TABLE `merchant_rules` (
	`id` integer PRIMARY KEY NOT NULL,
	`match` text NOT NULL,
	`display_merchant` text NOT NULL,
	`category` text NOT NULL,
	`created_from_txn_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `prices` (
	`scheme_code` text NOT NULL,
	`date` text NOT NULL,
	`nav` real NOT NULL,
	`source` text NOT NULL,
	PRIMARY KEY(`scheme_code`, `date`)
);
--> statement-breakpoint
CREATE TABLE `recurring_occurrences` (
	`series_id` integer NOT NULL,
	`due_date` text NOT NULL,
	`transaction_id` integer,
	`status` text NOT NULL,
	PRIMARY KEY(`series_id`, `due_date`),
	FOREIGN KEY (`series_id`) REFERENCES `recurring_series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `recurring_series` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`match` text NOT NULL,
	`cadence` text DEFAULT 'monthly' NOT NULL,
	`usual_day` integer,
	`expected_amount` real NOT NULL,
	`tolerance_pct` real DEFAULT 10 NOT NULL,
	`holding_id` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transaction_items` (
	`id` integer PRIMARY KEY NOT NULL,
	`transaction_id` integer NOT NULL,
	`name` text NOT NULL,
	`qty` real,
	`amount` real NOT NULL,
	`category` text NOT NULL,
	`source` text NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `transaction_splits` (
	`transaction_id` integer NOT NULL,
	`category` text NOT NULL,
	`amount` real NOT NULL,
	PRIMARY KEY(`transaction_id`, `category`),
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `transaction_trips` (
	`transaction_id` integer NOT NULL,
	`trip_id` integer NOT NULL,
	`source` text NOT NULL,
	`in_daily_budget` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`transaction_id`, `trip_id`),
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `trips` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`budget` real DEFAULT 0 NOT NULL,
	`auto_tag` integer DEFAULT true NOT NULL,
	`skip_recurring` integer DEFAULT true NOT NULL,
	`ended_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `transactions` ADD `excluded` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `duplicate_of` integer;--> statement-breakpoint
ALTER TABLE `transactions` ADD `raw_merchant` text;