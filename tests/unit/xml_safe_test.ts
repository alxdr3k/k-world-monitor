/**
 * Unit tests for xml-safe singleton (DEC-018, ADR-0028 INV-0028-6).
 * INFRA-1B.2a.
 */

import { describe, it, expect } from "bun:test";
import { RSS_PARSER } from "../../src/discovery/parse/xml-safe";
import { XMLParser } from "fast-xml-parser";

describe("RSS_PARSER — singleton", () => {
  it("is an XMLParser instance", () => {
    expect(RSS_PARSER).toBeInstanceOf(XMLParser);
  });

  it("parses basic RSS feed", () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <link>https://example.com</link>
    <item>
      <title>Article 1</title>
      <link>https://example.com/1</link>
    </item>
  </channel>
</rss>`;
    const result = RSS_PARSER.parse(xml) as { rss: { channel: { title: string } } };
    expect(result.rss.channel.title).toBe("Test Feed");
  });

  it("parses Atom feed", () => {
    const atom = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <entry>
    <title>Entry 1</title>
  </entry>
</feed>`;
    const result = RSS_PARSER.parse(atom) as { feed: { title: string } };
    expect(result.feed.title).toBe("Atom Feed");
  });

  it("does NOT expand XML entities (XXE blocked — DEC-018)", () => {
    // If processEntities were true, &amp; would expand to &, &lt; to <, etc.
    // With processEntities:false, entity references are returned as literal text.
    const xml = `<root><item>test &amp; value</item></root>`;
    const result = RSS_PARSER.parse(xml) as { root: { item: string } };
    // processEntities:false → entities NOT expanded → literal &amp; in output
    expect(result.root.item).toBe("test &amp; value");
  });

  it("does NOT process external entity declarations (XXE attack blocked)", () => {
    // XXE payload — if a vulnerable parser processed this, it would load file:///etc/passwd.
    // fast-xml-parser v5 hard-rejects DOCTYPE SYSTEM declarations by throwing.
    const xxePayload = `<?xml version="1.0"?>
<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<root>&xxe;</root>`;
    expect(() => RSS_PARSER.parse(xxePayload)).toThrow("External entities are not supported");
  });

  it("parses attributes with @ prefix", () => {
    const xml = `<item id="42"><title>Test</title></item>`;
    const result = RSS_PARSER.parse(xml) as { item: { "@id": string; title: string } };
    expect(result.item["@id"]).toBe("42");
    expect(result.item.title).toBe("Test");
  });
});
