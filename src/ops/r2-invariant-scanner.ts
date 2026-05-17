// Runtime R2 invariant scanner — AI-P1-6 / OPS-1B.h1-runtime-invariant-scanner.
// Extended by AI-P1-13 / OPS-1B.h2-r2-invariant-scanner-orphan-axis.
// Cycle 8 / OPS-1B.h3-r2-orphan-axis-repairability: skipped_toctou axis split
// + cause-qualified naming for Axis 4 + expectedR2Key in violation details
// for direct operator-CLI / repair-CLI consumption.
// Cycle 9 / OPS-1B.h4-r2-audit-column-rationale-drift-axis: Axis 6 surfaces
// dual-write contract violations between v9 `snap_id` column and rationale
// prefix (recordR2UploadDecision dual-writes both atomically; divergence
// means manual SQL repair, writer format regression, or fixture/backfill
// touched only one side).
//
// Reconciles 3 stores against ADR-0012 INV-0012-3 + INV-0012-4 (permitted-
// artifact gate). Read-only scan — does NOT modify Neo4j / SQLite / R2.
//
// The 7 axes:
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
//   'set_r2_key_failed_neo4j' and 'skipped_toctou' cases are SEPARATE states
//   classified by Axis 4 / 4b below — AI-P1-6's original Axis 2 comment
//   incorrectly conflated all three.
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
// Axis 4: r2_object_without_graph_key_set_failed
//   (AI-P1-13, renamed Cycle 8 from `r2_object_without_graph_key` for
//   cause-qualified accuracy — see Axis 4b below for the sibling state.)
//   policy_decisions row decision='set_r2_key_failed_neo4j' — emitted by
//   snapshot-fingerprint.ts after r2Put succeeded but the subsequent
//   `SET s.r2_key` Cypher mutation failed (network partition mid-tx,
//   constraint violation, etc.). The R2 object EXISTS but the graph never
//   recorded its key. Operator remediation: either rerun the SET with the
//   `expectedR2Key` from the violation details (recovery, preserves dedup)
//   or delete the R2 object (cleanup). Both paths are repair-CLI scope.
//   The audit row's existence IS the violation evidence — Axis 4 does NOT
//   cross-check r2SnapIds because the audit lifecycle never set r2_key for
//   these rows; even if a later repair populates r2_key, the historical
//   orphan window violated NFR-008 and Axis 4 keeps reporting until the
//   audit row is acknowledged/resolved by a future repair-tracking slice.
//
// Axis 4b: r2_object_without_graph_key_policy_recheck_skipped
//   (Cycle 8 / OPS-1B.h3 new axis — closes the AI-P1-13 narrow-scope gap.)
//   policy_decisions row decision='skipped_toctou' — emitted by snapshot-
//   fingerprint.ts after r2Put succeeded but the post-r2-put recheck found
//   a now-restricted linked source (operator policy change mid-transaction)
//   and intentionally skipped the SET to avoid INV-0012-3 violation. The
//   physical state is identical to Axis 4 (R2 object exists + Snapshot
//   r2_key NULL), but the cause is graceful policy enforcement, not a
//   failed write. Operator remediation differs: do NOT blindly rerun SET
//   (it would violate the post-recheck decision); the correct action is
//   either R2 object cleanup (TTL or explicit delete via repair-CLI) or
//   source policy rollback (if the recheck rejection was unintended). Axis
//   4 vs 4b separation lets operators triage by intent — failed writes
//   are recoverable, policy-rejected uploads need a decision before cleanup.
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
// Axis 6: r2_audit_column_rationale_drift (Cycle 9 / OPS-1B.h4)
//   Both the v9 `snap_id` column AND the rationale prefix are well-formed
//   but carry DIFFERENT snap_id values. `recordR2UploadDecision` dual-
//   writes both atomically (Cycle 7 `assertValidSnapId` guarantees both
//   sides receive the same well-formed input). A divergence is an
//   explicit dual-write contract violation — likely causes: manual SQL
//   UPDATE / repair script that touched only one field, writer format
//   regression where `formatRationale()` diverges from the column write,
//   or fixture/backfill that populated one source. Without Axis 6 the
//   column-preferred resolution would silently mask the rationale
//   anomaly — v8- legacy consumers parsing rationale would see a
//   different snap_id than scanner. Axis 6 makes the dual-write contract
//   auditable. Triggers only when both raw sources are well-formed and
//   differ; canonical post-v9 happy paths (column populated + rationale
//   populated + same value, or column-only with arbitrary rationale, or
//   v8- legacy column-NULL + rationale-only) all stay silent.
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
  | "r2_object_without_graph_key_set_failed"
  | "r2_object_without_graph_key_policy_recheck_skipped"
  | "r2_audit_column_rationale_drift"
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
  /** policy_decisions rows with decision='skipped_toctou' (snap_id parsed) — Cycle 8 / OPS-1B.h3 */
  skippedToctouAuditRows: number;
  /** policy_decisions r2_upload outcome rows whose rationale failed to parse — AI-P1-13 */
  malformedR2UploadAuditRows: number;
  /** source_material_policy rows */
  sourcePolicyRows: number;
}

