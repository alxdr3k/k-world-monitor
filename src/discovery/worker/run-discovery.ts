// Discovery worker v0 entry point (INFRA-1B.2).
// Loads Tier A RSS sources, polls eligible ones, parses feeds, enqueues items.
//
// Usage:
//   bun run src/discovery/worker/run-discovery.ts [--dry-run] [--source <slug>]

import { readFileSync } from "fs";
import { join } from "path";
import { pollEligibleSources, type DiscoverySource } from "../scheduler/scheduler";
import { recordFetchOutcome } from "../scheduler/crawl-state";
import { parseRssFeed, enqueueDiscoveredItems } from "./rss-worker";

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
// Load sources from seed YAML (v0: reads YAML directly; INFRA-1B.1+ reads SQLite)
// ---------------------------------------------------------------------------

function loadRssSources(filterSlug?: string): DiscoverySource[] {
  // Dynamically parse YAML without a dependency — the seed file uses a simple
  // flat structure that can be extracted with a lightweight manual parse.
  // Once INFRA-1B.1 lands, this will switch to SQLite source_material_policy.
  const repoRoot = join(import.meta.dir, "../../..");
  const raw = readFileSync(join(repoRoot, "data/sources_seed.yaml"), "utf-8");

  // Parse YAML manually for the fields we need (avoids adding a yaml dep).
  // ADR-0026: `active_v0` flag (when present in seed) restricts polling to the
  // v0 active source subset. If the field is absent from a record, default to
  // true for backward compatibility (forward-only filter).
  const sources: DiscoverySource[] = [];
  let currentSlug = "";
  let currentRssUrl = "";
  let currentMethod = "";
  let currentTier = 1;
  let currentActiveV0 = true;

  function flush() {
    if (
      currentSlug &&
      currentRssUrl &&
      currentMethod === "rss" &&
      currentTier === 0 &&
      currentActiveV0
    ) {
      if (!filterSlug || filterSlug === currentSlug) {
        sources.push({
          source_id: currentSlug, // v0: use slug as source_id; INFRA-1B.1+ uses src_<ULID>
          feed_url: currentRssUrl,
        });
      }
    }
  }

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- slug:")) {
      flush();
      currentSlug = trimmed.replace("- slug:", "").trim();
      currentRssUrl = "";
      currentMethod = "";
      currentTier = 1;
      currentActiveV0 = true;
    } else if (trimmed.startsWith("slug:")) {
      flush();
      currentSlug = trimmed.replace("slug:", "").trim();
      currentRssUrl = "";
      currentMethod = "";
      currentTier = 1;
      currentActiveV0 = true;
    } else if (trimmed.startsWith("rss_url:")) {
      currentRssUrl = trimmed.replace("rss_url:", "").trim();
    } else if (trimmed.startsWith("access_method:")) {
      currentMethod = trimmed.replace("access_method:", "").trim();
    } else if (trimmed.startsWith("reliability_tier:")) {
      currentTier = parseInt(trimmed.replace("reliability_tier:", "").trim(), 10);
    } else if (trimmed.startsWith("active_v0:")) {
      const v = trimmed.replace("active_v0:", "").trim().toLowerCase();
      currentActiveV0 = v !== "false" && v !== "no" && v !== "0";
    }
  }
  flush();

  return sources;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// Known CLI flags; unknown flags abort to avoid an accidental full crawl from
// a typo (e.g. `--soruce foo` silently falling through to all sources).
const KNOWN_FLAGS = new Set(["--dry-run", "--source"]);
const rawArgs = process.argv.slice(2);
for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i]!;
  if (!a.startsWith("--")) continue; // positional/value
  if (!KNOWN_FLAGS.has(a)) {
    console.error(`[discovery] Error: unknown flag ${a}`);
    process.exit(1);
  }
  if (a === "--source") i++; // skip the slug value following --source
}
const args = new Set(rawArgs);
const dryRun = args.has("--dry-run");
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

    // DEC-013 daily cap: skip parse + enqueue once the cap is reached, but
    // still record the ok fetch outcome so ETag/Last-Modified state stays
    // fresh and we avoid spurious full re-fetches on the next run.
    if (totalInserted >= DAILY_CANDIDATE_CAP) {
      if (!capLogged) {
        console.log(`[discovery] Daily candidate cap (${DAILY_CANDIDATE_CAP}) reached — recording ok for remaining sources without enqueue`);
        capLogged = true;
      }
      recordFetchOutcome(source_id, outcome);
      continue;
    }

    try {
      // Detect charset: Content-Type first, then XML prolog (`<?xml ... encoding="..."?>`).
      // Fall back to UTF-8 if neither is present.
      let charset = "utf-8";
      const charsetMatch = ct.match(/charset=([^\s;]+)/i);
      if (charsetMatch) {
        charset = charsetMatch[1]!.toLowerCase().replace(/^"(.*)"$/, "$1");
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
        // charset is a runtime string from Content-Type — Bun's TextDecoder
        // types restrict the label parameter to a literal union, so we cast
        // through unknown to satisfy the type checker while keeping runtime safety.
        // The inner try/catch falls back to UTF-8 for any unrecognised label.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        decoder = new TextDecoder(charset as any, { fatal: false });
      } catch {
        decoder = new TextDecoder("utf-8", { fatal: false });
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

      // Respect the daily cap: pass maxInsert budget to enqueue so later non-duplicate
      // items in the same feed are still attempted even when early items are dupes.
      // (Pre-slicing would miss valid items if the first N entries all conflict.)
      const remaining = DAILY_CANDIDATE_CAP - totalInserted;
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
