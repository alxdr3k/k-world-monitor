// Runtime R2 invariant scanner — AI-P1-6 / OPS-1B.h1-runtime-invariant-scanner.
//
// Reconciles 3 stores against ADR-0012 INV-0012-3 + INV-0012-4 (permitted-
// artifact gate). Read-only scan — does NOT modify Neo4j / SQLite / R2.
//
// The 3 axes:
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
//   Interpretation: audit claims a successful upload but the graph state
//   does not reflect it. Either set_r2_key_failed_neo4j happened (and the
//   subsequent 'set_r2_key_failed_neo4j' audit row exists — scanner can
//   distinguish), or the Snapshot was DETACH DELETE'd while r2 retained the
//   object (operator manual ops without audit-aware repair).
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
  | "r2_key_with_restricted_source";

export interface R2InvariantViolation {
  type: R2InvariantViolationType;
  snapId: string;
  /** Free-form details — type-specific (linked source_ids, r2_key, etc.). */
  details: Record<string, unknown>;
}

export interface ScanCounts {
  /** :Source-linked Snapshot nodes with r2_key IS NOT NULL */
  r2BackedSnapshots: number;
  /** policy_decisions rows with intended_action='r2_upload' AND decision='uploaded' */
  uploadedAuditRows: number;
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

export interface UploadedAuditRow {
  snapId: string;
  uploadAttemptId: string | null;
  rationale: string;
  decisionId: string;
}

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

export function fetchUploadedAuditRows(): UploadedAuditRow[] {
  const rows = getDb()
    .query<
      { rationale: string | null; upload_attempt_id: string | null; decision_id: string },
      []
    >(
      `SELECT rationale, upload_attempt_id, decision_id
       FROM policy_decisions
       WHERE intended_action = 'r2_upload' AND decision = 'uploaded'`
    )
    .all();
  return rows
    .map((r) => {
      const snapId = parseSnapIdFromRationale(r.rationale);
      if (!snapId) return null;
      return {
        snapId,
        uploadAttemptId: r.upload_attempt_id,
        rationale: r.rationale ?? "",
        decisionId: r.decision_id,
      };
    })
    .filter((r): r is UploadedAuditRow => r !== null);
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
  uploadedAuditRows: ReadonlyArray<UploadedAuditRow>;
  sourcePolicies: ReadonlyArray<SourcePolicy>;
}

export function reconcile(input: ReconcileInput): R2InvariantViolation[] {
  const auditSnapIds = new Set(input.uploadedAuditRows.map((r) => r.snapId));
  const r2SnapIds = new Set(input.r2BackedSnapshots.map((s) => s.snapId));
  const policyBySourceId = new Map(input.sourcePolicies.map((p) => [p.sourceId, p]));

  const violations: R2InvariantViolation[] = [];

  // Axis 1: r2_key_without_audit — Snapshot has r2_key but no uploaded audit row.
  for (const snap of input.r2BackedSnapshots) {
    if (!auditSnapIds.has(snap.snapId)) {
      violations.push({
        type: "r2_key_without_audit",
        snapId: snap.snapId,
        details: { r2Key: snap.r2Key, linkedSourceIds: snap.linkedSourceIds },
      });
    }
  }

  // Axis 2: audit_uploaded_without_r2_key — audit row claims upload but
  // Snapshot is missing or has r2_key=NULL.
  for (const audit of input.uploadedAuditRows) {
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

  return violations;
}

// ---------------------------------------------------------------------------
// Top-level orchestrator
// ---------------------------------------------------------------------------

export async function scanR2Invariants(): Promise<ScanResult> {
  const [r2BackedSnapshots, uploadedAuditRows, sourcePolicies] = [
    await fetchR2BackedSnapshots(),
    fetchUploadedAuditRows(),
    fetchSourcePolicies(),
  ];

  const violations = reconcile({
    r2BackedSnapshots,
    uploadedAuditRows,
    sourcePolicies,
  });

  return {
    counts: {
      r2BackedSnapshots: r2BackedSnapshots.length,
      uploadedAuditRows: uploadedAuditRows.length,
      sourcePolicyRows: sourcePolicies.length,
    },
    violations,
    aligned: violations.length === 0,
  };
}
