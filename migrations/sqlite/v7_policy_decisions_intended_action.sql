-- v7: policy_decisions.intended_action
-- AC-032 / NFR-008 — R2 upload audit ledger hook (Q-044 → DEC-020, TRACE-040).
-- ADR-0012 INV-0012-3 raw-cloud-upload invariant audit: every r2Put call site
-- in src/discovery/worker/snapshot-fingerprint.ts records one immutable row
-- via src/storage/audit/policy-decisions.ts (INFRA-1B.3.x-audit slice).
--
-- The intended_action column namespaces the row source. Existing operator-facing
-- policy gate rows (ADR-0017 8 danger-action triggers) leave it NULL.
-- System-initiated audit rows set intended_action='r2_upload' (and reuse
-- trigger_type='r2_upload' + policy_gate_mode='batch_report' to satisfy the
-- existing NOT NULL + CHECK constraints — the 'batch_report' mode semantically
-- matches automated background process with no operator dialog).

ALTER TABLE policy_decisions ADD COLUMN intended_action TEXT;

CREATE INDEX IF NOT EXISTS policy_decisions_intended_action_idx
  ON policy_decisions(intended_action);

-- Schema version record
INSERT OR IGNORE INTO schema_migrations (version, description)
VALUES ('v7', 'INFRA-1B.3.x-audit — policy_decisions.intended_action for R2 upload audit (Q-044 / NFR-008)');
