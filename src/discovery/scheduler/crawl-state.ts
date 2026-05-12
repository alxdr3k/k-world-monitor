// crawl_state SQLite CRUD (ADR-0030 INV-0030-5).
// All writes are synchronous (bun:sqlite) and must be called from the
// serial write phase — never inside an async fetch task (INV-0030-2).

import { getDb } from "../../storage/sqlite/connection";

const BACKOFF_FAILURES = 5;
const BACKOFF_MS = 24 * 60 * 60 * 1000; // 24 hours

export type CrawlStatus = "pending" | "ok" | "not_modified" | "error" | "timeout";

export interface CrawlState {
  source_id: string;
  last_polled_at: string | null;
  last_etag: string | null;
  last_modified_header: string | null;
  last_status: CrawlStatus;
  consecutive_failures: number;
  next_eligible_at: string | null;
}

export interface FetchOutcome {
  status: CrawlStatus;
  etag?: string | null;
  lastModified?: string | null;
}

// Return sources eligible for polling: sources with no crawl_state row are
// treated as eligible (never-polled), as are sources whose next_eligible_at
// is NULL or <= now. Brand-new sources (no row yet) must be included so they
// are polled on their first pass.
export function getEligibleSources(sourceIds: string[]): CrawlState[] {
  if (sourceIds.length === 0) return [];
  const db = getDb();
  const now = new Date().toISOString();
  // Deduplicate sourceIds before building SQL placeholders and synthesizing new rows.
  // Duplicate IDs would produce duplicate crawl_state rows in the output and could
  // generate multiple SQL placeholders for the same source.
  const uniqueSourceIds = [...new Set(sourceIds)];

  // Chunk IN queries to stay within SQLite's ~999 variable limit (use 900 for headroom).
  const CHUNK_SIZE = 900;
  const existing: CrawlState[] = [];
  for (let i = 0; i < uniqueSourceIds.length; i += CHUNK_SIZE) {
    const chunk = uniqueSourceIds.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT source_id, last_polled_at, last_etag, last_modified_header,
                last_status, consecutive_failures, next_eligible_at
         FROM crawl_state
         WHERE source_id IN (${placeholders})
           AND (next_eligible_at IS NULL OR next_eligible_at <= ?)
         ORDER BY last_polled_at ASC NULLS FIRST`
      )
      .all(...chunk, now) as CrawlState[];
    existing.push(...rows);
  }

  // Find source IDs that have ANY row in crawl_state (eligible or in backoff).
  // We must distinguish "has a row but is in backoff" from "has no row at all"
  // to avoid promoting backed-off sources as new.
  const knownIds = new Set<string>();
  for (let i = 0; i < uniqueSourceIds.length; i += CHUNK_SIZE) {
    const chunk = uniqueSourceIds.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT source_id FROM crawl_state WHERE source_id IN (${placeholders})`
      )
      .all(...chunk) as Array<{ source_id: string }>;
    for (const r of rows) knownIds.add(r.source_id);
  }

  // Brand-new sources (no row at all in crawl_state) are eligible by default.
  // Synthesise a CrawlState with null values so callers have uniform records.
  const newSources: CrawlState[] = uniqueSourceIds
    .filter((id) => !knownIds.has(id))
    .map((id) => ({
      source_id: id,
      last_polled_at: null,
      last_etag: null,
      last_modified_header: null,
      last_status: "pending" as CrawlStatus,
      consecutive_failures: 0,
      next_eligible_at: null,
    }));

  // New sources first (never polled) so they are prioritised over existing ones.
  return [...newSources, ...existing];
}

// Return crawl state for a single source, or null if not yet tracked.
export function getCrawlState(sourceId: string): CrawlState | null {
  const db = getDb();
  return (
    (db
      .prepare(
        `SELECT source_id, last_polled_at, last_etag, last_modified_header,
                last_status, consecutive_failures, next_eligible_at
         FROM crawl_state WHERE source_id = ?`
      )
      .get(sourceId) as CrawlState | undefined) ?? null
  );
}

// Upsert crawl_state after a fetch attempt.
// consecutive_failures is reset on ok/not_modified, incremented on error/timeout.
// 5+ consecutive failures → 24h backoff on next_eligible_at.
export function recordFetchOutcome(sourceId: string, outcome: FetchOutcome): void {
  const db = getDb();
  const now = new Date().toISOString();
  const prev = getCrawlState(sourceId);
  const prevFailures = prev?.consecutive_failures ?? 0;

  const isFailure = outcome.status === "error" || outcome.status === "timeout";
  const consecutiveFailures = isFailure ? prevFailures + 1 : 0;

  let nextEligibleAt: string | null = null;
  if (consecutiveFailures >= BACKOFF_FAILURES) {
    nextEligibleAt = new Date(Date.now() + BACKOFF_MS).toISOString();
  }

  // Preserve existing etag/lastModified when the new outcome omits them
  // (errors/timeouts don't return validators; 304 may omit them).
  // COALESCE keeps the prior stored value when the incoming value is NULL.
  db.prepare(
    `INSERT INTO crawl_state
       (source_id, last_polled_at, last_etag, last_modified_header,
        last_status, consecutive_failures, next_eligible_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id) DO UPDATE SET
       last_polled_at        = excluded.last_polled_at,
       last_etag             = COALESCE(excluded.last_etag, crawl_state.last_etag),
       last_modified_header  = COALESCE(excluded.last_modified_header, crawl_state.last_modified_header),
       last_status           = excluded.last_status,
       consecutive_failures  = excluded.consecutive_failures,
       next_eligible_at      = excluded.next_eligible_at`
  ).run(
    sourceId,
    now,
    outcome.etag ?? null,
    outcome.lastModified ?? null,
    outcome.status,
    consecutiveFailures,
    nextEligibleAt
  );
}
