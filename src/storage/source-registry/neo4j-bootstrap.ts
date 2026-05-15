/**
 * Neo4j Source node bootstrap — INFRA-1B.1.h1-source-bootstrap-neo4j (AI-P1-2).
 *
 * Bridges the gap between the SQLite seed (INFRA-1B.1, source_material_policy +
 * source_registry_slug_map) and the snapshot-fingerprint code path that does
 * `MATCH (src:Source {source_id: $sourceId})` and rolls back the transaction
 * when the node is missing. Without this bootstrap, every discovery → snapshot
 * end-to-end run fails with `Source not found in graph` (TypedQueueError code
 * `source_not_found_in_graph`) for every Tier A seed source.
 *
 * Semantics:
 *   - MERGE on `source_id` (Neo4j v1 schema CONSTRAINT source_unique enforces
 *     uniqueness). Re-runs are idempotent.
 *   - Properties stored on the Source node are intentionally minimal:
 *     `source_id`, `slug`, `name`, `bootstrap_at` (ON CREATE), `updated_at`
 *     (ON CREATE + ON MATCH). Full source profile metadata
 *     (publisher / urls_root[] / reliability_tier / collectability_score /
 *     access_method / source_perspective / meta_category / subtopic_tags) is
 *     reserved for the AI-P1-4 / INFRA-1B.1.h2-source-profile slice (Q-054 D3
 *     SQLite source_profile canonical store).
 *
 * Preflight contract (mismatch fail-fast):
 *   - SQLite `source_material_policy`, SQLite `source_registry_slug_map`, and
 *     Neo4j Source node sets must contain identical `source_id` values.
 *   - Mismatches are surfaced as a typed BootstrapPreflightError so callers
 *     (CLI / preflight scripts) can fail-fast with actionable diagnostics
 *     instead of letting downstream discovery worker hit the runtime guard.
 */

import { getDb } from "../sqlite/connection";
import { withSession } from "../neo4j/connection";
import type { SeedRow } from "./seed";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BootstrapResult {
  /** New Source nodes created in Neo4j */
  created: number;
  /** Existing Source nodes whose updated_at was refreshed by MERGE */
  matched: number;
  /** Total Source nodes touched (= created + matched) */
  total: number;
}

export interface PreflightCounts {
  sqlitePolicy: number;
  sqliteSlugMap: number;
  neo4jSource: number;
}

export interface PreflightMismatch {
  /** source_id in SQLite slug_map but NOT in Neo4j */
  missingInNeo4j: string[];
  /** source_id in Neo4j but NOT in SQLite slug_map */
  orphanInNeo4j: string[];
  /** source_id mismatches between SQLite policy and slug_map */
  policyVsSlugMap: {
    onlyInPolicy: string[];
    onlyInSlugMap: string[];
  };
  /**
   * Count of `:Source` nodes whose `source_id` is null (Codex PR #44 P2 fix).
   * Cypher `collect(s.source_id)` silently drops nulls, so without explicit
   * detection a malformed graph (Source node missing source_id) would pass
   * preflight. snapshot-fingerprint's `MATCH (src:Source {source_id: $id})`
   * would never find these nodes, but they would still consume graph storage
   * and could fan out via other relationships.
   */
  neo4jNodesMissingSourceId: number;
  /**
   * source_id values that appear on multiple `:Source` nodes (Codex PR #44
   * P2 fix). The v1 schema's `source_unique` CONSTRAINT prevents this on a
   * properly-migrated DB, but pre-constraint historical data (constraint
   * applied AFTER nodes were created) could surface duplicates. Without
   * this check, `new Set(neo4jSourceIds)` collapses them silently and
   * preflight returns aligned=true on a malformed graph.
   */
  neo4jDuplicateSourceIds: string[];
}

export interface PreflightResult {
  counts: PreflightCounts;
  mismatch: PreflightMismatch;
  /** true ⇔ all three sets contain identical source_id values */
  aligned: boolean;
}

