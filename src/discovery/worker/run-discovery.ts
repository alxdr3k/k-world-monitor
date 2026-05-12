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

interface SeedSource {
  slug: string;
  rss_url?: string;
  access_method: string;
  reliability_tier: number;
}

interface SeedFile {
  sources: SeedSource[];
}

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
  const sources: DiscoverySource[] = [];
  let currentSlug = "";
  let currentRssUrl = "";
  let currentMethod = "";
  let currentTier = 1;

  function flush() {
    if (
      currentSlug &&
      currentRssUrl &&
      currentMethod === "rss" &&
      currentTier === 0
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
    } else if (trimmed.startsWith("slug:")) {
      flush();
      currentSlug = trimmed.replace("slug:", "").trim();
      currentRssUrl = "";
      currentMethod = "";
      currentTier = 1;
    } else if (trimmed.startsWith("rss_url:")) {
      currentRssUrl = trimmed.replace("rss_url:", "").trim();
    } else if (trimmed.startsWith("access_method:")) {
      currentMethod = trimmed.replace("access_method:", "").trim();
    } else if (trimmed.startsWith("reliability_tier:")) {
      currentTier = parseInt(trimmed.replace("reliability_tier:", "").trim(), 10);
    }
  }
  flush();

  return sources;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = new Set(process.argv.slice(2));
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

  if (dryRun) {
    for (const s of sources) {
      console.log(`  [dry-run] ${s.source_id}: ${s.feed_url}`);
    }
    return;
  }

  // Phase 1: bounded parallel fetch via pollEligibleSources (INV-0030-1, INV-0030-2)
  const pollResults = await pollEligibleSources(sources);
  console.log(`[discovery] Polled ${pollResults.length} sources`);

  let totalInserted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  // Phase 2: parse RSS bodies and enqueue (serial, INV-0030-2)
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

    // Only parse text-based content (xml/rss/atom/html — not binaries)
    const ct = contentType ?? "";
    if (ct.includes("application/octet-stream") || ct.includes("image/")) {
      console.log(`  [skip] ${source_id}: non-text content-type ${ct}`);
      continue;
    }

    try {
      // Detect charset from Content-Type (e.g. "text/xml; charset=euc-kr").
      // Fall back to UTF-8 if absent or unrecognised.
      let charset = "utf-8";
      const charsetMatch = ct.match(/charset=([^\s;]+)/i);
      if (charsetMatch) {
        charset = charsetMatch[1]!.toLowerCase().replace(/^"(.*)"$/, "$1");
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
      const { inserted, skipped } = enqueueDiscoveredItems(source_id, items);
      totalInserted += inserted;
      totalSkipped += skipped;
      console.log(
        `  [ok] ${source_id}: ${items.length} items → +${inserted} queued, ${skipped} dupes`
      );
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
