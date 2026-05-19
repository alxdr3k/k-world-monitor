/**
 * Unit tests for ADR-0029 INV-0029-4 external_llm_policy gate.
 * EXTR-1A.0 — Prompt Injection 방어 기반.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  checkLlmPolicy,
  LlmProhibitedError,
  LlmManualReviewRequiredError,
  SourceNotRegisteredError,
} from "../../src/extraction/policy/llm-policy-gate";

function makeDb(): Database {
  const db = new Database(":memory:");
  // Mirror the v1 source_material_policy table contract (subset — only
  // columns this gate reads). Full table schema is enforced by
  // migrations/sqlite/v1_schema.sql in production.
  db.run(`
    CREATE TABLE source_material_policy (
      source_id            TEXT NOT NULL PRIMARY KEY,
      archive_policy       TEXT NOT NULL CHECK (archive_policy IN ('metadata_only','excerpt_only','full_snapshot_allowed','do_not_collect')),
      raw_cloud_policy     TEXT NOT NULL CHECK (raw_cloud_policy IN ('always_prohibited','allowed_public_data_only')),
      external_llm_policy  TEXT NOT NULL CHECK (external_llm_policy IN ('allowed','manual_review_required','prohibited')),
      checked_at           TEXT NOT NULL
    )
  `);
  return db;
}

function insertSource(
  db: Database,
  sourceId: string,
  externalLlmPolicy: "allowed" | "manual_review_required" | "prohibited",
): void {
  db.run(
    `INSERT INTO source_material_policy (source_id, archive_policy, raw_cloud_policy, external_llm_policy, checked_at)
     VALUES (?, 'metadata_only', 'always_prohibited', ?, '2026-05-19T00:00:00Z')`,
    [sourceId, externalLlmPolicy],
  );
}

describe("checkLlmPolicy — INV-0029-4 enforcement", () => {
  let db: Database;
  beforeEach(() => {
    db = makeDb();
  });

  it("returns silently when external_llm_policy = 'allowed'", () => {
    insertSource(db, "src_allowed", "allowed");
    expect(() => checkLlmPolicy("src_allowed", db)).not.toThrow();
  });

  it("throws LlmProhibitedError when external_llm_policy = 'prohibited'", () => {
    insertSource(db, "src_pro", "prohibited");
    expect(() => checkLlmPolicy("src_pro", db)).toThrow(LlmProhibitedError);
    expect(() => checkLlmPolicy("src_pro", db)).toThrow(/prohibited/);
  });

  it("LlmProhibitedError carries sourceId field", () => {
    insertSource(db, "src_pro_2", "prohibited");
    try {
      checkLlmPolicy("src_pro_2", db);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(LlmProhibitedError);
      expect((err as LlmProhibitedError).sourceId).toBe("src_pro_2");
    }
  });

  it("throws LlmManualReviewRequiredError when external_llm_policy = 'manual_review_required'", () => {
    insertSource(db, "src_mrr", "manual_review_required");
    expect(() => checkLlmPolicy("src_mrr", db)).toThrow(
      LlmManualReviewRequiredError,
    );
    expect(() => checkLlmPolicy("src_mrr", db)).toThrow(/manual_review_required/);
  });

  it("LlmManualReviewRequiredError carries sourceId field", () => {
    insertSource(db, "src_mrr_2", "manual_review_required");
    try {
      checkLlmPolicy("src_mrr_2", db);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(LlmManualReviewRequiredError);
      expect((err as LlmManualReviewRequiredError).sourceId).toBe("src_mrr_2");
    }
  });

  it("throws SourceNotRegisteredError when source_id not in source_material_policy", () => {
    expect(() => checkLlmPolicy("src_missing", db)).toThrow(
      SourceNotRegisteredError,
    );
    expect(() => checkLlmPolicy("src_missing", db)).toThrow(/not found/);
  });

  it("SourceNotRegisteredError is fail-closed (unregistered source default per ADR-0017)", () => {
    try {
      checkLlmPolicy("src_unknown", db);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SourceNotRegisteredError);
      expect((err as SourceNotRegisteredError).sourceId).toBe("src_unknown");
    }
  });

  it("throws TypeError on empty sourceId", () => {
    expect(() => checkLlmPolicy("", db)).toThrow(TypeError);
  });

  it("throws TypeError on whitespace-only sourceId", () => {
    expect(() => checkLlmPolicy("   ", db)).toThrow(TypeError);
  });

  it("throws TypeError on non-string sourceId", () => {
    // @ts-expect-error — defensive runtime check
    expect(() => checkLlmPolicy(123, db)).toThrow(TypeError);
    // @ts-expect-error
    expect(() => checkLlmPolicy(null, db)).toThrow(TypeError);
  });

  it("scoped per sourceId — one source's policy does not affect another", () => {
    insertSource(db, "src_a", "allowed");
    insertSource(db, "src_b", "prohibited");
    expect(() => checkLlmPolicy("src_a", db)).not.toThrow();
    expect(() => checkLlmPolicy("src_b", db)).toThrow(LlmProhibitedError);
  });

  it("error message includes the invariant reference (ADR-0029 INV-0029-4)", () => {
    insertSource(db, "src_pro_3", "prohibited");
    try {
      checkLlmPolicy("src_pro_3", db);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as Error).message).toContain("ADR-0029 INV-0029-4");
    }
  });
});