export class BootstrapPreflightError extends Error {
  constructor(public readonly result: PreflightResult) {
    super(BootstrapPreflightError.formatMessage(result));
    this.name = "BootstrapPreflightError";
  }

  static formatMessage(r: PreflightResult): string {
    const parts: string[] = [
      `Source registry preflight mismatch (SQLite policy=${r.counts.sqlitePolicy}, slug_map=${r.counts.sqliteSlugMap}, Neo4j=${r.counts.neo4jSource}):`,
    ];
    if (r.mismatch.missingInNeo4j.length > 0) {
      parts.push(
        `  missing in Neo4j (${r.mismatch.missingInNeo4j.length}): ${r.mismatch.missingInNeo4j.slice(0, 5).join(", ")}${r.mismatch.missingInNeo4j.length > 5 ? " ..." : ""}`
      );
    }
    if (r.mismatch.orphanInNeo4j.length > 0) {
      parts.push(
        `  orphan in Neo4j (${r.mismatch.orphanInNeo4j.length}): ${r.mismatch.orphanInNeo4j.slice(0, 5).join(", ")}${r.mismatch.orphanInNeo4j.length > 5 ? " ..." : ""}`
      );
    }
    if (r.mismatch.policyVsSlugMap.onlyInPolicy.length > 0) {
      parts.push(
        `  only in source_material_policy (${r.mismatch.policyVsSlugMap.onlyInPolicy.length}): ${r.mismatch.policyVsSlugMap.onlyInPolicy.slice(0, 5).join(", ")}`
      );
    }
    if (r.mismatch.policyVsSlugMap.onlyInSlugMap.length > 0) {
      parts.push(
        `  only in source_registry_slug_map (${r.mismatch.policyVsSlugMap.onlyInSlugMap.length}): ${r.mismatch.policyVsSlugMap.onlyInSlugMap.slice(0, 5).join(", ")}`
      );
    }
    if (r.mismatch.neo4jNodesMissingSourceId > 0) {
      parts.push(
        `  :Source nodes missing source_id (${r.mismatch.neo4jNodesMissingSourceId}) — malformed graph; manual repair required`
      );
    }
    if (r.mismatch.neo4jDuplicateSourceIds.length > 0) {
      parts.push(
        `  duplicate source_id in Neo4j (${r.mismatch.neo4jDuplicateSourceIds.length}): ${r.mismatch.neo4jDuplicateSourceIds.slice(0, 5).join(", ")}${r.mismatch.neo4jDuplicateSourceIds.length > 5 ? " ..." : ""} — pre-constraint historical data; manual dedupe + apply CONSTRAINT source_unique`
      );
    }
    parts.push(
      "Run `bun run seed-sources --neo4j` to bootstrap missing Source nodes; manual investigation required for orphans / null source_id / duplicates."
    );
    return parts.join("\n");
  }
}

// ---------------------------------------------------------------------------
// Bootstrap row resolution — full SQLite slug_map coverage.
//
// Codex review PR #44 P1 (2026-05-15): `seedSources()` is upsert-only and
// never deletes historical slug_map rows. If a source was previously seeded
// then later removed from `data/sources_seed.yaml`, its source_id remains
// in `source_registry_slug_map` (and in `source_material_policy`). Preflight
// validates against the FULL slug_map set, so if bootstrap only touches the
// current-YAML rows, historical IDs are forever missing-in-Neo4j and
// preflight fails permanently — blocking the recovery flow the CLI was
// designed for. `loadBootstrapRowsFromSqlite()` reads the FULL slug_map set
// and resolves `name` from the current-YAML rows when available, falling
// back to `slug` when a source is no longer present in YAML (graph node
// display name remains human-readable instead of an opaque ULID).
// ---------------------------------------------------------------------------

export interface BootstrapRow {
  source_id: string;
  slug: string;
  name: string;
}

