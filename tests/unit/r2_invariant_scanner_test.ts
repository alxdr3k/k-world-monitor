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
  reconcile,
  fetchUploadedAuditRows,
  fetchSourcePolicies,
  fetchR2BackedSnapshots,
  scanR2Invariants,
  type R2BackedSnapshot,
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
      upload_attempt_id  TEXT
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
      { snapId: "snap_A", uploadAttemptId: "uatt_1", rationale: "", decisionId: "pdec_1" },
    ];
    const policies: SourcePolicy[] = [
      { sourceId: "src_A", archivePolicy: "full_snapshot_allowed", rawCloudPolicy: "allowed_public_data_only" },
    ];
    expect(
      reconcile({ r2BackedSnapshots: snapshots, uploadedAuditRows: audits, sourcePolicies: policies })
    ).toEqual([]);
  });

  it("returns no violations for empty inputs (degenerate baseline)", () => {
    expect(
      reconcile({ r2BackedSnapshots: [], uploadedAuditRows: [], sourcePolicies: [] })
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
    const violations = reconcile({ r2BackedSnapshots: snapshots, uploadedAuditRows: audits, sourcePolicies: policies });
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
      { snapId: "snap_A", uploadAttemptId: "uatt_1", rationale: "", decisionId: "pdec_1" },
    ];
    const policies: SourcePolicy[] = [
      { sourceId: "src_A", archivePolicy: "full_snapshot_allowed", rawCloudPolicy: "allowed_public_data_only" },
    ];
    const violations = reconcile({ r2BackedSnapshots: snapshots, uploadedAuditRows: audits, sourcePolicies: policies });
    expect(violations).toHaveLength(0);
  });
});

describe("reconcile — Axis 2: audit_uploaded_without_r2_key", () => {
  it("flags uploaded audit row without matching r2-backed Snapshot", () => {
    const snapshots: R2BackedSnapshot[] = []; // no r2-backed snapshot
    const audits: UploadedAuditRow[] = [
      { snapId: "snap_GHOST", uploadAttemptId: "uatt_ghost", rationale: "", decisionId: "pdec_ghost" },
    ];
    const policies: SourcePolicy[] = [];
    const violations = reconcile({ r2BackedSnapshots: snapshots, uploadedAuditRows: audits, sourcePolicies: policies });
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
      { snapId: "snap_RESTRICTED", uploadAttemptId: "uatt_1", rationale: "", decisionId: "pdec_1" },
    ];
    const policies: SourcePolicy[] = [
      // src_TIGHTENED was operator-changed to metadata_only AFTER the upload.
      { sourceId: "src_TIGHTENED", archivePolicy: "metadata_only", rawCloudPolicy: "allowed_public_data_only" },
    ];
    const violations = reconcile({ r2BackedSnapshots: snapshots, uploadedAuditRows: audits, sourcePolicies: policies });
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
      { snapId: "snap_X", uploadAttemptId: "uatt_1", rationale: "", decisionId: "pdec_1" },
    ];
    const policies: SourcePolicy[] = [
      { sourceId: "src_X", archivePolicy: "full_snapshot_allowed", rawCloudPolicy: "always_prohibited" },
    ];
    const violations = reconcile({ r2BackedSnapshots: snapshots, uploadedAuditRows: audits, sourcePolicies: policies });
    expect(violations).toHaveLength(1);
    expect(violations[0]!.type).toBe("r2_key_with_restricted_source");
  });

  it("flags unregistered source (source_material_policy row missing) as restricted with hasUnregistered=true", () => {
    const snapshots: R2BackedSnapshot[] = [
      { snapId: "snap_UNREG", r2Key: "k1", linkedSourceIds: ["src_DELETED"] },
    ];
    const audits: UploadedAuditRow[] = [
      { snapId: "snap_UNREG", uploadAttemptId: "uatt_1", rationale: "", decisionId: "pdec_1" },
    ];
    const policies: SourcePolicy[] = []; // src_DELETED row was operator-removed
    const violations = reconcile({ r2BackedSnapshots: snapshots, uploadedAuditRows: audits, sourcePolicies: policies });
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
      { snapId: "snap_NOLINK", uploadAttemptId: "uatt_1", rationale: "", decisionId: "pdec_1" },
    ];
    const policies: SourcePolicy[] = [];
    const violations = reconcile({ r2BackedSnapshots: snapshots, uploadedAuditRows: audits, sourcePolicies: policies });
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
      { snapId: "snap_GHOST", uploadAttemptId: "uatt_g", rationale: "", decisionId: "pdec_g" }, // → axis 2
      { snapId: "snap_RESTRICTED", uploadAttemptId: "uatt_r", rationale: "", decisionId: "pdec_r" },
    ];
    const policies: SourcePolicy[] = [
      { sourceId: "src_A", archivePolicy: "full_snapshot_allowed", rawCloudPolicy: "allowed_public_data_only" },
      { sourceId: "src_B", archivePolicy: "metadata_only", rawCloudPolicy: "allowed_public_data_only" },
    ];
    const violations = reconcile({ r2BackedSnapshots: snapshots, uploadedAuditRows: audits, sourcePolicies: policies });
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
