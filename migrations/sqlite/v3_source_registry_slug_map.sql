-- v3: source_registry_slug_map
-- Stable slug→source_id mapping for idempotent seed re-runs.
-- Created by INFRA-1B.1; previously bootstrapped at runtime in seed.ts (DEC-015).
CREATE TABLE IF NOT EXISTS source_registry_slug_map (
  slug      TEXT NOT NULL PRIMARY KEY,
  source_id TEXT NOT NULL
);

-- Schema version record
INSERT OR IGNORE INTO schema_migrations (version, description)
VALUES ('v3', 'INFRA-1B.1 — source_registry_slug_map for stable slug→source_id mapping');
