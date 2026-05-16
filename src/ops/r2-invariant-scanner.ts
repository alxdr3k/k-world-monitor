// Runtime R2 invariant scanner — AI-P1-6 / OPS-1B.h1-runtime-invariant-scanner.
// Extended by AI-P1-13 / OPS-1B.h2-r2-invariant-scanner-orphan-axis.
//
// Reconciles 3 stores against ADR-0012 INV-0012-3 + INV-0012-4 (permitted-
// artifact gate). Read-only scan — does NOT modify Neo4j / SQLite / R2.
//
// The 5 axes:
//
// Axis 1: r2_key_without_audit
//   Snapshot.r2_key IS NOT NULL but no policy_decisions row claims the upload
//   (intended_action='r2_upload' AND decision='uploaded' for the same snap_id).
//   Interpretation: r2 has bytes attributed to this snapshot, but the audit
//   ledger has no record of how/when the upload happened. Either the upload
//   predates the audit hook (INFRA-1B.3.x-audit, PR #39 — historical Snapshots
//   from a pre-v7 codebase) or an audit-write failure left an orphaned r2 key.
//   For pre-v7 historical rows, the violation is informational; for new
//   uploads, it indicates a NFR-008 invariant break.
//
// Axis 2: audit_uploaded_without_r2_key
//   policy_decisions row decision='uploaded' but Snapshot.r2_key IS NULL (or
//   the Snapshot is missing from Neo4j entirely).
//   Interpretation: audit claims a fully successful upload (R2 put + Neo4j
//   SET both succeeded — the snapshot-fingerprint.ts ternary writes 'uploaded'
//   only when setSucceeded=true) but the graph state does not reflect it.
//   Almost certainly indicates Snapshot was DETACH DELETE'd while r2 retained
//   the object (operator manual ops without audit-aware repair). The
//   'set_r2_key_failed_neo4j' case is a SEPARATE state classified by Axis 4
//   below — AI-P1-6's original Axis 2 comment incorrectly conflated the two.
//
// Axis 3: r2_key_with_restricted_source
//   Snapshot.r2_key IS NOT NULL but at least one linked Source has
//   archive_policy != 'full_snapshot_allowed' OR raw_cloud_policy !=
//   'allowed_public_data_only' in source_material_policy NOW.
//   Interpretation: retroactive policy tightening — operator changed
//   source_material_policy AFTER the original upload. The original upload
//   was legal at write time (INFRA-1B.3.h1-policy-fix guards the write side),
//   but the current state violates ADR-0012 INV-0012-3 reading. Required
//   response: r2 object removal (separate slice — not in scope for this
//   read-only scanner) or source policy rollback.
//
// Axis 4: r2_object_without_graph_key (AI-P1-13)
//   policy_decisions row decision='set_r2_key_failed_neo4j' — emitted by
//   snapshot-fingerprint.ts after r2Put succeeded but the subsequent
//   `SET s.r2_key` Cypher mutation failed (network partition mid-tx,
//   constraint violation, etc.). The R2 object EXISTS but the graph never
//   recorded its key, so the back-fill / dedup re-attempt logic cannot find
//   it. AI-P1-6 (PR #50) scanner missed this entirely because
//   fetchUploadedAuditRows() filtered to decision='uploaded' only — the most
//   operationally critical orphan state (R2 has bytes, graph has nothing)
//   was invisible to all 3 original axes. The 'skipped_toctou' outcome —
//   r2Put succeeded then post-recheck found a now-restricted linked source
//   and skipped SET — also produces an R2 object without a graph key, but
//   AI-P1-13 narrows this axis to set_r2_key_failed_neo4j per the operator
//   decision text; skipped_toctou is classified separately as an
//   intentional graceful skip rather than a failed write and is left to a
//   future axis if operators want it surfaced.
//
// Axis 5: malformed_r2_upload_audit_row (AI-P1-13)
//   r2_upload outcome audit row whose `rationale` does NOT start with the
//   canonical `snap_id=<snap_id>;` prefix that recordR2UploadDecision()
//   formats. Pre-AI-P1-13 scanner silently dropped these rows in
//   fetchUploadedAuditRows(), so any malformed audit row was invisible to
//   reconciliation — a defensive blind spot (defensive coding rule:
//   scanner is read-only, must surface anomalies as violations rather than
//   abort or drop). AI-P1-13 surfaces malformed rows as a distinct
//   violation so operators can repair the audit ledger (or, if the format
//   change was intentional, update the parser).
//
// CLI consumer: `bun run audit:r2-invariants` (read-only, exit 1 on
// violations) — see src/ops/run-r2-invariants.ts.

