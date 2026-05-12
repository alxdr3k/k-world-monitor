-- v5: crawl_state table for discovery scheduler (ADR-0030 INV-0030-5)
-- Tracks per-source polling state: etag/Last-Modified for conditional fetch,
-- consecutive failure count for 24h backoff, and next eligible poll time.

CREATE TABLE IF NOT EXISTS crawl_state (
  source_id               TEXT    NOT NULL PRIMARY KEY,
  last_polled_at          TEXT,                               -- ISO-8601 UTC
  last_etag               TEXT,
  last_modified_header    TEXT,
  last_status             TEXT    NOT NULL DEFAULT 'pending', -- pending|ok|not_modified|error|timeout
  consecutive_failures    INTEGER NOT NULL DEFAULT 0,
  next_eligible_at        TEXT                                -- ISO-8601 UTC; NULL = eligible now
);

INSERT OR IGNORE INTO schema_migrations (version, description)
  VALUES ('v5', 'crawl_state table — per-source polling state, etag, backoff');
