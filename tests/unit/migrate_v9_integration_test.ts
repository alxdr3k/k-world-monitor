/**
 * Integration tests for v9 SQLite migration
 * (INFRA-1B.3.h5-policy-decisions-snap-id-column-v9 + Cycle 7
 * INFRA-1B.3.h6-schema-hardening).
 *
 * Pre-Cycle-7 the v9 migration had unit tests for the resulting column /
 * scanner behavior, but did NOT test the actual ALTER TABLE path:
 *   1. v8 DB → apply v9 SQL → column appears, index exists,
 *      schema_migrations row gets v9.
 *   2. Re-applying the same SQL throws duplicate-column (non-idempotent
 *      by design — runner's responsibility to handle).
 *   3. migrate.ts duplicate-column recovery branch (strip ALTER + retry)
 *      lands cleanly on already-applied state.
 *
 * Codex PR #57 round 1 already caught the schema_migrations row missing
 * via static review. This file locks the migration path behavior so a
 * future refactor that removes the INSERT, weakens the index, or changes
 * the duplicate-column recovery semantics fails fast in tests.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { Database } from "bun:sqlite";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const V9_SQL_PATH = join(
  REPO_ROOT,
  "migrations",
  "sqlite",
  "v9_policy_decisions_snap_id.sql",
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Materialize a minimum v8-state DB: schema_migrations table populated
 * through v8 + a stub policy_decisions table mirroring the post-v8 shape.
 * This is the "before" state v9 migrates from.
 */
