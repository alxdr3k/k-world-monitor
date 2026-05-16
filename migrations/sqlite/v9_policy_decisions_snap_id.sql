-- v9: policy_decisions.snap_id column (AI-P1-15, INFRA-1B.3.h5-policy-decisions-snap-id-column-v9).
--
-- AI-P1-13 (OPS-1B.h2-r2-invariant-scanner-orphan-axis) surfaced a structural
-- weakness in the audit ledger: the scanner has to parse snap_id out of the
-- free-form `rationale` column via `parseSnapIdFromRationale()` regex. Any
-- future change to the rationale prefix format silently breaks the scanner,
-- and malformed rows must be handled as a separate violation axis
-- (`malformed_r2_upload_audit_row`) because the column is the only structured
-- handle that audit consumers can rely on.
--
-- AI-P1-15 fixes the schema rather than working around it: a first-class
-- `snap_id` TEXT column on `policy_decisions`. New audit writes populate
-- both the column AND the rationale prefix (backward-compat); legacy v8-
-- rows have NULL `snap_id` and continue to require rationale parsing as
-- fallback. The scanner reads the column when available and falls back to
-- rationale parsing only when the column is NULL (legacy rows).
--
-- Migration semantics:
--
-- 1. ALTER TABLE policy_decisions ADD COLUMN snap_id TEXT — nullable
--    because v8- rows have no value (will be backfilled offline if/when
--    needed; the scanner's rationale fallback covers them at read time).
--
-- 2. Partial INDEX on (snap_id) WHERE snap_id IS NOT NULL — supports
--    operator queries like `SELECT * FROM policy_decisions WHERE snap_id
--    = ?` without scanning v8- rows. Partial index matches the existing
--    upload_attempt_id idx pattern from v8.
--
-- No CHECK constraint on the column itself: the snap_id ULID prefix shape
-- is enforced at the application boundary (`recordR2UploadDecision` only
-- writes well-formed `snap_<ULID>` values) and the scanner reports any
-- malformed value as a violation. A DB-level CHECK would require parsing
-- and would be redundant with the existing parser-side enforcement.

ALTER TABLE policy_decisions ADD COLUMN snap_id TEXT;

CREATE INDEX IF NOT EXISTS policy_decisions_snap_id_idx
  ON policy_decisions(snap_id)
  WHERE snap_id IS NOT NULL;