/**
 * Deterministic r2_key shape that snapshot-fingerprint.ts uses on r2Put
 * (see snapshot-fingerprint.ts:541 dedup back-fill + :722 new path). Mirrored
 * here so the scanner can emit a repair-actionable `expectedR2Key` in Axis
 * 4 / 4b violation details without forcing the operator / repair-CLI to
 * reconstruct the prefix manually.
 *
 * Single source of truth lives in src/storage/r2/policy.ts PERMITTED_PREFIXES
 * but copying the literal here keeps the scanner read-only with no cross-
 * module write/test dependency. Any change to the prefix on the writer side
 * MUST be mirrored here (and ideally enforced by a lint or co-test).
 */
const SNAPSHOT_R2_KEY_PREFIX = "permitted_artifact/derived/snapshot/";

function buildExpectedR2Key(snapId: string): string {
  return `${SNAPSHOT_R2_KEY_PREFIX}${snapId}`;
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

/**
 * r2_upload outcome row variants reconcile() routes to specific axes.
 *
 * - `uploaded`: full success (Axis 1/2 territory)
 * - `set_r2_key_failed_neo4j`: r2Put succeeded, SET r2_key failed (Axis 4)
 * - `skipped_toctou`: r2Put succeeded, post-recheck rejected SET (Axis 4b,
 *   Cycle 8 — split from Axis 4 for cause-qualified semantics)
 */
export type R2UploadOutcomeDecision =
  | "uploaded"
  | "set_r2_key_failed_neo4j"
  | "skipped_toctou";

export interface R2UploadOutcomeAuditRow {
  /**
   * Resolved snap_id via column-preferred + rationale fallback (AI-P1-15 +
   * Codex P2 round 1 `validSnapIdOrNull` shape guard). null when both
   * sources fail to yield a well-formed value — surfaced as
   * `malformed_r2_upload_audit_row` violation (Axis 5).
   */
  snapId: string | null;
  /**
   * Raw v9 `snap_id` column value after `validSnapIdOrNull()` shape guard
   * — null when column is NULL, empty, or malformed shape. Cycle 9
   * (OPS-1B.h4) exposes this alongside `rationaleSnapId` so reconcile()
   * can detect column ↔ rationale drift (Axis 6) — both fields preserved
   * even after `snapId` resolution to give the comparator both raw inputs.
   */
  columnSnapId: string | null;
  /**
   * snap_id parsed from rationale prefix. null when rationale is missing
   * or malformed. Cycle 9 surfaces the raw rationale parse result (not
   * the resolved fallback) so column-vs-rationale mismatch is visible
   * even when scanner uses the column value as the canonical resolution.
   */
  rationaleSnapId: string | null;
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
const SNAP_ID_SHAPE = /^snap_[A-Za-z0-9_-]+$/;

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
 * AI-P1-15 P2 (Codex PR #57): validate the v9 snap_id column value matches
 * the canonical `snap_<...>` shape before treating it as authoritative.
 *
 * Without this guard, a non-NULL but malformed value (empty string, manual
 * SQL corruption, format regression) would be silently used as the snap_id
 * and route the row into Axis 2/4 reconciliation with a garbage handle —
 * the row would no longer surface as `malformed_r2_upload_audit_row` and
 * could mis-classify under other axes. Empty/garbage values fall back to
 * rationale parsing (recoverable case); if rationale is also malformed
 * the row surfaces as Axis 5 (the defensive contract from AI-P1-13).
 */
export function validSnapIdOrNull(value: string | null): string | null {
  if (!value) return null;
  return SNAP_ID_SHAPE.test(value) ? value : null;
}

/**
 * AI-P1-13: fetches BOTH 'uploaded' and 'set_r2_key_failed_neo4j' outcome
 * rows so reconcile() can route them to Axis 2 vs Axis 4 respectively.
 * Pre-AI-P1-13 (`fetchUploadedAuditRows`) hardcoded decision='uploaded'
 * which made the most critical orphan state invariant break (R2 object
 * exists, graph never set r2_key) invisible to the scanner.
 *
 * AI-P1-15 (v9): also selects `snap_id` column. snapId resolution prefers
 * the column (structured handle) and falls back to rationale parsing for
 * legacy v8- rows where snap_id is NULL. Malformed rationale rows in v8-
 * legacy state are still RETURNED with snapId=null so reconcile() can
 * surface them as `malformed_r2_upload_audit_row`.
 */
export function fetchR2UploadOutcomeAuditRows(): R2UploadOutcomeAuditRow[] {
  const rows = getDb()
    .query<
      {
        rationale: string | null;
        upload_attempt_id: string | null;
        decision_id: string;
        decision: string;
        snap_id: string | null;
      },
      []
    >(
      `SELECT rationale, upload_attempt_id, decision_id, decision, snap_id
       FROM policy_decisions
       WHERE intended_action = 'r2_upload'
         AND decision IN ('uploaded', 'set_r2_key_failed_neo4j', 'skipped_toctou')`
    )
    .all();
  return rows.map((r) => {
    // AI-P1-15 + Codex PR #57 P2: column-preferred + rationale fallback +
    // shape guard. Cycle 9 (OPS-1B.h4) additionally exposes both raw
    // inputs (`columnSnapId`, `rationaleSnapId`) so reconcile() can detect
    // column ↔ rationale drift as a separate axis without losing the
    // resolved-value contract callers depend on.
    const columnSnapId = validSnapIdOrNull(r.snap_id);
    const rationaleSnapId = parseSnapIdFromRationale(r.rationale);
    return {
      snapId: columnSnapId ?? rationaleSnapId,
      columnSnapId,
      rationaleSnapId,
      uploadAttemptId: r.upload_attempt_id,
      rationale: r.rationale ?? "",
      decisionId: r.decision_id,
      decision: r.decision as R2UploadOutcomeDecision,
    };
  });
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

  // Axis 4 (AI-P1-13, renamed Cycle 8): r2_object_without_graph_key_set_failed.
  // Every well-formed 'set_r2_key_failed_neo4j' audit row indicates a
  // confirmed orphan R2 object (r2Put succeeded, SET r2_key failed). Audit
  // row's existence IS the evidence. Cycle 8 adds `expectedR2Key` to details
  // so repair-CLI / operator can recover or cleanup without manually
  // reconstructing the key from snap_id.
  for (const audit of input.r2UploadOutcomeAuditRows) {
    if (audit.decision !== "set_r2_key_failed_neo4j" || audit.snapId === null) continue;
    violations.push({
      type: "r2_object_without_graph_key_set_failed",
      snapId: audit.snapId,
      details: {
        uploadAttemptId: audit.uploadAttemptId,
        auditDecisionId: audit.decisionId,
        expectedR2Key: buildExpectedR2Key(audit.snapId),
      },
    });
  }

  // Axis 4b (Cycle 8 / OPS-1B.h3): r2_object_without_graph_key_policy_recheck_skipped.
  // 'skipped_toctou' audit row — r2Put succeeded, post-recheck rejected SET
  // due to a now-restricted linked source. Same physical state as Axis 4
  // (R2 object exists + graph r2_key NULL) but different remediation: do
  // NOT blindly rerun SET (it would re-violate the recheck decision). The
  // correct action is R2 object cleanup or source policy rollback.
  for (const audit of input.r2UploadOutcomeAuditRows) {
    if (audit.decision !== "skipped_toctou" || audit.snapId === null) continue;
    violations.push({
      type: "r2_object_without_graph_key_policy_recheck_skipped",
      snapId: audit.snapId,
      details: {
        uploadAttemptId: audit.uploadAttemptId,
        auditDecisionId: audit.decisionId,
        expectedR2Key: buildExpectedR2Key(audit.snapId),
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

  // Axis 6 (Cycle 9 / OPS-1B.h4): r2_audit_column_rationale_drift —
  // both v9 `snap_id` column and rationale prefix are well-formed but
  // carry DIFFERENT snap_id values. recordR2UploadDecision dual-writes
  // both fields atomically so a drift between them is an explicit
  // backward-compat contract violation:
  //   - manual SQL UPDATE / repair script that touched only one field
  //   - format regression in the writer (column ≠ formatRationale output)
  //   - test fixture / migration backfill that populated one source
  //
  // Without surfacing this, the column-preferred resolution would
  // silently mask the rationale anomaly — v8- legacy consumers parsing
  // rationale would see a different snap_id than scanner. Axis 6 makes
  // the dual-write contract auditable.
  //
  // Both NULL or both same: silent. Column-only well-formed (v9 happy
  // path, rationale could be anything since column takes precedence):
  // silent — this is the canonical post-v9 shape. Rationale-only well-
  // formed (v8- legacy row): silent — column is NULL by construction.
  // Both well-formed AND different: violation.
  for (const audit of input.r2UploadOutcomeAuditRows) {
    if (audit.columnSnapId === null || audit.rationaleSnapId === null) continue;
    if (audit.columnSnapId === audit.rationaleSnapId) continue;
    violations.push({
      type: "r2_audit_column_rationale_drift",
      // Use column value as canonical handle (existing column-preferred
      // resolution convention); details preserves both for operator
      // triage.
      snapId: audit.columnSnapId,
      details: {
        decision: audit.decision,
        uploadAttemptId: audit.uploadAttemptId,
        auditDecisionId: audit.decisionId,
        columnSnapId: audit.columnSnapId,
        rationaleSnapId: audit.rationaleSnapId,
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
  const skippedToctouCount = r2UploadOutcomeAuditRows.filter(
    (r) => r.decision === "skipped_toctou" && r.snapId !== null
  ).length;
  const malformedCount = r2UploadOutcomeAuditRows.filter((r) => r.snapId === null).length;

  return {
    counts: {
      r2BackedSnapshots: r2BackedSnapshots.length,
      uploadedAuditRows: uploadedCount,
      setR2KeyFailedNeo4jAuditRows: failedNeo4jCount,
      skippedToctouAuditRows: skippedToctouCount,
      malformedR2UploadAuditRows: malformedCount,
      sourcePolicyRows: sourcePolicies.length,
    },
    violations,
    aligned: violations.length === 0,
  };
}
