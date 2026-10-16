INSERT INTO `categories` (`name`, `type`, `color_token`, `sort_order`) VALUES
  ('Food', 'expense', 'cat-food', 0),
  ('Transport', 'expense', 'cat-transport', 1),
  ('Shopping', 'expense', 'cat-shopping', 2),
  ('Utilities', 'expense', 'cat-utilities', 3),
  ('Entertainment', 'expense', 'cat-entertainment', 4),
  ('Health', 'expense', 'cat-health', 5),
  ('Home', 'expense', 'cat-home', 6),
  ('Sports', 'expense', 'cat-sports', 7),
  ('Work', 'expense', 'cat-work', 8),
  ('Other', 'expense', 'cat-other', 9),
  ('Salary', 'income', 'earn', 0),
  ('Refunds', 'income', 'earn', 1),
  ('Other', 'income', 'cat-other', 2);
--> statement-breakpoint
-- Card bill payments are transfers, not spend: keep them, leave them out of totals.
UPDATE `transactions` SET `excluded` = 1 WHERE `category` = 'Credit Card Payment';
--> statement-breakpoint
-- Category stays plain text with no FK; anything outside the seeded list reads as Other.
UPDATE `transactions` SET `category` = 'Other'
  WHERE `type` <> 'investment' AND (`category` IS NULL OR `category` NOT IN (SELECT `name` FROM `categories`));
--> statement-breakpoint
UPDATE `transactions` SET `raw_merchant` = `merchant` WHERE `raw_merchant` IS NULL AND `source` = 'sms';
