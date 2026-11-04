CREATE TABLE `merchant_vectors` (
	`merchant` text PRIMARY KEY NOT NULL,
	`model` text NOT NULL,
	`vector` blob NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
