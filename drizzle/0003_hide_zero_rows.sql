-- ₹0 rows are parser misses (OTP, balance alerts) stored before ingest skipped them. Soft-delete so they stay recoverable.
UPDATE transactions SET deleted_at = datetime('now') WHERE amount = 0 AND deleted_at IS NULL;