import { withSession } from "../storage/neo4j/connection";
import { getDb } from "../storage/sqlite/connection";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type R2InvariantViolationType =
  | "r2_key_without_audit"
  | "audit_uploaded_without_r2_key"
  | "r2_key_with_restricted_source"
  | "r2_object_without_graph_key"
  | "malformed_r2_upload_audit_row";

export interface R2InvariantViolation {
  type: R2InvariantViolationType;
  snapId: string;
  /** Free-form details — type-specific (linked source_ids, r2_key, etc.). */
  details: Record<string, unknown>;
}

export interface ScanCounts {
  /** :Source-linked Snapshot nodes with r2_key IS NOT NULL */
  r2BackedSnapshots: number;
  /** policy_decisions rows with intended_action='r2_upload' AND decision='uploaded' (snap_id parsed) */
  uploadedAuditRows: number;
  /** policy_decisions rows with decision='set_r2_key_failed_neo4j' (snap_id parsed) — AI-P1-13 */
  setR2KeyFailedNeo4jAuditRows: number;
  /** policy_decisions r2_upload outcome rows whose rationale failed to parse — AI-P1-13 */
  malformedR2UploadAuditRows: number;
  /** source_material_policy rows */
  sourcePolicyRows: number;
}

export interface ScanResult {
  counts: ScanCounts;
  violations: R2InvariantViolation[];
  /** true ⇔ violations.length === 0 */
  aligned: boolean;
}

// ---------------------------------------------------------------------------
// SQL / Cypher fetchers — exported for unit testing isolation
// ---------------------------------------------------------------------------

export interface R2BackedSnapshot {
  snapId: string;
  r2Key: string;
  /** source_ids linked via (:Source)-[:HAS_DOCUMENT]->(:Document)-[:HAS_SNAPSHOT]->(:Snapshot) */
  linkedSourceIds: string[];
}

export async function fetchR2BackedSnapshots(): Promise<R2BackedSnapshot[]> {
  return withSession(async (session) => {
    const result = await session.run(
      `MATCH (s:Snapshot) WHERE s.r2_key IS NOT NULL
       OPTIONAL MATCH (src:Source)-[:HAS_DOCUMENT]->(:Document)-[:HAS_SNAPSHOT]->(s)
       RETURN s.snap_id AS snap_id,
              s.r2_key  AS r2_key,
              collect(DISTINCT src.source_id) AS source_ids`
    );
    return result.records.map((rec) => ({
      snapId: rec.get("snap_id") as string,
      r2Key: rec.get("r2_key") as string,
      linkedSourceIds: ((rec.get("source_ids") as Array<string | null>) ?? []).filter(
        (id): id is string => id !== null
      ),
    }));
  });
}

/** r2_upload outcome row variants AI-P1-13 surfaces to reconcile(). */
export type R2UploadOutcomeDecision = "uploaded" | "set_r2_key_failed_neo4j";

export interface R2UploadOutcomeAuditRow {
  /**
   * snap_id parsed from the canonical rationale prefix, or null when
   * rationale is malformed (cannot be parsed). Malformed rows are returned
   * (not silently dropped) so reconcile() can surface them as
   * `malformed_r2_upload_audit_row` violations — defensive coding rule:
   * read-only scanner exposes anomalies, never aborts or hides them.
   */
  snapId: string | null;
  uploadAttemptId: string | null;
  rationale: string;
  decisionId: string;
  decision: R2UploadOutcomeDecision;
}

/**
 * Backward-compat type alias. Pre-AI-P1-13 callers that only consumed
 * decision='uploaded' rows can keep importing `UploadedAuditRow`; the
 * extended shape (nullable snapId + decision discriminator) is a superset.
 */
export type UploadedAuditRow = R2UploadOutcomeAuditRow;

const SNAP_ID_RATIONALE_PREFIX = /^snap_id=(snap_[A-Za-z0-9_-]+)/;

/**
 * Parse the canonical `snap_id=<snap_id>; ...` prefix that
 * `recordR2UploadDecision()` formats. Returns null on malformed rationale.
 */
export function parseSnapIdFromRationale(rationale: string | null): string | null {
  if (!rationale) return null;
  const match = SNAP_ID_RATIONALE_PREFIX.exec(rationale);
  return match ? match[1]! : null;
}

/**
 * AI-P1-13: fetches BOTH 'uploaded' and 'set_r2_key_failed_neo4j' outcome
 * rows so reconcile() can route them to Axis 2 vs Axis 4 respectively.
 * Pre-AI-P1-13 (`fetchUploadedAuditRows`) hardcoded decision='uploaded'
 * which made the most critical orphan state invariant break (R2 object
 * exists, graph never set r2_key) invisible to the scanner.
 *
 * Malformed rationale rows are RETURNED with snapId=null (not dropped) so
 * reconcile() can surface them as `malformed_r2_upload_audit_row`.
 */
