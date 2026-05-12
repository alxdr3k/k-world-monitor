-- v6: discovery_queue table for INFRA-1B.2 Discovery Worker
-- Stores discovered document URLs from RSS/Atom feed polling,
-- pending Snapshot fingerprint creation (INFRA-1B.3).

CREATE TABLE IF NOT EXISTS discovery_queue (
  queue_id        TEXT NOT NULL PRIMARY KEY,    -- `dq_<ULID>`
  source_id       TEXT NOT NULL,                -- FK to source_material_policy.source_id
  url             TEXT NOT NULL,                -- discovered document URL
  title           TEXT,                         -- feed item title (optional)
  published_at    TEXT,                         -- ISO-8601 UTC from feed, or NULL
  discovered_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  content_hash    TEXT,                         -- sha256 of url for dedup (set by enqueue)
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','done','error')),
  error_detail    TEXT
);

-- Deduplication: one URL per source, only pending/processing rows.
CREATE UNIQUE INDEX IF NOT EXISTS discovery_queue_url_source_active_idx
  ON discovery_queue (source_id, url)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS discovery_queue_status_idx
  ON discovery_queue (status, discovered_at);

INSERT OR IGNORE INTO schema_migrations (version, description)
  VALUES ('v6', 'discovery_queue table — discovered document URLs pending snapshot creation');
