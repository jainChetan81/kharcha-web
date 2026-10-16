CREATE TABLE `reimbursement_links` (
	`reimbursement_id` integer NOT NULL,
	`credit_transaction_id` integer NOT NULL,
	`amount` real NOT NULL,
	PRIMARY KEY(`reimbursement_id`, `credit_transaction_id`),
	FOREIGN KEY (`reimbursement_id`) REFERENCES `reimbursements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`credit_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reimbursements` (
	`id` integer PRIMARY KEY NOT NULL,
	`transaction_id` integer NOT NULL,
	`amount` real NOT NULL,
	`counterparty` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`item_ids` text,
	`manual_paid` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`closed_at` text,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
