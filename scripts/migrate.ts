#!/usr/bin/env bun
/**
 * Migration runner for k-world-monitor.
 * Applies Neo4j Cypher schema and/or SQLite SQL schema.
 *
 * Usage:
 *   bun run migrate             # both stores
 *   bun run migrate:neo4j       # Neo4j only
 *   bun run migrate:sqlite      # SQLite only
 *   bun run scripts/migrate.ts --neo4j --sqlite --dry-run
 */

import { readFileSync } from "fs";
import { join } from "path";

const args = new Set(Bun.argv.slice(2));
const dryRun = args.has("--dry-run");
const doNeo4j = args.has("--neo4j") || (!args.has("--sqlite") && !args.has("--neo4j"));
const doSqlite = args.has("--sqlite") || (!args.has("--sqlite") && !args.has("--neo4j"));

const REPO_ROOT = join(import.meta.dir, "..");

// ---------------------------------------------------------------------------
// SQLite migration — versioned chain v1 → v3
// ---------------------------------------------------------------------------
const SQLITE_MIGRATIONS: Array<{ version: string; file: string }> = [
  { version: "v1", file: "migrations/sqlite/v1_schema.sql" },
  { version: "v2", file: "migrations/sqlite/v2_enum_constraints.sql" },
  { version: "v3", file: "migrations/sqlite/v3_source_registry_slug_map.sql" },
];

async function migrateSqlite(): Promise<void> {
  const { getDb, getMigrationVersion } = await import("../src/storage/sqlite/connection");

  if (dryRun) {
    const current = getMigrationVersion();
    const pending = SQLITE_MIGRATIONS.filter((m) => m.version > (current ?? ""));
    if (pending.length === 0) {
      console.log("[SQLite] --dry-run: already at latest version.");
    } else {
      for (const m of pending) {
        console.log(`[SQLite] --dry-run: would apply ${m.file} (${m.version})`);
      }
    }
    return;
  }

  for (const migration of SQLITE_MIGRATIONS) {
    const current = getMigrationVersion();
    if (current !== null && current >= migration.version) {
      console.log(`[SQLite] Already at ${current} — skipping ${migration.version}.`);
      continue;
    }
    const sqlPath = join(REPO_ROOT, migration.file);
    const sql = readFileSync(sqlPath, "utf-8");
    getDb().exec(sql);
    console.log(`[SQLite] ✓ Applied ${migration.file}`);
  }
}

// ---------------------------------------------------------------------------
// Neo4j migration
// ---------------------------------------------------------------------------
async function migrateNeo4j(): Promise<void> {
  const { withSession, verifyConnectivity, closeDriver } = await import(
    "../src/storage/neo4j/connection"
  );
  const cypherPath = join(REPO_ROOT, "migrations/neo4j/v1_schema.cypher");
  const raw = readFileSync(cypherPath, "utf-8");

  // Split on semicolons, strip comments and blanks, collect executable statements.
  const statements = raw
    .split(";")
    .map((s) => s.replace(/\/\/.*$/gm, "").trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  if (dryRun) {
    console.log(`[Neo4j] --dry-run: would apply ${statements.length} statements from ${cypherPath}`);
    return;
  }

  try {
    await verifyConnectivity();
  } catch (err) {
    console.error("[Neo4j] Connection failed. Is Neo4j running?", err);
    process.exit(1);
  }

  let applied = 0;
  let skipped = 0;

  await withSession(async (session) => {
    for (const stmt of statements) {
      try {
        await session.run(stmt);
        applied++;
      } catch (err: unknown) {
        // Neo4j returns specific error codes for "already exists" — treat as idempotent.
        const neo4jErr = err as { code?: string; message?: string };
        if (
          neo4jErr.code === "Neo.ClientError.Schema.EquivalentSchemaRuleAlreadyExists" ||
          neo4jErr.code === "Neo.ClientError.Schema.ConstraintAlreadyExists" ||
          neo4jErr.code === "Neo.ClientError.Schema.IndexAlreadyExists"
        ) {
          skipped++;
        } else {
          console.error("[Neo4j] Statement failed:", stmt.slice(0, 100), "\nError:", neo4jErr.message);
          throw err;
        }
      }
    }
  });

  await closeDriver();
  console.log(`[Neo4j] ✓ Applied ${applied} statements, ${skipped} already existed.`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log(`k-world-monitor migration runner (dry-run=${dryRun})`);

  if (doSqlite) await migrateSqlite();
  if (doNeo4j) await migrateNeo4j();

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
