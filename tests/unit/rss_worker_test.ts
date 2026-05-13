/**
 * Unit tests for RSS worker — parseRssFeed + enqueueDiscoveredItems (INFRA-1B.2).
 */

import { describe, it, expect, beforeEach } from "bun:test";

process.env["SQLITE_PATH"] = ":memory:";

import { closeDb } from "../../src/storage/sqlite/connection";
import { parseRssFeed, enqueueDiscoveredItems, type FeedItem } from "../../src/discovery/worker/rss-worker";

// Mirror the production v6 schema: discovery_queue.source_id has a FK to
// source_material_policy(source_id), and connections enable foreign_keys.
// The previous setup omitted both the FK and the slug map, so a slug-form
// enqueue (the real worker's v0 input) would have passed in tests but
// failed loudly in production with "FOREIGN KEY constraint failed".
// Pre-seed each test slug via seedSlug() so enqueue resolves to src_<ULID>.
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
    CREATE TABLE IF NOT EXISTS source_material_policy (
      source_id            TEXT NOT NULL PRIMARY KEY,
      archive_policy       TEXT NOT NULL DEFAULT 'metadata_only',
      raw_cloud_policy     TEXT NOT NULL DEFAULT 'always_prohibited',
      external_llm_policy  TEXT NOT NULL DEFAULT 'allowed',
      checked_at           TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z',
      updated_at           TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z'
    );
    CREATE TABLE IF NOT EXISTS source_registry_slug_map (
      slug       TEXT NOT NULL PRIMARY KEY,
      source_id  TEXT NOT NULL REFERENCES source_material_policy(source_id)
    );
    CREATE TABLE IF NOT EXISTS discovery_queue (
      queue_id      TEXT NOT NULL PRIMARY KEY,
      source_id     TEXT NOT NULL
                    REFERENCES source_material_policy(source_id),
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

// Seed a slug → src_<ULID> mapping mirroring INFRA-1B.1 source registry
// bootstrap, then return the canonical source_id so tests can assert against
// the value that actually lands in discovery_queue.source_id.
function seedSlug(slug: string): string {
  const { getDb } = require("../../src/storage/sqlite/connection");
  const canonical = `src_${slug.replace(/[^a-zA-Z0-9_]/g, "_").toUpperCase()}`;
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO source_material_policy
       (source_id, archive_policy, raw_cloud_policy, external_llm_policy)
     VALUES (?, 'full_snapshot_allowed', 'allowed_public_data_only', 'allowed')`
  ).run(canonical);
  db.prepare(
    `INSERT OR IGNORE INTO source_registry_slug_map (slug, source_id) VALUES (?, ?)`
  ).run(slug, canonical);
  return canonical;
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
  // Slug→canonical resolution moved to run-discovery.ts loadRssSources at the
  // entry point. enqueueDiscoveredItems now requires canonical src_<ULID>
  // input directly; the FK on source_material_policy enforces the contract.
  // Tests pre-seed canonical ids via seedSlug() and pass the returned id.

  it("inserts new items with canonical src_<ULID> and returns counts", () => {
    const canonical = seedSlug("src-test");
    const items: FeedItem[] = [
      { url: "https://example.com/1", title: "One" },
      { url: "https://example.com/2", title: "Two" },
    ];
    const result = enqueueDiscoveredItems(canonical, items);
    expect(result.inserted).toBe(2);
    expect(result.skipped).toBe(0);

    const { getDb } = require("../../src/storage/sqlite/connection");
    const rows = getDb().prepare("SELECT * FROM discovery_queue ORDER BY url").all();
    expect(rows).toHaveLength(2);
    expect((rows[0] as Record<string,unknown>)["source_id"]).toBe(canonical);
    expect((rows[0] as Record<string,unknown>)["status"]).toBe("pending");
    expect((rows[0] as Record<string,unknown>)["content_hash"]).toBeTruthy();
  });

  it("skips duplicate URLs (same source, pending status)", () => {
    const canonical = seedSlug("src-dupe");
    const items: FeedItem[] = [{ url: "https://example.com/dupe", title: "Dupe" }];
    enqueueDiscoveredItems(canonical, items);
    const result = enqueueDiscoveredItems(canonical, items);
    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("returns zero counts for empty items (no FK touched)", () => {
    // Empty items short-circuits before any INSERT, so no seed required.
    const result = enqueueDiscoveredItems("src_NONEXISTENT", []);
    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it("allows same URL from different source IDs", () => {
    const a = seedSlug("source-a");
    const b = seedSlug("source-b");
    const items: FeedItem[] = [{ url: "https://shared.example.com/article" }];
    const r1 = enqueueDiscoveredItems(a, items);
    const r2 = enqueueDiscoveredItems(b, items);
    expect(r1.inserted).toBe(1);
    expect(r2.inserted).toBe(1);
  });

  it("stores publishedAt correctly", () => {
    const canonical = seedSlug("src-dated");
    const items: FeedItem[] = [
      { url: "https://example.com/dated", publishedAt: "2026-05-01T10:00:00.000Z" },
    ];
    enqueueDiscoveredItems(canonical, items);
    const { getDb } = require("../../src/storage/sqlite/connection");
    const row = getDb()
      .prepare("SELECT published_at FROM discovery_queue WHERE url = ?")
      .get("https://example.com/dated") as { published_at: string } | null;
    expect(row?.published_at).toBe("2026-05-01T10:00:00.000Z");
  });

  it("FK rejects an unmapped source_id (caller must pre-canonicalise)", () => {
    // Slug → canonical resolution is now the caller's responsibility
    // (run-discovery.ts loadRssSources). If the caller fails to do it, the
    // production FK to source_material_policy(source_id) surfaces the bug
    // loudly. The error message comes from SQLite, not from this module.
    const items: FeedItem[] = [{ url: "https://example.com/orphan" }];
    expect(() => enqueueDiscoveredItems("orphan-slug", items)).toThrow(
      /FOREIGN KEY constraint failed/
    );
  });

  it("accepts a pre-canonicalised src_<ULID> input", () => {
    const { getDb } = require("../../src/storage/sqlite/connection");
    getDb().prepare(
      `INSERT INTO source_material_policy
         (source_id, archive_policy, raw_cloud_policy, external_llm_policy)
       VALUES ('src_DIRECT', 'metadata_only', 'always_prohibited', 'allowed')`
    ).run();
    const items: FeedItem[] = [{ url: "https://example.com/direct" }];
    const result = enqueueDiscoveredItems("src_DIRECT", items);
    expect(result.inserted).toBe(1);
    const row = getDb()
      .prepare("SELECT source_id FROM discovery_queue WHERE url = ?")
      .get("https://example.com/direct") as { source_id: string };
    expect(row.source_id).toBe("src_DIRECT");
  });
});
