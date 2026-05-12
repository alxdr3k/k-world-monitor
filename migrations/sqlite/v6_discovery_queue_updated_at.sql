-- v6: Add updated_at column to discovery_queue for stale processing row detection.
-- INFRA-1B.3: processDiscoveryQueue resets rows where status='processing' and
-- updated_at < NOW-1h back to 'pending' to reclaim them from crashed workers.

ALTER TABLE discovery_queue
  ADD COLUMN updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'));

-- Trigger to keep updated_at current on every status change.
CREATE TRIGGER IF NOT EXISTS discovery_queue_updated_at
  AFTER UPDATE ON discovery_queue
  FOR EACH ROW
  BEGIN
    UPDATE discovery_queue SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
    WHERE queue_id = NEW.queue_id;
  END;

INSERT OR IGNORE INTO schema_migrations (version, description)
  VALUES ('v6', 'discovery_queue updated_at column for stale processing row reclaim');
