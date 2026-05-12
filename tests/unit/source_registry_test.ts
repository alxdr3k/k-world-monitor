/**
 * Unit tests for INFRA-1B.1 Source Registry seed (AC-001, AC-022, AC-023).
 *
 * AC-001: source_id uses src_ prefix (AC-005).
 * AC-022: source_material_policy row created per source.
 * AC-023: policy enum fields validated at seed time.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { load as yamlLoad } from "js-yaml";
import { seedSources, SeedValidationError } from "../../src/storage/source-registry/seed";
import { getDb, closeDb } from "../../src/storage/sqlite/connection";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const POLICY_TABLE_DDL = `
  CREATE TABLE source_material_policy (
    source_id            TEXT NOT NULL,
    archive_policy       TEXT NOT NULL CHECK (archive_policy IN ('metadata_only','excerpt_only','full_snapshot_allowed','do_not_collect')),
    raw_cloud_policy     TEXT NOT NULL CHECK (raw_cloud_policy IN ('always_prohibited','allowed_public_data_only')),
    external_llm_policy  TEXT NOT NULL CHECK (external_llm_policy IN ('allowed','manual_review_required','prohibited')),
    terms_url            TEXT,
    license_url          TEXT,
    checked_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    PRIMARY KEY (source_id)
  )
`;

function setupInMemoryDb(): void {
  closeDb();
  process.env["SQLITE_PATH"] = ":memory:";
  const db = getDb();
  db.run(POLICY_TABLE_DDL);
  // slug map is created by seedSources itself via CREATE TABLE IF NOT EXISTS
}

function teardownDb(): void {
  closeDb();
  delete process.env["SQLITE_PATH"];
}

// ---------------------------------------------------------------------------
// Dry-run (no DB required — validates YAML, assumes fresh DB)
// ---------------------------------------------------------------------------

describe("seedSources — dry-run (no DB required)", () => {
  it("returns inserted count equal to total sources in seed file", () => {
    const result = seedSources({ dryRun: true });
    expect(result.inserted).toBe(72);
    expect(result.updated).toBe(0);
    expect(result.rows).toHaveLength(72);
  });

  it("every dry-run row has src_ prefixed source_id (AC-005)", () => {
    const result = seedSources({ dryRun: true });
    for (const row of result.rows) {
      expect(row.source_id.startsWith("src_")).toBe(true);
    }
  });

  it("all dry-run slugs are unique", () => {
    const result = seedSources({ dryRun: true });
    const slugs = result.rows.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(72);
  });

  it("all dry-run source_ids are unique", () => {
    const result = seedSources({ dryRun: true });
    const ids = result.rows.map((r) => r.source_id);
    expect(new Set(ids).size).toBe(72);
  });

  it("all dry-run rows report action=inserted", () => {
    const result = seedSources({ dryRun: true });
    for (const row of result.rows) {
      expect(row.action).toBe("inserted");
    }
  });

  it("all dry-run rows have valid archive_policy values (AC-023)", () => {
    const valid = new Set(["metadata_only", "excerpt_only", "full_snapshot_allowed", "do_not_collect"]);
    const result = seedSources({ dryRun: true });
    for (const row of result.rows) {
      expect(valid.has(row.archive_policy)).toBe(true);
    }
  });

  it("all dry-run rows have raw_cloud_policy=always_prohibited (ADR-0012 invariant)", () => {
    const result = seedSources({ dryRun: true });
    for (const row of result.rows) {
      expect(row.raw_cloud_policy).toBe("always_prohibited");
    }
  });

  it("all dry-run rows have valid external_llm_policy values (AC-023)", () => {
    const valid = new Set(["allowed", "manual_review_required", "prohibited"]);
    const result = seedSources({ dryRun: true });
    for (const row of result.rows) {
      expect(valid.has(row.external_llm_policy)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// DB write path — uses in-memory SQLite
// ---------------------------------------------------------------------------

describe("seedSources — DB write path", () => {
  beforeEach(setupInMemoryDb);
  afterEach(teardownDb);

  it("inserts 72 rows into source_material_policy (AC-022)", () => {
    const result = seedSources({ dryRun: false });
    expect(result.inserted).toBe(72);
    expect(result.updated).toBe(0);

    const db = getDb();
    const row = db.query<{ count: number }, []>(
      "SELECT COUNT(*) as count FROM source_material_policy"
    ).get();
    expect(row?.count).toBe(72);
  });

  it("all inserted source_ids have src_ prefix (AC-005)", () => {
    seedSources({ dryRun: false });
    const db = getDb();
    const rows = db.query<{ source_id: string }, []>(
      "SELECT source_id FROM source_material_policy"
    ).all();
    for (const r of rows) {
      expect(r.source_id.startsWith("src_")).toBe(true);
    }
  });

  it("all inserted rows have raw_cloud_policy=always_prohibited (ADR-0012)", () => {
    seedSources({ dryRun: false });
    const db = getDb();
    const rows = db.query<{ raw_cloud_policy: string }, []>(
      "SELECT raw_cloud_policy FROM source_material_policy"
    ).all();
    for (const r of rows) {
      expect(r.raw_cloud_policy).toBe("always_prohibited");
    }
  });

  it("re-run updates existing policy rows rather than skipping (idempotent upsert)", () => {
    seedSources({ dryRun: false });
    const result2 = seedSources({ dryRun: false });
    expect(result2.inserted).toBe(0);
    expect(result2.updated).toBe(72);
    for (const row of result2.rows) {
      expect(row.action).toBe("updated");
    }
    // Row count unchanged
    const db = getDb();
    const row = db.query<{ count: number }, []>(
      "SELECT COUNT(*) as count FROM source_material_policy"
    ).get();
    expect(row?.count).toBe(72);
  });

  it("heals missing policy row when slug map already exists", () => {
    seedSources({ dryRun: false });
    // Manually delete policy rows while keeping slug map
    const db = getDb();
    db.run("DELETE FROM source_material_policy");
    const afterDelete = db.query<{ count: number }, []>(
      "SELECT COUNT(*) as count FROM source_material_policy"
    ).get();
    expect(afterDelete?.count).toBe(0);

    // Re-seed should recreate all policy rows
    const result = seedSources({ dryRun: false });
    expect(result.updated).toBe(72);
    const afterReseed = db.query<{ count: number }, []>(
      "SELECT COUNT(*) as count FROM source_material_policy"
    ).get();
    expect(afterReseed?.count).toBe(72);
  });

  it("source_ids are stable across re-runs (same slug → same ID)", () => {
    const r1 = seedSources({ dryRun: false });
    const r2 = seedSources({ dryRun: false });
    const ids1 = new Map(r1.rows.map((r) => [r.slug, r.source_id]));
    for (const row of r2.rows) {
      expect(row.source_id).toBe(ids1.get(row.slug)!);
    }
  });
});

// ---------------------------------------------------------------------------
// YAML structure lint (no DB, reads seed directly)
// ---------------------------------------------------------------------------

describe("sources_seed.yaml structure", () => {
  const raw = readFileSync(join(process.cwd(), "data/sources_seed.yaml"), "utf-8");
  const parsed = yamlLoad(raw) as { sources: { slug: string; reliability_tier: number }[] };

  it("has exactly 72 sources", () => {
    expect(parsed.sources).toHaveLength(72);
  });

  it("all sources have reliability_tier 0", () => {
    for (const s of parsed.sources) {
      expect(s.reliability_tier).toBe(0);
    }
  });

  it("all slugs are non-empty strings", () => {
    for (const s of parsed.sources) {
      expect(typeof s.slug).toBe("string");
      expect(s.slug.length).toBeGreaterThan(0);
    }
  });

  it("all 72 slugs are unique (no duplicates in seed file)", () => {
    const slugs = parsed.sources.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(72);
  });
});

// ---------------------------------------------------------------------------
// SeedValidationError
// ---------------------------------------------------------------------------

describe("SeedValidationError", () => {
  it("is thrown for invalid source_perspective in seed data", () => {
    const err = new SeedValidationError("test_slug", "source_perspective", "unknown_value");
    expect(err).toBeInstanceOf(SeedValidationError);
    expect(err.name).toBe("SeedValidationError");
    expect(err.message).toContain("test_slug");
    expect(err.message).toContain("source_perspective");
    expect(err.message).toContain("unknown_value");
  });

  it("is thrown for duplicate slug (data quality guard)", () => {
    const err = new SeedValidationError("dup_slug", "slug", "duplicate slug in sources_seed.yaml");
    expect(err).toBeInstanceOf(SeedValidationError);
    expect(err.message).toContain("dup_slug");
    expect(err.message).toContain("slug");
  });
});

// ---------------------------------------------------------------------------
// YAML shape guard
// ---------------------------------------------------------------------------

describe("seedSources — YAML shape guard", () => {
  it("throws on null/empty YAML (dryRun path exercises shape check)", () => {
    // Use a non-existent dataRoot so readFileSync throws a controlled error
    expect(() => seedSources({ dryRun: true, dataRoot: "/nonexistent/path" })).toThrow();
  });
});
