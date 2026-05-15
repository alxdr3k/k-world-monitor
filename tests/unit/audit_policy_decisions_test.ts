/**
 * Unit tests for INFRA-1B.3.x-audit — policy_decisions.intended_action audit
 * ledger (Q-044 / DEC-020 / TRACE-040, AC-032 / NFR-008).
 *
 * Covers src/storage/audit/policy-decisions.ts.recordR2UploadDecision —
 * the INSERT hook called by src/discovery/worker/snapshot-fingerprint.ts
 * around every r2Put call site to satisfy ADR-0012 INV-0012-3 audit-trail
 * enforcement.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { closeDb, getDb } from "../../src/storage/sqlite/connection";
import { recordR2UploadDecision } from "../../src/storage/audit/policy-decisions";
import {
  INTENDED_ACTION,
  isIntendedAction,
  R2_UPLOAD_DECISION,
  isR2UploadDecision,
} from "../../src/utils/enums";

process.env["SQLITE_PATH"] = ":memory:";

// ---------------------------------------------------------------------------
// SQLite setup — materializes policy_decisions schema (v1 + v7 ALTER COLUMN).
// ---------------------------------------------------------------------------

function setupDb() {
  closeDb();
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS policy_decisions (
      decision_id       TEXT PRIMARY KEY,
      source_id         TEXT,
      session_id        TEXT,
      url               TEXT,
      trigger_type      TEXT NOT NULL,
      policy_gate_mode  TEXT NOT NULL CHECK (policy_gate_mode IN ('inline_block','inline_warn','batch_report')),
      decision          TEXT NOT NULL,
      rationale         TEXT,
      created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      intended_action   TEXT
    );
  `);
  return db;
}

beforeEach(() => {
  setupDb();
});

interface AuditRow {
  decision_id: string;
  source_id: string | null;
  session_id: string | null;
  url: string | null;
  trigger_type: string;
  policy_gate_mode: string;
  decision: string;
  rationale: string | null;
  created_at: string;
  intended_action: string | null;
}

function readRow(decisionId: string): AuditRow {
  const row = getDb()
    .query<AuditRow, [string]>("SELECT * FROM policy_decisions WHERE decision_id = ?")
    .get(decisionId);
  expect(row).toBeTruthy();
  return row as AuditRow;
}

// ---------------------------------------------------------------------------
// IntendedAction + R2UploadDecision enums (typesafety)
// ---------------------------------------------------------------------------

describe("IntendedAction enum (INFRA-1B.3.x-audit)", () => {
  it("contains 'r2_upload' as the v0 sole value", () => {
    expect(INTENDED_ACTION).toEqual(["r2_upload"]);
  });

  it("isIntendedAction guards string membership", () => {
    expect(isIntendedAction("r2_upload")).toBe(true);
    expect(isIntendedAction("external_llm_call")).toBe(false);
    expect(isIntendedAction(undefined)).toBe(false);
    expect(isIntendedAction(123)).toBe(false);
  });
});

describe("R2UploadDecision enum (INFRA-1B.3.x-audit)", () => {
  it("contains the 4 lifecycle values in fixed order", () => {
    expect(R2_UPLOAD_DECISION).toEqual([
      "attempted",
      "uploaded",
      "skipped_toctou",
      "set_r2_key_failed_neo4j",
    ]);
  });

  it("isR2UploadDecision guards string membership", () => {
    expect(isR2UploadDecision("attempted")).toBe(true);
    expect(isR2UploadDecision("uploaded")).toBe(true);
    expect(isR2UploadDecision("skipped_toctou")).toBe(true);
    expect(isR2UploadDecision("set_r2_key_failed_neo4j")).toBe(true);
    expect(isR2UploadDecision("blocked_by_policy")).toBe(false); // audit-by-absence
    expect(isR2UploadDecision("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// recordR2UploadDecision (happy paths)
// ---------------------------------------------------------------------------

describe("recordR2UploadDecision returns pdec_<ULID> decision_id", () => {
  it("returns a string starting with pdec_", () => {
    const id = recordR2UploadDecision({
      sourceId: "src_test1",
      snapId: "snap_test1",
      url: "https://example.com/a",
      archivePolicy: "full_snapshot_allowed",
      rawCloudPolicy: "allowed_public_data_only",
      decision: "attempted",
    });
    expect(id).toMatch(/^pdec_[0-9A-HJKMNP-TV-Z]{26}$/i);
  });

  it("each call generates a unique decision_id (ulid monotonic)", () => {
    const a = recordR2UploadDecision({
      sourceId: "src_test1",
      snapId: "snap_test1",
      url: "https://example.com/a",
      archivePolicy: "full_snapshot_allowed",
      rawCloudPolicy: "allowed_public_data_only",
      decision: "attempted",
    });
    const b = recordR2UploadDecision({
      sourceId: "src_test1",
      snapId: "snap_test1",
      url: "https://example.com/a",
      archivePolicy: "full_snapshot_allowed",
      rawCloudPolicy: "allowed_public_data_only",
      decision: "uploaded",
      rationale: `r2_key=permitted_artifact/derived/snapshot/snap_test1`,
    });
    expect(a).not.toBe(b);
  });
});

describe("recordR2UploadDecision INSERTs row with canonical column values", () => {
  it("trigger_type='r2_upload' / policy_gate_mode='batch_report' / intended_action='r2_upload'", () => {
    const id = recordR2UploadDecision({
      sourceId: "src_test1",
      snapId: "snap_test1",
      url: "https://example.com/a",
      archivePolicy: "full_snapshot_allowed",
      rawCloudPolicy: "allowed_public_data_only",
      decision: "attempted",
    });
    const row = readRow(id);
    expect(row.trigger_type).toBe("r2_upload");
    expect(row.policy_gate_mode).toBe("batch_report");
    expect(row.intended_action).toBe("r2_upload");
  });

  it("copies source_id + url + decision verbatim from input", () => {
    const id = recordR2UploadDecision({
      sourceId: "src_abc123",
      snapId: "snap_xyz789",
      url: "https://example.org/path?q=1",
      archivePolicy: "full_snapshot_allowed",
      rawCloudPolicy: "allowed_public_data_only",
      decision: "uploaded",
    });
    const row = readRow(id);
    expect(row.source_id).toBe("src_abc123");
    expect(row.url).toBe("https://example.org/path?q=1");
    expect(row.decision).toBe("uploaded");
  });

  it("rationale begins with snap_id + archive_policy + raw_cloud_policy structured prefix", () => {
    const id = recordR2UploadDecision({
      sourceId: "src_test1",
      snapId: "snap_grep_anchor",
      url: "https://example.com/a",
      archivePolicy: "full_snapshot_allowed",
      rawCloudPolicy: "allowed_public_data_only",
      decision: "attempted",
    });
    const row = readRow(id);
    expect(row.rationale).toContain("snap_id=snap_grep_anchor");
    expect(row.rationale).toContain("archive_policy=full_snapshot_allowed");
    expect(row.rationale).toContain("raw_cloud_policy=allowed_public_data_only");
  });

  it("appends optional rationale detail after structured prefix", () => {
    const id = recordR2UploadDecision({
      sourceId: "src_test1",
      snapId: "snap_test1",
      url: "https://example.com/a",
      archivePolicy: "full_snapshot_allowed",
      rawCloudPolicy: "allowed_public_data_only",
      decision: "set_r2_key_failed_neo4j",
      rationale: "neo4j driver ETIMEDOUT after 5000ms",
    });
    const row = readRow(id);
    expect(row.rationale).toContain("snap_id=snap_test1");
    expect(row.rationale).toContain("neo4j driver ETIMEDOUT after 5000ms");
    // structured prefix appears before optional detail
    const prefixEnd = row.rationale!.indexOf("raw_cloud_policy=");
    const detailStart = row.rationale!.indexOf("neo4j driver");
    expect(prefixEnd).toBeLessThan(detailStart);
  });

  it("auto-sets created_at to a strftime ISO8601-no-millis Z string", () => {
    const id = recordR2UploadDecision({
      sourceId: "src_test1",
      snapId: "snap_test1",
      url: "https://example.com/a",
      archivePolicy: "full_snapshot_allowed",
      rawCloudPolicy: "allowed_public_data_only",
      decision: "attempted",
    });
    const row = readRow(id);
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

// ---------------------------------------------------------------------------
// All 4 R2UploadDecision values round-trip through the audit ledger.
// ---------------------------------------------------------------------------

describe("recordR2UploadDecision accepts every R2UploadDecision value", () => {
  for (const decision of R2_UPLOAD_DECISION) {
    it(`writes decision='${decision}'`, () => {
      const id = recordR2UploadDecision({
        sourceId: "src_test1",
        snapId: "snap_test1",
        url: "https://example.com/a",
        archivePolicy: "full_snapshot_allowed",
        rawCloudPolicy: "allowed_public_data_only",
        decision,
      });
      const row = readRow(id);
      expect(row.decision).toBe(decision);
    });
  }
});

// ---------------------------------------------------------------------------
// Audit-trail correlation — two rows per upload attempt (before + after).
// snap_id anchor in rationale lets operators GROUP BY snap_id to pair rows.
// ---------------------------------------------------------------------------

describe("audit-trail correlation via snap_id rationale anchor", () => {
  it("two rows for the same snap_id are queryable via LIKE 'snap_id=<snap>%'", () => {
    const snap = "snap_correlate_test";
    recordR2UploadDecision({
      sourceId: "src_test1",
      snapId: snap,
      url: "https://example.com/a",
      archivePolicy: "full_snapshot_allowed",
      rawCloudPolicy: "allowed_public_data_only",
      decision: "attempted",
      rationale: "dedup back-fill path",
    });
    recordR2UploadDecision({
      sourceId: "src_test1",
      snapId: snap,
      url: "https://example.com/a",
      archivePolicy: "full_snapshot_allowed",
      rawCloudPolicy: "allowed_public_data_only",
      decision: "uploaded",
      rationale: "dedup back-fill path; r2_key=permitted_artifact/derived/snapshot/" + snap,
    });

    const rows = getDb()
      .query<{ decision: string }, [string]>(
        "SELECT decision FROM policy_decisions WHERE rationale LIKE ? ORDER BY created_at, decision"
      )
      .all(`snap_id=${snap}%`);
    expect(rows.length).toBe(2);
    const decisions = rows.map((r) => r.decision).sort();
    expect(decisions).toEqual(["attempted", "uploaded"]);
  });
});
