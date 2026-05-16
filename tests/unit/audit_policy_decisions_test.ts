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
import {
  recordR2UploadDecision,
  newUploadAttemptId,
} from "../../src/storage/audit/policy-decisions";
import {
  INTENDED_ACTION,
  isIntendedAction,
  R2_UPLOAD_DECISION,
  isR2UploadDecision,
} from "../../src/utils/enums";

process.env["SQLITE_PATH"] = ":memory:";

// ---------------------------------------------------------------------------
// SQLite setup — materializes policy_decisions schema (v1 + v7 ALTER + v8
// audit hardening triggers + upload_attempt_id column).
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
      intended_action   TEXT,
      upload_attempt_id TEXT
    );

    -- v8 audit hardening triggers (AI-P1-7) — DB-level enum + correlation
    -- enforcement. Mirrors migrations/sqlite/v8_audit_hardening.sql.
    CREATE TRIGGER IF NOT EXISTS policy_decisions_intended_action_enum_ins
    BEFORE INSERT ON policy_decisions
    FOR EACH ROW
    WHEN NEW.intended_action IS NOT NULL
         AND NEW.intended_action NOT IN ('r2_upload')
    BEGIN
      SELECT RAISE(ABORT,
        'policy_decisions.intended_action: invalid value (must be NULL or in INTENDED_ACTION enum: r2_upload)');
    END;

    CREATE TRIGGER IF NOT EXISTS policy_decisions_r2_upload_decision_enum_ins
    BEFORE INSERT ON policy_decisions
    FOR EACH ROW
    WHEN NEW.intended_action = 'r2_upload'
         AND NEW.decision NOT IN (
           'attempted',
           'uploaded',
           'skipped_toctou',
           'set_r2_key_failed_neo4j'
         )
    BEGIN
      SELECT RAISE(ABORT,
        'policy_decisions.decision: invalid value for intended_action=r2_upload (must be in R2_UPLOAD_DECISION enum)');
    END;

    CREATE TRIGGER IF NOT EXISTS policy_decisions_r2_upload_attempt_id_required_ins
    BEFORE INSERT ON policy_decisions
    FOR EACH ROW
    WHEN NEW.intended_action = 'r2_upload'
         AND NEW.upload_attempt_id IS NULL
    BEGIN
      SELECT RAISE(ABORT,
        'policy_decisions.upload_attempt_id: required when intended_action=r2_upload (correlates attempted/outcome pair)');
    END;
  `);
  return db;
}

// Test helper: every recordR2UploadDecision call now requires an
// uploadAttemptId (v8 trigger). Default a fresh id per call unless the
// test explicitly cares about correlation.
function freshAttemptId(): string {
  return newUploadAttemptId();
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
      uploadAttemptId: freshAttemptId(),
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
      uploadAttemptId: freshAttemptId(),
    });
    const b = recordR2UploadDecision({
      sourceId: "src_test1",
      snapId: "snap_test1",
      url: "https://example.com/a",
      archivePolicy: "full_snapshot_allowed",
      rawCloudPolicy: "allowed_public_data_only",
      decision: "uploaded",
      uploadAttemptId: freshAttemptId(),
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
      uploadAttemptId: freshAttemptId(),
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
      uploadAttemptId: freshAttemptId(),
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
      uploadAttemptId: freshAttemptId(),
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
      uploadAttemptId: freshAttemptId(),
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
      uploadAttemptId: freshAttemptId(),
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
        uploadAttemptId: freshAttemptId(),
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
      uploadAttemptId: freshAttemptId(),
      rationale: "dedup back-fill path",
    });
    recordR2UploadDecision({
      sourceId: "src_test1",
      snapId: snap,
      url: "https://example.com/a",
      archivePolicy: "full_snapshot_allowed",
      rawCloudPolicy: "allowed_public_data_only",
      decision: "uploaded",
      uploadAttemptId: freshAttemptId(),
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

// ---------------------------------------------------------------------------
// AI-P1-7 (INFRA-1B.3.h3-audit-hardening, v8 migration) regression coverage:
// upload_attempt_id correlation + DB-level enum + required-field triggers.
// ---------------------------------------------------------------------------

describe("newUploadAttemptId — correlation key generation", () => {
  it("returns uatt_<ULID> shape", () => {
    const id = newUploadAttemptId();
    expect(id).toMatch(/^uatt_[0-9A-HJKMNP-TV-Z]{26}$/i);
  });

  it("each call returns a unique id (monotonic ulid)", () => {
    const a = newUploadAttemptId();
    const b = newUploadAttemptId();
    expect(a).not.toBe(b);
  });
});

describe("recordR2UploadDecision persists upload_attempt_id verbatim", () => {
  it("stores the supplied uploadAttemptId in the row", () => {
    const attemptId = "uatt_KNOWN_TEST_VALUE_123456789";
    const id = recordR2UploadDecision({
      sourceId: "src_test1",
      snapId: "snap_test1",
      url: "https://example.com/a",
      archivePolicy: "full_snapshot_allowed",
      rawCloudPolicy: "allowed_public_data_only",
      decision: "attempted",
      uploadAttemptId: attemptId,
    });
    const row = getDb()
      .query<{ upload_attempt_id: string }, [string]>(
        "SELECT upload_attempt_id FROM policy_decisions WHERE decision_id = ?"
      )
      .get(id);
    expect(row?.upload_attempt_id).toBe(attemptId);
  });

  it("BEFORE/AFTER row pair sharing one uploadAttemptId is queryable as a single attempt", () => {
    // Operator audit query: WHERE upload_attempt_id = '...' returns the
    // matched pair regardless of intervening rows from concurrent r2Put
    // calls. This is the canonical correlation; rationale-snap_id parsing
    // breaks under dedup back-fill race.
    const attemptId = newUploadAttemptId();
    const otherAttemptId = newUploadAttemptId(); // a concurrent r2Put for the same snap

    // Concurrent r2Put for the same snap_id (e.g. dedup back-fill race) —
    // should NOT be returned by the upload_attempt_id query for `attemptId`.
    recordR2UploadDecision({
      sourceId: "src_concurrent",
      snapId: "snap_shared",
      url: "https://example.com/a",
      archivePolicy: "full_snapshot_allowed",
      rawCloudPolicy: "allowed_public_data_only",
      decision: "attempted",
      uploadAttemptId: otherAttemptId,
    });

    // The attempt we care about — BEFORE row.
    recordR2UploadDecision({
      sourceId: "src_test1",
      snapId: "snap_shared",
      url: "https://example.com/a",
      archivePolicy: "full_snapshot_allowed",
      rawCloudPolicy: "allowed_public_data_only",
      decision: "attempted",
      uploadAttemptId: attemptId,
    });

    // Concurrent outcome (different attempt).
    recordR2UploadDecision({
      sourceId: "src_concurrent",
      snapId: "snap_shared",
      url: "https://example.com/a",
      archivePolicy: "full_snapshot_allowed",
      rawCloudPolicy: "allowed_public_data_only",
      decision: "uploaded",
      uploadAttemptId: otherAttemptId,
    });

    // Our attempt's outcome.
    recordR2UploadDecision({
      sourceId: "src_test1",
      snapId: "snap_shared",
      url: "https://example.com/a",
      archivePolicy: "full_snapshot_allowed",
      rawCloudPolicy: "allowed_public_data_only",
      decision: "skipped_toctou",
      uploadAttemptId: attemptId,
    });

    const rows = getDb()
      .query<{ decision: string; source_id: string }, [string]>(
        "SELECT decision, source_id FROM policy_decisions WHERE upload_attempt_id = ? ORDER BY created_at"
      )
      .all(attemptId);
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.decision)).toEqual(["attempted", "skipped_toctou"]);
    // Confirm correlation isolated our attempt from the concurrent one.
    expect(rows.every((r) => r.source_id === "src_test1")).toBe(true);
  });
});

describe("v8 trigger: intended_action enum enforcement (INSERT)", () => {
  it("rejects INSERT with intended_action='UNKNOWN' (not in INTENDED_ACTION enum)", () => {
    expect(() => {
      getDb()
        .prepare(
          `INSERT INTO policy_decisions
             (decision_id, source_id, url, trigger_type, policy_gate_mode,
              decision, intended_action, upload_attempt_id)
           VALUES ('pdec_bad1', 'src_x', 'https://x.com/', 'r2_upload',
                   'batch_report', 'attempted', 'UNKNOWN_ACTION', 'uatt_x')`
        )
        .run();
    }).toThrow(/intended_action.*invalid value/);
  });

  it("allows INSERT with intended_action=NULL (operator-policy-gate row, ADR-0017)", () => {
    // The operator-policy-gate flow keeps intended_action NULL — the v8
    // trigger MUST NOT block these rows or the existing 8-danger-action
    // policy gate (REQ-018, AC-023) breaks.
    expect(() => {
      getDb()
        .prepare(
          `INSERT INTO policy_decisions
             (decision_id, source_id, url, trigger_type, policy_gate_mode,
              decision, intended_action)
           VALUES ('pdec_op_gate', 'src_x', 'https://x.com/', 'extract',
                   'inline_block', 'block', NULL)`
        )
        .run();
    }).not.toThrow();
  });
});

describe("v8 trigger: r2_upload decision enum enforcement (INSERT)", () => {
  it("rejects INSERT with intended_action='r2_upload' + decision='unknown_outcome'", () => {
    expect(() => {
      getDb()
        .prepare(
          `INSERT INTO policy_decisions
             (decision_id, source_id, url, trigger_type, policy_gate_mode,
              decision, intended_action, upload_attempt_id)
           VALUES ('pdec_bad_dec', 'src_x', 'https://x.com/', 'r2_upload',
                   'batch_report', 'unknown_outcome', 'r2_upload', 'uatt_x')`
        )
        .run();
    }).toThrow(/decision.*invalid value for intended_action=r2_upload/);
  });

  it("decision-enum trigger does NOT fire for intended_action=NULL (operator gate rows untouched)", () => {
    // Operator-gate rows can have any decision string — the trigger only
    // constrains r2_upload rows.
    expect(() => {
      getDb()
        .prepare(
          `INSERT INTO policy_decisions
             (decision_id, source_id, url, trigger_type, policy_gate_mode,
              decision, intended_action)
           VALUES ('pdec_op_dec', 'src_x', 'https://x.com/', 'extract',
                   'inline_block', 'arbitrary_operator_decision', NULL)`
        )
        .run();
    }).not.toThrow();
  });
});

describe("v8 trigger: upload_attempt_id required for r2_upload rows (INSERT)", () => {
  it("rejects INSERT with intended_action='r2_upload' + upload_attempt_id=NULL", () => {
    expect(() => {
      getDb()
        .prepare(
          `INSERT INTO policy_decisions
             (decision_id, source_id, url, trigger_type, policy_gate_mode,
              decision, intended_action, upload_attempt_id)
           VALUES ('pdec_no_uatt', 'src_x', 'https://x.com/', 'r2_upload',
                   'batch_report', 'attempted', 'r2_upload', NULL)`
        )
        .run();
    }).toThrow(/upload_attempt_id.*required when intended_action=r2_upload/);
  });

  it("allows INSERT with intended_action=NULL + upload_attempt_id=NULL (operator gate rows)", () => {
    expect(() => {
      getDb()
        .prepare(
          `INSERT INTO policy_decisions
             (decision_id, source_id, url, trigger_type, policy_gate_mode,
              decision, intended_action, upload_attempt_id)
           VALUES ('pdec_op_no_uatt', 'src_x', 'https://x.com/', 'extract',
                   'inline_block', 'block', NULL, NULL)`
        )
        .run();
    }).not.toThrow();
  });
});