export function fetchR2UploadOutcomeAuditRows(): R2UploadOutcomeAuditRow[] {
  const rows = getDb()
    .query<
      {
        rationale: string | null;
        upload_attempt_id: string | null;
        decision_id: string;
        decision: string;
      },
      []
    >(
      `SELECT rationale, upload_attempt_id, decision_id, decision
       FROM policy_decisions
       WHERE intended_action = 'r2_upload'
         AND decision IN ('uploaded', 'set_r2_key_failed_neo4j')`
    )
    .all();
  return rows.map((r) => ({
    snapId: parseSnapIdFromRationale(r.rationale),
    uploadAttemptId: r.upload_attempt_id,
    rationale: r.rationale ?? "",
    decisionId: r.decision_id,
    decision: r.decision as R2UploadOutcomeDecision,
  }));
}

/**
 * @deprecated Use `fetchR2UploadOutcomeAuditRows` instead. Retained for
 * backward compatibility; returns only well-formed decision='uploaded'
 * rows (pre-AI-P1-13 semantic). New callers should use the broader
 * fetcher so reconcile() can surface set_r2_key_failed_neo4j orphans and
 * malformed audit rows.
 */
export function fetchUploadedAuditRows(): R2UploadOutcomeAuditRow[] {
  return fetchR2UploadOutcomeAuditRows().filter(
    (r) => r.decision === "uploaded" && r.snapId !== null
  );
}

export interface SourcePolicy {
  sourceId: string;
  archivePolicy: string;
  rawCloudPolicy: string;
}

export function fetchSourcePolicies(): SourcePolicy[] {
  return getDb()
    .query<
      { source_id: string; archive_policy: string; raw_cloud_policy: string },
      []
    >(
      "SELECT source_id, archive_policy, raw_cloud_policy FROM source_material_policy"
    )
    .all()
    .map((r) => ({
      sourceId: r.source_id,
      archivePolicy: r.archive_policy,
      rawCloudPolicy: r.raw_cloud_policy,
    }));
}

// ---------------------------------------------------------------------------
// Pure 3-way reconciliation (testable without IO)
// ---------------------------------------------------------------------------

export interface ReconcileInput {
  r2BackedSnapshots: ReadonlyArray<R2BackedSnapshot>;
  /**
   * AI-P1-13: broadened to ALL r2_upload outcome rows. reconcile() branches
   * on `decision` and snapId nullability to route into Axis 2 / 4 / 5.
   * Pre-AI-P1-13 callers that passed only decision='uploaded' rows are
   * still compatible — those rows simply do not trigger Axis 4 / 5.
   */
  r2UploadOutcomeAuditRows: ReadonlyArray<R2UploadOutcomeAuditRow>;
  sourcePolicies: ReadonlyArray<SourcePolicy>;
}

