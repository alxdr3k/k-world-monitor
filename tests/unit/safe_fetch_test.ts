/**
 * Unit tests for safe-fetch defenses (ADR-0028 INV-0028-1 through INV-0028-6).
 * INFRA-1B.2a.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  isPrivateIp,
  parseRobotsTxt,
  isRobotsPathDisallowed,
  sniffMagic,
  classifyDeclaredContentType,
  isContentTypeMismatch,
  safeFetch,
  clearRobotsCache,
  MAX_BYTES,
  SsrfBlockedError,
  BodyTooLargeError,
  RobotsDisallowedError,
  RedirectError,
  ContentTypeMismatchError,
  type RobotsRules,
  type DnsLookupFn,
  type FetchFn,
} from "../../src/discovery/fetch/safe-fetch";

// ---------------------------------------------------------------------------
// isPrivateIp — IPv4 (INV-0028-2)
// ---------------------------------------------------------------------------

describe("isPrivateIp — IPv4", () => {
  it("blocks 10.0.0.1 (RFC1918)", () => expect(isPrivateIp("10.0.0.1", 4)).toBe(true));
  it("blocks 10.255.255.255", () => expect(isPrivateIp("10.255.255.255", 4)).toBe(true));
  it("blocks 172.16.0.1", () => expect(isPrivateIp("172.16.0.1", 4)).toBe(true));
  it("blocks 172.31.255.255", () => expect(isPrivateIp("172.31.255.255", 4)).toBe(true));
  it("blocks 192.168.1.1", () => expect(isPrivateIp("192.168.1.1", 4)).toBe(true));
  it("blocks 127.0.0.1 (loopback)", () => expect(isPrivateIp("127.0.0.1", 4)).toBe(true));
  it("blocks 127.0.0.255", () => expect(isPrivateIp("127.0.0.255", 4)).toBe(true));
  it("blocks 169.254.169.254 (AWS metadata)", () => expect(isPrivateIp("169.254.169.254", 4)).toBe(true));
  it("blocks 169.254.0.1 (link-local)", () => expect(isPrivateIp("169.254.0.1", 4)).toBe(true));
  it("blocks 100.64.0.1 (CG-NAT)", () => expect(isPrivateIp("100.64.0.1", 4)).toBe(true));
  it("blocks 0.0.0.0", () => expect(isPrivateIp("0.0.0.0", 4)).toBe(true));
  it("blocks 224.0.0.1 (multicast)", () => expect(isPrivateIp("224.0.0.1", 4)).toBe(true));
  it("blocks 240.0.0.1 (reserved)", () => expect(isPrivateIp("240.0.0.1", 4)).toBe(true));
  it("allows 1.1.1.1 (Cloudflare DNS)", () => expect(isPrivateIp("1.1.1.1", 4)).toBe(false));
  it("allows 8.8.8.8 (Google DNS)", () => expect(isPrivateIp("8.8.8.8", 4)).toBe(false));
  it("allows 93.184.216.34 (example.com)", () => expect(isPrivateIp("93.184.216.34", 4)).toBe(false));
  it("allows 172.15.255.255 (just below 172.16)", () => expect(isPrivateIp("172.15.255.255", 4)).toBe(false));
  it("allows 172.32.0.1 (just above 172.31)", () => expect(isPrivateIp("172.32.0.1", 4)).toBe(false));
});

describe("isPrivateIp — IPv6", () => {
  it("blocks ::1 (loopback)", () => expect(isPrivateIp("::1", 6)).toBe(true));
  it("blocks fe80::1 (link-local)", () => expect(isPrivateIp("fe80::1", 6)).toBe(true));
  it("blocks fe80::dead:beef", () => expect(isPrivateIp("fe80::dead:beef", 6)).toBe(true));
  it("blocks fc00::1 (unique-local)", () => expect(isPrivateIp("fc00::1", 6)).toBe(true));
  it("blocks fd00::1 (unique-local)", () => expect(isPrivateIp("fd00::1", 6)).toBe(true));
  it("blocks ff02::1 (multicast)", () => expect(isPrivateIp("ff02::1", 6)).toBe(true));
  it("blocks ::ffff:169.254.169.254 (IPv4-mapped metadata)", () => expect(isPrivateIp("::ffff:169.254.169.254", 6)).toBe(true));
  it("blocks ::ffff:10.0.0.1 (IPv4-mapped RFC1918)", () => expect(isPrivateIp("::ffff:10.0.0.1", 6)).toBe(true));
  it("blocks ::ffff:100.64.0.1 (IPv4-mapped CG-NAT)", () => expect(isPrivateIp("::ffff:100.64.0.1", 6)).toBe(true));
  it("blocks ::ffff:198.18.0.1 (IPv4-mapped benchmarking)", () => expect(isPrivateIp("::ffff:198.18.0.1", 6)).toBe(true));
  it("blocks :: (unspecified address)", () => expect(isPrivateIp("::", 6)).toBe(true));
  it("blocks ::ffff:a00:1 (hex-notation IPv4-mapped 10.0.0.1)", () => expect(isPrivateIp("::ffff:a00:1", 6)).toBe(true));
  it("blocks ::ffff:a9fe:a9fe (hex-notation IPv4-mapped 169.254.169.254)", () => expect(isPrivateIp("::ffff:a9fe:a9fe", 6)).toBe(true));
  it("blocks ::ffff:c0a8:101 (hex-notation IPv4-mapped 192.168.1.1)", () => expect(isPrivateIp("::ffff:c0a8:101", 6)).toBe(true));
  it("allows ::ffff:5db8:d822 (hex-notation IPv4-mapped 93.184.216.34)", () => expect(isPrivateIp("::ffff:5db8:d822", 6)).toBe(false));
  it("allows 2001:4860:4860::8888 (Google DNS IPv6)", () => expect(isPrivateIp("2001:4860:4860::8888", 6)).toBe(false));
  it("allows 2606:4700:4700::1111 (Cloudflare IPv6)", () => expect(isPrivateIp("2606:4700:4700::1111", 6)).toBe(false));
  // Expanded / non-compressed forms (P1 fix: canonicalize before regex checks)
  it("blocks 0:0:0:0:0:0:0:1 (long-form loopback)", () => expect(isPrivateIp("0:0:0:0:0:0:0:1", 6)).toBe(true));
  it("blocks 0:0:0:0:0:0:0:0 (long-form unspecified)", () => expect(isPrivateIp("0:0:0:0:0:0:0:0", 6)).toBe(true));
  it("blocks fc00:0:0:0:0:0:0:1 (long-form unique-local)", () => expect(isPrivateIp("fc00:0:0:0:0:0:0:1", 6)).toBe(true));
  it("blocks fd00:0000:0000:0000:0000:0000:0000:0001 (fully expanded unique-local)", () => expect(isPrivateIp("fd00:0000:0000:0000:0000:0000:0000:0001", 6)).toBe(true));
  it("blocks fe80:0:0:0:0:0:0:1 (long-form link-local)", () => expect(isPrivateIp("fe80:0:0:0:0:0:0:1", 6)).toBe(true));
  it("blocks ff02:0:0:0:0:0:0:1 (long-form multicast)", () => expect(isPrivateIp("ff02:0:0:0:0:0:0:1", 6)).toBe(true));
  it("allows 2001:4860:4860:0:0:0:0:8888 (long-form Google DNS)", () => expect(isPrivateIp("2001:4860:4860:0:0:0:0:8888", 6)).toBe(false));
});

// ---------------------------------------------------------------------------
// MAX_BYTES (DEC-017)
// ---------------------------------------------------------------------------

describe("MAX_BYTES constants (DEC-017)", () => {
  it("html = 10 MB", () => expect(MAX_BYTES.html).toBe(10 * 1024 * 1024));
  it("rss = 5 MB", () => expect(MAX_BYTES.rss).toBe(5 * 1024 * 1024));
  it("json = 5 MB", () => expect(MAX_BYTES.json).toBe(5 * 1024 * 1024));
  it("pdf = 20 MB", () => expect(MAX_BYTES.pdf).toBe(20 * 1024 * 1024));
  it("dataset = 50 MB", () => expect(MAX_BYTES.dataset).toBe(50 * 1024 * 1024));
  it("unknown = 1 MB", () => expect(MAX_BYTES.unknown).toBe(1 * 1024 * 1024));
});

// ---------------------------------------------------------------------------
// robots.txt parser (INV-0028-5)
// ---------------------------------------------------------------------------

describe("parseRobotsTxt", () => {
  it("parses wildcard Disallow rules", () => {
    const txt = "User-agent: *\nDisallow: /admin\nDisallow: /private/\n";
    const rules = parseRobotsTxt(txt, "testbot");
    expect(rules.disallow).toContain("/admin");
    expect(rules.disallow).toContain("/private/");
  });

  it("agent-specific rules take priority over *", () => {
    const txt = "User-agent: *\nDisallow: /a\n\nUser-agent: testbot\nDisallow: /b\n";
    const rules = parseRobotsTxt(txt, "testbot");
    expect(rules.disallow).toContain("/b");
    expect(rules.disallow).not.toContain("/a");
  });

  it("falls back to * when agent not found", () => {
    const txt = "User-agent: *\nDisallow: /secret\n";
    const rules = parseRobotsTxt(txt, "mybot");
    expect(rules.disallow).toContain("/secret");
  });

  it("ignores comments", () => {
    const txt = "User-agent: * # comment\nDisallow: /x # another comment\n";
    const rules = parseRobotsTxt(txt, "bot");
    expect(rules.disallow).toContain("/x");
  });

  it("returns empty disallow when everything allowed via Allow: /", () => {
    const txt = "User-agent: *\nAllow: /\n";
    const rules = parseRobotsTxt(txt, "bot");
    expect(rules.disallow).toHaveLength(0);
  });

  it("handles multi-UA group — all agents in the same group share the rules", () => {
    const txt = "User-agent: k-world-monitor\nUser-agent: otherbot\nDisallow: /shared\n";
    const rules = parseRobotsTxt(txt, "k-world-monitor/1.0");
    expect(rules.disallow).toContain("/shared");
  });

  it("agent-specific group with no rules does NOT fall back to wildcard (REP §2.2.2)", () => {
    // k-world-monitor group exists but has no Disallow/Allow; * group disallows /a.
    // REP says: an empty specific group still takes precedence — no fallback.
    const txt = "User-agent: k-world-monitor\n\nUser-agent: *\nDisallow: /a\n";
    const rules = parseRobotsTxt(txt, "k-world-monitor/1.0");
    expect(rules.disallow).toHaveLength(0);
    expect(rules.allow).toHaveLength(0);
  });

  it("matches by product token, not full header (k-world-monitor matches k-world-monitor/1.0)", () => {
    const txt = "User-agent: k-world-monitor\nDisallow: /internal\n";
    const rules = parseRobotsTxt(txt, "k-world-monitor/1.0");
    expect(rules.disallow).toContain("/internal");
  });

  it("does not match unrelated product token", () => {
    const txt = "User-agent: someotherbot\nDisallow: /internal\n\nUser-agent: *\nDisallow: /star\n";
    const rules = parseRobotsTxt(txt, "k-world-monitor/1.0");
    expect(rules.disallow).toContain("/star");
    expect(rules.disallow).not.toContain("/internal");
  });

  it("parses Allow rules alongside Disallow", () => {
    const txt = "User-agent: *\nDisallow: /private\nAllow: /private/public\n";
    const rules = parseRobotsTxt(txt, "bot");
    expect(rules.disallow).toContain("/private");
    expect(rules.allow).toContain("/private/public");
  });
});

describe("isRobotsPathDisallowed", () => {
  it("blocks exact match", () => {
    const rules: RobotsRules = { disallow: ["/admin"], allow: [] };
    expect(isRobotsPathDisallowed(rules, "/admin")).toBe(true);
  });

  it("blocks path under disallowed prefix", () => {
    const rules: RobotsRules = { disallow: ["/admin/"], allow: [] };
    expect(isRobotsPathDisallowed(rules, "/admin/secret")).toBe(true);
  });

  it("allows unrelated path", () => {
    const rules: RobotsRules = { disallow: ["/admin"], allow: [] };
    expect(isRobotsPathDisallowed(rules, "/public")).toBe(false);
  });

  it("allows with empty rules", () => {
    const rules: RobotsRules = { disallow: [], allow: [] };
    expect(isRobotsPathDisallowed(rules, "/anything")).toBe(false);
  });

  it("Allow wins over shorter Disallow (specificity rule)", () => {
    const rules: RobotsRules = { disallow: ["/private"], allow: ["/private/public"] };
    expect(isRobotsPathDisallowed(rules, "/private/public/data")).toBe(false);
  });

  it("Disallow wins when it is longer than Allow", () => {
    const rules: RobotsRules = { disallow: ["/private/secret"], allow: ["/private"] };
    expect(isRobotsPathDisallowed(rules, "/private/secret/doc")).toBe(true);
  });

  it("Allow: / overrides shorter Disallow on tie (length 1 tie favors Allow)", () => {
    // Disallow: /admin at length 6 blocks /admin/x; Allow: / at length 1 only ties for len-1 paths.
    const rules: RobotsRules = { disallow: ["/admin"], allow: ["/"] };
    expect(isRobotsPathDisallowed(rules, "/admin/x")).toBe(true);
    expect(isRobotsPathDisallowed(rules, "/other")).toBe(false);
  });

  it("wildcard * matches any character sequence", () => {
    const rules: RobotsRules = { disallow: ["/images/*.gif"], allow: [] };
    expect(isRobotsPathDisallowed(rules, "/images/foo/bar.gif")).toBe(true);
    expect(isRobotsPathDisallowed(rules, "/images/photo.png")).toBe(false);
  });

  it("$ end-anchor requires exact path match", () => {
    const rules: RobotsRules = { disallow: ["/page$"], allow: [] };
    expect(isRobotsPathDisallowed(rules, "/page")).toBe(true);
    expect(isRobotsPathDisallowed(rules, "/page/sub")).toBe(false);
  });

  it("wildcard + end-anchor /*.gif$", () => {
    const rules: RobotsRules = { disallow: ["/*.gif$"], allow: [] };
    expect(isRobotsPathDisallowed(rules, "/image.gif")).toBe(true);
    expect(isRobotsPathDisallowed(rules, "/image.gif?v=1")).toBe(false); // query breaks $ anchor
  });

  it("percent-encoded path matches decoded rule", () => {
    const rules: RobotsRules = { disallow: ["/foo/bar/baz"], allow: [] };
    expect(isRobotsPathDisallowed(rules, "/foo/bar/%62%61%7A")).toBe(true);
  });

  it("%2A in rule is literal asterisk, not wildcard operator", () => {
    // A robots rule with %2A must match a literal * in the path, not act as wildcard.
    const rules: RobotsRules = { disallow: ["/foo%2Abar"], allow: [] };
    expect(isRobotsPathDisallowed(rules, "/foo*bar")).toBe(true);    // literal * matches
    expect(isRobotsPathDisallowed(rules, "/fooanythingbar")).toBe(false); // not a wildcard
  });

  it("%24 in rule is literal dollar sign, not end-anchor operator", () => {
    // A robots rule with %24 must treat $ as a literal character, not end-anchor.
    const rules: RobotsRules = { disallow: ["/foo%24"], allow: [] };
    expect(isRobotsPathDisallowed(rules, "/foo$")).toBe(true);       // literal $ matches
    expect(isRobotsPathDisallowed(rules, "/foo$extra")).toBe(true);  // prefix match, not anchored
  });

  it("/robots.txt path is always allowed regardless of rules", () => {
    const rules: RobotsRules = { disallow: ["/"], allow: [] };
    expect(isRobotsPathDisallowed(rules, "/robots.txt")).toBe(false);
  });

  it("%2F in rule does NOT match / separator in path (P1 fix: reserved char preservation)", () => {
    // Rule /a%2Fb must NOT match /a/b — %2F is a literal slash, not a path separator.
    // decodeURIComponent would decode %2F → / making them match; correct fix preserves %2F.
    const rules: RobotsRules = { disallow: ["/a%2Fb"], allow: [] };
    expect(isRobotsPathDisallowed(rules, "/a/b")).toBe(false);   // %2F ≠ / separator
    expect(isRobotsPathDisallowed(rules, "/a%2Fb")).toBe(true);  // exact encoded match
  });

  it("query-bearing disallow rule blocks path+query (P2 fix: path+search)", () => {
    // Disallow: /search?q= should block /search?q=secret when isRobotsPathDisallowed
    // is called with path+query. This is only relevant when checkRobots passes
    // url.pathname + url.search.
    const rules: RobotsRules = { disallow: ["/search?q="], allow: [] };
    expect(isRobotsPathDisallowed(rules, "/search?q=secret")).toBe(true);
    expect(isRobotsPathDisallowed(rules, "/search")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sniffMagic — content-type detection (INV-0028-6)
// ---------------------------------------------------------------------------

describe("sniffMagic", () => {
  it("detects ELF binary", () => {
    const elf = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x00]);
    expect(sniffMagic(elf)).toBe("executable");
  });

  it("detects PE binary (MZ header)", () => {
    const pe = new Uint8Array([0x4d, 0x5a, 0x00, 0x00]);
    expect(sniffMagic(pe)).toBe("executable");
  });

  it("detects Mach-O fat binary", () => {
    const macho = new Uint8Array([0xca, 0xfe, 0xba, 0xbe, 0x00]);
    expect(sniffMagic(macho)).toBe("executable");
  });

  it("detects XML (<?xml)", () => {
    const xml = new TextEncoder().encode('<?xml version="1.0"?><root/>');
    expect(sniffMagic(xml)).toBe("xml");
  });

  it("detects RSS feed (<rss)", () => {
    const rss = new TextEncoder().encode('<rss version="2.0"><channel></channel></rss>');
    expect(sniffMagic(rss)).toBe("xml");
  });

  it("detects Atom feed (<feed)", () => {
    const atom = new TextEncoder().encode('<feed xmlns="http://www.w3.org/2005/Atom"></feed>');
    expect(sniffMagic(atom)).toBe("xml");
  });

  it("detects JSON object", () => {
    const json = new TextEncoder().encode('{"key": "value"}');
    expect(sniffMagic(json)).toBe("json");
  });

  it("detects JSON array", () => {
    const json = new TextEncoder().encode('[1, 2, 3]');
    expect(sniffMagic(json)).toBe("json");
  });

  it("detects HTML", () => {
    const html = new TextEncoder().encode('<!DOCTYPE html><html><body></body></html>');
    expect(sniffMagic(html)).toBe("html");
  });

  it("returns unknown for binary blob", () => {
    const blob = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    expect(sniffMagic(blob)).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// classifyDeclaredContentType — declared Content-Type semantic group
// (INV-0028-6 — operator D1 2026-05-18)
// ---------------------------------------------------------------------------

describe("classifyDeclaredContentType", () => {
  it("classifies application/rss+xml as xml", () => {
    expect(classifyDeclaredContentType("application/rss+xml")).toBe("xml");
  });
  it("classifies application/atom+xml as xml", () => {
    expect(classifyDeclaredContentType("application/atom+xml")).toBe("xml");
  });
  it("classifies application/xml as xml", () => {
    expect(classifyDeclaredContentType("application/xml")).toBe("xml");
  });
  it("classifies text/xml as xml", () => {
    expect(classifyDeclaredContentType("text/xml")).toBe("xml");
  });
  it("classifies application/feed+json as json", () => {
    expect(classifyDeclaredContentType("application/feed+json")).toBe("json");
  });
  it("classifies application/json as json", () => {
    expect(classifyDeclaredContentType("application/json")).toBe("json");
  });
  it("classifies text/html as html", () => {
    expect(classifyDeclaredContentType("text/html")).toBe("html");
  });
  it("strips charset parameter before classification", () => {
    expect(classifyDeclaredContentType("application/json; charset=utf-8")).toBe("json");
    expect(classifyDeclaredContentType("text/html; charset=UTF-8")).toBe("html");
    expect(classifyDeclaredContentType("application/rss+xml; charset=utf-8")).toBe("xml");
  });
  it("strips boundary and other parameters", () => {
    expect(classifyDeclaredContentType("application/json;charset=utf-8;boundary=x")).toBe("json");
  });
  it("normalizes case (Application/JSON → json)", () => {
    expect(classifyDeclaredContentType("Application/JSON")).toBe("json");
    expect(classifyDeclaredContentType("TEXT/HTML")).toBe("html");
    expect(classifyDeclaredContentType("Application/RSS+XML")).toBe("xml");
  });
  it("trims whitespace around MIME atom", () => {
    expect(classifyDeclaredContentType("  application/json  ; charset=utf-8")).toBe("json");
  });
  it("returns unknown for null", () => {
    expect(classifyDeclaredContentType(null)).toBe("unknown");
  });
  it("returns unknown for undefined", () => {
    expect(classifyDeclaredContentType(undefined)).toBe("unknown");
  });
  it("returns unknown for empty string", () => {
    expect(classifyDeclaredContentType("")).toBe("unknown");
  });
  it("returns unknown for text/plain", () => {
    expect(classifyDeclaredContentType("text/plain")).toBe("unknown");
  });
  it("returns unknown for application/octet-stream", () => {
    expect(classifyDeclaredContentType("application/octet-stream")).toBe("unknown");
  });
  it("returns unknown for completely unknown MIME", () => {
    expect(classifyDeclaredContentType("application/x-custom-blob")).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// isContentTypeMismatch — declared vs sniffed compatibility
// (INV-0028-6 — operator D1 2026-05-18)
// ---------------------------------------------------------------------------

describe("isContentTypeMismatch", () => {
  it("matches xml × xml (no mismatch)", () => {
    expect(isContentTypeMismatch("xml", "xml")).toBe(false);
  });
  it("matches json × json (no mismatch)", () => {
    expect(isContentTypeMismatch("json", "json")).toBe(false);
  });
  it("matches html × html (no mismatch)", () => {
    expect(isContentTypeMismatch("html", "html")).toBe(false);
  });
  it("flags xml × json as mismatch", () => {
    expect(isContentTypeMismatch("xml", "json")).toBe(true);
  });
  it("flags json × xml as mismatch", () => {
    expect(isContentTypeMismatch("json", "xml")).toBe(true);
  });
  it("flags json × html as mismatch (HTML error page disguised as JSON API)", () => {
    expect(isContentTypeMismatch("json", "html")).toBe(true);
  });
  it("flags html × json as mismatch", () => {
    expect(isContentTypeMismatch("html", "json")).toBe(true);
  });
  it("flags xml × html as mismatch", () => {
    expect(isContentTypeMismatch("xml", "html")).toBe(true);
  });
  it("flags html × xml as mismatch", () => {
    expect(isContentTypeMismatch("html", "xml")).toBe(true);
  });
  it("never flags unknown declared (operator D1: missing Content-Type pass)", () => {
    expect(isContentTypeMismatch("unknown", "xml")).toBe(false);
    expect(isContentTypeMismatch("unknown", "json")).toBe(false);
    expect(isContentTypeMismatch("unknown", "html")).toBe(false);
    expect(isContentTypeMismatch("unknown", "unknown")).toBe(false);
  });
  it("never flags unknown sniffed (small body, no recognizable prefix)", () => {
    expect(isContentTypeMismatch("xml", "unknown")).toBe(false);
    expect(isContentTypeMismatch("json", "unknown")).toBe(false);
    expect(isContentTypeMismatch("html", "unknown")).toBe(false);
  });
  it("flags executable sniffed as mismatch (defense in depth)", () => {
    // Note: in safeFetch, executable is handled by SsrfBlockedError BEFORE
    // this check fires; this assertion documents the defensive fallback.
    expect(isContentTypeMismatch("xml", "executable")).toBe(true);
    expect(isContentTypeMismatch("json", "executable")).toBe(true);
    expect(isContentTypeMismatch("html", "executable")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// safeFetch integration (with mock DNS + fetch)
// ---------------------------------------------------------------------------

function publicDns(hostname: string): Promise<Array<{ address: string; family: 4 | 6 }>> {
  void hostname;
  return Promise.resolve([{ address: "93.184.216.34", family: 4 }]);
}

function privateDns(hostname: string): Promise<Array<{ address: string; family: 4 | 6 }>> {
  void hostname;
  return Promise.resolve([{ address: "192.168.1.100", family: 4 }]);
}

function metadataDns(hostname: string): Promise<Array<{ address: string; family: 4 | 6 }>> {
  void hostname;
  return Promise.resolve([{ address: "169.254.169.254", family: 4 }]);
}

function makeFetcher(
  responses: Array<{ status: number; headers?: Record<string, string>; body?: string }>
): FetchFn {
  let idx = 0;
  return (_url, _init) => {
    const r = responses[idx++]!;
    const headers = new Headers(r.headers ?? { "Content-Type": "text/plain" });
    const body = r.body !== undefined ? r.body : "ok";
    return Promise.resolve(
      new Response(body, { status: r.status, headers })
    );
  };
}

describe("safeFetch — SSRF defense (INV-0028-2)", () => {
  beforeEach(() => clearRobotsCache());

  it("throws SsrfBlockedError for private IP target", async () => {
    await expect(
      safeFetch("https://internal.example.com/feed", { maxBytes: MAX_BYTES.rss }, { dnsLookup: privateDns })
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("throws SsrfBlockedError for AWS metadata IP", async () => {
    await expect(
      safeFetch("https://example.com/feed", { maxBytes: MAX_BYTES.rss }, { dnsLookup: metadataDns })
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("throws SsrfBlockedError for file: scheme", async () => {
    await expect(
      safeFetch("file:///etc/passwd", { maxBytes: MAX_BYTES.unknown }, { dnsLookup: publicDns })
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("throws SsrfBlockedError for ftp: scheme", async () => {
    await expect(
      safeFetch("ftp://example.com/file", { maxBytes: MAX_BYTES.unknown }, { dnsLookup: publicDns })
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("throws SsrfBlockedError for http: when allowHttp=false (default)", async () => {
    await expect(
      safeFetch("http://example.com/", { maxBytes: MAX_BYTES.html }, { dnsLookup: publicDns })
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("throws SsrfBlockedError when DNS lookup stalls past timeoutMs", async () => {
    // A stalled DNS resolver must be bounded by the caller's timeoutMs, not hang forever.
    const stalledDns: DnsLookupFn = () => new Promise(() => {}); // never resolves
    await expect(
      safeFetch(
        "https://example.com/page",
        { maxBytes: MAX_BYTES.html, timeoutMs: 50 },
        { dnsLookup: stalledDns }
      )
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("allows http: when allowHttp=true", async () => {
    const fetcher = makeFetcher([
      { status: 200, body: "<html>ok</html>" },  // robots.txt fetch
      { status: 200, body: "<html>page</html>" }, // actual fetch
    ]);
    const result = await safeFetch(
      "http://example.com/page",
      { maxBytes: MAX_BYTES.html, allowHttp: true },
      { dnsLookup: publicDns, fetcher }
    );
    expect(result.status).toBe(200);
  });

  it("allows public HTTPS target", async () => {
    const fetcher = makeFetcher([
      { status: 404, body: "" },                  // robots.txt not found → allow
      { status: 200, body: '{"ok": true}' },       // actual fetch
    ]);
    const result = await safeFetch(
      "https://example.com/api",
      { maxBytes: MAX_BYTES.json },
      { dnsLookup: publicDns, fetcher }
    );
    expect(result.status).toBe(200);
  });
});

describe("safeFetch — redirect defense (INV-0028-3)", () => {
  beforeEach(() => clearRobotsCache());

  it("throws RedirectError on scheme downgrade https → http", async () => {
    const fetcher: FetchFn = (url, _init) => {
      if (url.includes("robots.txt")) return Promise.resolve(new Response("", { status: 404 }));
      return Promise.resolve(
        new Response(null, {
          status: 301,
          headers: { Location: "http://example.com/unsafe" },
        })
      );
    };
    await expect(
      safeFetch("https://example.com/page", { maxBytes: MAX_BYTES.html }, { dnsLookup: publicDns, fetcher })
    ).rejects.toThrow(RedirectError);
  });

  it("throws RedirectError after exceeding 3 redirect hops", async () => {
    let hop = 0;
    const fetcher: FetchFn = (url, _init) => {
      if (url.includes("robots.txt")) return Promise.resolve(new Response("", { status: 404 }));
      hop++;
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { Location: `https://example.com/hop${hop}` },
        })
      );
    };
    await expect(
      safeFetch("https://example.com/start", { maxBytes: MAX_BYTES.html }, { dnsLookup: publicDns, fetcher })
    ).rejects.toThrow(RedirectError);
  });

  it("follows valid redirect within hop limit", async () => {
    let call = 0;
    const fetcher: FetchFn = (url, _init) => {
      if (url.includes("robots.txt")) return Promise.resolve(new Response("", { status: 404 }));
      call++;
      if (call === 1) {
        return Promise.resolve(
          new Response(null, { status: 302, headers: { Location: "https://example.com/final" } })
        );
      }
      return Promise.resolve(new Response('{"done": true}', { status: 200 }));
    };
    const result = await safeFetch(
      "https://example.com/start",
      { maxBytes: MAX_BYTES.json },
      { dnsLookup: publicDns, fetcher }
    );
    expect(result.status).toBe(200);
  });

  it("blocks initial URL host when not in allowedHosts", async () => {
    // allowedHosts must be checked on the initial URL, not just on redirect targets.
    let anyNetworkCall = false;
    const fetcher: FetchFn = (_url, _init) => {
      anyNetworkCall = true;
      return Promise.resolve(new Response("ok", { status: 200 }));
    };
    await expect(
      safeFetch(
        "https://evil.com/page",
        { maxBytes: MAX_BYTES.html, allowedHosts: new Set(["example.com"]) },
        { dnsLookup: publicDns, fetcher }
      )
    ).rejects.toThrow(SsrfBlockedError);
    expect(anyNetworkCall).toBe(false);
  });

  it("blocks redirect to disallowed host when allowedHosts is set (before SSRF check)", async () => {
    // Verify that allowedHosts is checked before any network call to the redirect target.
    // The fetcher should NOT be called for evil.com/robots.txt.
    let evilRobotsRequested = false;
    const fetcher: FetchFn = (url, _init) => {
      if (url === "https://example.com/robots.txt") return Promise.resolve(new Response("", { status: 404 }));
      if (url.includes("evil.com")) {
        evilRobotsRequested = true;
        return Promise.resolve(new Response("", { status: 404 }));
      }
      return Promise.resolve(new Response(null, { status: 301, headers: { Location: "https://evil.com/exfil" } }));
    };
    await expect(
      safeFetch(
        "https://example.com/page",
        { maxBytes: MAX_BYTES.html, allowedHosts: new Set(["example.com"]) },
        { dnsLookup: publicDns, fetcher }
      )
    ).rejects.toThrow(RedirectError);
    expect(evilRobotsRequested).toBe(false);
  });

  it("throws RobotsDisallowedError when redirect target is blocked by its robots.txt", async () => {
    const fetcher: FetchFn = (url, _init) => {
      if (url === "https://example.com/robots.txt") return Promise.resolve(new Response("", { status: 404 }));
      if (url === "https://other.com/robots.txt") {
        return Promise.resolve(new Response("User-agent: *\nDisallow: /private\n", { status: 200 }));
      }
      if (url === "https://example.com/start") {
        return Promise.resolve(
          new Response(null, { status: 302, headers: { Location: "https://other.com/private/data" } })
        );
      }
      return Promise.resolve(new Response("should not reach", { status: 200 }));
    };
    await expect(
      safeFetch("https://example.com/start", { maxBytes: MAX_BYTES.html }, { dnsLookup: publicDns, fetcher })
    ).rejects.toThrow(RobotsDisallowedError);
  });

  it("returns 300 Multiple Choices as a final (non-redirect) response", async () => {
    // 300 is not in the redirect set [301,302,303,307,308] and should be returned
    // directly instead of entering redirect processing (which requires a Location header).
    const fetcher: FetchFn = (url, _init) => {
      if (url.includes("robots.txt")) return Promise.resolve(new Response("", { status: 404 }));
      return Promise.resolve(new Response("choices", { status: 300 }));
    };
    const result = await safeFetch(
      "https://example.com/multi",
      { maxBytes: MAX_BYTES.html },
      { dnsLookup: publicDns, fetcher }
    );
    expect(result.status).toBe(300);
  });

  it("returns 304 status directly without throwing RedirectError (conditional GET)", async () => {
    // 304 must not be treated as a redirect — it carries no Location header and
    // the scheduler's not_modified path depends on receiving it cleanly.
    const fetcher: FetchFn = (url, _init) => {
      if (url.includes("robots.txt")) return Promise.resolve(new Response("", { status: 404 }));
      return Promise.resolve(
        new Response(null, {
          status: 304,
          headers: { ETag: '"abc123"' },
        })
      );
    };
    const result = await safeFetch(
      "https://example.com/feed.xml",
      { maxBytes: MAX_BYTES.rss, requestHeaders: { "If-None-Match": '"abc123"' } },
      { dnsLookup: publicDns, fetcher }
    );
    expect(result.status).toBe(304);
    expect(result.headers.get("ETag")).toBe('"abc123"');
  });
});

describe("safeFetch — body size cap (INV-0028-4)", () => {
  beforeEach(() => clearRobotsCache());

  it("throws BodyTooLargeError when Content-Length exceeds limit", async () => {
    const fetcher: FetchFn = (url, _init) => {
      if (url.includes("robots.txt")) return Promise.resolve(new Response("", { status: 404 }));
      return Promise.resolve(
        new Response("tiny body", {
          status: 200,
          headers: { "Content-Length": "999999999" },
        })
      );
    };
    await expect(
      safeFetch("https://example.com/big", { maxBytes: 1024 }, { dnsLookup: publicDns, fetcher })
    ).rejects.toThrow(BodyTooLargeError);
  });

  it("throws BodyTooLargeError when streamed body exceeds limit", async () => {
    const bigBody = "x".repeat(10 * 1024); // 10 KB
    const fetcher: FetchFn = (url, _init) => {
      if (url.includes("robots.txt")) return Promise.resolve(new Response("", { status: 404 }));
      return Promise.resolve(new Response(bigBody, { status: 200 }));
    };
    await expect(
      safeFetch("https://example.com/big", { maxBytes: 1024 }, { dnsLookup: publicDns, fetcher })
    ).rejects.toThrow(BodyTooLargeError);
  });
});

describe("safeFetch — content-type sniff (INV-0028-6)", () => {
  beforeEach(() => clearRobotsCache());

  it("throws SsrfBlockedError for ELF binary response", async () => {
    const elfBody = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01]);
    const fetcher: FetchFn = (url, _init) => {
      if (url.includes("robots.txt")) return Promise.resolve(new Response("", { status: 404 }));
      return Promise.resolve(
        new Response(elfBody, { status: 200, headers: { "Content-Type": "application/octet-stream" } })
      );
    };
    await expect(
      safeFetch("https://example.com/file", { maxBytes: MAX_BYTES.unknown }, { dnsLookup: publicDns, fetcher })
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("returns contentKind=xml for RSS body", async () => {
    const rssBody = '<rss version="2.0"><channel><title>Test</title></channel></rss>';
    const fetcher: FetchFn = (url, _init) => {
      if (url.includes("robots.txt")) return Promise.resolve(new Response("", { status: 404 }));
      return Promise.resolve(
        new Response(rssBody, { status: 200, headers: { "Content-Type": "application/rss+xml" } })
      );
    };
    const result = await safeFetch(
      "https://example.com/feed.rss",
      { maxBytes: MAX_BYTES.rss },
      { dnsLookup: publicDns, fetcher }
    );
    expect(result.contentKind).toBe("xml");
  });
});

describe("safeFetch — robots.txt (INV-0028-5)", () => {
  beforeEach(() => clearRobotsCache());

  it("throws RobotsDisallowedError when path is Disallowed", async () => {
    const fetcher: FetchFn = (url, _init) => {
      if (url.includes("robots.txt")) {
        return Promise.resolve(
          new Response("User-agent: *\nDisallow: /secret\n", { status: 200 })
        );
      }
      return Promise.resolve(new Response("body", { status: 200 }));
    };
    await expect(
      safeFetch(
        "https://example.com/secret/data",
        { maxBytes: MAX_BYTES.html },
        { dnsLookup: publicDns, fetcher }
      )
    ).rejects.toThrow(RobotsDisallowedError);
  });

  it("allows fetch when path is not Disallowed", async () => {
    const fetcher: FetchFn = (url, _init) => {
      if (url.includes("robots.txt")) {
        return Promise.resolve(
          new Response("User-agent: *\nDisallow: /admin\n", { status: 200 })
        );
      }
      return Promise.resolve(new Response('{"ok": true}', { status: 200 }));
    };
    const result = await safeFetch(
      "https://example.com/public/feed",
      { maxBytes: MAX_BYTES.json },
      { dnsLookup: publicDns, fetcher }
    );
    expect(result.status).toBe(200);
  });

  it("respects Allow rule overriding Disallow via specificity", async () => {
    const fetcher: FetchFn = (url, _init) => {
      if (url.includes("robots.txt")) {
        return Promise.resolve(
          new Response("User-agent: *\nDisallow: /archive\nAllow: /archive/public\n", { status: 200 })
        );
      }
      return Promise.resolve(new Response('{"ok": true}', { status: 200 }));
    };
    const result = await safeFetch(
      "https://example.com/archive/public/doc",
      { maxBytes: MAX_BYTES.json },
      { dnsLookup: publicDns, fetcher }
    );
    expect(result.status).toBe(200);
  });

  it("allows access when robots.txt returns 401 (RFC 9309 §2.3.1.3 — 4xx = allow-all)", async () => {
    const fetcher: FetchFn = (url, _init) => {
      if (url.includes("robots.txt")) return Promise.resolve(new Response("", { status: 401 }));
      return Promise.resolve(new Response("body", { status: 200 }));
    };
    // 401 is a 4xx — per RFC 9309 §2.3.1.3 robots.txt "doesn't exist" → allow-all.
    const result = await safeFetch(
      "https://example.com/any/path",
      { maxBytes: MAX_BYTES.html },
      { dnsLookup: publicDns, fetcher }
    );
    expect(result.status).toBe(200);
  });

  it("allows access when robots.txt returns 403 (RFC 9309 §2.3.1.3 — 4xx = allow-all)", async () => {
    const fetcher: FetchFn = (url, _init) => {
      if (url.includes("robots.txt")) return Promise.resolve(new Response("", { status: 403 }));
      return Promise.resolve(new Response("body", { status: 200 }));
    };
    // 403 is a 4xx — per RFC 9309 §2.3.1.3 robots.txt "doesn't exist" → allow-all.
    const result = await safeFetch(
      "https://example.com/any/path",
      { maxBytes: MAX_BYTES.html },
      { dnsLookup: publicDns, fetcher }
    );
    expect(result.status).toBe(200);
  });

  it("fail-closed: blocks fetch when robots.txt is unreachable (network error → disallow-all)", async () => {
    const fetcher: FetchFn = (url, _init) => {
      if (url.includes("robots.txt")) return Promise.reject(new Error("ECONNREFUSED"));
      return Promise.resolve(new Response("body", { status: 200 }));
    };
    // Network error fetching robots.txt → fail-closed (disallow-all) per security policy.
    await expect(
      safeFetch("https://example.com/any/path", { maxBytes: MAX_BYTES.html }, { dnsLookup: publicDns, fetcher })
    ).rejects.toThrow(RobotsDisallowedError);
  });

  it("blocks fetch when robots.txt returns 5xx (disallow-all per RFC 9309 §2.3.1.4)", async () => {
    const fetcher: FetchFn = (url, _init) => {
      if (url.includes("robots.txt")) return Promise.resolve(new Response("", { status: 503 }));
      return Promise.resolve(new Response('{"ok": true}', { status: 200 }));
    };
    await expect(
      safeFetch("https://example.com/page", { maxBytes: MAX_BYTES.json }, { dnsLookup: publicDns, fetcher })
    ).rejects.toThrow(RobotsDisallowedError);
  });

  it("follows same-host robots.txt redirect (canonical redirect)", async () => {
    // example.com/robots.txt → 301 to example.com/robots.txt?v=2 (same host, just query).
    // The redirected robots should be parsed and disallow /private.
    const fetcher: FetchFn = (url, _init) => {
      if (url === "https://example.com/robots.txt") {
        return Promise.resolve(
          new Response(null, { status: 301, headers: { Location: "https://example.com/robots.txt?v=2" } })
        );
      }
      if (url === "https://example.com/robots.txt?v=2") {
        return Promise.resolve(new Response("User-agent: *\nDisallow: /private\n", { status: 200 }));
      }
      return Promise.resolve(new Response("ok", { status: 200 }));
    };
    await expect(
      safeFetch("https://example.com/private/doc", { maxBytes: MAX_BYTES.html }, { dnsLookup: publicDns, fetcher })
    ).rejects.toThrow(RobotsDisallowedError);
  });

  it("treats cross-host robots.txt redirect as allow-all (SSRF safety)", async () => {
    // robots.txt redirects to a different host — we stop following (allow-all).
    const fetcher: FetchFn = (url, _init) => {
      if (url === "https://example.com/robots.txt") {
        return Promise.resolve(
          new Response(null, { status: 301, headers: { Location: "https://other.com/robots.txt" } })
        );
      }
      // other.com/robots.txt would disallow / — but we should NOT follow and NOT block.
      return Promise.resolve(new Response("ok", { status: 200 }));
    };
    const result = await safeFetch(
      "https://example.com/private/doc",
      { maxBytes: MAX_BYTES.html },
      { dnsLookup: publicDns, fetcher }
    );
    expect(result.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// safeFetch — requestHeaders handling
// ---------------------------------------------------------------------------

describe("safeFetch — requestHeaders", () => {
  const publicDns: DnsLookupFn = () =>
    Promise.resolve([{ address: "1.2.3.4", family: 4 }]);

  beforeEach(() => clearRobotsCache());

  it("forwards custom headers on same-host request", async () => {
    let capturedHeaders: Record<string, string> = {};
    const fetcher: FetchFn = (url, init) => {
      if ((url as string).endsWith("/robots.txt")) {
        return Promise.resolve(new Response("User-agent: *\nAllow: /\n", { status: 200 }));
      }
      capturedHeaders = Object.fromEntries(
        Object.entries(init?.headers as Record<string, string> ?? {})
      );
      return Promise.resolve(new Response("ok", { status: 200 }));
    };
    await safeFetch(
      "https://example.com/page",
      { maxBytes: MAX_BYTES.html, requestHeaders: { "X-Custom": "value123" } },
      { dnsLookup: publicDns, fetcher }
    );
    expect(capturedHeaders["X-Custom"]).toBe("value123");
  });

  it("never allows requestHeaders to override configured User-Agent", async () => {
    let capturedUA = "";
    const fetcher: FetchFn = (url, init) => {
      if ((url as string).endsWith("/robots.txt")) {
        return Promise.resolve(new Response("User-agent: *\nAllow: /\n", { status: 200 }));
      }
      capturedUA = (init?.headers as Record<string, string>)["User-Agent"] ?? "";
      return Promise.resolve(new Response("ok", { status: 200 }));
    };
    await safeFetch(
      "https://example.com/page",
      {
        maxBytes: MAX_BYTES.html,
        userAgent: "mybot/2.0",
        requestHeaders: { "User-Agent": "AttackerBot/1.0" },
      },
      { dnsLookup: publicDns, fetcher }
    );
    expect(capturedUA).toBe("mybot/2.0");
  });

  it("strips ALL caller headers on cross-host redirect (not just known-sensitive ones)", async () => {
    let secondHopHeaders: Record<string, string> = {};
    const fetcher: FetchFn = (url, init) => {
      const u = url as string;
      if (u.includes("/robots.txt")) {
        return Promise.resolve(new Response("User-agent: *\nAllow: /\n", { status: 200 }));
      }
      if (u === "https://origin.com/page") {
        return Promise.resolve(
          new Response(null, { status: 302, headers: { Location: "https://other.com/data" } })
        );
      }
      // second hop — capture headers
      secondHopHeaders = Object.fromEntries(
        Object.entries(init?.headers as Record<string, string> ?? {})
      );
      return Promise.resolve(new Response("ok", { status: 200 }));
    };
    await safeFetch(
      "https://origin.com/page",
      {
        maxBytes: MAX_BYTES.html,
        requestHeaders: {
          Authorization: "Bearer secret-token",
          "X-App-Id": "app123",
          "X-API-Key": "custom-key",
        },
      },
      { dnsLookup: publicDns, fetcher }
    );
    // All caller headers must be stripped on cross-host hops — a denylist
    // approach cannot enumerate every possible custom auth header.
    expect(secondHopHeaders["Authorization"]).toBeUndefined();
    expect(secondHopHeaders["X-App-Id"]).toBeUndefined();
    expect(secondHopHeaders["X-API-Key"]).toBeUndefined();
    // Only User-Agent is forwarded (always set from opts.userAgent)
    expect(secondHopHeaders["User-Agent"]).toBe("k-world-monitor/1.0");
  });

  it("strips Cookie header on cross-host redirect", async () => {
    let secondHopHeaders: Record<string, string> = {};
    const fetcher: FetchFn = (url, init) => {
      const u = url as string;
      if (u.includes("/robots.txt")) {
        return Promise.resolve(new Response("User-agent: *\nAllow: /\n", { status: 200 }));
      }
      if (u === "https://origin.com/page") {
        return Promise.resolve(
          new Response(null, { status: 301, headers: { Location: "https://other.com/resource" } })
        );
      }
      secondHopHeaders = Object.fromEntries(
        Object.entries(init?.headers as Record<string, string> ?? {})
      );
      return Promise.resolve(new Response("ok", { status: 200 }));
    };
    await safeFetch(
      "https://origin.com/page",
      {
        maxBytes: MAX_BYTES.html,
        requestHeaders: { Cookie: "session=abc123" },
      },
      { dnsLookup: publicDns, fetcher }
    );
    expect(secondHopHeaders["Cookie"]).toBeUndefined();
  });

  it("preserves Authorization on same-host redirect", async () => {
    let secondHopHeaders: Record<string, string> = {};
    const fetcher: FetchFn = (url, init) => {
      const u = url as string;
      if (u.includes("/robots.txt")) {
        return Promise.resolve(new Response("User-agent: *\nAllow: /\n", { status: 200 }));
      }
      if (u === "https://example.com/page") {
        return Promise.resolve(
          new Response(null, { status: 301, headers: { Location: "https://example.com/new-page" } })
        );
      }
      secondHopHeaders = Object.fromEntries(
        Object.entries(init?.headers as Record<string, string> ?? {})
      );
      return Promise.resolve(new Response("ok", { status: 200 }));
    };
    await safeFetch(
      "https://example.com/page",
      {
        maxBytes: MAX_BYTES.html,
        requestHeaders: { Authorization: "Bearer my-token" },
      },
      { dnsLookup: publicDns, fetcher }
    );
    // Same host — Authorization is preserved
    expect(secondHopHeaders["Authorization"]).toBe("Bearer my-token");
  });
});

// ---------------------------------------------------------------------------
// safeFetch — declared-vs-sniffed Content-Type mismatch (INV-0028-6)
// Operator decision D1 2026-05-18: production wiring of
// ContentTypeMismatchError at safe-fetch boundary.
// ---------------------------------------------------------------------------

describe("safeFetch — declared-vs-sniffed Content-Type mismatch (INV-0028-6)", () => {
  beforeEach(() => clearRobotsCache());

  it("passes when declared application/json + body sniffs as json", async () => {
    const fetcher = makeFetcher([
      { status: 404, body: "" }, // robots.txt 404 → allow
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: '{"feed": []}',
      },
    ]);
    const result = await safeFetch(
      "https://example.com/api",
      { maxBytes: MAX_BYTES.json },
      { dnsLookup: publicDns, fetcher },
    );
    expect(result.status).toBe(200);
    expect(result.contentKind).toBe("json");
  });

  it("passes when declared application/rss+xml + body sniffs as xml", async () => {
    const fetcher = makeFetcher([
      { status: 404, body: "" },
      {
        status: 200,
        headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
        body: '<?xml version="1.0"?><rss><channel></channel></rss>',
      },
    ]);
    const result = await safeFetch(
      "https://example.com/feed",
      { maxBytes: MAX_BYTES.rss },
      { dnsLookup: publicDns, fetcher },
    );
    expect(result.status).toBe(200);
    expect(result.contentKind).toBe("xml");
  });

  it("passes when declared text/html + body sniffs as html", async () => {
    const fetcher = makeFetcher([
      { status: 404, body: "" },
      {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
        body: "<!doctype html><html><body>ok</body></html>",
      },
    ]);
    const result = await safeFetch(
      "https://example.com/page",
      { maxBytes: MAX_BYTES.html },
      { dnsLookup: publicDns, fetcher },
    );
    expect(result.status).toBe(200);
    expect(result.contentKind).toBe("html");
  });

  it("throws ContentTypeMismatchError when declared application/json + body is HTML error page", async () => {
    const fetcher = makeFetcher([
      { status: 404, body: "" },
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: "<!doctype html><html><body>503 backend error</body></html>",
      },
    ]);
    await expect(
      safeFetch(
        "https://example.com/api",
        { maxBytes: MAX_BYTES.json },
        { dnsLookup: publicDns, fetcher },
      ),
    ).rejects.toThrow(ContentTypeMismatchError);
  });

  it("throws ContentTypeMismatchError when declared application/rss+xml + body is JSON", async () => {
    const fetcher = makeFetcher([
      { status: 404, body: "" },
      {
        status: 200,
        headers: { "Content-Type": "application/rss+xml" },
        body: '{"error": "wrong endpoint"}',
      },
    ]);
    await expect(
      safeFetch(
        "https://example.com/feed",
        { maxBytes: MAX_BYTES.rss },
        { dnsLookup: publicDns, fetcher },
      ),
    ).rejects.toThrow(ContentTypeMismatchError);
  });

  it("throws ContentTypeMismatchError when declared text/html + body is JSON", async () => {
    const fetcher = makeFetcher([
      { status: 404, body: "" },
      {
        status: 200,
        headers: { "Content-Type": "text/html" },
        body: '{"data": []}',
      },
    ]);
    await expect(
      safeFetch(
        "https://example.com/page",
        { maxBytes: MAX_BYTES.html },
        { dnsLookup: publicDns, fetcher },
      ),
    ).rejects.toThrow(ContentTypeMismatchError);
  });

  it("passes when Content-Type header is missing (operator D1: no hard fail)", async () => {
    const fetcher: FetchFn = (url, _init) => {
      if (url.includes("robots.txt"))
        return Promise.resolve(new Response("", { status: 404 }));
      // Build response with NO Content-Type header at all.
      const headers = new Headers();
      return Promise.resolve(
        new Response('{"ok": true}', { status: 200, headers }),
      );
    };
    const result = await safeFetch(
      "https://example.com/api",
      { maxBytes: MAX_BYTES.json },
      { dnsLookup: publicDns, fetcher },
    );
    expect(result.status).toBe(200);
    expect(result.contentKind).toBe("json");
  });

  it("passes when declared is unrecognized MIME (text/plain etc — no hard fail)", async () => {
    const fetcher = makeFetcher([
      { status: 404, body: "" },
      {
        status: 200,
        headers: { "Content-Type": "text/plain" },
        body: '{"ok": true}',
      },
    ]);
    const result = await safeFetch(
      "https://example.com/api",
      { maxBytes: MAX_BYTES.json },
      { dnsLookup: publicDns, fetcher },
    );
    // text/plain → declared=unknown → no mismatch
    expect(result.status).toBe(200);
    expect(result.contentKind).toBe("json");
  });

  it("passes when body is too small to sniff (contentKind=unknown)", async () => {
    const fetcher = makeFetcher([
      { status: 404, body: "" },
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: "",
      },
    ]);
    const result = await safeFetch(
      "https://example.com/api",
      { maxBytes: MAX_BYTES.json },
      { dnsLookup: publicDns, fetcher },
    );
    // Empty body → sniffMagic returns unknown → no mismatch
    expect(result.status).toBe(200);
    expect(result.contentKind).toBe("unknown");
  });

  it("ContentTypeMismatchError message includes declared and sniffed", async () => {
    const fetcher = makeFetcher([
      { status: 404, body: "" },
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: "<!doctype html><html></html>",
      },
    ]);
    try {
      await safeFetch(
        "https://example.com/api",
        { maxBytes: MAX_BYTES.json },
        { dnsLookup: publicDns, fetcher },
      );
      throw new Error("expected ContentTypeMismatchError");
    } catch (err) {
      expect(err).toBeInstanceOf(ContentTypeMismatchError);
      expect((err as Error).message).toContain("application/json");
      expect((err as Error).message).toContain("html");
    }
  });

  it("throws SsrfBlockedError (not ContentTypeMismatchError) for executable body", async () => {
    // SsrfBlockedError branch fires BEFORE mismatch check; this assertion
    // documents the precedence (executable reject is INV-0028-6 rule 3,
    // mismatch is rules 1+2).
    const elf = "\x7fELF" + "\x00".repeat(508);
    const fetcher = makeFetcher([
      { status: 404, body: "" },
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: elf,
      },
    ]);
    await expect(
      safeFetch(
        "https://example.com/api",
        { maxBytes: MAX_BYTES.json },
        { dnsLookup: publicDns, fetcher },
      ),
    ).rejects.toThrow(SsrfBlockedError);
  });
});
