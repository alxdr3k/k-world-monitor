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
// SQLite migration — versioned chain v1 → v7
// ---------------------------------------------------------------------------
const SQLITE_MIGRATIONS: Array<{ version: string; file: string }> = [
  { version: "v1", file: "migrations/sqlite/v1_schema.sql" },
  { version: "v2", file: "migrations/sqlite/v2_enum_constraints.sql" },
  { version: "v3", file: "migrations/sqlite/v3_source_registry_slug_map.sql" },
  { version: "v4", file: "migrations/sqlite/v4_run_ledger_completed_at_idx.sql" },
  { version: "v5", file: "migrations/sqlite/v5_crawl_state.sql" },
  { version: "v6", file: "migrations/sqlite/v6_discovery_queue.sql" },
  { version: "v7", file: "migrations/sqlite/v7_policy_decisions_intended_action.sql" },
  { version: "v8", file: "migrations/sqlite/v8_audit_hardening.sql" },
  { version: "v9", file: "migrations/sqlite/v9_policy_decisions_snap_id.sql" },
];

// Parse "v<N>" → integer for numeric comparison. Lexicographic string compare
// ("v10" < "v2") breaks once v10 lands; align all version arithmetic on the
// numeric SUBSTR pattern that getMigrationVersion() already uses (Codex PR
// #39 reviewer P2/P3).
function versionNum(v: string | null): number {
  if (!v) return 0;
  const n = Number(v.replace(/^v/, ""));
  return Number.isFinite(n) ? n : 0;
}

async function migrateSqlite(): Promise<void> {
  const { getDb, getMigrationVersion } = await import("../src/storage/sqlite/connection");

  if (dryRun) {
    const current = getMigrationVersion();
    const pending = SQLITE_MIGRATIONS.filter(
      (m) => versionNum(m.version) > versionNum(current)
    );
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
    if (current !== null && versionNum(current) >= versionNum(migration.version)) {
      console.log(`[SQLite] Already at ${current} — skipping ${migration.version}.`);
      continue;
    }
    const sqlPath = join(REPO_ROOT, migration.file);
    const sql = readFileSync(sqlPath, "utf-8");
    // Wrap each migration in BEGIN/COMMIT so a multi-statement file that
    // errors mid-way rolls back cleanly instead of leaving the DB with
    // partial DDL applied AND no schema_migrations row (the resulting
    // state masks the original failure on re-run because IF NOT EXISTS
    // makes the surviving partial state look idempotent). SQLite supports
    // DDL inside transactions; the only exception (CREATE VIRTUAL TABLE
    // for some FTS5 variants) is not used in this project's migrations.
    const db = getDb();
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.exec("COMMIT");
    } catch (err) {
      try { db.exec("ROLLBACK"); } catch { /* ignore rollback failure */ }
      // Defense-in-depth for ADD COLUMN migrations: SQLite has no native
      // "ADD COLUMN IF NOT EXISTS", so a re-run after a successful apply
      // throws "duplicate column name". The primary guard is the version
      // check above (now fixed in connection.ts getMigrationVersion to
      // order by version, not applied_at second-precision). This catch
      // handles the residual case where schema_migrations is missing or
      // stale: strip all ALTER TABLE statements (which are intrinsically
      // non-idempotent) and re-run the remainder of the file — CREATE
      // TABLE/INDEX use IF NOT EXISTS and INSERT INTO schema_migrations
      // uses OR IGNORE, so the rest is safely idempotent.
      // Codex PR #39 P1 — v7 ADD COLUMN intended_action.
      const msg = err instanceof Error ? err.message : String(err);
      if (/duplicate column name/i.test(msg)) {
        const idempotentSql = sql.replace(/^\s*ALTER\s+TABLE[^;]*;/gim, "");
        db.exec("BEGIN");
        try {
          db.exec(idempotentSql);
          db.exec("COMMIT");
          console.log(
            `[SQLite] ${migration.version}: ALTER skipped (column already exists) — applied idempotent remainder`
          );
        } catch (retryErr) {
          try { db.exec("ROLLBACK"); } catch { /* ignore rollback failure */ }
          throw retryErr;
        }
      } else {
        throw err;
      }
    }
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
