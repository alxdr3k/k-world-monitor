#!/usr/bin/env bun
/**
 * CLI: seed source_material_policy table from data/sources_seed.yaml (INFRA-1B.1).
 *
 * Usage:
 *   bun run seed-sources            # insert missing rows
 *   bun run seed-sources --dry-run  # validate + print plan, no DB writes
 */

import { seedSources } from "../src/storage/source-registry/seed";

const dryRun = process.argv.includes("--dry-run");

try {
  const result = seedSources({ dryRun });

  for (const row of result.rows) {
    const tag = row.action === "inserted" ? "[+]" : "[~]";
    console.log(`${tag} ${row.source_id}  ${row.slug}  (${row.archive_policy} / ${row.raw_cloud_policy})`);
  }

  console.log(
    `\nDone${dryRun ? " (dry-run — assumes fresh DB)" : ""}. inserted=${result.inserted} updated=${result.updated} total=${result.rows.length}`
  );
  process.exit(0);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
