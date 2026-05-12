// RSS discovery worker (INFRA-1B.2).
// Parses a fetched RSS/Atom body and enqueues discovered document URLs
// into the discovery_queue SQLite table.
//
// Invariants:
//   INV-0030-2: no network I/O inside this module — caller provides pre-fetched body.
//   DEC-018: XML parsed via RSS_PARSER singleton (processEntities:false).

import { RSS_PARSER } from "../parse/xml-safe";
import { sha256Hex } from "../../utils/hash";
import { getDb } from "../../storage/sqlite/connection";

export interface FeedItem {
  url: string;
  title?: string;
  publishedAt?: string;
}

export interface EnqueueResult {
  sourceId: string;
  inserted: number;
  skipped: number;
}

// ---------------------------------------------------------------------------
// RSS/Atom parsing
// ---------------------------------------------------------------------------

// Extract items from a parsed RSS 2.0 or Atom 1.0 feed object.
function extractItems(parsed: unknown): FeedItem[] {
  if (typeof parsed !== "object" || parsed === null) return [];
  const obj = parsed as Record<string, unknown>;

  // RSS 2.0: rss.channel.item[]  (also handles namespace-prefixed root like rss:rss)
  const rssKey = Object.keys(obj).find((k) => k === "rss" || k.endsWith(":rss"));
  const rss = rssKey ? (obj[rssKey] as Record<string, unknown> | undefined) : undefined;
  if (rss) {
    const channelKey = Object.keys(rss).find((k) => k === "channel" || k.endsWith(":channel"));
    const channel = channelKey ? (rss[channelKey] as Record<string, unknown> | undefined) : undefined;
    if (channel) {
      const itemKey = Object.keys(channel).find((k) => k === "item" || k.endsWith(":item"));
      const items = itemKey ? channel[itemKey] : undefined;
      return normalizeItems(Array.isArray(items) ? items : items ? [items] : [], "rss");
    }
  }

  // Atom 1.0: feed.entry[]  (also handles namespace-prefixed root like atom:feed)
  const feedKey = Object.keys(obj).find((k) => k === "feed" || k.endsWith(":feed"));
  const feed = feedKey ? (obj[feedKey] as Record<string, unknown> | undefined) : undefined;
  if (feed) {
    const entryKey = Object.keys(feed).find((k) => k === "entry" || k.endsWith(":entry"));
    const entries = entryKey ? feed[entryKey] : undefined;
    return normalizeItems(Array.isArray(entries) ? entries : entries ? [entries] : [], "atom");
  }

  return [];
}

// Look up a field from a parsed XML element by its local name, ignoring any
// namespace prefix (e.g. "atom:link" matches localKey "link").
function getLocal(obj: Record<string, unknown>, localKey: string): unknown {
  if (localKey in obj) return obj[localKey];
  const suffixed = `:${localKey}`;
  const key = Object.keys(obj).find((k) => k === localKey || k.endsWith(suffixed));
  return key ? obj[key] : undefined;
}

function normalizeItems(raw: unknown[], format: "rss" | "atom"): FeedItem[] {
  const items: FeedItem[] = [];
  for (const r of raw) {
    if (typeof r !== "object" || r === null) continue;
    const entry = r as Record<string, unknown>;

    let url: string | undefined;
    let title: string | undefined;
    let publishedAt: string | undefined;

    if (format === "rss") {
      url = str(getLocal(entry, "link"));
      title = str(getLocal(entry, "title"));
      publishedAt = parseDate(str(getLocal(entry, "pubDate")));
    } else {
      // Atom: link can be a string, an object with @href, or an array of link
      // objects (e.g. rel="alternate" + rel="self").  Prefer the rel="alternate"
      // entry; fall back to the first entry that has an @href.
      const linkVal = getLocal(entry, "link");
      if (typeof linkVal === "string") {
        url = linkVal;
      } else if (Array.isArray(linkVal)) {
        const links = linkVal as Record<string, unknown>[];
        const alt = links.find((l) => l["@rel"] === "alternate" || !l["@rel"]);
        const chosen = alt ?? links[0];
        if (chosen) url = str(chosen["@href"]);
      } else if (typeof linkVal === "object" && linkVal !== null) {
        url = str((linkVal as Record<string, unknown>)["@href"]);
      }
      title = str(getLocal(entry, "title"));
      const pub = getLocal(entry, "published") ?? getLocal(entry, "updated");
      publishedAt = parseDate(str(pub));
    }

    if (url && isValidHttpUrl(url)) {
      items.push({ url, title, publishedAt });
    }
  }
  return items;
}

function str(val: unknown): string | undefined {
  if (typeof val === "string") return val.trim() || undefined;
  return undefined;
}

function parseDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return undefined;
    return d.toISOString();
  } catch {
    return undefined;
  }
}

function isValidHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Parse RSS/Atom XML body and return extracted feed items.
// Throws on XML parse error.
export function parseRssFeed(xmlBody: string): FeedItem[] {
  const parsed = RSS_PARSER.parse(xmlBody);
  return extractItems(parsed);
}

// Enqueue discovered items into discovery_queue (INV-0030-2: serial write, no network I/O).
// Skips duplicates via the unique index (source_id, url) WHERE status IN pending/processing.
// Returns counts of inserted and skipped rows.
export function enqueueDiscoveredItems(
  sourceId: string,
  items: FeedItem[]
): EnqueueResult {
  if (items.length === 0) return { sourceId, inserted: 0, skipped: 0 };

  const db = getDb();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO discovery_queue
      (queue_id, source_id, url, title, published_at, discovered_at, content_hash, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
  `);

  let inserted = 0;
  let skipped = 0;

  // Batch inside a transaction for atomicity and performance (INV-0030-2).
  const insertAll = db.transaction(() => {
    for (const item of items) {
      // queue_id: deterministic from source_id+url so INSERT OR IGNORE is idempotent.
      const contentHash = sha256Hex(item.url);
      const queueId = `dq_${sha256Hex(sourceId + "|" + item.url).slice(0, 26)}`;
      const changes = stmt.run(
        queueId,
        sourceId,
        item.url,
        item.title ?? null,
        item.publishedAt ?? null,
        now,
        contentHash
      );
      if (changes.changes > 0) inserted++;
      else skipped++;
    }
  });

  insertAll();
  return { sourceId, inserted, skipped };
}
