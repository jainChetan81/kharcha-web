ALTER TABLE `ask_log` ADD `tokens_in` integer;--> statement-breakpoint
ALTER TABLE `ask_log` ADD `tokens_out` integer;--> statement-breakpoint
ALTER TABLE `ask_log` ADD `cost_usd` real;--> statement-breakpoint
ALTER TABLE `digests` ADD `tokens_in` integer;--> statement-breakpoint
ALTER TABLE `digests` ADD `tokens_out` integer;--> statement-breakpoint
ALTER TABLE `digests` ADD `cost_usd` real;--> statement-breakpoint
ALTER TABLE `receipt_jobs` ADD `tokens_in` integer;--> statement-breakpoint
ALTER TABLE `receipt_jobs` ADD `tokens_out` integer;--> statement-breakpoint
ALTER TABLE `receipt_jobs` ADD `cost_usd` real;