function setupV8Db(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE schema_migrations (
      version TEXT NOT NULL PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      description TEXT
    );
    INSERT INTO schema_migrations (version, description) VALUES
      ('v1', 'core schema'),
      ('v2', 'enum constraints'),
      ('v3', 'source_registry_slug_map'),
      ('v4', 'run_ledger'),
      ('v5', 'crawl_state'),
      ('v6', 'discovery_queue'),
      ('v7', 'policy_decisions.intended_action'),
      ('v8', 'audit_hardening');
    -- Post-v8 policy_decisions shape (intended_action + upload_attempt_id present,
    -- snap_id NOT yet — that's what v9 adds).
    CREATE TABLE policy_decisions (
      decision_id       TEXT PRIMARY KEY,
      source_id         TEXT,
      session_id        TEXT,
      url               TEXT,
      trigger_type      TEXT NOT NULL,
      policy_gate_mode  TEXT NOT NULL,
      decision          TEXT NOT NULL,
      rationale         TEXT,
      created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      intended_action   TEXT,
      upload_attempt_id TEXT
    );
  `);
  return db;
}

/**
 * Strip ALTER TABLE statements (intrinsically non-idempotent) to match
 * migrate.ts duplicate-column recovery branch behavior. Used by the
 * "re-apply" test to verify the same recovery SQL works.
 */
function stripAlterTable(sql: string): string {
  return sql.replace(/^\s*ALTER\s+TABLE[^;]*;/gim, "");
}

function readV9Sql(): string {
  return readFileSync(V9_SQL_PATH, "utf-8");
}

// ---------------------------------------------------------------------------
// Migration application
// ---------------------------------------------------------------------------

describe("v9 migration — fresh apply onto v8 DB", () => {
  let db: Database;

  beforeEach(() => {
    db = setupV8Db();
    const sql = readV9Sql();
    db.exec("BEGIN");
    db.exec(sql);
    db.exec("COMMIT");
  });

  it("adds policy_decisions.snap_id column (nullable, no default)", () => {
    const cols = db
      .query<
        { name: string; type: string; notnull: number; dflt_value: string | null },
        []
      >("PRAGMA table_info(policy_decisions)")
      .all();
    const snapIdCol = cols.find((c) => c.name === "snap_id");
    expect(snapIdCol).toBeDefined();
    expect(snapIdCol!.type).toBe("TEXT");
    expect(snapIdCol!.notnull).toBe(0);
    expect(snapIdCol!.dflt_value).toBeNull();
  });

  it("creates partial index policy_decisions_snap_id_idx WHERE snap_id IS NOT NULL", () => {
    const idx = db
      .query<{ name: string; sql: string | null }, []>(
        "SELECT name, sql FROM sqlite_master WHERE type='index' AND name='policy_decisions_snap_id_idx'",
      )
      .get();
    expect(idx).not.toBeNull();
    expect(idx!.sql).toContain("WHERE snap_id IS NOT NULL");
  });

  it("records v9 in schema_migrations (immutable ledger anchor)", () => {
    const row = db
      .query<{ version: string; description: string | null }, []>(
        "SELECT version, description FROM schema_migrations WHERE version = 'v9'",
      )
      .get();
    expect(row).not.toBeNull();
    expect(row!.version).toBe("v9");
    expect(row!.description).toContain("INFRA-1B.3.h5-policy-decisions-snap-id-column-v9");
  });

  it("post-v9 INSERT into policy_decisions can populate the snap_id column", () => {
    db.prepare(
      `INSERT INTO policy_decisions
       (decision_id, source_id, url, trigger_type, policy_gate_mode,
        decision, rationale, intended_action, upload_attempt_id, snap_id)
       VALUES ('pdec_v9_insert', 'src_x', 'https://x', 'r2_upload',
               'batch_report', 'uploaded', 'snap_id=snap_v9_insert; ...',
               'r2_upload', 'uatt_v9_insert', 'snap_v9_insert')`,
    ).run();
    const row = db
      .query<{ snap_id: string | null }, []>(
        "SELECT snap_id FROM policy_decisions WHERE decision_id = 'pdec_v9_insert'",
      )
      .get();
    expect(row?.snap_id).toBe("snap_v9_insert");
  });
});

// ---------------------------------------------------------------------------
// Re-apply behavior (duplicate-column recovery)
// ---------------------------------------------------------------------------

describe("v9 migration — re-apply behavior (duplicate-column path)", () => {
  it("re-applying full v9 SQL throws duplicate column name (non-idempotent ALTER, by design)", () => {
    const db = setupV8Db();
    const sql = readV9Sql();
    db.exec("BEGIN");
    db.exec(sql);
    db.exec("COMMIT");
    // Second apply must fail at ALTER step — runner's job to recover.
    expect(() => {
      db.exec("BEGIN");
      db.exec(sql);
      db.exec("COMMIT");
    }).toThrow(/duplicate column name/i);
    // Verify rollback returned the DB to a consistent state (snap_id column
    // still exists, index still exists, schema_migrations still has v9 from
    // the first apply).
    try { db.exec("ROLLBACK"); } catch { /* ignore */ }
    const v9Row = db
      .query<{ version: string }, []>(
        "SELECT version FROM schema_migrations WHERE version = 'v9'",
      )
      .get();
    expect(v9Row?.version).toBe("v9");
  });

  it("migrate.ts duplicate-column recovery branch (strip ALTER + retry) lands cleanly on already-applied DB", () => {
    const db = setupV8Db();
    const sql = readV9Sql();
    // First apply: full SQL.
    db.exec("BEGIN");
    db.exec(sql);
    db.exec("COMMIT");
    // Simulate migrate.ts recovery: strip ALTER, retry idempotent remainder.
    // The stripAlterTable regex matches migrate.ts's exact pattern
    // (^\s*ALTER\s+TABLE[^;]*; with gim flags) — line-anchored, so SQL
    // comments containing "ALTER TABLE" (prefixed with "-- ") are left
    // alone and contribute no executable statements after strip.
    const idempotentSql = stripAlterTable(sql);
    expect(() => {
      db.exec("BEGIN");
      db.exec(idempotentSql);
      db.exec("COMMIT");
    }).not.toThrow();
    // schema_migrations v9 row still present (INSERT OR IGNORE preserved
    // the original row from the first apply).
    const v9Rows = db
      .query<{ version: string; description: string | null }, []>(
        "SELECT version, description FROM schema_migrations WHERE version = 'v9'",
      )
      .all();
    expect(v9Rows).toHaveLength(1);
    // CREATE INDEX IF NOT EXISTS preserved the original index.
    const idx = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='policy_decisions_snap_id_idx'",
      )
      .get();
    expect(idx?.name).toBe("policy_decisions_snap_id_idx");
  });
});

// ---------------------------------------------------------------------------
// Migration ordering / version comparison (locks runner contract)
// ---------------------------------------------------------------------------

describe("v9 migration — version ordering invariants", () => {
  it("schema_migrations description references the canonical slice ID", () => {
    // The slice ID in the description doubles as a doc-anchor for operator
    // audit queries (`SELECT * FROM schema_migrations WHERE description
    // LIKE '%INFRA-1B.3.h5%'`). Lock the anchor so a future refactor that
    // changes the slice name also has to update this assertion.
    const db = setupV8Db();
    db.exec("BEGIN");
    db.exec(readV9Sql());
    db.exec("COMMIT");
    const row = db
      .query<{ description: string | null }, []>(
        "SELECT description FROM schema_migrations WHERE version = 'v9'",
      )
      .get();
    expect(row?.description).toContain("INFRA-1B.3.h5");
    expect(row?.description).toContain("snap_id");
  });

  it("v9 SQL does NOT modify schema_migrations rows for prior versions", () => {
    const db = setupV8Db();
    const v8Before = db
      .query<{ version: string; description: string | null }, []>(
        "SELECT version, description FROM schema_migrations WHERE version = 'v8'",
      )
      .get();
    db.exec("BEGIN");
    db.exec(readV9Sql());
    db.exec("COMMIT");
    const v8After = db
      .query<{ version: string; description: string | null }, []>(
        "SELECT version, description FROM schema_migrations WHERE version = 'v8'",
      )
      .get();
    expect(v8After).toEqual(v8Before);
  });
});
