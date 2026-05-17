#!/usr/bin/env bun
/**
 * CLI: scan R2 ↔ policy ↔ audit ledger invariants (AI-P1-6,
 * OPS-1B.h1-runtime-invariant-scanner).
 *
 * Read-only — does NOT modify Neo4j / SQLite / R2. Exits 1 on any
 * violation (operator alert), 0 if aligned.
 *
 * Usage:
 *   bun run audit:r2-invariants
 *   bun run audit:r2-invariants --json   # machine-readable output
 *
 * Operator response per violation type:
 *
 *   r2_key_without_audit
 *     - Pre-v7 historical Snapshot: informational. Optionally backfill an
 *       audit row marker (separate slice).
 *     - Post-v7 Snapshot: NFR-008 invariant break. Investigate the audit
 *       hook for the corresponding r2Put call site (snapshot-fingerprint).
 *
 *   audit_uploaded_without_r2_key
 *     - decision='uploaded' implies BOTH r2Put AND Neo4j SET succeeded
 *       (per the snapshot-fingerprint.ts ternary; SET failures and
 *       skipped_toctou outcomes emit separate rows classified by
 *       r2_object_without_graph_key_set_failed and
 *       r2_object_without_graph_key_policy_recheck_skipped below).
 *       Most likely cause: Snapshot was DETACH DELETE'd while r2
 *       retained the object — manual r2 cleanup required.
 *
 *   r2_key_with_restricted_source
 *     - Operator tightened source_material_policy AFTER the upload.
 *       Required: r2 object removal (separate slice — repair CLI) or
 *       source policy rollback to full_snapshot_allowed +
 *       allowed_public_data_only.
 *
 *   r2_object_without_graph_key_set_failed (Axis 4 — AI-P1-13, Cycle 8 rename)
 *     - decision='set_r2_key_failed_neo4j' audit row — r2Put succeeded
 *       but the subsequent Cypher SET s.r2_key failed (network partition
 *       mid-tx, constraint violation, etc.). R2 object exists but graph
 *       never recorded the key. Required: either rerun the SET with
 *       `expectedR2Key` from violation details (recovery — preserves
 *       dedup) or remove the r2 object (cleanup). Both paths are
 *       repair-CLI scope.
 *
 *   r2_object_without_graph_key_policy_recheck_skipped (Axis 4b — Cycle 8)
 *     - decision='skipped_toctou' audit row — r2Put succeeded but the
 *       post-r2-put recheck found a now-restricted linked source and
 *       intentionally skipped SET to avoid INV-0012-3 violation. Same
 *       physical state as Axis 4 (R2 object exists + graph r2_key NULL)
 *       but DIFFERENT remediation: do NOT blindly rerun SET (would
 *       re-violate the post-recheck decision). Required: either r2
 *       object cleanup via repair-CLI, or source policy rollback if
 *       the recheck rejection was unintended. `expectedR2Key` in
 *       details points to the orphan object for cleanup.
 *
 *   malformed_r2_upload_audit_row (AI-P1-13)
 *     - r2_upload outcome row whose rationale does NOT start with
 *       `snap_id=snap_...;` canonical prefix. Pre-AI-P1-13 scanner
 *       silently dropped these (defensive blind spot). Required:
 *       investigate the audit ledger writer (recordR2UploadDecision)
 *       for a format regression, then either repair the row or update
 *       the parser regex.
 */

import { scanR2Invariants, type R2InvariantViolation } from "./r2-invariant-scanner";
import { closeDriver } from "../storage/neo4j/connection";
import { closeDb } from "../storage/sqlite/connection";

// ---------------------------------------------------------------------------
// Argv handling — fail-fast on unknown flags (Codex P2 pattern from PR #45)
// ---------------------------------------------------------------------------

export const KNOWN_FLAGS = new Set(["--json"]);
const USAGE = "Usage: bun run audit:r2-invariants [--json]";

export class UnknownArgumentError extends Error {
  constructor(public readonly unknown: ReadonlyArray<string>) {
    super(
      `Unknown argument(s): ${unknown.join(", ")}\n` +
        `Known flags: ${[...KNOWN_FLAGS].join(", ")}\n` +
        USAGE
    );
    this.name = "UnknownArgumentError";
  }
}

export interface ParsedArgs {
  json: boolean;
}

export function parseArgs(argv: ReadonlyArray<string>): ParsedArgs {
  const unknown = argv.filter((a) => !KNOWN_FLAGS.has(a));
  if (unknown.length > 0) throw new UnknownArgumentError(unknown);
  return { json: argv.includes("--json") };
}

// ---------------------------------------------------------------------------
// Human-readable violation formatting
// ---------------------------------------------------------------------------

