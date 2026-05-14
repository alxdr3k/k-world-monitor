// Discovery worker v0 entry point (INFRA-1B.2).
// Loads Tier A RSS sources, polls eligible ones, parses feeds, enqueues items.
//
// Usage:
//   bun run src/discovery/worker/run-discovery.ts [--dry-run] [--source <slug>]

import { readFileSync } from "fs";
import { join } from "path";
import { load as yamlLoad } from "js-yaml";
import { pollEligibleSources, type DiscoverySource } from "../scheduler/scheduler";
import { recordFetchOutcome } from "../scheduler/crawl-state";
import { parseRssFeed, enqueueDiscoveredItems } from "./rss-worker";
import { getDb, closeDb } from "../../storage/sqlite/connection";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// DEC-013 §1: Discovery worker caps daily queue insertions at 20 candidates.
// Items beyond the cap are dropped; they receive priority lift on the next day
// via the scheduler's backoff / priority logic.
// Limitation (v0): this cap counts insertions within a single run, not across
// all runs in a calendar day. If the worker is invoked more than once per day,
// each run may insert up to 20 additional items. For the first-publication
// milestone (single daily cron invocation) this is acceptable. Adjust to an
// inter-run DB query when a scheduler with multiple daily invocations lands.
const DAILY_CANDIDATE_CAP = 20;

// ---------------------------------------------------------------------------
// Load sources from seed YAML.
// Parsed via js-yaml (already a transitive dep used by source-registry seed)
// instead of a hand-rolled scalar parser — handles quoted strings, nested
// objects, comments, anchors, and multi-line scalars correctly.
//
// Slug → canonical src_<ULID> resolution happens HERE, at the entry point,
// so every downstream consumer (scheduler, crawl_state, rss-worker,
// discovery_queue, source_material_policy lookups) operates on canonical
// ids only. This removes the dual-form source_id problem that previously
// required normalizeSourceId / resolveCanonicalSourceId helpers in two
// separate modules.
// ---------------------------------------------------------------------------

interface SeedRecord {
  slug: string;
  rss_url?: string;
  access_method?: string;
  reliability_tier?: number;
  active_v0?: boolean;
}

interface SeedFile {
  sources?: SeedRecord[];
}

function isValidHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

// Resolve slug → canonical src_<ULID> via source_registry_slug_map (created by
// INFRA-1B.1 seed). Missing mapping is an operator error — seed must run first.
function resolveCanonicalId(slug: string): string | null {
  if (slug.startsWith("src_")) return slug;
  const row = getDb()
    .prepare("SELECT source_id FROM source_registry_slug_map WHERE slug = ?")
    .get(slug) as { source_id: string } | undefined;
  return row?.source_id ?? null;
}

function loadRssSources(filterSlug?: string): DiscoverySource[] {
  const repoRoot = join(import.meta.dir, "../../..");
  const raw = readFileSync(join(repoRoot, "data/sources_seed.yaml"), "utf-8");
  const parsed = yamlLoad(raw) as SeedFile | null;
  const records = parsed?.sources ?? [];

  const sources: DiscoverySource[] = [];
  for (const r of records) {
    if (!r.slug) continue;
    // ADR-0026 `active_v0`: restrict to v0 active subset. Missing → default
    // true (forward-only filter).
    if (r.active_v0 === false) continue;
    if (r.access_method !== "rss") continue;
    if (r.reliability_tier !== 0) continue;
    if (!r.rss_url) continue;
    if (!isValidHttpUrl(r.rss_url)) {
      console.warn(`[discovery] skip ${r.slug}: rss_url is not a valid http(s) URL`);
      continue;
    }
    if (filterSlug && filterSlug !== r.slug) continue;
    const canonical = resolveCanonicalId(r.slug);
    if (canonical === null) {
      // Operator forgot to run `bun run seed:sources` first. Fail loud
      // rather than fall back to slug-form (would trip the FK on every
      // discovery_queue INSERT downstream).
      throw new Error(
        `[discovery] cannot resolve slug '${r.slug}' to canonical src_<ULID>. ` +
          `Run \`bun run seed:sources\` first to populate source_registry_slug_map.`
      );
    }
    sources.push({ source_id: canonical, feed_url: r.rss_url });
  }
  return sources;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// Known CLI flags; anything else (including single-dash typos like `-source`
// or stray positional tokens) aborts to avoid an accidental full crawl from a
// malformed invocation silently falling back to "no filter = all sources".
const KNOWN_FLAGS = new Set(["--dry-run", "--source"]);
const rawArgs = process.argv.slice(2);
for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i]!;
  if (a === "--source") {
    // --source consumes the next token as its value (validated below).
    i++;
    continue;
  }
  if (KNOWN_FLAGS.has(a)) continue; // valueless known flag (--dry-run)
  // Reject any other token: unknown long flag, single-dash form, or stray positional.
  console.error(`[discovery] Error: unknown argument ${a}`);
  process.exit(1);
}
const dryRun = rawArgs.includes("--dry-run");
const filterSlug = (() => {
  const idx = process.argv.indexOf("--source");
  if (idx < 0) return undefined;
  const next = process.argv[idx + 1];
  // Reject missing value or another flag passed as the slug argument.
  if (!next || next.startsWith("--")) {
    console.error("[discovery] Error: --source requires a slug argument");
    process.exit(1);
  }
  return next;
})();

