-- =============================================================================
-- k-world-monitor — SQLite migration v4
-- OPS-1A.1: add composite index on run_ledger(completed_at, vendor) for
-- daily cost aggregation queries (getDailyCostUsd / getDailyCostBreakdown).
-- Cost is recorded at completeRun time, so daily rollups filter on
-- completed_at. The composite index covers the optional vendor filter too.
-- =============================================================================

CREATE INDEX IF NOT EXISTS run_ledger_completed_at_vendor_idx ON run_ledger(completed_at, vendor);

INSERT OR IGNORE INTO schema_migrations (version, description)
VALUES ('v4', 'OPS-1A.1 — run_ledger(completed_at, vendor) composite index for daily cost scans');
