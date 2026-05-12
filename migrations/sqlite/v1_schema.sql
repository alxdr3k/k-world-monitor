-- =============================================================================
-- k-world-monitor — SQLite relational schema v1
-- ADR-0012 (storage split), ADR-0017 (source_policy gate),
-- ADR-0020 (metrics framework), ADR-0021 (policy learning),
-- ADR-0023 (LLM routing v2 + run_ledger + cross_vendor_review_ledger),
-- ADR-0024 (dataset_vintage + derived_metric_ledger)
-- Q-004 resolved: k-world-monitor repo owns SQLite only (no vault jsonl here)
-- =============================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA auto_vacuum = INCREMENTAL;

-- =============================================================================
-- Run ledger (ADR-0023 INV-0023-7, ADR-0006 INV-0006-5 extension)
-- Tracks every LLM call + cost + vendor + tier.
-- run_id is the FK anchor used by Neo4j nodes (Claim.run_id etc.).
-- =============================================================================
CREATE TABLE IF NOT EXISTS run_ledger (
  run_id          TEXT PRIMARY KEY,             -- `run_<ULID>`
  started_at      TEXT NOT NULL,
  completed_at    TEXT,
  status          TEXT NOT NULL DEFAULT 'running', -- running|completed|failed
  stage           TEXT NOT NULL,                -- discover|extract|dossier|scenario|thesis|cite_check|publication
  vendor          TEXT NOT NULL,                -- openai|anthropic|google
  tier            INTEGER NOT NULL,             -- 0|1|2|3 (ADR-0023)
  model_id        TEXT NOT NULL,                -- exact model snapshot from data/llm_routing.yaml
  prompt_version  TEXT,
  system_prompt_sha256 TEXT,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  cached_tokens   INTEGER,                      -- INV-0023-7
  total_cost_usd  REAL,
  batch_id        TEXT,                         -- Batch API job id (nullable)
  cross_vendor_review_of TEXT REFERENCES run_ledger(run_id), -- INV-0023-7
  spec_sha256     TEXT,                         -- ADR-0024 INV-0024-3 (dataset transforms)
  dataset_vintage_id TEXT,                      -- FK to dataset_vintage (ADR-0024)
  library_version_lock_sha256 TEXT,             -- ADR-0024 INV-0024-2
  domain_override_reason TEXT,                  -- INV-0023-7: required when non-default vendor
  session_id      TEXT,                         -- FK to research_session
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS run_ledger_vendor_idx ON run_ledger(vendor);
CREATE INDEX IF NOT EXISTS run_ledger_stage_idx ON run_ledger(stage);
CREATE INDEX IF NOT EXISTS run_ledger_started_at_idx ON run_ledger(started_at);
CREATE INDEX IF NOT EXISTS run_ledger_batch_id_idx ON run_ledger(batch_id);
-- OPS-1A.1: daily cost queries filter on completed_at; composite covers vendor filter too.
CREATE INDEX IF NOT EXISTS run_ledger_completed_at_vendor_idx ON run_ledger(completed_at, vendor);

-- =============================================================================
-- Cross-vendor review ledger (ADR-0023 INV-0023-4)
-- Records the 3 mandatory cross-vendor review instances.
-- =============================================================================
CREATE TABLE IF NOT EXISTS cross_vendor_review_ledger (
  review_id         TEXT PRIMARY KEY,           -- `cvr_<ULID>`
  review_type       TEXT NOT NULL,              -- preflight_cite_overclaim|scenario_adversarial|high_stakes_thesis
  generator_run_id  TEXT NOT NULL REFERENCES run_ledger(run_id),
  reviewer_run_id   TEXT NOT NULL REFERENCES run_ledger(run_id),
  outcome           TEXT NOT NULL,              -- pass|fail|conditional
  findings_json     TEXT,                       -- structured findings from reviewer
  cross_vendor_review_coverage REAL,            -- rolling KPI contribution (AC-013 ≥ 0.95)
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS cvr_review_type_idx ON cross_vendor_review_ledger(review_type);
CREATE INDEX IF NOT EXISTS cvr_generator_run_idx ON cross_vendor_review_ledger(generator_run_id);

-- =============================================================================
-- Source material policy (ADR-0017)
-- Per-source policy decisions for archive / cloud / LLM access.
-- =============================================================================
CREATE TABLE IF NOT EXISTS source_material_policy (
  source_id            TEXT NOT NULL,           -- FK to Neo4j Source.source_id
  archive_policy       TEXT NOT NULL CHECK (archive_policy IN ('metadata_only','excerpt_only','full_snapshot_allowed','do_not_collect')),
  raw_cloud_policy     TEXT NOT NULL CHECK (raw_cloud_policy IN ('always_prohibited','allowed_public_data_only')),
  external_llm_policy  TEXT NOT NULL CHECK (external_llm_policy IN ('allowed','manual_review_required','prohibited')),
  terms_url            TEXT,
  license_url          TEXT,
  checked_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (source_id)
);

-- =============================================================================
-- Policy decisions (referenced by policy_learning_events)
-- Records operator decisions made at policy gate triggers.
-- =============================================================================
CREATE TABLE IF NOT EXISTS policy_decisions (
  decision_id       TEXT PRIMARY KEY,           -- `pdec_<ULID>`
  source_id         TEXT,                       -- FK to Neo4j Source.source_id
  session_id        TEXT,                       -- FK to research_session
  url               TEXT,
  trigger_type      TEXT NOT NULL,              -- 1..8 from ADR-0017 danger-action list
  policy_gate_mode  TEXT NOT NULL CHECK (policy_gate_mode IN ('inline_block','inline_warn','batch_report')),
  decision          TEXT NOT NULL,              -- ignore|manual_claim|temp_text|override|blocked
  rationale         TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS policy_decisions_source_id_idx ON policy_decisions(source_id);
CREATE INDEX IF NOT EXISTS policy_decisions_session_id_idx ON policy_decisions(session_id);

-- =============================================================================
-- Policy learning events (ADR-0021)
-- Proposes rule candidates from repeated operator decisions.
-- =============================================================================
CREATE TABLE IF NOT EXISTS policy_learning_events (
  event_id            TEXT PRIMARY KEY,         -- `ple_<ULID>`
  policy_decision_id  TEXT REFERENCES policy_decisions(decision_id),
  user_action         TEXT NOT NULL,            -- ignore|manual_claim|temp_text|override
  pattern             TEXT NOT NULL,            -- pattern_1|pattern_2|pattern_3|pattern_5
  proposed_rule_id    TEXT,                     -- FK to source_policy_rules (nullable until rule exists)
  rule_accepted       INTEGER,                  -- 0|1 (SQLite bool)
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS ple_policy_decision_idx ON policy_learning_events(policy_decision_id);
CREATE INDEX IF NOT EXISTS ple_pattern_idx ON policy_learning_events(pattern);

-- =============================================================================
-- Source policy rules (ADR-0021)
-- Auto-propose rules from learning events. Only activated on user confirm.
-- =============================================================================
CREATE TABLE IF NOT EXISTS source_policy_rules (
  rule_id              TEXT PRIMARY KEY,        -- `spr_<ULID>`
  pattern              TEXT NOT NULL,           -- pattern_1|pattern_2|pattern_3|pattern_5
  applies_to_field     TEXT NOT NULL,           -- archive_policy|raw_cloud_policy|external_llm_policy
  match_pattern        TEXT NOT NULL,           -- source_id or URL glob (`*.ft.com`)
  rule_value           TEXT NOT NULL,           -- enum value for applies_to_field
  source_count         INTEGER NOT NULL DEFAULT 0,
  created_from         TEXT NOT NULL,           -- policy_learning_event.event_id
  active               INTEGER NOT NULL DEFAULT 0, -- 0=proposed, 1=confirmed
  terms_url            TEXT,                    -- required for relaxation direction
  license_url          TEXT,
  confirmed_at         TEXT,
  demoted_at           TEXT
);

CREATE INDEX IF NOT EXISTS spr_active_idx ON source_policy_rules(active);
CREATE INDEX IF NOT EXISTS spr_match_pattern_idx ON source_policy_rules(match_pattern);

-- =============================================================================
-- Dataset vintage (ADR-0024 PRE-0024-2)
-- Records every fetched dataset's vintage + observation date for reproducibility.
-- =============================================================================
CREATE TABLE IF NOT EXISTS dataset_vintage (
  vintage_id            TEXT PRIMARY KEY,       -- `dvnt_<ULID>`
  source_id             TEXT,                   -- FK to Neo4j Source.source_id
  url                   TEXT NOT NULL,
  vintage_date          TEXT NOT NULL,          -- dataset's publication date (ISO8601 date)
  observation_date      TEXT NOT NULL,          -- date we fetched/observed it
  format                TEXT NOT NULL,          -- csv|parquet|json|xlsx|api_response
  checksum_sha256       TEXT NOT NULL,
  byte_size             INTEGER,
  r2_key                TEXT,                   -- R2 key if permitted artifact stored
  row_count             INTEGER,
  column_names_json     TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS dvnt_source_id_idx ON dataset_vintage(source_id);
CREATE INDEX IF NOT EXISTS dvnt_vintage_date_idx ON dataset_vintage(vintage_date);
CREATE INDEX IF NOT EXISTS dvnt_observation_date_idx ON dataset_vintage(observation_date);

-- =============================================================================
-- Derived metric ledger (ADR-0024 PRE-0024-3)
-- Reproducibility 3-tuple: dataset_vintage_id + spec_sha256 + library_version_lock_sha256
-- =============================================================================
CREATE TABLE IF NOT EXISTS derived_metric_ledger (
  metric_id                    TEXT PRIMARY KEY, -- `met_<ULID>`
  dataset_vintage_id           TEXT NOT NULL REFERENCES dataset_vintage(vintage_id),
  spec_sha256                  TEXT NOT NULL,    -- SHA256 of data/transforms/<spec_id>.{py,sql}
  library_version_lock_sha256  TEXT NOT NULL,    -- SHA256 of uv.lock or requirements.lock
  computed_at                  TEXT NOT NULL,
  metric_name                  TEXT NOT NULL,
  value_json                   TEXT NOT NULL,    -- computed metric value (number, object, or array)
  claim_id_fk                  TEXT,            -- FK to Neo4j Claim.claim_id (when metric becomes evidence)
  run_id                       TEXT REFERENCES run_ledger(run_id)
);

CREATE INDEX IF NOT EXISTS dml_dataset_vintage_idx ON derived_metric_ledger(dataset_vintage_id);
CREATE INDEX IF NOT EXISTS dml_spec_sha256_idx ON derived_metric_ledger(spec_sha256);
CREATE INDEX IF NOT EXISTS dml_claim_id_idx ON derived_metric_ledger(claim_id_fk);

-- Reproducibility uniqueness: same 3-tuple + metric_name must yield same row.
CREATE UNIQUE INDEX IF NOT EXISTS dml_reproducibility_unique
ON derived_metric_ledger(dataset_vintage_id, spec_sha256, library_version_lock_sha256, metric_name);

-- =============================================================================
-- Metrics framework (ADR-0020)
-- =============================================================================
CREATE TABLE IF NOT EXISTS metrics_run (
  metric_run_id  TEXT PRIMARY KEY,              -- `mrun_<ULID>`
  run_id         TEXT NOT NULL REFERENCES run_ledger(run_id),
  category       TEXT NOT NULL,                 -- 데이터_품질|운영_성능|policy_safety|콘텐츠_production|추적성|시스템_건강|bidirectional
  metric_name    TEXT NOT NULL,
  metric_value   REAL NOT NULL,
  measured_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  context_json   TEXT
);

CREATE INDEX IF NOT EXISTS metrics_run_category_idx ON metrics_run(category);
CREATE INDEX IF NOT EXISTS metrics_run_metric_name_idx ON metrics_run(metric_name);
CREATE INDEX IF NOT EXISTS metrics_run_measured_at_idx ON metrics_run(measured_at);

CREATE TABLE IF NOT EXISTS metrics_daily (
  date          TEXT NOT NULL,
  metric_name   TEXT NOT NULL,
  metric_value  REAL NOT NULL,
  sample_count  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, metric_name)
);

CREATE TABLE IF NOT EXISTS metric_alerts (
  alert_id      TEXT PRIMARY KEY,               -- `malt_<ULID>`
  metric_name   TEXT NOT NULL,
  threshold     REAL NOT NULL,
  triggered_at  TEXT NOT NULL,
  resolved_at   TEXT,
  notes         TEXT
);

-- Evaluation runs for retrieval quality (ADR-0020)
CREATE TABLE IF NOT EXISTS evaluation_runs (
  evaluation_run_id  TEXT PRIMARY KEY,          -- `eval_<ULID>`
  gold_query_set_id  TEXT NOT NULL,
  started_at         TEXT NOT NULL,
  completed_at       TEXT,
  total_cases        INTEGER,
  pass_rate          REAL
);

CREATE TABLE IF NOT EXISTS evaluation_cases (
  case_id              TEXT PRIMARY KEY,        -- `ecase_<ULID>`
  evaluation_run_id    TEXT NOT NULL REFERENCES evaluation_runs(evaluation_run_id),
  query                TEXT NOT NULL,
  expected_claims_json TEXT,
  retrieved_claims_json TEXT,
  pack_metrics_json    TEXT,
  pass                 INTEGER                  -- 0|1
);

CREATE INDEX IF NOT EXISTS eval_cases_run_idx ON evaluation_cases(evaluation_run_id);

CREATE TABLE IF NOT EXISTS retrieval_pack_metrics (
  pack_metric_id       TEXT PRIMARY KEY,        -- `rpm_<ULID>`
  evaluation_run_id    TEXT NOT NULL REFERENCES evaluation_runs(evaluation_run_id),
  case_id              TEXT NOT NULL REFERENCES evaluation_cases(case_id),
  recall_at_k          REAL,
  diversity_score      REAL,
  bidirectional_balance REAL,
  stability_score      REAL
);

-- =============================================================================
-- Research session (ADR-0021)
-- Tracks interactive research sessions; scopes raw_cache_items lifetime.
-- =============================================================================
CREATE TABLE IF NOT EXISTS research_session (
  session_id            TEXT PRIMARY KEY,       -- `sess_<ULID>`
  scenario_id           TEXT,                   -- FK to Neo4j Scenario.scenario_id
  thesis_id             TEXT,                   -- FK to Neo4j Thesis.thesis_id
  status                TEXT NOT NULL CHECK (status IN ('active','finalized','abandoned')),
  raw_cache_expires_at  TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS research_session_status_idx ON research_session(status);

-- =============================================================================
-- Raw cache items (ADR-0021)
-- Ephemeral content references during a session. Never stores raw text blobs.
-- Expires per DEC-007 lifecycle policy.
-- =============================================================================
CREATE TABLE IF NOT EXISTS raw_cache_items (
  cache_id      TEXT PRIMARY KEY,               -- `rcache_<ULID>`
  session_id    TEXT NOT NULL REFERENCES research_session(session_id),
  url           TEXT NOT NULL,
  content_hash  TEXT,                           -- sha256 of fetched content (not stored here)
  indexed       INTEGER NOT NULL DEFAULT 0,     -- 0|1
  embedded      INTEGER NOT NULL DEFAULT 0,     -- 0|1
  expires_at    TEXT NOT NULL,                  -- 24h–7d ceiling (DEC-007)
  deleted_at    TEXT
);

CREATE INDEX IF NOT EXISTS raw_cache_session_idx ON raw_cache_items(session_id);
CREATE INDEX IF NOT EXISTS raw_cache_expires_at_idx ON raw_cache_items(expires_at);
CREATE INDEX IF NOT EXISTS raw_cache_url_idx ON raw_cache_items(url);

-- =============================================================================
-- Schema version tracking
-- =============================================================================
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  description TEXT
);

INSERT OR IGNORE INTO schema_migrations (version, description)
VALUES ('v1', 'INFRA-1A.2 — initial relational schema (run_ledger, cross_vendor_review_ledger, source_material_policy, policy_decisions, policy_learning_events, source_policy_rules, dataset_vintage, derived_metric_ledger, metrics_*, evaluation_*, research_session, raw_cache_items)');