export function loadBootstrapRowsFromSqlite(
  yamlRows: ReadonlyArray<Pick<SeedRow, "source_id" | "slug" | "name">>
): BootstrapRow[] {
  const yamlByIdMap = new Map<string, { slug: string; name: string }>(
    yamlRows.map((r) => [r.source_id, { slug: r.slug, name: r.name }])
  );
  const slugMapRows = getDb()
    .query<{ slug: string; source_id: string }, []>(
      "SELECT slug, source_id FROM source_registry_slug_map"
    )
    .all();
  return slugMapRows.map((r) => {
    const yaml = yamlByIdMap.get(r.source_id);
    return {
      source_id: r.source_id,
      slug: yaml?.slug ?? r.slug,
      // Fallback: when a source is no longer present in YAML, use slug as
      // name so the graph node has a human-readable label. The slug remains
      // stable across YAML edits (slug_map is keyed on slug), so this
      // fallback is deterministic.
      name: yaml?.name ?? r.slug,
    };
  });
}

// ---------------------------------------------------------------------------
// Bootstrap — create / refresh Neo4j Source nodes for the given SQLite rows.
// ---------------------------------------------------------------------------

export async function bootstrapNeo4jSourceNodes(
  rows: ReadonlyArray<Pick<SeedRow, "source_id" | "slug" | "name">>
): Promise<BootstrapResult> {
  if (rows.length === 0) {
    return { created: 0, matched: 0, total: 0 };
  }
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  return withSession(async (session) => {
    // Single UNWIND batch: keeps the round-trip count to 1 for typical 72-row
    // seeds. `was_created` is computed as a query-local variable via
    // OPTIONAL MATCH BEFORE the MERGE, so we can report created-vs-matched
    // counts WITHOUT storing the boolean as a Source node property (Codex
    // PR #44 review: transient reporting flag must not become a permanent
    // graph property — keeps Source node properties minimal per the slice
    // contract: source_id, slug, name, bootstrap_at, updated_at). The CLI
    // is single-operator so no race between OPTIONAL MATCH and MERGE.
    const result = await session.run(
      `UNWIND $rows AS row
       OPTIONAL MATCH (existing:Source {source_id: row.source_id})
       WITH row, existing IS NULL AS was_created
       MERGE (s:Source {source_id: row.source_id})
       ON CREATE SET
         s.slug         = row.slug,
         s.name         = row.name,
         s.bootstrap_at = $now,
         s.updated_at   = $now
       ON MATCH SET
         s.slug         = row.slug,
         s.name         = row.name,
         s.updated_at   = $now
       RETURN s.source_id AS source_id, was_created AS created`,
      { rows: rows.map((r) => ({ source_id: r.source_id, slug: r.slug, name: r.name })), now }
    );

    let created = 0;
    let matched = 0;
    for (const rec of result.records) {
      if (rec.get("created") === true) created++;
      else matched++;
    }
    return { created, matched, total: created + matched };
  });
}

// ---------------------------------------------------------------------------
// Preflight — check that SQLite policy, SQLite slug_map, and Neo4j Source
// all contain the same source_id set.
// ---------------------------------------------------------------------------

