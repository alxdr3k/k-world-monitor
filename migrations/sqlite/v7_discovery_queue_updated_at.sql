-- v7: Add updated_at column to discovery_queue for stale processing row detection.
-- INFRA-1B.3: processDiscoveryQueue resets rows where status='processing' and
-- updated_at < NOW-1h back to 'pending' to reclaim them from crashed workers.
--
-- Constant DEFAULT required: ALTER TABLE ... ADD COLUMN cannot use expression
-- defaults on tables that already have rows (SQLite constraint). Pre-migration
-- processing rows get '1970-01-01T00:00:00Z', which is older than 1h, so the
-- stale-row reclaim will pick them up on the next worker run (desired behavior).
--
-- No trigger: updated_at is set explicitly by application code on every write
-- (markQueueItemDone, markQueueItemError, claim UPDATE). Triggers with time-
-- string precision guards are unreliable under PRAGMA recursive_triggers=ON.

ALTER TABLE discovery_queue
  ADD COLUMN updated_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z';

INSERT OR IGNORE INTO schema_migrations (version, description)
  VALUES ('v7', 'discovery_queue updated_at column for stale processing row reclaim');
