/**
 * Unit tests for the `discovery:process-queue` CLI policy lookup +
 * dry-run summary (INFRA-1B.3.h2-queue-cli, AI-P1-3).
 *
 * The CLI itself calls `processDiscoveryQueue()` (already covered by
 * snapshot_fingerprint_test.ts) — these tests cover the CLI-specific
 * extras that are not exercised in the existing suite:
 *
 *   1. SQLite-backed `archivePolicyFn` builder — verifies enum validation,
 *      missing-row diagnostics, and the actionable error message when
 *      source_material_policy is missing a queue row's source_id.
 *   2. Dry-run snapshot counts pending + per-source breakdown + stale-
 *      'processing' rows without touching Neo4j / R2.
 */

import { describe, it, expect, beforeEach } from "bun:test";

process.env["SQLITE_PATH"] = ":memory:";

import { getDb, closeDb } from "../../src/storage/sqlite/connection";
import {
  __TEST_makeArchivePolicyLookup as makeArchivePolicyLookup,
  __TEST_pendingSnapshot as pendingSnapshot,
  parseArgs,
  UnknownArgumentError,
} from "../../src/discovery/worker/run-process-queue";

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
      checked_at           TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z'
    );
    CREATE TABLE IF NOT EXISTS discovery_queue (
      queue_id      TEXT NOT NULL PRIMARY KEY,
      source_id     TEXT NOT NULL,
      url           TEXT NOT NULL,
      title         TEXT,
      published_at  TEXT,
      discovered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      content_hash  TEXT,
      status        TEXT NOT NULL DEFAULT 'pending',
      snap_id       TEXT,
      error_code    TEXT,
      error_detail  TEXT,
      updated_at    TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z'
    );
  `);
  return db;
}

function insertPolicy(
  sourceId: string,
  archivePolicy: string,
  rawCloudPolicy: string
): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO source_material_policy
       (source_id, archive_policy, raw_cloud_policy, external_llm_policy)
       VALUES (?, ?, ?, 'allowed')`
    )
    .run(sourceId, archivePolicy, rawCloudPolicy);
}