export function reconcile(input: ReconcileInput): R2InvariantViolation[] {
  // Audit-side snap_ids that count toward Axis 1 negation are only those
  // with decision='uploaded' AND a parseable snap_id. Failed-Neo4j outcomes
  // do NOT clear Axis 1 — they are themselves a separate violation (Axis 4)
  // and an Axis 1 hit on the same snap_id (if any Snapshot did somehow end
  // up with r2_key set) would be redundant with Axis 4's existence claim.
  const uploadedSnapIds = new Set(
    input.r2UploadOutcomeAuditRows
      .filter((r) => r.decision === "uploaded" && r.snapId !== null)
      .map((r) => r.snapId as string)
  );
  const r2SnapIds = new Set(input.r2BackedSnapshots.map((s) => s.snapId));
  const policyBySourceId = new Map(input.sourcePolicies.map((p) => [p.sourceId, p]));

  const violations: R2InvariantViolation[] = [];

  // Axis 1: r2_key_without_audit — Snapshot has r2_key but no uploaded audit row.
  for (const snap of input.r2BackedSnapshots) {
    if (!uploadedSnapIds.has(snap.snapId)) {
      violations.push({
        type: "r2_key_without_audit",
        snapId: snap.snapId,
        details: { r2Key: snap.r2Key, linkedSourceIds: snap.linkedSourceIds },
      });
    }
  }

  // Axis 2: audit_uploaded_without_r2_key — audit row decision='uploaded'
  // but Snapshot is missing or has r2_key=NULL.
  for (const audit of input.r2UploadOutcomeAuditRows) {
    if (audit.decision !== "uploaded" || audit.snapId === null) continue;
    if (!r2SnapIds.has(audit.snapId)) {
      violations.push({
        type: "audit_uploaded_without_r2_key",
        snapId: audit.snapId,
        details: {
          uploadAttemptId: audit.uploadAttemptId,
          auditDecisionId: audit.decisionId,
        },
      });
    }
  }

  // Axis 3: r2_key_with_restricted_source — Snapshot has r2_key but a linked
  // source is now policy-restricted (retroactive tightening).
  for (const snap of input.r2BackedSnapshots) {
    const restricted: Array<{ sourceId: string; archivePolicy: string; rawCloudPolicy: string }> = [];
    let hasUnregistered = false;
    for (const sourceId of snap.linkedSourceIds) {
      const policy = policyBySourceId.get(sourceId);
      if (!policy) {
        hasUnregistered = true;
        restricted.push({
          sourceId,
          archivePolicy: "<unregistered>",
          rawCloudPolicy: "<unregistered>",
        });
        continue;
      }
      if (
        policy.archivePolicy !== "full_snapshot_allowed" ||
        policy.rawCloudPolicy !== "allowed_public_data_only"
      ) {
        restricted.push({
          sourceId,
          archivePolicy: policy.archivePolicy,
          rawCloudPolicy: policy.rawCloudPolicy,
        });
      }
    }
    if (restricted.length > 0) {
      violations.push({
        type: "r2_key_with_restricted_source",
        snapId: snap.snapId,
        details: {
          r2Key: snap.r2Key,
          restrictedSources: restricted,
          hasUnregistered,
        },
      });
    }
  }

  // Axis 4 (AI-P1-13): r2_object_without_graph_key — every well-formed
  // 'set_r2_key_failed_neo4j' audit row indicates a confirmed orphan R2
  // object (r2Put succeeded, SET r2_key failed). The audit row's existence
  // IS the violation evidence — there is no extra cross-check against
  // r2SnapIds because, by construction of the audit lifecycle, Snapshot
  // r2_key was never set for these rows (and even if a later repair set
  // it, the orphan period still violated NFR-008 and should be reported
  // until the audit row is repaired or marked resolved by a future slice).
  for (const audit of input.r2UploadOutcomeAuditRows) {
    if (audit.decision !== "set_r2_key_failed_neo4j" || audit.snapId === null) continue;
    violations.push({
      type: "r2_object_without_graph_key",
      snapId: audit.snapId,
      details: {
        uploadAttemptId: audit.uploadAttemptId,
        auditDecisionId: audit.decisionId,
      },
    });
  }

  // Axis 5 (AI-P1-13): malformed_r2_upload_audit_row — rationale could not
  // be parsed for snap_id. Surfaced as violation rather than silently
  // dropped (pre-AI-P1-13 fetchUploadedAuditRows() dropped these, creating
  // a defensive blind spot). snapId field is set to a sentinel because
  // the row has no parseable snap_id; the audit decision_id is the
  // operator-actionable handle.
  for (const audit of input.r2UploadOutcomeAuditRows) {
    if (audit.snapId !== null) continue;
    violations.push({
      type: "malformed_r2_upload_audit_row",
      snapId: "<unparseable>",
      details: {
        decision: audit.decision,
        uploadAttemptId: audit.uploadAttemptId,
        auditDecisionId: audit.decisionId,
        rationalePrefix: audit.rationale.slice(0, 120),
      },
    });
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Top-level orchestrator
// ---------------------------------------------------------------------------

export async function scanR2Invariants(): Promise<ScanResult> {
  const [r2BackedSnapshots, r2UploadOutcomeAuditRows, sourcePolicies] = [
    await fetchR2BackedSnapshots(),
    fetchR2UploadOutcomeAuditRows(),
    fetchSourcePolicies(),
  ];

  const violations = reconcile({
    r2BackedSnapshots,
    r2UploadOutcomeAuditRows,
    sourcePolicies,
  });

  const uploadedCount = r2UploadOutcomeAuditRows.filter(
    (r) => r.decision === "uploaded" && r.snapId !== null
  ).length;
  const failedNeo4jCount = r2UploadOutcomeAuditRows.filter(
    (r) => r.decision === "set_r2_key_failed_neo4j" && r.snapId !== null
  ).length;
  const malformedCount = r2UploadOutcomeAuditRows.filter((r) => r.snapId === null).length;

  return {
    counts: {
      r2BackedSnapshots: r2BackedSnapshots.length,
      uploadedAuditRows: uploadedCount,
      setR2KeyFailedNeo4jAuditRows: failedNeo4jCount,
      malformedR2UploadAuditRows: malformedCount,
      sourcePolicyRows: sourcePolicies.length,
    },
    violations,
    aligned: violations.length === 0,
  };
}
