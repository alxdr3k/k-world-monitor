-- v6: discovery_queue table for INFRA-1B.2 Discovery Worker
-- Stores discovered document URLs from RSS/Atom feed polling,
-- pending Snapshot fingerprint creation (INFRA-1B.3).
--
-- updated_at is folded into the base schema (previously a separate v7
-- ALTER COLUMN migration). Stale-row reclaim in processDiscoveryQueue
-- requires it; treating it as optional led to a 3-helper smell
-- (hasUpdatedAtColumn / tryHasUpdatedAtColumn / tryUpdatedAtClause)
-- defending against a non-existent pre-v7 schema.

CREATE TABLE IF NOT EXISTS discovery_queue (
  queue_id        TEXT NOT NULL PRIMARY KEY,    -- `dq_<ULID>`
  source_id       TEXT NOT NULL                 -- FK to source_material_policy.source_id
                  REFERENCES source_material_policy(source_id),
  url             TEXT NOT NULL,                -- discovered document URL
  title           TEXT,                         -- feed item title (optional)
  published_at    TEXT,                         -- ISO-8601 UTC from feed, or NULL
  discovered_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  content_hash    TEXT,                         -- sha256 of url — stored for future change-detection (not used for dedup)
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','done','error')),
  error_detail    TEXT,
  -- Stale-row reclaim: processDiscoveryQueue resets rows where
  -- status='processing' AND updated_at < NOW-1h back to 'pending' to
  -- recover them from crashed workers. Application code (claim UPDATE,
  -- heartbeat, markers) sets this on every write — no trigger, since
  -- triggers with time-string precision guards are unreliable under
  -- PRAGMA recursive_triggers=ON.
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Deduplication: one URL per source, only pending/processing rows.
CREATE UNIQUE INDEX IF NOT EXISTS discovery_queue_url_source_active_idx
  ON discovery_queue (source_id, url)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS discovery_queue_status_idx
  ON discovery_queue (status, discovered_at);

-- Stale-row reclaim index: lookup on processing rows ordered by stamp.
CREATE INDEX IF NOT EXISTS discovery_queue_processing_updated_at_idx
  ON discovery_queue (updated_at)
  WHERE status = 'processing';

INSERT OR IGNORE INTO schema_migrations (version, description)
  VALUES ('v6', 'discovery_queue table — discovered document URLs pending snapshot creation');
