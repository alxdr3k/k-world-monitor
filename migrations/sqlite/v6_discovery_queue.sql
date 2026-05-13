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
  -- Result metadata: snap_id is the Snapshot id this row produced (status='done'),
  -- error_code is a discrete enum classifying the failure mode (status='error'),
  -- and error_detail is free-form supplementary text (e.g. exception message).
  -- Previously snap_id was packed into error_detail as "snap_id:<id>" and every
  -- error reason was a free-form string — operator dashboards / metrics had to
  -- parse English strings to bucket failures. Splitting these makes the failure
  -- taxonomy queryable without parsing.
  snap_id         TEXT,                         -- on done: the produced/dedup'd Snapshot id; NULL otherwise
  error_code      TEXT                          -- on error: one of the enum values; NULL otherwise
                  CHECK (
                    error_code IS NULL OR
                    error_code IN (
                      'source_not_found_in_graph',
                      'dedup_prohibited_source',
                      'policy_do_not_collect',
                      'http_status',
                      'empty_body',
                      'runtime_error'
                    )
                  ),
  error_detail    TEXT,                         -- free-form supplementary text (<= 500 chars)
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
