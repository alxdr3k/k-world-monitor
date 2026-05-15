#!/usr/bin/env bun
/**
 * CLI: process discovery_queue rows — fetch URLs + create Snapshot fingerprints
 * (INFRA-1B.3.h2-queue-cli, AI-P1-3).
 *
 * Reads source policy from SQLite `source_material_policy`. Each queue row in
 * status='pending' is claimed (status='processing'), fetched via safeFetch
 * (or rejected per archive_policy / 8 위험 행동 rules), then snapshot-
 * fingerprinted with content_hash dedup + conditional R2 upload for permitted
 * artifacts (full_snapshot_allowed + allowed_public_data_only).
 *
 * Usage:
 *   bun run discovery:process-queue            # process pending rows
 *   bun run discovery:process-queue --dry-run  # report pending count, no writes
 *
 * E2E sequence (post-AI-P1-2 INFRA-1B.1.h1-source-bootstrap-neo4j land):
 *
 *   bun run migrate:sqlite
 *   bun run migrate:neo4j
 *   bun run seed-sources:neo4j   # SQLite seed + Neo4j Source bootstrap + preflight
 *   bun run discovery:run        # poll RSS / sitemaps, enqueue candidates
 *   bun run discovery:process-queue  # process enqueued rows → Snapshot fingerprint
 *
 * AI-P1-3 unified `source_not_found_in_graph` error_code: snapshot-fingerprint's
 * new-path (createDocumentAndSnapshot) now throws TypedQueueError with the
 * specific code instead of plain Error (previously bucketed as runtime_error).
 * Dedup-path (ensureSourceLinkage) already used TypedQueueError. Operator
 * alerts can now cover ONE error_code for the entire missing-Source class.
 */

import {
  processDiscoveryQueue,
  type ArchivePolicy,
  type RawCloudPolicy,
} from "./snapshot-fingerprint";
import { getDb, closeDb } from "../../storage/sqlite/connection";
import { closeDriver } from "../../storage/neo4j/connection";
import { isArchivePolicy, isRawCloudPolicy } from "../../utils/enums";

// ---------------------------------------------------------------------------
// SQLite-backed policy lookup.
//
// discovery_queue.source_id has a FK to source_material_policy(source_id)
// per the v6 schema, so an unregistered source_id should be impossible. If
// it does happen (DB corruption / out-of-band INSERT bypassing the FK),
// we throw an actionable error so processOneRow's catch records it as
// `runtime_error` with the diagnostic message. We do NOT silently default
// to `do_not_collect` because that would mask the corruption as a routine
// policy decision in the queue ledger.
//
// Exported via `__TEST_*` aliases below for tests/unit/run_process_queue_test.ts
// (Bun module mocking + the SQLite singleton makes direct unit testing of the
// builder cleaner than mocking process.exit / argv).
// ---------------------------------------------------------------------------

export function makeArchivePolicyLookup() {
  const stmt = getDb().prepare<
    { archive_policy: string; raw_cloud_policy: string },
    [string]
  >(
    "SELECT archive_policy, raw_cloud_policy FROM source_material_policy WHERE source_id = ?"
  );
  return async (sourceId: string): Promise<{
    archivePolicy: ArchivePolicy;
    rawCloudPolicy: RawCloudPolicy;
  }> => {
    const row = stmt.get(sourceId);
    if (!row) {
      throw new Error(
        `source_material_policy row not found for source_id=${sourceId}. ` +
          `discovery_queue FK should have prevented this — check for direct INSERTs or stale slug_map.`
      );
    }
    if (!isArchivePolicy(row.archive_policy)) {
      throw new Error(
        `Invalid archive_policy=${row.archive_policy} for source_id=${sourceId}`
      );
    }
    if (!isRawCloudPolicy(row.raw_cloud_policy)) {
      throw new Error(
        `Invalid raw_cloud_policy=${row.raw_cloud_policy} for source_id=${sourceId}`
      );
    }
    return {
      archivePolicy: row.archive_policy as ArchivePolicy,
      rawCloudPolicy: row.raw_cloud_policy as RawCloudPolicy,
    };
  };
}

// ---------------------------------------------------------------------------
// Dry-run snapshot of pending rows — no writes.
// ---------------------------------------------------------------------------

export interface PendingSummary {
  total: number;
  bySource: Array<{ source_id: string; count: number }>;
  staleProcessing: number;
}

// ---------------------------------------------------------------------------
// Argument parsing — fail-fast on unknown flags (Codex PR #45 P2 fix).
//
// Bug: the previous `process.argv.includes("--dry-run")` check silently
// accepted ANY non-`--dry-run` argument as a real processing run. A typo
// like `--dryrun` or `--dry_run` would skip the dry-run intent and execute
// fetch + Neo4j + R2 writes — mutating queue state when the operator
// believed they were doing a preview. For an operator-facing CLI that
// mutates production state, permissive argv handling is a footgun.
//
// Fix: parse argv against an allowlist; unknown tokens raise UnknownArgumentError
// with the offending arguments + known-flag list + usage line. Exported so
// tests/ can verify the rejection contract without spawning a subprocess.
// ---------------------------------------------------------------------------

export interface ParsedArgs {
  dryRun: boolean;
}

