import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { join } from "path";

let _db: Database | null = null;

export function getDb(): Database {
  if (!_db) {
    const dbPath = process.env["SQLITE_PATH"] ?? join(process.cwd(), "research.db");
    _db = new Database(dbPath, { create: true });
    _db.run("PRAGMA journal_mode = WAL");
    _db.run("PRAGMA foreign_keys = ON");
    _db.run("PRAGMA auto_vacuum = INCREMENTAL");
  }
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function applyMigration(sqlPath: string): void {
  const sql = readFileSync(sqlPath, "utf-8");
  getDb().exec(sql);
}

export function getMigrationVersion(): string | null {
  const db = getDb();

  const tableExists = db
    .query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
    )
    .get() as { name: string } | null;

  if (!tableExists) return null;

  const row = db
    .query("SELECT version FROM schema_migrations ORDER BY applied_at DESC LIMIT 1")
    .get() as { version: string } | null;

  return row?.version ?? null;
}
