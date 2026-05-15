/**
 * Unit tests for Neo4j Source bootstrap (INFRA-1B.1.h1-source-bootstrap-neo4j,
 * AI-P1-2).
 *
 * Covers:
 *   - bootstrapNeo4jSourceNodes: empty + first-create + idempotent re-run
 *     + created/matched count attribution.
 *   - preflightSourceRegistry: aligned + missingInNeo4j + orphanInNeo4j +
 *     policy↔slug_map mismatch.
 *   - assertSourceRegistryAligned: throws BootstrapPreflightError when
 *     mismatched.
 *
 * Neo4j is mocked via tests/test-helpers/neo4j-mock. SQLite runs in-memory.
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import { createNeo4jMock } from "../test-helpers/neo4j-mock";

process.env["SQLITE_PATH"] = ":memory:";

// ---------------------------------------------------------------------------
// Neo4j mock — UNWIND returns multiple records (one per input row), so we
// build a custom multi-record response instead of using the single-row
// helper. The `bootstrapNeo4jSourceNodes` query also takes a `$rows` array
// param — the handler reads params.rows to compute the per-row response.
// ---------------------------------------------------------------------------

let neo4jSourceIds: string[] = [];
let mergeBehavior: "all-create" | "all-match" | "mixed" = "all-create";

const neo4j = createNeo4jMock();
function registerHandlers() {
  neo4j.session.on(/UNWIND \$rows AS row[\s\S]*MERGE \(s:Source/, ({ params }) => {
    const rows = (params["rows"] as Array<{ source_id: string }>) ?? [];
    const records = rows.map((r, i) => {
      let created: boolean;
      if (mergeBehavior === "all-create") created = true;
      else if (mergeBehavior === "all-match") created = false;
      else created = i % 2 === 0; // mixed
      return {
        get: (key: string) => (key === "source_id" ? r.source_id : key === "created" ? created : null),
      };
    });
    return { records };
  });
  neo4j.session.on(/MATCH \(s:Source\)[\s\S]*RETURN collect\(s\.source_id\)/, () => ({
    records: [
      {
        get: (key: string) => (key === "source_ids" ? neo4jSourceIds : null),
      },
    ],
  }));
}
registerHandlers();

mock.module("../../src/storage/neo4j/connection", () => neo4j.module);

// ---------------------------------------------------------------------------
// Imports after mocks.
// ---------------------------------------------------------------------------

import { getDb, closeDb } from "../../src/storage/sqlite/connection";
import {
  bootstrapNeo4jSourceNodes,
  loadBootstrapRowsFromSqlite,
  preflightSourceRegistry,
  assertSourceRegistryAligned,
  BootstrapPreflightError,
} from "../../src/storage/source-registry/neo4j-bootstrap";

// ---------------------------------------------------------------------------
// SQLite setup.
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
      checked_at           TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z',
      updated_at           TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z'
    );
    CREATE TABLE IF NOT EXISTS source_registry_slug_map (
      slug       TEXT NOT NULL PRIMARY KEY,
      source_id  TEXT NOT NULL
    );
  `);
  return db;
}

function insertSqliteRow(slug: string, sourceId: string): void {
  const db = getDb();
  db.prepare(
    "INSERT OR REPLACE INTO source_registry_slug_map (slug, source_id) VALUES (?, ?)"
  ).run(slug, sourceId);
  db.prepare(
    `INSERT OR REPLACE INTO source_material_policy
     (source_id, archive_policy, raw_cloud_policy, external_llm_policy)
     VALUES (?, 'full_snapshot_allowed', 'allowed_public_data_only', 'allowed')`
  ).run(sourceId);
}

beforeEach(() => {
  neo4j.reset();
  registerHandlers();
  neo4jSourceIds = [];
  mergeBehavior = "all-create";
  setupDb();
});

// ---------------------------------------------------------------------------
// bootstrapNeo4jSourceNodes
// ---------------------------------------------------------------------------

describe("bootstrapNeo4jSourceNodes", () => {
  it("returns zero-counts for empty input + does not call Neo4j", async () => {
    const result = await bootstrapNeo4jSourceNodes([]);
    expect(result).toEqual({ created: 0, matched: 0, total: 0 });
    expect(neo4j.runs).toHaveLength(0);
  });

  it("first-create: all rows reported as created", async () => {
    mergeBehavior = "all-create";
    const result = await bootstrapNeo4jSourceNodes([
      { source_id: "src_A", slug: "a", name: "A" },
      { source_id: "src_B", slug: "b", name: "B" },
      { source_id: "src_C", slug: "c", name: "C" },
    ]);
    expect(result).toEqual({ created: 3, matched: 0, total: 3 });

    // Single UNWIND round-trip (efficient bootstrap).
    expect(neo4j.runs).toHaveLength(1);
    expect(neo4j.runs[0]!.query).toContain("UNWIND $rows");
    expect(neo4j.runs[0]!.query).toContain("MERGE (s:Source");
  });

  it("idempotent re-run: all rows reported as matched (existing)", async () => {
    mergeBehavior = "all-match";
    const result = await bootstrapNeo4jSourceNodes([
      { source_id: "src_A", slug: "a", name: "A" },
      { source_id: "src_B", slug: "b", name: "B" },
    ]);
    expect(result).toEqual({ created: 0, matched: 2, total: 2 });
  });

  it("mixed first-create and match (some new, some existing)", async () => {
    mergeBehavior = "mixed"; // even indices created, odd matched
    const result = await bootstrapNeo4jSourceNodes([
      { source_id: "src_A", slug: "a", name: "A" }, // index 0 → created
      { source_id: "src_B", slug: "b", name: "B" }, // index 1 → matched
      { source_id: "src_C", slug: "c", name: "C" }, // index 2 → created
      { source_id: "src_D", slug: "d", name: "D" }, // index 3 → matched
    ]);
    expect(result).toEqual({ created: 2, matched: 2, total: 4 });
  });

  it("passes source_id + slug + name + bootstrap_at + updated_at via UNWIND param", async () => {
    await bootstrapNeo4jSourceNodes([
      { source_id: "src_X", slug: "x-slug", name: "X Name" },
    ]);
    const run = neo4j.runs[0]!;
    const params = run.params as { rows: Array<{ source_id: string; slug: string; name: string }>; now: string };
    expect(params.rows).toEqual([{ source_id: "src_X", slug: "x-slug", name: "X Name" }]);
    expect(typeof params.now).toBe("string");
    expect(params.now).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    // Query body must set bootstrap_at on ON CREATE + updated_at on both
    // branches so idempotent re-runs surface stable bootstrap_at but fresh
    // updated_at (operator confidence).
    expect(run.query).toContain("ON CREATE SET");
    expect(run.query).toContain("s.bootstrap_at = $now");
    expect(run.query).toContain("ON MATCH SET");
    expect(run.query).toContain("s.updated_at   = $now");
  });
});

// ---------------------------------------------------------------------------
// preflightSourceRegistry
// ---------------------------------------------------------------------------

describe("preflightSourceRegistry — counts + alignment", () => {
  it("returns aligned=true when all three sets contain the same source_ids", async () => {
    insertSqliteRow("a", "src_A");
    insertSqliteRow("b", "src_B");
    neo4jSourceIds = ["src_A", "src_B"];

    const result = await preflightSourceRegistry();
    expect(result.aligned).toBe(true);
    expect(result.counts).toEqual({ sqlitePolicy: 2, sqliteSlugMap: 2, neo4jSource: 2 });
    expect(result.mismatch.missingInNeo4j).toHaveLength(0);
    expect(result.mismatch.orphanInNeo4j).toHaveLength(0);
  });

  it("returns aligned=true for an empty registry (degenerate but valid)", async () => {
    neo4jSourceIds = [];
    const result = await preflightSourceRegistry();
    expect(result.aligned).toBe(true);
    expect(result.counts).toEqual({ sqlitePolicy: 0, sqliteSlugMap: 0, neo4jSource: 0 });
  });

  it("flags missingInNeo4j when SQLite has rows but Neo4j does not", async () => {
    insertSqliteRow("a", "src_A");
    insertSqliteRow("b", "src_B");
    neo4jSourceIds = []; // Neo4j empty — bootstrap was never run

    const result = await preflightSourceRegistry();
    expect(result.aligned).toBe(false);
    expect(result.mismatch.missingInNeo4j).toEqual(["src_A", "src_B"]);
    expect(result.mismatch.orphanInNeo4j).toEqual([]);
    expect(result.counts).toEqual({ sqlitePolicy: 2, sqliteSlugMap: 2, neo4jSource: 0 });
  });

  it("flags orphanInNeo4j when Neo4j has nodes not in SQLite slug_map", async () => {
    insertSqliteRow("a", "src_A");
    neo4jSourceIds = ["src_A", "src_GHOST"]; // GHOST was never seeded

    const result = await preflightSourceRegistry();
    expect(result.aligned).toBe(false);
    expect(result.mismatch.missingInNeo4j).toEqual([]);
    expect(result.mismatch.orphanInNeo4j).toEqual(["src_GHOST"]);
  });

  it("flags policy↔slug_map divergence (corrupted SQLite state)", async () => {
    // Manually corrupt — slug_map has an id missing from policy table.
    getDb()
      .prepare("INSERT INTO source_registry_slug_map (slug, source_id) VALUES (?, ?)")
      .run("a", "src_A");
    // Policy row absent for src_A; instead policy has src_ROGUE.
    getDb()
      .prepare(
        `INSERT INTO source_material_policy
         (source_id, archive_policy, raw_cloud_policy, external_llm_policy)
         VALUES ('src_ROGUE', 'full_snapshot_allowed', 'allowed_public_data_only', 'allowed')`
      )
      .run();
    neo4jSourceIds = ["src_A"];

    const result = await preflightSourceRegistry();
    expect(result.aligned).toBe(false);
    expect(result.mismatch.policyVsSlugMap.onlyInPolicy).toEqual(["src_ROGUE"]);
    expect(result.mismatch.policyVsSlugMap.onlyInSlugMap).toEqual(["src_A"]);
  });
});

// ---------------------------------------------------------------------------
// assertSourceRegistryAligned
// ---------------------------------------------------------------------------

describe("assertSourceRegistryAligned", () => {
  it("returns the result without throwing when aligned", async () => {
    insertSqliteRow("a", "src_A");
    neo4jSourceIds = ["src_A"];
    const result = await assertSourceRegistryAligned();
    expect(result.aligned).toBe(true);
  });

  it("throws BootstrapPreflightError with descriptive message when missing in Neo4j", async () => {
    insertSqliteRow("a", "src_A");
    insertSqliteRow("b", "src_B");
    neo4jSourceIds = []; // Neo4j empty

    let caught: unknown;
    try {
      await assertSourceRegistryAligned();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BootstrapPreflightError);
    const err = caught as BootstrapPreflightError;
    expect(err.message).toContain("Source registry preflight mismatch");
    expect(err.message).toContain("missing in Neo4j (2)");
    expect(err.message).toContain("src_A");
    expect(err.message).toContain("seed-sources --neo4j");
    expect(err.result.aligned).toBe(false);
    expect(err.result.mismatch.missingInNeo4j).toEqual(["src_A", "src_B"]);
  });

  it("throws BootstrapPreflightError when orphan in Neo4j", async () => {
    insertSqliteRow("a", "src_A");
    neo4jSourceIds = ["src_A", "src_GHOST"];

    await expect(assertSourceRegistryAligned()).rejects.toThrow(
      /orphan in Neo4j \(1\).*src_GHOST/s
    );
  });
});

// ---------------------------------------------------------------------------
// loadBootstrapRowsFromSqlite — full slug_map coverage with name fallback
// (Codex PR #44 P1 regression coverage)
// ---------------------------------------------------------------------------

describe("loadBootstrapRowsFromSqlite — full slug_map coverage", () => {
  it("returns all slug_map rows (NOT just current YAML rows) — historical sources covered", () => {
    // Simulate: YAML currently has slug 'a' but SQLite has historical slug
    // 'b' that was removed from YAML. Bootstrap must still cover 'b' so
    // preflight does not fail permanently.
    insertSqliteRow("a", "src_A");
    insertSqliteRow("b-historical", "src_B");

    const yamlRows = [{ source_id: "src_A", slug: "a", name: "A Name" }];
    const rows = loadBootstrapRowsFromSqlite(yamlRows);

    expect(rows).toHaveLength(2);
    const idMap = new Map(rows.map((r) => [r.source_id, r]));
    // YAML row uses YAML's authoritative name
    expect(idMap.get("src_A")).toEqual({ source_id: "src_A", slug: "a", name: "A Name" });
    // Historical row uses slug as name fallback (no YAML data available)
    expect(idMap.get("src_B")).toEqual({
      source_id: "src_B",
      slug: "b-historical",
      name: "b-historical",
    });
  });

  it("prefers YAML name + slug over slug_map when both are present", () => {
    // slug_map has slug 'old-slug' for src_A, but YAML provides slug 'new-slug'
    // + name 'Renamed'. YAML wins. (Note: in production seedSources() updates
    // the slug_map row via INSERT OR IGNORE, so this scenario is degenerate —
    // but the function's resolution rule must still be deterministic.)
    insertSqliteRow("old-slug", "src_A");
    const yamlRows = [{ source_id: "src_A", slug: "new-slug", name: "Renamed" }];

    const rows = loadBootstrapRowsFromSqlite(yamlRows);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ source_id: "src_A", slug: "new-slug", name: "Renamed" });
  });

  it("returns empty array when slug_map is empty (degenerate input)", () => {
    const rows = loadBootstrapRowsFromSqlite([]);
    expect(rows).toEqual([]);
  });

  it("integration with bootstrapNeo4jSourceNodes — historical rows are bootstrapped end-to-end", async () => {
    // The Codex P1 recovery flow: bootstrap full slug_map → preflight aligned.
    insertSqliteRow("a", "src_A");
    insertSqliteRow("b-historical", "src_B");
    const yamlRows = [{ source_id: "src_A", slug: "a", name: "A Name" }];

    const bootstrapRows = loadBootstrapRowsFromSqlite(yamlRows);
    expect(bootstrapRows).toHaveLength(2);

    mergeBehavior = "all-create";
    const result = await bootstrapNeo4jSourceNodes(bootstrapRows);
    expect(result.total).toBe(2);

    // Verify the UNWIND query received BOTH source_ids — not just the YAML one.
    const run = neo4j.runs.find((r) => r.query.includes("UNWIND $rows"))!;
    const params = run.params as { rows: Array<{ source_id: string }> };
    expect(params.rows.map((r) => r.source_id).sort()).toEqual(["src_A", "src_B"]);
  });
});

// ---------------------------------------------------------------------------
// Missing-table guard (actionable error before graph work)
// ---------------------------------------------------------------------------

describe("preflightSourceRegistry — missing-table guard", () => {
  it("throws actionable error when source_material_policy is missing", async () => {
    closeDb();
    process.env["SQLITE_PATH"] = ":memory:";
    const db = getDb();
    // Only create slug_map, not policy.
    db.exec(
      "CREATE TABLE source_registry_slug_map (slug TEXT NOT NULL PRIMARY KEY, source_id TEXT NOT NULL);"
    );
    await expect(preflightSourceRegistry()).rejects.toThrow(
      /source_material_policy table not found.*bun run migrate:sqlite/s
    );
  });

  it("throws actionable error when source_registry_slug_map is missing", async () => {
    closeDb();
    process.env["SQLITE_PATH"] = ":memory:";
    const db = getDb();
    db.exec(
      "CREATE TABLE source_material_policy (source_id TEXT PRIMARY KEY, archive_policy TEXT NOT NULL, raw_cloud_policy TEXT NOT NULL, external_llm_policy TEXT NOT NULL, checked_at TEXT NOT NULL DEFAULT '');"
    );
    await expect(preflightSourceRegistry()).rejects.toThrow(
      /source_registry_slug_map table not found.*bun run migrate:sqlite/s
    );
  });
});