const KNOWN_FLAGS = new Set(["--dry-run"]);
const USAGE_LINE = "Usage: bun run discovery:process-queue [--dry-run]";

export class UnknownArgumentError extends Error {
  constructor(public readonly unknown: ReadonlyArray<string>) {
    super(
      `Unknown argument(s): ${unknown.join(", ")}\n` +
        `Known flags: ${[...KNOWN_FLAGS].join(", ")}\n` +
        USAGE_LINE
    );
    this.name = "UnknownArgumentError";
  }
}

export function parseArgs(argv: ReadonlyArray<string>): ParsedArgs {
  const unknown = argv.filter((a) => !KNOWN_FLAGS.has(a));
  if (unknown.length > 0) {
    throw new UnknownArgumentError(unknown);
  }
  return { dryRun: argv.includes("--dry-run") };
}

export function pendingSnapshot(): PendingSummary {
  const db = getDb();
  const total = (db
    .query<{ n: number }, []>(
      "SELECT COUNT(*) AS n FROM discovery_queue WHERE status = 'pending'"
    )
    .get()?.n ?? 0) as number;
  const bySource = db
    .query<{ source_id: string; count: number }, []>(
      `SELECT source_id, COUNT(*) AS count
       FROM discovery_queue WHERE status = 'pending'
       GROUP BY source_id
       ORDER BY count DESC, source_id ASC`
    )
    .all();
  // Stale-reclaim window matches snapshot-fingerprint's STALE_RECLAIM_THRESHOLD_MS
  // (1 hour). Surfaces rows that would be reclaimed at the start of the next
  // non-dry-run invocation.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
  const staleProcessing = (db
    .query<{ n: number }, [string]>(
      "SELECT COUNT(*) AS n FROM discovery_queue WHERE status = 'processing' AND updated_at < ?"
    )
    .get(oneHourAgo)?.n ?? 0) as number;
  return { total, bySource, staleProcessing };
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  // Argv slice(2) drops `bun` + script path. parseArgs raises
  // UnknownArgumentError on typos / stray args (Codex PR #45 P2 fix).
  const { dryRun } = parseArgs(process.argv.slice(2));

  if (dryRun) {
    const summary = pendingSnapshot();
    console.log(
      `discovery_queue pending: ${summary.total} rows${summary.staleProcessing > 0 ? ` (+${summary.staleProcessing} stale 'processing' would be reclaimed on next run)` : ""}`
    );
    if (summary.bySource.length === 0) {
      console.log("(no pending rows)");
    } else {
      console.log("\nPer-source breakdown:");
      for (const { source_id, count } of summary.bySource) {
        console.log(`  ${source_id}  ${count}`);
      }
    }
    console.log("\nDry-run: no fetch / Neo4j / R2 writes performed.");
    return 0;
  }

  const archivePolicyFn = makeArchivePolicyLookup();
  console.log("Processing discovery_queue (batch size 100, stale reclaim 1h) ...");
  const t0 = Date.now();
  const result = await processDiscoveryQueue(archivePolicyFn);
  const elapsedMs = Date.now() - t0;

  console.log(
    `\nQueue processing done in ${elapsedMs}ms. ` +
      `processed=${result.processed} deduplicated=${result.deduplicated} errors=${result.errors}`
  );
  if (result.errors > 0) {
    console.log(
      `\nReview error rows with: SELECT queue_id, source_id, url, error_code, error_detail ` +
        `FROM discovery_queue WHERE status = 'error' ORDER BY updated_at DESC LIMIT 50;`
    );
    console.log(
      `Common error_code values: source_not_found_in_graph (Neo4j Source missing — run ` +
        `\`bun run seed-sources:neo4j\` + \`bun run seed-sources:preflight\`), ` +
        `policy_do_not_collect (archive_policy=do_not_collect), ` +
        `dedup_prohibited_source (cross-source policy block), ` +
        `http_status / empty_body / runtime_error.`
    );
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Test-only re-exports. The runtime CLI uses the bare names (makeArchivePolicyLookup
// + pendingSnapshot); these aliased re-exports mark the dependency direction
// from tests/ explicitly. The CLI is NOT imported by tests directly to avoid
// side-effects of the `run()` invocation at the bottom of the file.
// ---------------------------------------------------------------------------

export { makeArchivePolicyLookup as __TEST_makeArchivePolicyLookup };
export { pendingSnapshot as __TEST_pendingSnapshot };

async function run(): Promise<void> {
  let exitCode = 0;
  try {
    exitCode = await main();
  } catch (err) {
    console.error((err as Error).message);
    exitCode = 1;
  } finally {
    // Mirror scripts/seed-sources.ts pattern — close Neo4j driver (snapshot-
    // fingerprint opens sessions via withSession) and SQLite connection so
    // the CLI does not hang after success.
    await closeDriver();
    closeDb();
  }
  process.exit(exitCode);
}

// Bun-native entry-point guard: only auto-invoke when this file is the
// process entry (via `bun run discovery:process-queue` / direct
// `bun run <path>`). When imported by tests/ for unit testing, the side-
// effect of run() (Neo4j session open + SQLite read) must not fire.
if (import.meta.main) {
  run();
}
