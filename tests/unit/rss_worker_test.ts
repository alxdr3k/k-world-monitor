/**
 * Unit tests for RSS worker — parseRssFeed + enqueueDiscoveredItems (INFRA-1B.2).
 */

import { describe, it, expect, beforeEach } from "bun:test";

process.env["SQLITE_PATH"] = ":memory:";

import { closeDb } from "../../src/storage/sqlite/connection";
import { parseRssFeed, enqueueDiscoveredItems, type FeedItem } from "../../src/discovery/worker/rss-worker";

function setupDb() {
  closeDb();
  const { getDb } = require("../../src/storage/sqlite/connection");
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT NOT NULL PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      description TEXT
    );
    CREATE TABLE IF NOT EXISTS discovery_queue (
      queue_id      TEXT NOT NULL PRIMARY KEY,
      source_id     TEXT NOT NULL,
      url           TEXT NOT NULL,
      title         TEXT,
      published_at  TEXT,
      discovered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      content_hash  TEXT,
      status        TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','done','error')),
      error_detail  TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS discovery_queue_url_source_active_idx
      ON discovery_queue (source_id, url)
      WHERE status IN ('pending', 'processing');
    CREATE INDEX IF NOT EXISTS discovery_queue_status_idx
      ON discovery_queue (status, discovered_at);
  `);
}

beforeEach(() => { setupDb(); });

// ---------------------------------------------------------------------------
// parseRssFeed — RSS 2.0
// ---------------------------------------------------------------------------

const RSS2_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>Article One</title>
      <link>https://example.com/article-1</link>
      <pubDate>Mon, 01 Jan 2026 00:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Article Two</title>
      <link>https://example.com/article-2</link>
      <pubDate>Tue, 02 Jan 2026 00:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

describe("parseRssFeed — RSS 2.0", () => {
  it("extracts items from RSS 2.0", () => {
    const items = parseRssFeed(RSS2_XML);
    expect(items).toHaveLength(2);
    expect(items[0]!.url).toBe("https://example.com/article-1");
    expect(items[0]!.title).toBe("Article One");
    expect(items[0]!.publishedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(items[1]!.url).toBe("https://example.com/article-2");
  });
});

// ---------------------------------------------------------------------------
// parseRssFeed — Atom 1.0
// ---------------------------------------------------------------------------

const ATOM_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <entry>
    <title>Atom Article One</title>
    <link href="https://example.com/atom-1"/>
    <published>2026-03-01T12:00:00Z</published>
  </entry>
  <entry>
    <title>Atom Article Two</title>
    <link href="https://example.com/atom-2"/>
    <updated>2026-03-02T12:00:00Z</updated>
  </entry>
</feed>`;

describe("parseRssFeed — Atom 1.0", () => {
  it("extracts items from Atom 1.0", () => {
    const items = parseRssFeed(ATOM_XML);
    expect(items).toHaveLength(2);
    expect(items[0]!.url).toBe("https://example.com/atom-1");
    expect(items[0]!.title).toBe("Atom Article One");
    expect(items[0]!.publishedAt).toBe("2026-03-01T12:00:00.000Z");
    expect(items[1]!.url).toBe("https://example.com/atom-2");
  });

  it("falls back to updated when published is absent", () => {
    const items = parseRssFeed(ATOM_XML);
    expect(items[1]!.publishedAt).toBe("2026-03-02T12:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// parseRssFeed — edge cases
// ---------------------------------------------------------------------------

describe("parseRssFeed — edge cases", () => {
  it("filters items with non-http URLs", () => {
    const xml = `<rss version="2.0"><channel>
      <item><link>ftp://example.com/file</link></item>
      <item><link>https://example.com/valid</link></item>
    </channel></rss>`;
    const items = parseRssFeed(xml);
    expect(items).toHaveLength(1);
    expect(items[0]!.url).toBe("https://example.com/valid");
  });

  it("returns empty array for unrecognized XML structure", () => {
    expect(parseRssFeed("<foo><bar/></foo>")).toHaveLength(0);
  });

  it("handles Atom link array — prefers rel=alternate", () => {
    const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Multi-link</title>
    <link rel="alternate" href="https://example.com/article"/>
    <link rel="self" href="https://example.com/feed/entry/1"/>
    <published>2026-01-01T00:00:00Z</published>
  </entry>
</feed>`;
    const items = parseRssFeed(xml);
    expect(items).toHaveLength(1);
    expect(items[0]!.url).toBe("https://example.com/article");
  });

  it("handles Atom link array — falls back to first when no rel=alternate", () => {
    const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Self-only</title>
    <link rel="self" href="https://example.com/self-only"/>
    <published>2026-01-01T00:00:00Z</published>
  </entry>
</feed>`;
    const items = parseRssFeed(xml);
    expect(items).toHaveLength(1);
    expect(items[0]!.url).toBe("https://example.com/self-only");
  });

  it("handles namespace-prefixed Atom root (atom:feed)", () => {
    const xml = `<?xml version="1.0"?>
<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
  <atom:entry>
    <atom:title>NS Article</atom:title>
    <atom:link href="https://example.com/ns-atom"/>
    <atom:published>2026-02-01T00:00:00Z</atom:published>
  </atom:entry>
</atom:feed>`;
    const items = parseRssFeed(xml);
    expect(items).toHaveLength(1);
    expect(items[0]!.url).toBe("https://example.com/ns-atom");
  });

  it("handles single item (non-array) in RSS channel", () => {
    const xml = `<rss version="2.0"><channel>
      <item><link>https://example.com/single</link><title>Single</title></item>
    </channel></rss>`;
    const items = parseRssFeed(xml);
    expect(items).toHaveLength(1);
    expect(items[0]!.url).toBe("https://example.com/single");
  });

  it("tolerates missing pubDate — publishedAt is undefined", () => {
    const xml = `<rss version="2.0"><channel>
      <item><link>https://example.com/no-date</link></item>
    </channel></rss>`;
    const items = parseRssFeed(xml);
    expect(items[0]!.publishedAt).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// enqueueDiscoveredItems
// ---------------------------------------------------------------------------

describe("enqueueDiscoveredItems", () => {
  it("inserts new items and returns correct count", () => {
    const items: FeedItem[] = [
      { url: "https://example.com/1", title: "One" },
      { url: "https://example.com/2", title: "Two" },
    ];
    const result = enqueueDiscoveredItems("src-test", items);
    expect(result.inserted).toBe(2);
    expect(result.skipped).toBe(0);

    const { getDb } = require("../../src/storage/sqlite/connection");
    const rows = getDb().prepare("SELECT * FROM discovery_queue ORDER BY url").all();
    expect(rows).toHaveLength(2);
    expect((rows[0] as Record<string,unknown>)["source_id"]).toBe("src-test");
    expect((rows[0] as Record<string,unknown>)["status"]).toBe("pending");
    expect((rows[0] as Record<string,unknown>)["content_hash"]).toBeTruthy();
  });

  it("skips duplicate URLs (same source, pending status)", () => {
    const items: FeedItem[] = [{ url: "https://example.com/dupe", title: "Dupe" }];
    enqueueDiscoveredItems("src-dupe", items);
    const result = enqueueDiscoveredItems("src-dupe", items);
    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("returns zero counts for empty items", () => {
    const result = enqueueDiscoveredItems("src-empty", []);
    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it("allows same URL from different source IDs", () => {
    const items: FeedItem[] = [{ url: "https://shared.example.com/article" }];
    const r1 = enqueueDiscoveredItems("source-a", items);
    const r2 = enqueueDiscoveredItems("source-b", items);
    expect(r1.inserted).toBe(1);
    expect(r2.inserted).toBe(1);
  });

  it("stores publishedAt correctly", () => {
    const items: FeedItem[] = [
      { url: "https://example.com/dated", publishedAt: "2026-05-01T10:00:00.000Z" },
    ];
    enqueueDiscoveredItems("src-dated", items);
    const { getDb } = require("../../src/storage/sqlite/connection");
    const row = getDb()
      .prepare("SELECT published_at FROM discovery_queue WHERE url = ?")
      .get("https://example.com/dated") as { published_at: string } | null;
    expect(row?.published_at).toBe("2026-05-01T10:00:00.000Z");
  });
});