export async function preflightSourceRegistry(): Promise<PreflightResult> {
  const db = getDb();

  // Required-table guard — give an actionable error before doing graph work
  // if migrations have not been applied.
  const policyTable = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='source_material_policy'"
    )
    .get();
  if (!policyTable) {
    throw new Error(
      "source_material_policy table not found. Run migrations first: bun run migrate:sqlite"
    );
  }
  const slugMapTable = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='source_registry_slug_map'"
    )
    .get();
  if (!slugMapTable) {
    throw new Error(
      "source_registry_slug_map table not found. Run migrations first: bun run migrate:sqlite"
    );
  }

  const policyRows = db
    .query<{ source_id: string }, []>("SELECT source_id FROM source_material_policy")
    .all();
  const slugMapRows = db
    .query<{ source_id: string }, []>("SELECT source_id FROM source_registry_slug_map")
    .all();
  const policySet = new Set(policyRows.map((r) => r.source_id));
  const slugMapSet = new Set(slugMapRows.map((r) => r.source_id));

  // Codex PR #44 P2 fix: return both `count(s)` (all :Source nodes, including
  // those with null source_id) AND `collect(s.source_id)` (Cypher aggregation
  // drops nulls). The difference exposes malformed nodes missing source_id
  // that the previous query silently ignored.
  const { neo4jTotalNodes, neo4jSourceIdsRaw } = await withSession(async (session) => {
    const result = await session.run(
      `MATCH (s:Source)
       RETURN count(s) AS total_nodes, collect(s.source_id) AS source_ids`
    );
    const rec = result.records[0];
    if (!rec) return { neo4jTotalNodes: 0, neo4jSourceIdsRaw: [] as string[] };
    // Neo4j driver returns Integer for count — normalize via Number().
    const total = Number(rec.get("total_nodes") ?? 0);
    const ids = (rec.get("source_ids") as string[]) ?? [];
    return { neo4jTotalNodes: total, neo4jSourceIdsRaw: ids };
  });

  // null source_id detection: collect() drops nulls, so any difference between
  // count(s) and the array length is the null-source_id node count.
  const neo4jNodesMissingSourceId = neo4jTotalNodes - neo4jSourceIdsRaw.length;

  // Duplicate detection: track source_ids that appear more than once in the
  // raw array BEFORE Set collapses them. The v1 schema's source_unique
  // CONSTRAINT prevents this on a properly-migrated DB, but pre-constraint
  // historical data may slip through.
  const occurrenceCount = new Map<string, number>();
  for (const id of neo4jSourceIdsRaw) {
    occurrenceCount.set(id, (occurrenceCount.get(id) ?? 0) + 1);
  }
  const neo4jDuplicateSourceIds = [...occurrenceCount.entries()]
    .filter(([_, n]) => n > 1)
    .map(([id, _]) => id)
    .sort();

  const neo4jSet = new Set(neo4jSourceIdsRaw);
  const missingInNeo4j = [...slugMapSet].filter((id) => !neo4jSet.has(id)).sort();
  const orphanInNeo4j = [...neo4jSet].filter((id) => !slugMapSet.has(id)).sort();
  const onlyInPolicy = [...policySet].filter((id) => !slugMapSet.has(id)).sort();
  const onlyInSlugMap = [...slugMapSet].filter((id) => !policySet.has(id)).sort();

  const aligned =
    missingInNeo4j.length === 0 &&
    orphanInNeo4j.length === 0 &&
    onlyInPolicy.length === 0 &&
    onlyInSlugMap.length === 0 &&
    neo4jNodesMissingSourceId === 0 &&
    neo4jDuplicateSourceIds.length === 0;

  return {
    counts: {
      sqlitePolicy: policySet.size,
      sqliteSlugMap: slugMapSet.size,
      // neo4jSource = total :Source node count (NOT deduplicated set size).
      // If duplicates exist or null source_id nodes exist, this surfaces the
      // raw graph state so the operator sees the actual node population.
      neo4jSource: neo4jTotalNodes,
    },
    mismatch: {
      missingInNeo4j,
      orphanInNeo4j,
      policyVsSlugMap: { onlyInPolicy, onlyInSlugMap },
      neo4jNodesMissingSourceId,
      neo4jDuplicateSourceIds,
    },
    aligned,
  };
}

/**
 * Convenience wrapper: run preflight and throw BootstrapPreflightError when
 * the three source_id sets are not aligned. Used by the CLI fail-fast path.
 */
export async function assertSourceRegistryAligned(): Promise<PreflightResult> {
  const result = await preflightSourceRegistry();
  if (!result.aligned) {
    throw new BootstrapPreflightError(result);
  }
  return result;
}
