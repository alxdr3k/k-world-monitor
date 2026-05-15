// Policy decisions audit ledger — R2 upload hook (INFRA-1B.3.x-audit).
//
// Implements ADR-0012 INV-0012-3 audit-trail enforcement for AC-032 / NFR-008
// (Q-044 → DEC-020, TRACE-040). Every r2Put call site in
// src/discovery/worker/snapshot-fingerprint.ts records two immutable rows via
// this module:
//
//   1. BEFORE r2Put: decision='attempted' — so an r2Put network failure still
//      leaves a recoverable audit trail for the attempted upload.
//   2. AFTER r2Put: decision='uploaded' | 'skipped_toctou' |
//      'set_r2_key_failed_neo4j' — captures the final disposition.
//
// "blocked_by_policy" is intentionally NOT a runtime row: policy gating
// happens before r2Put is reached, and absence of any audit row for a
// Snapshot is the canonical proof that no upload was attempted (ADR-0012
// INV-0012-3 audit-by-absence). This keeps the audit ledger row count
// proportional to upload attempts rather than to every prohibited Snapshot.
//
// Schema anchor: policy_decisions.intended_action (v7 migration).

import { monotonicFactory } from "ulid";
import { getDb } from "../sqlite/connection";
import type { ArchivePolicy, RawCloudPolicy, R2UploadDecision } from "../../utils/enums";

const ulid = monotonicFactory();

export interface R2UploadAuditInput {
  sourceId: string;
  snapId: string;
  url: string;
  archivePolicy: ArchivePolicy;
  rawCloudPolicy: RawCloudPolicy;
  decision: R2UploadDecision;
  /** Optional extra detail appended to rationale (e.g. error message tail). */
  rationale?: string;
}

// Compact, machine-grep-able rationale: every audit row's rationale starts
// with the snap_id so post-hoc queries can `LIKE 'snap_id=snap_%'` group rows
// per snapshot. Extra detail is appended last so the structured prefix is
// stable even when rationale text varies.
function formatRationale(input: R2UploadAuditInput): string {
  const parts = [
    `snap_id=${input.snapId}`,
    `archive_policy=${input.archivePolicy}`,
    `raw_cloud_policy=${input.rawCloudPolicy}`,
  ];
  if (input.rationale) parts.push(input.rationale);
  return parts.join("; ");
}

/**
 * Insert one immutable row into policy_decisions capturing an r2Put attempt
 * or outcome (ADR-0012 INV-0012-3, ADR-0017 INV-0017-3 immutable ledger).
 *
 * Returns the generated decision_id (`pdec_<ULID>`) so the caller may correlate
 * the BEFORE and AFTER rows for one upload attempt (rationale starts with the
 * same snap_id anchor).
 */
export function recordR2UploadDecision(input: R2UploadAuditInput): string {
  const decisionId = `pdec_${ulid()}`;
  getDb()
    .prepare(
      `INSERT INTO policy_decisions
         (decision_id, source_id, url, trigger_type, policy_gate_mode,
          decision, rationale, intended_action)
       VALUES (?, ?, ?, 'r2_upload', 'batch_report', ?, ?, 'r2_upload')`
    )
    .run(decisionId, input.sourceId, input.url, input.decision, formatRationale(input));
  return decisionId;
}