function formatViolation(v: R2InvariantViolation): string {
  switch (v.type) {
    case "r2_key_without_audit": {
      const linked = (v.details.linkedSourceIds as string[]) ?? [];
      return (
        `  [r2_key_without_audit] snap_id=${v.snapId} r2_key=${v.details.r2Key} ` +
        `linked_sources=[${linked.join(", ") || "(none)"}]\n` +
        `    → Investigate: pre-v7 historical snapshot or audit-hook regression`
      );
    }
    case "audit_uploaded_without_r2_key":
      return (
        `  [audit_uploaded_without_r2_key] snap_id=${v.snapId} ` +
        `upload_attempt_id=${v.details.uploadAttemptId} audit_decision_id=${v.details.auditDecisionId}\n` +
        `    → decision='uploaded' implies r2Put + SET both succeeded; most likely cause is Snapshot DETACH DELETE while r2 retained the object — manual r2 cleanup required`
      );
    case "r2_key_with_restricted_source": {
      const restricted = (v.details.restrictedSources as Array<{ sourceId: string; archivePolicy: string; rawCloudPolicy: string }>) ?? [];
      const lines = restricted.map(
        (r) => `      - ${r.sourceId}: archive=${r.archivePolicy}, raw_cloud=${r.rawCloudPolicy}`
      );
      return (
        `  [r2_key_with_restricted_source] snap_id=${v.snapId} r2_key=${v.details.r2Key}\n` +
        `    Restricted linked sources (current policy state):\n${lines.join("\n")}\n` +
        `    → Required: r2 object removal (repair CLI, separate slice) or source policy rollback`
      );
    }
    case "r2_object_without_graph_key_set_failed":
      return (
        `  [r2_object_without_graph_key_set_failed] snap_id=${v.snapId} ` +
        `upload_attempt_id=${v.details.uploadAttemptId} audit_decision_id=${v.details.auditDecisionId}\n` +
        `    expected_r2_key=${v.details.expectedR2Key}\n` +
        `    → r2Put succeeded, Neo4j SET r2_key failed. Recovery: rerun SET with expected_r2_key (preserves dedup). ` +
        `Cleanup: delete r2 object at expected_r2_key. Both paths are repair-CLI scope.`
      );
    case "r2_object_without_graph_key_policy_recheck_skipped":
      return (
        `  [r2_object_without_graph_key_policy_recheck_skipped] snap_id=${v.snapId} ` +
        `upload_attempt_id=${v.details.uploadAttemptId} audit_decision_id=${v.details.auditDecisionId}\n` +
        `    expected_r2_key=${v.details.expectedR2Key}\n` +
        `    → r2Put succeeded, post-recheck rejected SET due to now-restricted linked source. ` +
        `Do NOT blindly rerun SET (would re-violate the recheck decision). ` +
        `Required: r2 object cleanup at expected_r2_key, OR source policy rollback if the recheck rejection was unintended.`
      );
    case "malformed_r2_upload_audit_row":
      return (
        `  [malformed_r2_upload_audit_row] audit_decision_id=${v.details.auditDecisionId} ` +
        `decision=${v.details.decision} upload_attempt_id=${v.details.uploadAttemptId}\n` +
        `    rationale_prefix="${v.details.rationalePrefix}"\n` +
        `    → Investigate recordR2UploadDecision format regression; repair audit row or update parser`
      );
    default: {
      // exhaustiveness check — TypeScript narrows v.type to never if all cases handled
      const _exhaustive: never = v.type;
      return `  [unknown violation type: ${String(_exhaustive)}] ${JSON.stringify(v)}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const result = await scanR2Invariants();

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return result.aligned ? 0 : 1;
  }

  console.log(
    `R2 invariant scan — counts: r2_backed_snapshots=${result.counts.r2BackedSnapshots}, ` +
      `uploaded_audit_rows=${result.counts.uploadedAuditRows}, ` +
      `set_r2_key_failed_neo4j_audit_rows=${result.counts.setR2KeyFailedNeo4jAuditRows}, ` +
      `skipped_toctou_audit_rows=${result.counts.skippedToctouAuditRows}, ` +
      `malformed_r2_upload_audit_rows=${result.counts.malformedR2UploadAuditRows}, ` +
      `source_policy_rows=${result.counts.sourcePolicyRows}`
  );
  if (result.aligned) {
    console.log("aligned ✓ (no violations)");
    return 0;
  }
  console.error(
    `\n${result.violations.length} violation(s) detected:\n`
  );
  for (const v of result.violations) {
    console.error(formatViolation(v));
  }
  console.error(
    "\nFull violation details (JSON): re-run with --json. " +
      "Read-only scan — no changes were made to Neo4j / SQLite / R2."
  );
  return 1;
}

async function run(): Promise<void> {
  let exitCode = 0;
  try {
    exitCode = await main();
  } catch (err) {
    console.error((err as Error).message);
    exitCode = 1;
  } finally {
    // Mirror seed-sources / process-queue CLI cleanup pattern.
    await closeDriver();
    closeDb();
  }
  process.exit(exitCode);
}

if (import.meta.main) {
  run();
}
