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
  preflightSourceRegistry,
  assertSourceRegistryAligned,
  BootstrapPreflightError,
  type PreflightResult,
} from "../src/storage/source-registry/neo4j-bootstrap";

function printPreflight(label: string, r: PreflightResult): void {
  console.log(
    `${label}: SQLite policy=${r.counts.sqlitePolicy}, slug_map=${r.counts.sqliteSlugMap}, Neo4j Source=${r.counts.neo4jSource} → ${r.aligned ? "aligned ✓" : "MISMATCH ✗"}`
  );
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const neo4j = process.argv.includes("--neo4j");
  const preflightOnly = process.argv.includes("--preflight");

  if (preflightOnly) {
    // Preflight-only mode: no DB writes, just check alignment.
    const result = await preflightSourceRegistry();
    printPreflight("Preflight", result);
    if (!result.aligned) {
      console.error(BootstrapPreflightError.formatMessage(result));
      process.exit(1);
    }
    process.exit(0);
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
    process.exit(0);
  }

  // --neo4j: bootstrap Source nodes from the rows we just seeded.
  if (dryRun) {
    console.log(
      `\nNeo4j bootstrap (dry-run): would MERGE ${result.rows.length} Source nodes (source_id + slug + name + bootstrap_at + updated_at). No graph writes.`
    );
    process.exit(0);
  }

  const bootstrap = await bootstrapNeo4jSourceNodes(result.rows);
  console.log(
    `\nNeo4j bootstrap done. created=${bootstrap.created} matched=${bootstrap.matched} total=${bootstrap.total}`
  );

  // Auto-preflight after bootstrap — fail-fast if anything is off so the
  // operator knows immediately instead of hitting source_not_found_in_graph
  // at runtime.
  try {
    const aligned = await assertSourceRegistryAligned();
    printPreflight("Preflight (post-bootstrap)", aligned);
  } catch (err) {
    if (err instanceof BootstrapPreflightError) {
      printPreflight("Preflight (post-bootstrap)", err.result);
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
