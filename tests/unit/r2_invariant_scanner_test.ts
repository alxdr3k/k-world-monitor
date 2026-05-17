/**
 * Unit tests for R2 invariant scanner (AI-P1-6, OPS-1B.h1-runtime-invariant-scanner).
 *
 * The scanner has 4 testable layers:
 *   1. `parseSnapIdFromRationale()` — pure parser
 *   2. `reconcile()` — pure 3-way set comparison
 *   3. `fetchUploadedAuditRows()` / `fetchSourcePolicies()` — SQLite query
 *   4. `fetchR2BackedSnapshots()` — Neo4j query (mocked)
 *
 * Tests focus on layers 1-2 (pure), with one integration test for layer 3.
 * The Neo4j-backed `scanR2Invariants()` top-level orchestrator is exercised
 * indirectly via the run-r2-invariants CLI tests below.
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import { createNeo4jMock } from "../test-helpers/neo4j-mock";

process.env["SQLITE_PATH"] = ":memory:";

// ---------------------------------------------------------------------------
// Neo4j mock — fetchR2BackedSnapshots issues a single query joining
// Snapshot → Document → Source. We register a handler that returns a
// configurable array of snapshots.
// ---------------------------------------------------------------------------

let neo4jR2BackedRows: Array<{ snapId: string; r2Key: string; linkedSourceIds: string[] }> = [];

const neo4j = createNeo4jMock();
function registerHandlers() {
  neo4j.session.on(/MATCH \(s:Snapshot\) WHERE s\.r2_key IS NOT NULL/, () => ({
    records: neo4jR2BackedRows.map((row) => ({
      get: (key: string) => {
        if (key === "snap_id") return row.snapId;
        if (key === "r2_key") return row.r2Key;
        if (key === "source_ids") return row.linkedSourceIds;
        return null;
      },
    })),
  }));
}
registerHandlers();

mock.module("../../src/storage/neo4j/connection", () => neo4j.module);

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { closeDb, getDb } from "../../src/storage/sqlite/connection";
import {
  parseSnapIdFromRationale,
  validSnapIdOrNull,
  reconcile,
  fetchUploadedAuditRows,
  fetchR2UploadOutcomeAuditRows,
  fetchSourcePolicies,
  fetchR2BackedSnapshots,
  scanR2Invariants,
  type R2BackedSnapshot,
  type R2UploadOutcomeAuditRow,
  type UploadedAuditRow,
  type SourcePolicy,
} from "../../src/ops/r2-invariant-scanner";

// ---------------------------------------------------------------------------
// SQLite setup
// ---------------------------------------------------------------------------

function setupDb() {
  closeDb();
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS source_material_policy (
      source_id            TEXT NOT NULL PRIMARY KEY,
      archive_policy       TEXT NOT NULL,
      raw_cloud_policy     TEXT NOT NULL,
      external_llm_policy  TEXT NOT NULL,
      checked_at           TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z'
    );
    CREATE TABLE IF NOT EXISTS policy_decisions (
      decision_id        TEXT PRIMARY KEY,
      source_id          TEXT,
      session_id         TEXT,
      url                TEXT,
      trigger_type       TEXT NOT NULL,
      policy_gate_mode   TEXT NOT NULL,
      decision           TEXT NOT NULL,
      rationale          TEXT,
      created_at         TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z',
      intended_action    TEXT,
      upload_attempt_id  TEXT,
      snap_id            TEXT
    );
  `);
  return db;
}

beforeEach(() => {
  neo4j.reset();
  registerHandlers();
  neo4jR2BackedRows = [];
  setupDb();
});

function insertPolicy(sourceId: string, archive: string, rawCloud: string): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO source_material_policy
       (source_id, archive_policy, raw_cloud_policy, external_llm_policy)
       VALUES (?, ?, ?, 'allowed')`
    )
    .run(sourceId, archive, rawCloud);
}

function insertAuditRow(
  decisionId: string,
  snapId: string,
  decision: string,
  uploadAttemptId: string | null = "uatt_test",
  intendedAction: string | null = "r2_upload"
): void {
  const rationale =
    `snap_id=${snapId}; archive_policy=full_snapshot_allowed; raw_cloud_policy=allowed_public_data_only`;
  getDb()
    .prepare(
      `INSERT INTO policy_decisions
       (decision_id, source_id, url, trigger_type, policy_gate_mode,
        decision, rationale, intended_action, upload_attempt_id)
       VALUES (?, 'src_x', 'https://example.com', 'r2_upload', 'batch_report',
               ?, ?, ?, ?)`
    )
    .run(decisionId, decision, rationale, intendedAction, uploadAttemptId);
}

// ---------------------------------------------------------------------------
// parseSnapIdFromRationale — pure parser
// ---------------------------------------------------------------------------

describe("parseSnapIdFromRationale", () => {
  it("extracts snap_id from canonical recordR2UploadDecision prefix", () => {
    expect(
      parseSnapIdFromRationale(
        "snap_id=snap_01ABCDEF; archive_policy=full_snapshot_allowed; raw_cloud_policy=allowed_public_data_only"
      )
    ).toBe("snap_01ABCDEF");
  });

  it("extracts when rationale has appended detail", () => {
    expect(
      parseSnapIdFromRationale(
        "snap_id=snap_XYZ; archive_policy=full_snapshot_allowed; raw_cloud_policy=allowed_public_data_only; dedup back-fill path"
      )
    ).toBe("snap_XYZ");
  });

  it("returns null for empty / null rationale", () => {
    expect(parseSnapIdFromRationale(null)).toBeNull();
    expect(parseSnapIdFromRationale("")).toBeNull();
  });

  it("returns null when snap_id prefix is missing", () => {
    expect(parseSnapIdFromRationale("no_anchor_here; archive_policy=x")).toBeNull();
  });

  it("returns null when prefix does not start at position 0 (defends against rationale injection)", () => {
    expect(
      parseSnapIdFromRationale("prefix snap_id=snap_X; ...")
    ).toBeNull();
  });

  // Cycle 10 (INFRA-1B.3.h7-gate-evidence-hardening): delimiter-anchored
  // regex. Pre-Cycle-10 the regex `^snap_id=(snap_[A-Za-z0-9_-]+)` allowed
  // JS partial match — an invalid trailing character (`@`, `.`, `/`, `=`)
  // would end the character-class match silently and yield the prefix.
  // That misclassified malformed rationale rows as valid (Axis 5 silent)
  // AND fed truncated values into Axis 6 drift detection (wrong reason
  // for the drift). recordR2UploadDecision always emits `snap_id=<id>;`
  // so the delimiter lookahead `(?=;|$)` makes invalid trailing chars
  // fall through to null (→ Axis 5 fires).

  it("returns null when snap_id is followed by invalid char @ (no delimiter)", () => {
    expect(parseSnapIdFromRationale("snap_id=snap_A@bad; ...")).toBeNull();
  });

  it("returns null when snap_id is followed by invalid char . (no delimiter)", () => {
    expect(parseSnapIdFromRationale("snap_id=snap_A.foo; ...")).toBeNull();
  });

  it("returns null when snap_id is followed by invalid char / (no delimiter)", () => {
    expect(parseSnapIdFromRationale("snap_id=snap_A/evil; ...")).toBeNull();
  });

  it("returns null when snap_id is followed by invalid char = (no delimiter)", () => {
    expect(parseSnapIdFromRationale("snap_id=snap_A=evil; ...")).toBeNull();
  });

  it("returns null when snap_id is followed by whitespace without semicolon", () => {
    // Whitespace between snap_id and next field is also invalid per
    // recordR2UploadDecision contract (which uses "; " as the canonical
    // separator — the `;` is mandatory).
    expect(parseSnapIdFromRationale("snap_id=snap_A archive_policy=x")).toBeNull();
  });

  it("accepts snap_id at end-of-string (no trailing semicolon, but no invalid char either)", () => {
    // Edge case: rationale that is *only* the snap_id field. The lookahead
    // permits `$` so this still extracts. Defensive: this is the rare
    // case where rationale has no follow-on fields.
    expect(parseSnapIdFromRationale("snap_id=snap_LONE")).toBe("snap_LONE");
  });

  it("accepts canonical snap_id followed by ; delimiter (writer happy path)", () => {
    expect(parseSnapIdFromRationale("snap_id=snap_A; archive_policy=x")).toBe(
      "snap_A"
    );
  });
});

// ---------------------------------------------------------------------------
// reconcile — pure 3-way set comparison
// ---------------------------------------------------------------------------

describe("reconcile — aligned state", () => {
  it("returns no violations when all 3 axes agree", () => {
    const snapshots: R2BackedSnapshot[] = [
      { snapId: "snap_A", r2Key: "permitted_artifact/derived/snapshot/snap_A", linkedSourceIds: ["src_A"] },
    ];
    const audits: UploadedAuditRow[] = [
      { snapId: "snap_A", columnSnapId: "snap_A", rationaleSnapId: "snap_A", uploadAttemptId: "uatt_1", rationale: "", decisionId: "pdec_1", decision: "uploaded" as const },
    ];
    const policies: SourcePolicy[] = [
      { sourceId: "src_A", archivePolicy: "full_snapshot_allowed", rawCloudPolicy: "allowed_public_data_only" },
    ];
    expect(
      reconcile({ r2BackedSnapshots: snapshots, r2UploadOutcomeAuditRows: audits, sourcePolicies: policies })
    ).toEqual([]);
  });

  it("returns no violations for empty inputs (degenerate baseline)", () => {
    expect(
      reconcile({ r2BackedSnapshots: [], r2UploadOutcomeAuditRows: [], sourcePolicies: [] })
    ).toEqual([]);
  });
});

describe("reconcile — Axis 1: r2_key_without_audit", () => {
  it("flags Snapshot with r2_key but no matching uploaded audit row", () => {
    const snapshots: R2BackedSnapshot[] = [
      { snapId: "snap_ORPHAN_R2", r2Key: "permitted_artifact/derived/snapshot/snap_ORPHAN_R2", linkedSourceIds: ["src_A"] },
    ];
    const audits: UploadedAuditRow[] = []; // no audit row
    const policies: SourcePolicy[] = [
      { sourceId: "src_A", archivePolicy: "full_snapshot_allowed", rawCloudPolicy: "allowed_public_data_only" },
    ];
    const violations = reconcile({ r2BackedSnapshots: snapshots, r2UploadOutcomeAuditRows: audits, sourcePolicies: policies });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      type: "r2_key_without_audit",
      snapId: "snap_ORPHAN_R2",
    });
    expect(violations[0]!.details.r2Key).toBe("permitted_artifact/derived/snapshot/snap_ORPHAN_R2");
    expect(violations[0]!.details.linkedSourceIds).toEqual(["src_A"]);
  });

  it("does NOT flag when an audit row exists for the same snap_id", () => {
    const snapshots: R2BackedSnapshot[] = [
      { snapId: "snap_A", r2Key: "k1", linkedSourceIds: ["src_A"] },
    ];
    const audits: UploadedAuditRow[] = [
      { snapId: "snap_A", columnSnapId: "snap_A", rationaleSnapId: "snap_A", uploadAttemptId: "uatt_1", rationale: "", decisionId: "pdec_1", decision: "uploaded" as const },
    ];
    const policies: SourcePolicy[] = [
      { sourceId: "src_A", archivePolicy: "full_snapshot_allowed", rawCloudPolicy: "allowed_public_data_only" },
    ];
    const violations = reconcile({ r2BackedSnapshots: snapshots, r2UploadOutcomeAuditRows: audits, sourcePolicies: policies });
    expect(violations).toHaveLength(0);
  });
});

describe("reconcile — Axis 2: audit_uploaded_without_r2_key", () => {
  it("flags uploaded audit row without matching r2-backed Snapshot", () => {
    const snapshots: R2BackedSnapshot[] = []; // no r2-backed snapshot
    const audits: UploadedAuditRow[] = [
      { snapId: "snap_GHOST", columnSnapId: "snap_GHOST", rationaleSnapId: "snap_GHOST", uploadAttemptId: "uatt_ghost", rationale: "", decisionId: "pdec_ghost", decision: "uploaded" as const },
    ];
    const policies: SourcePolicy[] = [];
    const violations = reconcile({ r2BackedSnapshots: snapshots, r2UploadOutcomeAuditRows: audits, sourcePolicies: policies });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      type: "audit_uploaded_without_r2_key",
      snapId: "snap_GHOST",
    });
    expect(violations[0]!.details.uploadAttemptId).toBe("uatt_ghost");
    expect(violations[0]!.details.auditDecisionId).toBe("pdec_ghost");
  });
});

describe("reconcile — Axis 3: r2_key_with_restricted_source", () => {
  it("flags Snapshot with r2_key linked to a now-restricted source (retroactive tightening)", () => {
    const snapshots: R2BackedSnapshot[] = [
      { snapId: "snap_RESTRICTED", r2Key: "k1", linkedSourceIds: ["src_TIGHTENED"] },
    ];
    const audits: UploadedAuditRow[] = [
      { snapId: "snap_RESTRICTED", columnSnapId: "snap_RESTRICTED", rationaleSnapId: "snap_RESTRICTED", uploadAttemptId: "uatt_1", rationale: "", decisionId: "pdec_1", decision: "uploaded" as const },
    ];
    const policies: SourcePolicy[] = [
      // src_TIGHTENED was operator-changed to metadata_only AFTER the upload.
      { sourceId: "src_TIGHTENED", archivePolicy: "metadata_only", rawCloudPolicy: "allowed_public_data_only" },
    ];
    const violations = reconcile({ r2BackedSnapshots: snapshots, r2UploadOutcomeAuditRows: audits, sourcePolicies: policies });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ type: "r2_key_with_restricted_source", snapId: "snap_RESTRICTED" });
    const restricted = violations[0]!.details.restrictedSources as Array<{ sourceId: string; archivePolicy: string; rawCloudPolicy: string }>;
    expect(restricted).toHaveLength(1);
    expect(restricted[0]).toEqual({
      sourceId: "src_TIGHTENED",
      archivePolicy: "metadata_only",
      rawCloudPolicy: "allowed_public_data_only",
    });
  });

  it("flags when raw_cloud_policy was tightened to always_prohibited", () => {
    const snapshots: R2BackedSnapshot[] = [
      { snapId: "snap_X", r2Key: "k1", linkedSourceIds: ["src_X"] },
    ];
    const audits: UploadedAuditRow[] = [
      { snapId: "snap_X", columnSnapId: "snap_X", rationaleSnapId: "snap_X", uploadAttemptId: "uatt_1", rationale: "", decisionId: "pdec_1", decision: "uploaded" as const },
    ];
    const policies: SourcePolicy[] = [
      { sourceId: "src_X", archivePolicy: "full_snapshot_allowed", rawCloudPolicy: "always_prohibited" },
    ];
    const violations = reconcile({ r2BackedSnapshots: snapshots, r2UploadOutcomeAuditRows: audits, sourcePolicies: policies });
    expect(violations).toHaveLength(1);
    expect(violations[0]!.type).toBe("r2_key_with_restricted_source");
  });

  it("flags unregistered source (source_material_policy row missing) as restricted with hasUnregistered=true", () => {
    const snapshots: R2BackedSnapshot[] = [
      { snapId: "snap_UNREG", r2Key: "k1", linkedSourceIds: ["src_DELETED"] },
    ];
    const audits: UploadedAuditRow[] = [
      { snapId: "snap_UNREG", columnSnapId: "snap_UNREG", rationaleSnapId: "snap_UNREG", uploadAttemptId: "uatt_1", rationale: "", decisionId: "pdec_1", decision: "uploaded" as const },
    ];
    const policies: SourcePolicy[] = []; // src_DELETED row was operator-removed
    const violations = reconcile({ r2BackedSnapshots: snapshots, r2UploadOutcomeAuditRows: audits, sourcePolicies: policies });
    expect(violations).toHaveLength(1);
    expect(violations[0]!.details.hasUnregistered).toBe(true);
    const restricted = violations[0]!.details.restrictedSources as Array<{ sourceId: string; archivePolicy: string }>;
    expect(restricted[0]!.archivePolicy).toBe("<unregistered>");
  });

  it("does NOT flag Snapshot with no linked sources (graph orphan — different axis)", () => {
    // A Snapshot.r2_key set with linkedSourceIds=[] passes Axis 3 because
    // there's no source TO be restricted. Axis 1 (audit) catches the
    // legitimate concern that this Snapshot has no provenance trail.
    const snapshots: R2BackedSnapshot[] = [
      { snapId: "snap_NOLINK", r2Key: "k1", linkedSourceIds: [] },
    ];
    const audits: UploadedAuditRow[] = [
      { snapId: "snap_NOLINK", columnSnapId: "snap_NOLINK", rationaleSnapId: "snap_NOLINK", uploadAttemptId: "uatt_1", rationale: "", decisionId: "pdec_1", decision: "uploaded" as const },
    ];
    const policies: SourcePolicy[] = [];
    const violations = reconcile({ r2BackedSnapshots: snapshots, r2UploadOutcomeAuditRows: audits, sourcePolicies: policies });
    // Axis 3 violations specifically — no source to check, so axis 3 is silent.
    const axis3 = violations.filter((v) => v.type === "r2_key_with_restricted_source");
    expect(axis3).toHaveLength(0);
  });
});

describe("reconcile — combined violations", () => {
  it("reports all 3 axes when separate snapshots trip each", () => {
    const snapshots: R2BackedSnapshot[] = [
      { snapId: "snap_ORPHAN", r2Key: "k1", linkedSourceIds: ["src_A"] }, // → axis 1
      { snapId: "snap_RESTRICTED", r2Key: "k2", linkedSourceIds: ["src_B"] }, // → axis 3
    ];
    const audits: UploadedAuditRow[] = [
      { snapId: "snap_GHOST", columnSnapId: "snap_GHOST", rationaleSnapId: "snap_GHOST", uploadAttemptId: "uatt_g", rationale: "", decisionId: "pdec_g", decision: "uploaded" as const }, // → axis 2
      { snapId: "snap_RESTRICTED", columnSnapId: "snap_RESTRICTED", rationaleSnapId: "snap_RESTRICTED", uploadAttemptId: "uatt_r", rationale: "", decisionId: "pdec_r", decision: "uploaded" as const },
    ];
    const policies: SourcePolicy[] = [
      { sourceId: "src_A", archivePolicy: "full_snapshot_allowed", rawCloudPolicy: "allowed_public_data_only" },
      { sourceId: "src_B", archivePolicy: "metadata_only", rawCloudPolicy: "allowed_public_data_only" },
    ];
    const violations = reconcile({ r2BackedSnapshots: snapshots, r2UploadOutcomeAuditRows: audits, sourcePolicies: policies });
    expect(violations.map((v) => v.type).sort()).toEqual([
      "audit_uploaded_without_r2_key",
      "r2_key_with_restricted_source",
      "r2_key_without_audit",
    ]);
  });
});

// ---------------------------------------------------------------------------
// fetchUploadedAuditRows — SQLite integration
// ---------------------------------------------------------------------------

describe("fetchUploadedAuditRows — SQLite query layer", () => {
  it("returns only rows with intended_action='r2_upload' AND decision='uploaded'", () => {
    insertAuditRow("pdec_1", "snap_A", "uploaded");
    insertAuditRow("pdec_2", "snap_B", "attempted"); // wrong decision
    insertAuditRow("pdec_3", "snap_C", "skipped_toctou"); // wrong decision
    insertAuditRow("pdec_4", "snap_D", "uploaded", "uatt_x", null); // wrong intended_action
    const rows = fetchUploadedAuditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.snapId).toBe("snap_A");
    expect(rows[0]!.decisionId).toBe("pdec_1");
  });

  it("returns upload_attempt_id verbatim (v8 correlation key, AI-P1-7)", () => {
    insertAuditRow("pdec_uatt", "snap_X", "uploaded", "uatt_known_value_123");
    const rows = fetchUploadedAuditRows();
    expect(rows[0]!.uploadAttemptId).toBe("uatt_known_value_123");
  });

  it("skips rows with malformed rationale (snap_id not parseable)", () => {
    getDb()
      .prepare(
        `INSERT INTO policy_decisions
         (decision_id, source_id, url, trigger_type, policy_gate_mode,
          decision, rationale, intended_action, upload_attempt_id)
         VALUES ('pdec_malformed', 'src_x', 'https://x.com', 'r2_upload',
                 'batch_report', 'uploaded', 'no_snap_id_here', 'r2_upload', 'uatt_x')`
      )
      .run();
    const rows = fetchUploadedAuditRows();
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// fetchSourcePolicies — SQLite integration
// ---------------------------------------------------------------------------

describe("fetchSourcePolicies — SQLite query layer", () => {
  it("returns all rows verbatim", () => {
    insertPolicy("src_A", "full_snapshot_allowed", "allowed_public_data_only");
    insertPolicy("src_B", "metadata_only", "always_prohibited");
    const policies = fetchSourcePolicies();
    expect(policies).toHaveLength(2);
    const byId = new Map(policies.map((p) => [p.sourceId, p]));
    expect(byId.get("src_A")?.archivePolicy).toBe("full_snapshot_allowed");
    expect(byId.get("src_B")?.archivePolicy).toBe("metadata_only");
    expect(byId.get("src_B")?.rawCloudPolicy).toBe("always_prohibited");
  });

  it("returns empty array for empty table", () => {
    expect(fetchSourcePolicies()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// fetchR2BackedSnapshots — Neo4j integration (mocked)
// ---------------------------------------------------------------------------

describe("fetchR2BackedSnapshots — Neo4j query layer", () => {
  it("returns parsed records from the mock", async () => {
    neo4jR2BackedRows = [
      { snapId: "snap_A", r2Key: "k1", linkedSourceIds: ["src_1", "src_2"] },
      { snapId: "snap_B", r2Key: "k2", linkedSourceIds: [] },
    ];
    const result = await fetchR2BackedSnapshots();
    expect(result).toHaveLength(2);
    expect(result[0]!.snapId).toBe("snap_A");
    expect(result[0]!.linkedSourceIds).toEqual(["src_1", "src_2"]);
    expect(result[1]!.linkedSourceIds).toEqual([]);
  });

  it("filters out null source_ids from OPTIONAL MATCH no-rows case", async () => {
    // OPTIONAL MATCH with no joined sources returns [null] in some Neo4j
    // driver versions. The fetcher filters those out.
    neo4jR2BackedRows = [
      { snapId: "snap_X", r2Key: "k1", linkedSourceIds: [null as unknown as string] },
    ];
    const result = await fetchR2BackedSnapshots();
    expect(result[0]!.linkedSourceIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// scanR2Invariants — top-level orchestrator (Neo4j + SQLite integration)
// ---------------------------------------------------------------------------

describe("scanR2Invariants — orchestrator", () => {
  it("aligned=true when 3-way state matches", async () => {
    neo4jR2BackedRows = [
      { snapId: "snap_A", r2Key: "k1", linkedSourceIds: ["src_A"] },
    ];
    insertAuditRow("pdec_1", "snap_A", "uploaded", "uatt_1");
    insertPolicy("src_A", "full_snapshot_allowed", "allowed_public_data_only");

    const result = await scanR2Invariants();
    expect(result.aligned).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.counts).toEqual({
      r2BackedSnapshots: 1,
      uploadedAuditRows: 1,
      setR2KeyFailedNeo4jAuditRows: 0,
      skippedToctouAuditRows: 0,
      malformedR2UploadAuditRows: 0,
      sourcePolicyRows: 1,
    });
  });

  it("aligned=false when retroactive policy tightening creates Axis 3 violation", async () => {
    neo4jR2BackedRows = [
      { snapId: "snap_T", r2Key: "k1", linkedSourceIds: ["src_T"] },
    ];
    insertAuditRow("pdec_T", "snap_T", "uploaded", "uatt_T");
    insertPolicy("src_T", "metadata_only", "allowed_public_data_only"); // tightened

    const result = await scanR2Invariants();
    expect(result.aligned).toBe(false);
    expect(result.violations.map((v) => v.type)).toEqual(["r2_key_with_restricted_source"]);
  });
});

// ---------------------------------------------------------------------------
// AI-P1-13 / OPS-1B.h2-r2-invariant-scanner-orphan-axis
//
// Pre-AI-P1-13 the scanner had a P1 gate-blocker blind spot:
//   - `fetchUploadedAuditRows()` hardcoded decision='uploaded', so audit rows
//     with decision='set_r2_key_failed_neo4j' were invisible. Combined with
//     `fetchR2BackedSnapshots()` filtering to r2_key IS NOT NULL, this made
//     the most critical orphan state (R2 object exists, graph Snapshot.r2_key
//     is NULL) invisible to all 3 original axes.
//   - `parseSnapIdFromRationale()` returning null caused silent drop in the
//     fetcher, so malformed audit rows were invisible to reconciliation.
//
// AI-P1-13 adds:
//   - `fetchR2UploadOutcomeAuditRows()` covering both decision types and
//     returning malformed rows with snapId=null (NOT dropped).
//   - Axis 4: r2_object_without_graph_key (from set_r2_key_failed_neo4j).
//   - Axis 5: malformed_r2_upload_audit_row (from snapId=null rows).
//   - Backward-compat: `fetchUploadedAuditRows()` retained as a wrapper that
//     filters to well-formed decision='uploaded' rows (pre-AI-P1-13 semantic).
// ---------------------------------------------------------------------------

describe("fetchR2UploadOutcomeAuditRows — SQLite query layer (AI-P1-13 + Cycle 8 skipped_toctou expansion)", () => {
  it("returns rows with decision IN ('uploaded', 'set_r2_key_failed_neo4j', 'skipped_toctou') — Cycle 8 broadens AI-P1-13 fetch to cover Axis 4b", () => {
    insertAuditRow("pdec_up", "snap_U", "uploaded");
    insertAuditRow("pdec_fail", "snap_F", "set_r2_key_failed_neo4j");
    insertAuditRow("pdec_toc", "snap_T", "skipped_toctou"); // Cycle 8 — now included (Axis 4b)
    insertAuditRow("pdec_att", "snap_A", "attempted"); // wrong decision — still excluded (BEFORE row, not outcome)
    insertAuditRow("pdec_other", "snap_O", "uploaded", "uatt_x", null); // wrong intended_action — still excluded

    const rows = fetchR2UploadOutcomeAuditRows();
    expect(rows).toHaveLength(3);
    const decisionsByDecisionId = new Map(rows.map((r) => [r.decisionId, r.decision]));
    expect(decisionsByDecisionId.get("pdec_up")).toBe("uploaded");
    expect(decisionsByDecisionId.get("pdec_fail")).toBe("set_r2_key_failed_neo4j");
    expect(decisionsByDecisionId.get("pdec_toc")).toBe("skipped_toctou");
  });

  it("returns malformed rows with snapId=null (AI-P1-13 — NOT silently dropped)", () => {
    insertAuditRow("pdec_ok", "snap_OK", "uploaded");
    // raw INSERT bypassing the helper, since the helper assumes parseable snap_id
    getDb()
      .prepare(
        `INSERT INTO policy_decisions
         (decision_id, source_id, url, trigger_type, policy_gate_mode,
          decision, rationale, intended_action, upload_attempt_id)
         VALUES ('pdec_bad', 'src_x', 'https://x.com', 'r2_upload',
                 'batch_report', 'uploaded', 'no_snap_id_here_just_raw_text',
                 'r2_upload', 'uatt_x')`
      )
      .run();
    getDb()
      .prepare(
        `INSERT INTO policy_decisions
         (decision_id, source_id, url, trigger_type, policy_gate_mode,
          decision, rationale, intended_action, upload_attempt_id)
         VALUES ('pdec_bad_fail', 'src_x', 'https://x.com', 'r2_upload',
                 'batch_report', 'set_r2_key_failed_neo4j', 'no_snap_id_either',
                 'r2_upload', 'uatt_y')`
      )
      .run();

    const rows = fetchR2UploadOutcomeAuditRows();
    expect(rows).toHaveLength(3);
    const malformed = rows.filter((r) => r.snapId === null);
    expect(malformed).toHaveLength(2);
    // both decisions surface malformed
    expect(new Set(malformed.map((r) => r.decision))).toEqual(
      new Set<"uploaded" | "set_r2_key_failed_neo4j">(["uploaded", "set_r2_key_failed_neo4j"])
    );
  });

  it("backward-compat: fetchUploadedAuditRows still filters to decision='uploaded' + well-formed", () => {
    // Pre-AI-P1-13 behavior contract preserved for callers that imported the
    // narrower fetcher.
    insertAuditRow("pdec_up_ok", "snap_OK", "uploaded");
    insertAuditRow("pdec_fail_ok", "snap_F", "set_r2_key_failed_neo4j"); // excluded by wrapper
    getDb()
      .prepare(
        `INSERT INTO policy_decisions
         (decision_id, source_id, url, trigger_type, policy_gate_mode,
          decision, rationale, intended_action, upload_attempt_id)
         VALUES ('pdec_up_bad', 'src_x', 'https://x.com', 'r2_upload',
                 'batch_report', 'uploaded', 'malformed_rationale', 'r2_upload', 'uatt_z')`
      )
      .run();

    const rows = fetchUploadedAuditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.decisionId).toBe("pdec_up_ok");
    expect(rows[0]!.snapId).toBe("snap_OK");
  });
});

describe("reconcile — Axis 4: r2_object_without_graph_key_set_failed (AI-P1-13, renamed Cycle 8)", () => {
  it("flags set_r2_key_failed_neo4j audit row as R2 object orphan + emits expectedR2Key for repair", () => {
    const snapshots: R2BackedSnapshot[] = []; // R2 had bytes but graph never set r2_key
    const audits: R2UploadOutcomeAuditRow[] = [
      {
        snapId: "snap_ORPHAN_R2_OBJECT",
        columnSnapId: "snap_ORPHAN_R2_OBJECT",
        rationaleSnapId: "snap_ORPHAN_R2_OBJECT",
        uploadAttemptId: "uatt_orphan",
        rationale: "snap_id=snap_ORPHAN_R2_OBJECT; archive_policy=full_snapshot_allowed",
        decisionId: "pdec_failed_set",
        decision: "set_r2_key_failed_neo4j",
      },
    ];
    const policies: SourcePolicy[] = [];

    const violations = reconcile({
      r2BackedSnapshots: snapshots,
      r2UploadOutcomeAuditRows: audits,
      sourcePolicies: policies,
    });

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      type: "r2_object_without_graph_key_set_failed",
      snapId: "snap_ORPHAN_R2_OBJECT",
    });
    expect(violations[0]!.details.uploadAttemptId).toBe("uatt_orphan");
    expect(violations[0]!.details.auditDecisionId).toBe("pdec_failed_set");
    // Cycle 8: expectedR2Key for direct operator-CLI / repair-CLI consumption.
    expect(violations[0]!.details.expectedR2Key).toBe(
      "permitted_artifact/derived/snapshot/snap_ORPHAN_R2_OBJECT"
    );
  });

  it("set_r2_key_failed_neo4j fires Axis 4 even when Snapshot.r2_key was later somehow set (defensive)", () => {
    // The audit row's existence is the violation evidence; the orphan period
    // happened. Even if a future repair set r2_key, the historical orphan
    // window violated NFR-008 and should be reported until the audit row is
    // acknowledged/resolved by a future repair-CLI slice.
    const snapshots: R2BackedSnapshot[] = [
      { snapId: "snap_RECOVERED", r2Key: "k1", linkedSourceIds: ["src_A"] },
    ];
    const audits: R2UploadOutcomeAuditRow[] = [
      {
        snapId: "snap_RECOVERED",
        columnSnapId: "snap_RECOVERED",
        rationaleSnapId: "snap_RECOVERED",
        uploadAttemptId: "uatt_x",
        rationale: "snap_id=snap_RECOVERED; ...",
        decisionId: "pdec_failed_recovered",
        decision: "set_r2_key_failed_neo4j",
      },
    ];
    const policies: SourcePolicy[] = [
      { sourceId: "src_A", archivePolicy: "full_snapshot_allowed", rawCloudPolicy: "allowed_public_data_only" },
    ];

    const violations = reconcile({
      r2BackedSnapshots: snapshots,
      r2UploadOutcomeAuditRows: audits,
      sourcePolicies: policies,
    });

    // Axis 4 fires. Axis 1 also fires (no uploaded row for snap_RECOVERED).
    // Axis 2/3 do not.
    const types = violations.map((v) => v.type).sort();
    expect(types).toEqual([
      "r2_key_without_audit",
      "r2_object_without_graph_key_set_failed",
    ]);
  });

  it("does NOT flag uploaded rows (Axis 2 handles those)", () => {
    const snapshots: R2BackedSnapshot[] = []; // missing graph
    const audits: R2UploadOutcomeAuditRow[] = [
      {
        snapId: "snap_GHOST",
        columnSnapId: "snap_GHOST",
        rationaleSnapId: "snap_GHOST",
        uploadAttemptId: "uatt_g",
        rationale: "snap_id=snap_GHOST; ...",
        decisionId: "pdec_g",
        decision: "uploaded",
      },
    ];

    const violations = reconcile({
      r2BackedSnapshots: snapshots,
      r2UploadOutcomeAuditRows: audits,
      sourcePolicies: [],
    });

    // Axis 2 fires; Axis 4 silent (different decision type).
    expect(violations.map((v) => v.type)).toEqual(["audit_uploaded_without_r2_key"]);
  });

  it("does NOT flag skipped_toctou rows (Axis 4b handles those — Cycle 8 split)", () => {
    const snapshots: R2BackedSnapshot[] = [];
    const audits: R2UploadOutcomeAuditRow[] = [
      {
        snapId: "snap_SKIPPED",
        columnSnapId: "snap_SKIPPED",
        rationaleSnapId: "snap_SKIPPED",
        uploadAttemptId: "uatt_s",
        rationale: "snap_id=snap_SKIPPED; ...",
        decisionId: "pdec_s",
        decision: "skipped_toctou",
      },
    ];
    const violations = reconcile({
      r2BackedSnapshots: snapshots,
      r2UploadOutcomeAuditRows: audits,
      sourcePolicies: [],
    });
    const types = violations.map((v) => v.type);
    expect(types).not.toContain("r2_object_without_graph_key_set_failed");
    expect(types).toContain("r2_object_without_graph_key_policy_recheck_skipped");
  });
});

describe("reconcile — Axis 4b: r2_object_without_graph_key_policy_recheck_skipped (Cycle 8 / OPS-1B.h3 new axis)", () => {
  // skipped_toctou physical state = R2 object exists + graph r2_key NULL.
  // Same orphan shape as Axis 4 but different cause (policy recheck rejection
  // vs failed write). Cycle 8 surfaces it as a distinct axis so operator
  // remediation can diverge — do NOT blindly rerun SET (would re-violate the
  // post-recheck decision); cleanup or source policy rollback required.

  it("flags skipped_toctou audit row + emits expectedR2Key for cleanup", () => {
    const audits: R2UploadOutcomeAuditRow[] = [
      {
        snapId: "snap_TOCTOU_ORPHAN",
        columnSnapId: "snap_TOCTOU_ORPHAN",
        rationaleSnapId: "snap_TOCTOU_ORPHAN",
        uploadAttemptId: "uatt_toctou",
        rationale: "snap_id=snap_TOCTOU_ORPHAN; ...",
        decisionId: "pdec_toctou",
        decision: "skipped_toctou",
      },
    ];

    const violations = reconcile({
      r2BackedSnapshots: [],
      r2UploadOutcomeAuditRows: audits,
      sourcePolicies: [],
    });

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      type: "r2_object_without_graph_key_policy_recheck_skipped",
      snapId: "snap_TOCTOU_ORPHAN",
    });
    expect(violations[0]!.details.expectedR2Key).toBe(
      "permitted_artifact/derived/snapshot/snap_TOCTOU_ORPHAN"
    );
    expect(violations[0]!.details.uploadAttemptId).toBe("uatt_toctou");
    expect(violations[0]!.details.auditDecisionId).toBe("pdec_toctou");
  });

  it("does NOT flag set_r2_key_failed_neo4j rows (Axis 4 handles those)", () => {
    const audits: R2UploadOutcomeAuditRow[] = [
      {
        snapId: "snap_FAILED",
        columnSnapId: "snap_FAILED",
        rationaleSnapId: "snap_FAILED",
        uploadAttemptId: "uatt_f",
        rationale: "snap_id=snap_FAILED; ...",
        decisionId: "pdec_f",
        decision: "set_r2_key_failed_neo4j",
      },
    ];
    const violations = reconcile({
      r2BackedSnapshots: [],
      r2UploadOutcomeAuditRows: audits,
      sourcePolicies: [],
    });
    const types = violations.map((v) => v.type);
    expect(types).not.toContain("r2_object_without_graph_key_policy_recheck_skipped");
    expect(types).toContain("r2_object_without_graph_key_set_failed");
  });

  it("malformed skipped_toctou rationale → Axis 5 only (not Axis 4b — snap_id null)", () => {
    const audits: R2UploadOutcomeAuditRow[] = [
      {
        snapId: null,
        columnSnapId: null,
        rationaleSnapId: null,
        uploadAttemptId: "uatt_bad_toc",
        rationale: "garbage_rationale_no_snap",
        decisionId: "pdec_bad_toc",
        decision: "skipped_toctou",
      },
    ];
    const violations = reconcile({
      r2BackedSnapshots: [],
      r2UploadOutcomeAuditRows: audits,
      sourcePolicies: [],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]!.type).toBe("malformed_r2_upload_audit_row");
    expect(violations[0]!.details.decision).toBe("skipped_toctou");
  });
});

describe("reconcile — Axis 5: malformed_r2_upload_audit_row (AI-P1-13)", () => {
  it("flags malformed uploaded row (snapId=null) — defensive surfacing, not silent drop", () => {
    const audits: R2UploadOutcomeAuditRow[] = [
      {
        snapId: null,
        columnSnapId: null,
        rationaleSnapId: null,
        uploadAttemptId: "uatt_bad",
        rationale: "no_snap_id_here_at_all",
        decisionId: "pdec_malformed_up",
        decision: "uploaded",
      },
    ];

    const violations = reconcile({
      r2BackedSnapshots: [],
      r2UploadOutcomeAuditRows: audits,
      sourcePolicies: [],
    });

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      type: "malformed_r2_upload_audit_row",
      snapId: "<unparseable>",
    });
    expect(violations[0]!.details.decision).toBe("uploaded");
    expect(violations[0]!.details.auditDecisionId).toBe("pdec_malformed_up");
    expect(violations[0]!.details.rationalePrefix).toBe("no_snap_id_here_at_all");
  });

  it("flags malformed set_r2_key_failed_neo4j row too (both decision types)", () => {
    const audits: R2UploadOutcomeAuditRow[] = [
      {
        snapId: null,
        columnSnapId: null,
        rationaleSnapId: null,
        uploadAttemptId: "uatt_bad_fail",
        rationale: "garbage_rationale_format",
        decisionId: "pdec_malformed_fail",
        decision: "set_r2_key_failed_neo4j",
      },
    ];

    const violations = reconcile({
      r2BackedSnapshots: [],
      r2UploadOutcomeAuditRows: audits,
      sourcePolicies: [],
    });

    // Axis 5 fires regardless of decision type. Axis 4 silent because
    // snapId is null (orphan classification requires a parseable snap_id).
    expect(violations).toHaveLength(1);
    expect(violations[0]!.type).toBe("malformed_r2_upload_audit_row");
    expect(violations[0]!.details.decision).toBe("set_r2_key_failed_neo4j");
  });

  it("truncates long rationale to 120 chars in details.rationalePrefix", () => {
    const longRationale = "X".repeat(500);
    const audits: R2UploadOutcomeAuditRow[] = [
      {
        snapId: null,
        columnSnapId: null,
        rationaleSnapId: null,
        uploadAttemptId: null,
        rationale: longRationale,
        decisionId: "pdec_long",
        decision: "uploaded",
      },
    ];

    const violations = reconcile({
      r2BackedSnapshots: [],
      r2UploadOutcomeAuditRows: audits,
      sourcePolicies: [],
    });

    expect((violations[0]!.details.rationalePrefix as string).length).toBe(120);
  });
});

describe("scanR2Invariants — orchestrator with Axis 4 / 4b / 5 (AI-P1-13 + Cycle 8)", () => {
  it("counts include skippedToctouAuditRows + violations include both orphan axes", async () => {
    neo4jR2BackedRows = [];
    insertAuditRow("pdec_up", "snap_U", "uploaded", "uatt_up");
    insertAuditRow("pdec_fail", "snap_F", "set_r2_key_failed_neo4j", "uatt_fail");
    insertAuditRow("pdec_toc", "snap_T", "skipped_toctou", "uatt_toc");
    // malformed: bypass helper
    getDb()
      .prepare(
        `INSERT INTO policy_decisions
         (decision_id, source_id, url, trigger_type, policy_gate_mode,
          decision, rationale, intended_action, upload_attempt_id)
         VALUES ('pdec_bad', 'src_x', 'https://x.com', 'r2_upload',
                 'batch_report', 'uploaded', 'malformed', 'r2_upload', 'uatt_bad')`
      )
      .run();

    const result = await scanR2Invariants();

    expect(result.counts.uploadedAuditRows).toBe(1); // well-formed uploaded only
    expect(result.counts.setR2KeyFailedNeo4jAuditRows).toBe(1);
    expect(result.counts.skippedToctouAuditRows).toBe(1);
    expect(result.counts.malformedR2UploadAuditRows).toBe(1);

    // 4 violations: Axis 2 (uploaded ghost), Axis 4 (failed orphan),
    // Axis 4b (skipped_toctou orphan), Axis 5 (malformed)
    const types = result.violations.map((v) => v.type).sort();
    expect(types).toEqual([
      "audit_uploaded_without_r2_key",
      "malformed_r2_upload_audit_row",
      "r2_object_without_graph_key_policy_recheck_skipped",
      "r2_object_without_graph_key_set_failed",
    ]);
    expect(result.aligned).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AI-P1-15 / INFRA-1B.3.h5-policy-decisions-snap-id-column-v9
//
// v9 adds a first-class snap_id column to policy_decisions. New audit writes
// populate both the column and the rationale prefix. The scanner prefers the
// column and falls back to rationale parsing for legacy v8- rows.
// ---------------------------------------------------------------------------

describe("fetchR2UploadOutcomeAuditRows — v9 snap_id column resolution (AI-P1-15)", () => {
  function insertV9AuditRow(
    decisionId: string,
    snapId: string | null,
    rationaleSnapId: string | null,
    decision: string,
  ): void {
    const rationale = rationaleSnapId
      ? `snap_id=${rationaleSnapId}; archive_policy=full_snapshot_allowed; raw_cloud_policy=allowed_public_data_only`
      : "no_snap_id_prefix";
    getDb()
      .prepare(
        `INSERT INTO policy_decisions
         (decision_id, source_id, url, trigger_type, policy_gate_mode,
          decision, rationale, intended_action, upload_attempt_id, snap_id)
         VALUES (?, 'src_x', 'https://example.com', 'r2_upload', 'batch_report',
                 ?, ?, 'r2_upload', 'uatt_test', ?)`,
      )
      .run(decisionId, decision, rationale, snapId);
  }

  it("v9 row: snap_id resolved from the dedicated column (not rationale)", () => {
    // Column has snap_X, rationale prefix has snap_DIFFERENT — scanner must
    // use the column. This locks the column-preferred contract so a future
    // refactor that drops the column read cannot silently regress.
    insertV9AuditRow("pdec_v9_col", "snap_V9_FROM_COLUMN", "snap_DIFFERENT", "uploaded");

    const rows = fetchR2UploadOutcomeAuditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.snapId).toBe("snap_V9_FROM_COLUMN");
  });

  it("legacy v8- row: snap_id NULL → falls back to rationale parsing", () => {
    // No snap_id column value (legacy row from before v9 migration). The
    // scanner must keep the rationale-parsing fallback working so v8-
    // historical rows are still classified correctly.
    insertV9AuditRow("pdec_v8_legacy", null, "snap_V8_FROM_RATIONALE", "uploaded");

    const rows = fetchR2UploadOutcomeAuditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.snapId).toBe("snap_V8_FROM_RATIONALE");
  });

  it("legacy v8- row with malformed rationale: snapId=null → Axis 5 violation surface preserved", () => {
    // v8 silent-drop path that AI-P1-13 closed must remain working for
    // legacy rows that have neither column nor parseable rationale prefix.
    insertV9AuditRow("pdec_v8_bad", null, null, "uploaded");

    const rows = fetchR2UploadOutcomeAuditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.snapId).toBeNull();
  });

  it("mixed v8 legacy + v9 new rows: each resolves via its own path", () => {
    insertV9AuditRow("pdec_mix_v9", "snap_NEW", "snap_NEW", "uploaded");
    insertV9AuditRow("pdec_mix_v8", null, "snap_OLD", "uploaded");
    insertV9AuditRow("pdec_mix_bad", null, null, "set_r2_key_failed_neo4j");

    const rows = fetchR2UploadOutcomeAuditRows();
    expect(rows).toHaveLength(3);
    const byId = new Map(rows.map((r) => [r.decisionId, r.snapId]));
    expect(byId.get("pdec_mix_v9")).toBe("snap_NEW");
    expect(byId.get("pdec_mix_v8")).toBe("snap_OLD");
    expect(byId.get("pdec_mix_bad")).toBeNull();
  });

  // AI-P1-15 P2 (Codex PR #57): validSnapIdOrNull() guard. Pre-fix `r.snap_id
  // ?? parseSnapIdFromRationale(rationale)` accepted any non-NULL column value
  // (including empty string or manual SQL corruption) as canonical, so a
  // garbage column would route the row into Axis 2/4 with a malformed handle
  // instead of falling back to rationale or surfacing as Axis 5.

  it("validSnapIdOrNull: rejects empty string, garbage, plain non-prefix; accepts canonical", () => {
    expect(validSnapIdOrNull(null)).toBeNull();
    expect(validSnapIdOrNull("")).toBeNull();
    expect(validSnapIdOrNull("not_snap_prefix")).toBeNull();
    expect(validSnapIdOrNull("snap_")).toBeNull(); // prefix only, no ULID body
    expect(validSnapIdOrNull("snap_ABC123")).toBe("snap_ABC123");
    expect(validSnapIdOrNull("snap_01KRRR_with-dashes")).toBe("snap_01KRRR_with-dashes");
  });

  it("v9 row with empty-string column → falls back to rationale parsing (P2 fix)", () => {
    // Column has "" (a non-NULL but malformed value — e.g. manual SQL
    // INSERT mistake). Pre-P2 fix: row.snapId would be "" → routed to
    // Axis 2/4 with empty snap_id. Post-fix: validSnapIdOrNull("") = null,
    // fall back to rationale.
    insertV9AuditRow("pdec_empty_col", "", "snap_RECOVERED_VIA_RATIONALE", "uploaded");

    const rows = fetchR2UploadOutcomeAuditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.snapId).toBe("snap_RECOVERED_VIA_RATIONALE");
  });

  it("v9 row with garbage column → falls back to rationale parsing (P2 fix)", () => {
    insertV9AuditRow("pdec_garbage_col", "garbage_value_not_snap_prefix", "snap_RECOVERED", "uploaded");

    const rows = fetchR2UploadOutcomeAuditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.snapId).toBe("snap_RECOVERED");
  });

  it("v9 row with garbage column AND malformed rationale → Axis 5 surface preserved (P2 fix)", () => {
    // Both anchors unrecoverable — the row must surface as
    // malformed_r2_upload_audit_row rather than silently use the garbage
    // column value.
    insertV9AuditRow("pdec_both_bad", "garbage", null, "uploaded");

    const rows = fetchR2UploadOutcomeAuditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.snapId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cycle 9 / OPS-1B.h4-r2-audit-column-rationale-drift-axis
//
// Axis 6 (r2_audit_column_rationale_drift) — dual-write contract violation
// surface. `recordR2UploadDecision` dual-writes the v9 snap_id column AND
// the rationale prefix; divergence means manual SQL repair, writer format
// regression, or fixture / backfill that touched only one side. Without
// this axis, column-preferred resolution would silently mask rationale
// anomalies that v8- legacy consumers parsing rationale would still see.
// ---------------------------------------------------------------------------

describe("reconcile — Axis 6: r2_audit_column_rationale_drift (Cycle 9 / OPS-1B.h4)", () => {
  it("flags row where column and rationale carry different well-formed snap_ids", () => {
    const audits: R2UploadOutcomeAuditRow[] = [
      {
        snapId: "snap_FROM_COLUMN",
        columnSnapId: "snap_FROM_COLUMN",
        rationaleSnapId: "snap_FROM_RATIONALE_DIFFERENT",
        uploadAttemptId: "uatt_drift",
        rationale: "snap_id=snap_FROM_RATIONALE_DIFFERENT; ...",
        decisionId: "pdec_drift",
        decision: "uploaded",
      },
    ];

    const violations = reconcile({
      r2BackedSnapshots: [],
      r2UploadOutcomeAuditRows: audits,
      sourcePolicies: [],
    });

    const drift = violations.filter((v) => v.type === "r2_audit_column_rationale_drift");
    expect(drift).toHaveLength(1);
    expect(drift[0]!.snapId).toBe("snap_FROM_COLUMN");
    expect(drift[0]!.details.columnSnapId).toBe("snap_FROM_COLUMN");
    expect(drift[0]!.details.rationaleSnapId).toBe("snap_FROM_RATIONALE_DIFFERENT");
    expect(drift[0]!.details.auditDecisionId).toBe("pdec_drift");
    expect(drift[0]!.details.decision).toBe("uploaded");
  });

  it("silent when column and rationale are the same well-formed value (canonical v9 happy path)", () => {
    const audits: R2UploadOutcomeAuditRow[] = [
      {
        snapId: "snap_SAME",
        columnSnapId: "snap_SAME",
        rationaleSnapId: "snap_SAME",
        uploadAttemptId: "uatt_same",
        rationale: "snap_id=snap_SAME; ...",
        decisionId: "pdec_same",
        decision: "uploaded",
      },
    ];
    const violations = reconcile({
      r2BackedSnapshots: [],
      r2UploadOutcomeAuditRows: audits,
      sourcePolicies: [],
    });
    expect(violations.filter((v) => v.type === "r2_audit_column_rationale_drift")).toHaveLength(0);
  });

  it("silent when column is null (v8- legacy row, rationale-only resolution)", () => {
    const audits: R2UploadOutcomeAuditRow[] = [
      {
        snapId: "snap_LEGACY",
        columnSnapId: null,
        rationaleSnapId: "snap_LEGACY",
        uploadAttemptId: "uatt_legacy",
        rationale: "snap_id=snap_LEGACY; ...",
        decisionId: "pdec_legacy",
        decision: "uploaded",
      },
    ];
    const violations = reconcile({
      r2BackedSnapshots: [],
      r2UploadOutcomeAuditRows: audits,
      sourcePolicies: [],
    });
    expect(violations.filter((v) => v.type === "r2_audit_column_rationale_drift")).toHaveLength(0);
  });

  it("silent when rationale is null/malformed but column is well-formed (column-preferred resolution)", () => {
    const audits: R2UploadOutcomeAuditRow[] = [
      {
        snapId: "snap_COL_ONLY",
        columnSnapId: "snap_COL_ONLY",
        rationaleSnapId: null,
        uploadAttemptId: "uatt_col_only",
        rationale: "broken_rationale_format",
        decisionId: "pdec_col_only",
        decision: "uploaded",
      },
    ];
    const violations = reconcile({
      r2BackedSnapshots: [],
      r2UploadOutcomeAuditRows: audits,
      sourcePolicies: [],
    });
    // Axis 6 silent (no contradicting values). Axis 5 also silent (snapId
    // resolved to column value). This is the canonical "column-preferred
    // resolution masks rationale anomaly" tolerance.
    expect(violations.filter((v) => v.type === "r2_audit_column_rationale_drift")).toHaveLength(0);
    expect(violations.filter((v) => v.type === "malformed_r2_upload_audit_row")).toHaveLength(0);
  });

  it("silent when both column and rationale are null (Axis 5 fires instead — separation of concerns)", () => {
    const audits: R2UploadOutcomeAuditRow[] = [
      {
        snapId: null,
        columnSnapId: null,
        rationaleSnapId: null,
        uploadAttemptId: "uatt_both_null",
        rationale: "no_snap_id_anywhere",
        decisionId: "pdec_both_null",
        decision: "uploaded",
      },
    ];
    const violations = reconcile({
      r2BackedSnapshots: [],
      r2UploadOutcomeAuditRows: audits,
      sourcePolicies: [],
    });
    const types = violations.map((v) => v.type);
    expect(types).toContain("malformed_r2_upload_audit_row");
    expect(types).not.toContain("r2_audit_column_rationale_drift");
  });

  it("integration via fetchR2UploadOutcomeAuditRows: writer-side drift surfaces through SQLite read path", () => {
    // Insert directly to DB so column and rationale snap_id values can be
    // set independently (simulates manual SQL repair / format regression /
    // fixture mistake).
    getDb()
      .prepare(
        `INSERT INTO policy_decisions
         (decision_id, source_id, url, trigger_type, policy_gate_mode,
          decision, rationale, intended_action, upload_attempt_id, snap_id)
         VALUES ('pdec_drift_db', 'src_x', 'https://example.com', 'r2_upload', 'batch_report',
                 'uploaded',
                 'snap_id=snap_RAT_DIFFERENT; archive_policy=full_snapshot_allowed',
                 'r2_upload', 'uatt_drift_db', 'snap_COL')`,
      )
      .run();

    const rows = fetchR2UploadOutcomeAuditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.columnSnapId).toBe("snap_COL");
    expect(rows[0]!.rationaleSnapId).toBe("snap_RAT_DIFFERENT");

    const violations = reconcile({
      r2BackedSnapshots: [],
      r2UploadOutcomeAuditRows: rows,
      sourcePolicies: [],
    });
    expect(violations.filter((v) => v.type === "r2_audit_column_rationale_drift")).toHaveLength(1);
  });
});