function insertQueue(
  queueId: string,
  sourceId: string,
  url: string,
  status: "pending" | "processing" = "pending",
  updatedAt?: string
): void {
  getDb()
    .prepare(
      `INSERT INTO discovery_queue (queue_id, source_id, url, status, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(queueId, sourceId, url, status, updatedAt ?? "1970-01-01T00:00:00Z");
}

beforeEach(() => {
  setupDb();
});

// ---------------------------------------------------------------------------
// makeArchivePolicyLookup
// ---------------------------------------------------------------------------

describe("makeArchivePolicyLookup", () => {
  it("returns archive_policy + raw_cloud_policy for a known source_id", async () => {
    insertPolicy("src-ok", "full_snapshot_allowed", "allowed_public_data_only");
    const lookup = makeArchivePolicyLookup();
    const result = await lookup("src-ok");
    expect(result).toEqual({
      archivePolicy: "full_snapshot_allowed",
      rawCloudPolicy: "allowed_public_data_only",
    });
  });

  it("returns restrictive policy values verbatim (metadata_only + always_prohibited)", async () => {
    insertPolicy("src-meta", "metadata_only", "always_prohibited");
    const lookup = makeArchivePolicyLookup();
    const result = await lookup("src-meta");
    expect(result.archivePolicy).toBe("metadata_only");
    expect(result.rawCloudPolicy).toBe("always_prohibited");
  });

  it("throws actionable error when source_id is absent from source_material_policy", async () => {
    const lookup = makeArchivePolicyLookup();
    let caught: unknown;
    try {
      await lookup("src-unknown");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain(
      "source_material_policy row not found"
    );
    expect((caught as Error).message).toContain("src-unknown");
    expect((caught as Error).message).toContain("FK should have prevented");
  });

  it("throws when archive_policy enum is invalid (DB corruption)", async () => {
    insertPolicy("src-corrupt", "INVALID_VALUE", "allowed_public_data_only");
    const lookup = makeArchivePolicyLookup();
    await expect(lookup("src-corrupt")).rejects.toThrow(
      /Invalid archive_policy=INVALID_VALUE/
    );
  });

  it("throws when raw_cloud_policy enum is invalid (DB corruption)", async () => {
    insertPolicy("src-corrupt", "full_snapshot_allowed", "INVALID_VALUE");
    const lookup = makeArchivePolicyLookup();
    await expect(lookup("src-corrupt")).rejects.toThrow(
      /Invalid raw_cloud_policy=INVALID_VALUE/
    );
  });
});

// ---------------------------------------------------------------------------
// pendingSnapshot — dry-run summary
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// parseArgs — fail-fast on unknown flags (Codex PR #45 P2 fix)
// ---------------------------------------------------------------------------

describe("parseArgs — fail-fast argv handling", () => {
  it("accepts empty argv (default = real processing run)", () => {
    expect(parseArgs([])).toEqual({ dryRun: false });
  });

  it("accepts --dry-run", () => {
    expect(parseArgs(["--dry-run"])).toEqual({ dryRun: true });
  });

  it("rejects --dryrun typo (no hyphen) with UnknownArgumentError", () => {
    let caught: unknown;
    try {
      parseArgs(["--dryrun"]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnknownArgumentError);
    const err = caught as UnknownArgumentError;
    expect(err.unknown).toEqual(["--dryrun"]);
    expect(err.message).toContain("Unknown argument(s): --dryrun");
    expect(err.message).toContain("Known flags: --dry-run");
    expect(err.message).toContain(
      "Usage: bun run discovery:process-queue [--dry-run]"
    );
  });

  it("rejects --dry_run typo (underscore) with UnknownArgumentError", () => {
    expect(() => parseArgs(["--dry_run"])).toThrow(UnknownArgumentError);
  });

  it("rejects unknown flag mixed with valid --dry-run", () => {
    let caught: unknown;
    try {
      parseArgs(["--dry-run", "--force"]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnknownArgumentError);
    expect((caught as UnknownArgumentError).unknown).toEqual(["--force"]);
  });

  it("rejects multiple unknown args (reports all in message)", () => {
    let caught: unknown;
    try {
      parseArgs(["--foo", "--bar", "--baz"]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnknownArgumentError);
    expect((caught as UnknownArgumentError).unknown).toEqual([
      "--foo",
      "--bar",
      "--baz",
    ]);
    expect((caught as Error).message).toContain("--foo, --bar, --baz");
  });

  it("rejects positional arguments (no positional flags supported)", () => {
    expect(() => parseArgs(["queue_id_001"])).toThrow(UnknownArgumentError);
  });
});

describe("pendingSnapshot", () => {
  it("returns zero counts when discovery_queue is empty", () => {
    const summary = pendingSnapshot();
    expect(summary.total).toBe(0);
    expect(summary.bySource).toEqual([]);
    expect(summary.staleProcessing).toBe(0);
  });

  it("counts only 'pending' status rows (ignores 'processing' / 'done' / 'error')", () => {
    insertQueue("dq_p1", "src-A", "https://example.com/a", "pending");
    insertQueue("dq_p2", "src-A", "https://example.com/b", "pending");
    insertQueue("dq_proc", "src-A", "https://example.com/c", "processing");
    getDb()
      .prepare(
        "INSERT INTO discovery_queue (queue_id, source_id, url, status) VALUES (?, ?, ?, ?)"
      )
      .run("dq_done", "src-A", "https://example.com/d", "done");

    const summary = pendingSnapshot();
    expect(summary.total).toBe(2);
    expect(summary.bySource).toEqual([{ source_id: "src-A", count: 2 }]);
  });

  it("breaks down pending rows per source_id sorted by count DESC then source_id ASC", () => {
    insertQueue("dq_1", "src-A", "https://a.example.com/1");
    insertQueue("dq_2", "src-B", "https://b.example.com/1");
    insertQueue("dq_3", "src-B", "https://b.example.com/2");
    insertQueue("dq_4", "src-B", "https://b.example.com/3");
    insertQueue("dq_5", "src-C", "https://c.example.com/1");
    insertQueue("dq_6", "src-C", "https://c.example.com/2");

    const summary = pendingSnapshot();
    expect(summary.total).toBe(6);
    expect(summary.bySource).toEqual([
      { source_id: "src-B", count: 3 }, // highest count first
      { source_id: "src-C", count: 2 }, // ties broken by source_id ASC
      { source_id: "src-A", count: 1 },
    ]);
  });

  it("counts stale 'processing' rows whose updated_at is older than 1 hour", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z");
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z");
    insertQueue("dq_stale", "src-A", "https://example.com/stale", "processing", twoHoursAgo);
    insertQueue("dq_fresh", "src-A", "https://example.com/fresh", "processing", fiveMinutesAgo);

    const summary = pendingSnapshot();
    expect(summary.staleProcessing).toBe(1); // only the 2h-old row
  });
});
