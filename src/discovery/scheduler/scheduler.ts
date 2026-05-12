// Discovery scheduler (ADR-0030 INV-0030-1..5).
//
// Two-phase pattern (INV-0030-2):
//   Phase 1 — fetch: all async, bounded by pool.
//   Phase 2 — write: serial SQLite upserts, no network I/O inside transactions.

import { runWithPool } from "./pool";
import { recordFetchOutcome, getEligibleSources, type FetchOutcome } from "./crawl-state";
import { safeFetch, MAX_BYTES, type SafeFetchOptions } from "../fetch/safe-fetch";

// AbortSignal.timeout() accepts values up to 2^31-1 ms (i32 max) on most
// runtimes. Clamp to 5 minutes as a safe upper bound for a feed poll timeout.
const FETCH_TIMEOUT_MAX_MS = 5 * 60 * 1000; // 300_000

function readPositiveInt(val: string | undefined, fallback: number, max?: number): number {
  if (!val) return fallback;
  // Strict digits-only check: reject "30s", "30_000", leading-zeros, etc.
  if (!/^\d+$/.test(val)) return fallback;
  const n = parseInt(val, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return max !== undefined ? Math.min(n, max) : n;
}

const FETCH_TIMEOUT_MS = readPositiveInt(
  process.env["DISCOVERY_FETCH_TIMEOUT_MS"],
  30_000,
  FETCH_TIMEOUT_MAX_MS,
);

export interface DiscoverySource {
  source_id: string;
  feed_url: string;
}

export interface PollResult {
  source_id: string;
  feed_url: string;
  outcome: FetchOutcome;
  body?: Uint8Array;
  contentType?: string;
}

// Poll all eligible sources from the provided list.
// Returns one PollResult per source attempted.
export async function pollEligibleSources(
  sources: DiscoverySource[]
): Promise<PollResult[]> {
  if (sources.length === 0) return [];

  // Deduplicate by source_id so duplicate entries in the input do not cause
  // multiple concurrent fetches for the same source. Keep the LAST occurrence
  // so that callers that update feed_url and re-queue a source get the newest URL.
  const seenLast = new Map<string, DiscoverySource>();
  for (const s of sources) seenLast.set(s.source_id, s);
  const dedupedSources = [...seenLast.values()];

  const sourceIds = dedupedSources.map((s) => s.source_id);

  const { getDb } = await import("../../storage/sqlite/connection");
  const db = getDb();

  // Determine ineligible set: sources that exist in crawl_state AND have a future
  // next_eligible_at (i.e., are in backoff). Sources absent from crawl_state are
  // eligible by default so first-time sources can be polled.
  const CHUNK_SIZE = 900;
  const now = new Date().toISOString();
  const ineligible = new Set<string>();
  for (let i = 0; i < sourceIds.length; i += CHUNK_SIZE) {
    const chunk = sourceIds.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT source_id FROM crawl_state
         WHERE source_id IN (${placeholders})
           AND next_eligible_at IS NOT NULL
           AND next_eligible_at > ?`
      )
      .all(...chunk, now) as Array<{ source_id: string }>;
    for (const r of rows) ineligible.add(r.source_id);
  }

  const targets = dedupedSources.filter((s) => !ineligible.has(s.source_id));
  if (targets.length === 0) return [];

  // Build conditional fetch headers from stored crawl state.
  // Chunk IN queries to stay within SQLite's variable limit.
  const eligibleIds = targets.map((s) => s.source_id);
  const stateBySource = new Map<string, {
    source_id: string;
    last_etag: string | null;
    last_modified_header: string | null;
  }>();
  for (let i = 0; i < eligibleIds.length; i += CHUNK_SIZE) {
    const chunk = eligibleIds.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT source_id, last_etag, last_modified_header
         FROM crawl_state
         WHERE source_id IN (${placeholders})`
      )
      .all(...chunk) as Array<{
        source_id: string;
        last_etag: string | null;
        last_modified_header: string | null;
      }>;
    for (const r of rows) stateBySource.set(r.source_id, r);
  }

  // Phase 1: bounded parallel fetch.
  const fetchResults = await Promise.allSettled(
    targets.map((src) => {
      const hostname = (() => {
        try { return new URL(src.feed_url).hostname; }
        catch { return src.feed_url; }
      })();
      const state = stateBySource.get(src.source_id);
      const requestHeaders: Record<string, string> = {};
      if (state?.last_etag) requestHeaders["If-None-Match"] = state.last_etag;
      if (state?.last_modified_header) requestHeaders["If-Modified-Since"] = state.last_modified_header;

      const fetchOpts: SafeFetchOptions = {
        maxBytes: MAX_BYTES.rss,
        timeoutMs: FETCH_TIMEOUT_MS,
        requestHeaders: Object.keys(requestHeaders).length > 0 ? requestHeaders : undefined,
      };

      return runWithPool(hostname, async () => {
        try {
          const res = await safeFetch(src.feed_url, fetchOpts);
          const etag = res.headers.get("ETag") ?? undefined;
          const lastMod = res.headers.get("Last-Modified") ?? undefined;
          if (res.status === 304) {
            return {
              source_id: src.source_id,
              feed_url: src.feed_url,
              outcome: { status: "not_modified" as const, etag, lastModified: lastMod },
            };
          }
          // Treat HTTP error responses as fetch failures so backoff applies.
          // 3xx that safeFetch did not follow (e.g. 300 Multiple Choices) are not
          // valid feed responses — treat them as errors. 304 is handled above.
          if (res.status >= 300 && res.status !== 304) {
            return {
              source_id: src.source_id,
              feed_url: src.feed_url,
              outcome: { status: "error" as const },
            };
          }
          return {
            source_id: src.source_id,
            feed_url: src.feed_url,
            outcome: { status: "ok" as const, etag, lastModified: lastMod },
            body: res.body,
            contentType: res.headers.get("Content-Type") ?? undefined,
          };
        } catch (err) {
          const isTimeout =
            err instanceof Error &&
            (err.name === "TimeoutError" || err.message.includes("timed out"));
          const status: FetchOutcome["status"] = isTimeout ? "timeout" : "error";
          return {
            source_id: src.source_id,
            feed_url: src.feed_url,
            outcome: { status },
          };
        }
      });
    })
  );

  // Phase 2: serial write — no network I/O here (INV-0030-2).
  // Record non-ok outcomes immediately (error/timeout/not_modified). "ok" is
  // intentionally deferred: the caller (run-discovery.ts) must record ok only
  // after content is successfully parsed and enqueued, so parse/empty-feed
  // failures can record "error" without first resetting consecutive_failures to 0.
  const results: PollResult[] = [];
  for (const settled of fetchResults) {
    if (settled.status === "fulfilled") {
      const r = settled.value;
      if (r.outcome.status !== "ok") {
        recordFetchOutcome(r.source_id, r.outcome);
      }
      results.push(r);
    }
    // rejected means runWithPool itself threw (unexpected) — skip silently
  }

  return results;
}