async function main(): Promise<void> {
  const sources = loadRssSources(filterSlug);
  console.log(`[discovery] Loaded ${sources.length} RSS sources (Tier A)`);

  // Fail fast on a typoed/stale --source slug — a silent 0-source run looks
  // identical to a successful no-op and delays detection of ingestion outages.
  if (filterSlug && sources.length === 0) {
    console.error(`[discovery] Error: --source "${filterSlug}" matched no configured source`);
    process.exit(1);
  }

  if (dryRun) {
    for (const s of sources) {
      console.log(`  [dry-run] ${s.source_id}: ${s.feed_url}`);
    }
    return;
  }

  // Phase 1: bounded parallel fetch via pollEligibleSources (INV-0030-1, INV-0030-2).
  // All eligible sources are fetched upfront; the daily cap is applied during enqueue
  // (Phase 2). Fetches beyond the cap are discarded. Acceptable for v0 (small source
  // pool); revisit if source count grows significantly.
  const pollResults = await pollEligibleSources(sources);
  console.log(`[discovery] Polled ${pollResults.length} sources`);

  let totalInserted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  // Phase 2: parse RSS bodies and enqueue (serial, INV-0030-2)
  // DEC-013: stop inserting once DAILY_CANDIDATE_CAP insertions are reached.
  let capLogged = false;
  for (const result of pollResults) {
    const { source_id, outcome, body, contentType } = result;

    if (outcome.status === "not_modified") {
      console.log(`  [skip] ${source_id}: 304 Not Modified`);
      continue;
    }

    if (outcome.status === "error" || outcome.status === "timeout") {
      console.log(`  [fail] ${source_id}: ${outcome.status}`);
      totalErrors++;
      continue;
    }

    if (!body || body.byteLength === 0) {
      console.log(`  [empty] ${source_id}: empty body`);
      recordFetchOutcome(source_id, { status: "error" });
      totalErrors++;
      continue;
    }

    // Only parse text-based content (xml/rss/atom/html — not binaries).
    // Non-text content-type is treated as a fetch failure: record error so the
    // source enters backoff (same path as parse failure and empty body).
    // HTTP media types are case-insensitive per RFC 9110; lowercase before match.
    const ct = (contentType ?? "").toLowerCase();
    if (ct.includes("application/octet-stream") || ct.includes("image/")) {
      console.log(`  [fail] ${source_id}: non-text content-type ${contentType}`);
      recordFetchOutcome(source_id, { status: "error" });
      totalErrors++;
      continue;
    }

    try {
      // Detect charset: Content-Type first, then XML prolog (`<?xml ... encoding="..."?>`).
      // Fall back to UTF-8 if neither is present.
      let charset = "utf-8";
      const charsetMatch = ct.match(/charset=([^\s;]+)/i);
      if (charsetMatch) {
        // Tolerate single or double quotes surrounding the charset value
        // (e.g. charset='utf-8' or charset="utf-8"), then strip any
        // trailing/leading non-label characters (stray punctuation, residual
        // quote). WHATWG encoding labels are [a-z0-9._+-]+ (case-insensitive
        // — we already lowercased); reject anything else from the edges so a
        // typo like `utf-8"` does not force the whole source into backoff
        // for legitimate UTF-8 content, while still keeping legitimate
        // labels with `.` or `+` (e.g. iso-2022-jp) intact.
        charset = charsetMatch[1]!
          .toLowerCase()
          .replace(/^["'](.*)["']$/, "$1")
          .replace(/^[^a-z0-9._+-]+|[^a-z0-9._+-]+$/g, "");
        if (!charset) charset = "utf-8";
      } else {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const prefix = new TextDecoder("ascii" as any, { fatal: false }).decode(body.slice(0, 200));
          const prolog = prefix.match(/<\?xml[^?>]*encoding=["']([^"']+)["']/i);
          if (prolog) charset = prolog[1]!.toLowerCase();
        } catch {
          // keep utf-8 default
        }
      }
      let decoder: TextDecoder;
      try {
        // charset is a runtime string from Content-Type / XML prolog — Bun's
        // TextDecoder types restrict the label parameter to a literal union,
        // so we cast through unknown. Unsupported labels (e.g. some bundles
        // lack EUC-KR) throw RangeError — surface as a parse error rather
        // than silently mojibake'ing into UTF-8, so the source enters backoff.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        decoder = new TextDecoder(charset as any, { fatal: false });
      } catch {
        throw new Error(`unsupported declared charset: ${charset}`);
      }
      const xmlText = decoder.decode(body);
      const items = parseRssFeed(xmlText);

      if (items.length === 0) {
        // Zero items after a successful HTTP 200 indicates a persistent non-feed
        // or empty feed. Record as error so the source enters backoff rather than
        // being polled again immediately on the next run.
        console.log(`  [empty-feed] ${source_id}: 0 items parsed — recording error`);
        recordFetchOutcome(source_id, { status: "error" });
        totalErrors++;
        continue;
      }

      // DEC-013 daily cap: parse every source for health validation but cap the
      // insert budget. With remaining=0 the enqueue is a no-op while parse still
      // surfaces empty/malformed feeds via the items.length === 0 / catch paths
      // so they enter backoff (codex finding: cap-reached sources must still be
      // validated, not silently marked ok).
      const remaining = Math.max(0, DAILY_CANDIDATE_CAP - totalInserted);
      if (remaining === 0 && !capLogged) {
        console.log(`[discovery] Daily candidate cap (${DAILY_CANDIDATE_CAP}) reached — parsing remaining sources for health validation only`);
        capLogged = true;
      }
      const { inserted, skipped } = enqueueDiscoveredItems(source_id, items, remaining);
      totalInserted += inserted;
      totalSkipped += skipped;
      console.log(
        `  [ok] ${source_id}: ${items.length} items → +${inserted} queued, ${skipped} dupes`
      );
      // Record ok only after successful parse + enqueue so parse/empty-feed
      // errors can record "error" without the prior HTTP-ok write resetting
      // consecutive_failures back to 0 (Codex P1 — oscillation fix).
      recordFetchOutcome(source_id, outcome);
    } catch (err) {
      console.error(`  [parse-error] ${source_id}:`, err instanceof Error ? err.message : err);
      recordFetchOutcome(source_id, { status: "error" });
      totalErrors++;
    }
  }

  console.log(
    `[discovery] Done — inserted: ${totalInserted}, skipped: ${totalSkipped}, errors: ${totalErrors}`
  );
}

// Graceful shutdown: ensure SQLite WAL checkpoint + Neo4j driver close before
// process exit. cron environments leave the process running across multiple
// invocations only if the entry point re-imports the module, but explicit
// teardown is still required to flush WAL pages and release the driver's
// connection pool. Discovery worker v0 does not open a Neo4j session
// (Snapshot fingerprint writes are in INFRA-1B.3 worker, not here), so only
// closeDb() is required at this entry point.
async function shutdown(): Promise<void> {
  try {
    closeDb();
  } catch (err) {
    console.error("[discovery] shutdown error (closeDb):", err);
  }
}

main()
  .then(async () => {
    await shutdown();
  })
  .catch(async (err) => {
    console.error(err);
    await shutdown();
    process.exit(1);
  });
