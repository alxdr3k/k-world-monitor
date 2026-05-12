-- =============================================================================
-- k-world-monitor — SQLite schema v2
-- Enum-validating triggers for columns that lack inline CHECK constraints in v1.
-- SQLite does not support ALTER TABLE ADD CONSTRAINT; triggers are the
-- standard idiomatic approach for post-creation enum enforcement.
--
-- Covers: run_ledger (status/stage/vendor), cross_vendor_review_ledger
-- (review_type/outcome).  Application-layer validators in src/utils/enums.ts
-- mirror these constraints.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- run_ledger enum triggers
-- ---------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS trg_run_ledger_status_insert
BEFORE INSERT ON run_ledger
BEGIN
  SELECT CASE WHEN NEW.status NOT IN ('running','completed','failed')
    THEN RAISE(ABORT, 'run_ledger.status must be running|completed|failed')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_run_ledger_status_update
BEFORE UPDATE OF status ON run_ledger
BEGIN
  SELECT CASE WHEN NEW.status NOT IN ('running','completed','failed')
    THEN RAISE(ABORT, 'run_ledger.status must be running|completed|failed')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_run_ledger_stage_insert
BEFORE INSERT ON run_ledger
BEGIN
  SELECT CASE WHEN NEW.stage NOT IN (
    'discover','extract','dossier','scenario','thesis','cite_check','publication'
  ) THEN RAISE(ABORT, 'run_ledger.stage invalid enum value') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_run_ledger_stage_update
BEFORE UPDATE OF stage ON run_ledger
BEGIN
  SELECT CASE WHEN NEW.stage NOT IN (
    'discover','extract','dossier','scenario','thesis','cite_check','publication'
  ) THEN RAISE(ABORT, 'run_ledger.stage invalid enum value') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_run_ledger_vendor_insert
BEFORE INSERT ON run_ledger
BEGIN
  SELECT CASE WHEN NEW.vendor NOT IN ('openai','anthropic','google')
    THEN RAISE(ABORT, 'run_ledger.vendor must be openai|anthropic|google')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_run_ledger_vendor_update
BEFORE UPDATE OF vendor ON run_ledger
BEGIN
  SELECT CASE WHEN NEW.vendor NOT IN ('openai','anthropic','google')
    THEN RAISE(ABORT, 'run_ledger.vendor must be openai|anthropic|google')
  END;
END;

-- ---------------------------------------------------------------------------
-- cross_vendor_review_ledger enum triggers
-- ---------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS trg_cvr_review_type_insert
BEFORE INSERT ON cross_vendor_review_ledger
BEGIN
  SELECT CASE WHEN NEW.review_type NOT IN (
    'preflight_cite_overclaim','scenario_adversarial','high_stakes_thesis'
  ) THEN RAISE(ABORT, 'cross_vendor_review_ledger.review_type invalid enum value') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cvr_review_type_update
BEFORE UPDATE OF review_type ON cross_vendor_review_ledger
BEGIN
  SELECT CASE WHEN NEW.review_type NOT IN (
    'preflight_cite_overclaim','scenario_adversarial','high_stakes_thesis'
  ) THEN RAISE(ABORT, 'cross_vendor_review_ledger.review_type invalid enum value') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cvr_outcome_insert
BEFORE INSERT ON cross_vendor_review_ledger
BEGIN
  SELECT CASE WHEN NEW.outcome NOT IN ('pass','fail','conditional')
    THEN RAISE(ABORT, 'cross_vendor_review_ledger.outcome must be pass|fail|conditional')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_cvr_outcome_update
BEFORE UPDATE OF outcome ON cross_vendor_review_ledger
BEGIN
  SELECT CASE WHEN NEW.outcome NOT IN ('pass','fail','conditional')
    THEN RAISE(ABORT, 'cross_vendor_review_ledger.outcome must be pass|fail|conditional')
  END;
END;

-- ---------------------------------------------------------------------------
-- Schema version record
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO schema_migrations (version, description)
VALUES ('v2', 'INFRA-1A.5 — enum-validating triggers for run_ledger (status/stage/vendor) and cross_vendor_review_ledger (review_type/outcome)');
