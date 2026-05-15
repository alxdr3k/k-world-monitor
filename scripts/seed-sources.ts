#!/usr/bin/env bun
/**
 * CLI: seed source_material_policy table from data/sources_seed.yaml (INFRA-1B.1).
 *
 * Usage:
 *   bun run seed-sources                  # SQLite seed only (backward compat)
 *   bun run seed-sources --dry-run        # validate + print plan, no DB writes
 *   bun run seed-sources --neo4j          # SQLite seed + Neo4j Source bootstrap
 *                                         # + preflight (INFRA-1B.1.h1-source-
 *                                         # bootstrap-neo4j, AI-P1-2)
 *   bun run seed-sources --preflight      # preflight only — fail-fast on
 *                                         # SQLite ↔ Neo4j mismatch (no writes)
 *
 * Flags can combine — `--dry-run --neo4j` validates YAML + shows Neo4j
 * bootstrap plan without DB writes (assumes fresh state).
 *
 * AI-P1-2 (INFRA-1B.1.h1-source-bootstrap-neo4j) — without `--neo4j`,
 * discovery → snapshot end-to-end runs fail with `source_not_found_in_graph`
 * (TypedQueueError) because seed.ts only writes to SQLite. Operators MUST
 * pass `--neo4j` after applying migrations to make the pipeline runnable.
 */

import { seedSources } from "../src/storage/source-registry/seed";
import {
  bootstrapNeo4jSourceNodes,
  loadBootstrapRowsFromSqlite,
  preflightSourceRegistry,
  assertSourceRegistryAligned,
  BootstrapPreflightError,
  type PreflightResult,
} from "../src/storage/source-registry/neo4j-bootstrap";
import { closeDriver } from "../src/storage/neo4j/connection";

function printPreflight(label: string, r: PreflightResult): void {
  console.log(
    `${label}: SQLite policy=${r.counts.sqlitePolicy}, slug_map=${r.counts.sqliteSlugMap}, Neo4j Source=${r.counts.neo4jSource} → ${r.aligned ? "aligned ✓" : "MISMATCH ✗"}`
  );
}

async function main(): Promise<number> {
  const dryRun = process.argv.includes("--dry-run");
  const neo4j = process.argv.includes("--neo4j");
  const preflightOnly = process.argv.includes("--preflight");

  if (preflightOnly) {
    // Preflight-only mode: no DB writes, just check alignment.
    const result = await preflightSourceRegistry();
    printPreflight("Preflight", result);
    if (!result.aligned) {
      console.error(BootstrapPreflightError.formatMessage(result));
      return 1;
    }
    return 0;
  }

  // SQLite seed (always runs unless preflight-only)
  const result = seedSources({ dryRun });

  for (const row of result.rows) {
    const tag = row.action === "inserted" ? "[+]" : "[~]";
    console.log(
      `${tag} ${row.source_id}  ${row.slug}  (${row.archive_policy} / ${row.raw_cloud_policy})`
    );
  }

  console.log(
    `\nSQLite seed done${dryRun ? " (dry-run — assumes fresh DB)" : ""}. inserted=${result.inserted} updated=${result.updated} total=${result.rows.length}`
  );

  if (!neo4j) {
    return 0;
  }

  // --neo4j: bootstrap Source nodes for the FULL SQLite slug_map set (not
  // just current YAML rows). seedSources() is upsert-only and does not
  // delete historical slug_map rows when a source is removed from YAML;
  // preflight validates against the full slug_map, so bootstrap must cover
  // the same set to keep the recovery flow useful (Codex PR #44 P1 fix).
  if (dryRun) {
    console.log(
      `\nNeo4j bootstrap (dry-run): would MERGE ${result.rows.length} Source nodes (source_id + slug + name + bootstrap_at + updated_at). No graph writes. (Non-dry-run resolves the full SQLite slug_map set, including historical sources removed from YAML.)`
    );
    return 0;
  }

  const bootstrapRows = loadBootstrapRowsFromSqlite(result.rows);
  const bootstrap = await bootstrapNeo4jSourceNodes(bootstrapRows);
  const historical = bootstrapRows.length - result.rows.length;
  console.log(
    `\nNeo4j bootstrap done. created=${bootstrap.created} matched=${bootstrap.matched} total=${bootstrap.total}` +
      (historical > 0
        ? ` (full slug_map coverage: ${result.rows.length} YAML rows + ${historical} historical rows whose slugs are no longer in YAML — name fallback = slug)`
        : "")
  );

  // Auto-preflight after bootstrap — fail-fast if anything is off so the
  // operator knows immediately instead of hitting source_not_found_in_graph
  // at runtime.
  try {
    const aligned = await assertSourceRegistryAligned();
    printPreflight("Preflight (post-bootstrap)", aligned);
    return 0;
  } catch (err) {
    if (err instanceof BootstrapPreflightError) {
      printPreflight("Preflight (post-bootstrap)", err.result);
      console.error(err.message);
      return 1;
    }
    throw err;
  }
}

// Codex PR #44 P2 fix: close Neo4j driver in CLI cleanup. The neo4j-driver
// keeps pooled network resources alive until driver.close(), so without
// this `bun run seed-sources --neo4j` hangs the process after a successful
// run (or leaks pool resources in automation). Mirrors scripts/migrate.ts.
async function run(): Promise<void> {
  let exitCode = 0;
  try {
    exitCode = await main();
  } catch (err) {
    console.error((err as Error).message);
    exitCode = 1;
  } finally {
    await closeDriver();
  }
  process.exit(exitCode);
}

run();
