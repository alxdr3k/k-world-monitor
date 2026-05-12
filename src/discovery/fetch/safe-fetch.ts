/**
 * safe-fetch — INFRA-1B.2a
 * All outbound HTTP requests in the discovery layer must go through this module.
 * Implements ADR-0028 INV-0028-1 through INV-0028-6.
 *
 * Defense layers (in order):
 *   1. URL scheme allowlist (INV-0028-2)
 *   2. DNS pre-resolve + private IP rejection (INV-0028-2)
 *   3. robots.txt cache + Disallow/Allow check (INV-0028-5)
 *   4. fetch() with redirect:manual + AbortSignal (INV-0028-3)
 *   5. Per-hop scheme + allowlist + SSRF + robots checks (INV-0028-3)
 *   6. Content-Length preflight (INV-0028-4)
 *   7. Streaming byte counter + zip bomb ratio (INV-0028-4)
 *   8. Body-first-512 content-type sniff (INV-0028-6)
 */

import { lookup } from "node:dns/promises";

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class SsrfBlockedError extends Error {
  constructor(url: string, reason: string) {
    super(`SSRF blocked [${url}]: ${reason}`);
    this.name = "SsrfBlockedError";
  }
}

export class BodyTooLargeError extends Error {
  constructor(url: string, limitBytes: number) {
    super(`Body too large [${url}]: exceeded ${limitBytes} bytes`);
    this.name = "BodyTooLargeError";
  }
}

export class RobotsDisallowedError extends Error {
  constructor(url: string) {
    super(`robots.txt disallows: ${url}`);
    this.name = "RobotsDisallowedError";
  }
}

export class RedirectError extends Error {
  constructor(reason: string) {
    super(`Redirect blocked: ${reason}`);
    this.name = "RedirectError";
  }
}

// ---------------------------------------------------------------------------
// Byte caps (DEC-017)
// ---------------------------------------------------------------------------

export const MAX_BYTES = {
  html:    10 * 1024 * 1024,
  rss:      5 * 1024 * 1024,
  json:     5 * 1024 * 1024,
  pdf:     20 * 1024 * 1024,
  dataset: 50 * 1024 * 1024,
  unknown:  1 * 1024 * 1024,
} as const;

const ZIP_BOMB_RATIO = 100;
const MAX_REDIRECT_HOPS = 3;
const ROBOTS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;       // 24 h for definitive responses
const ROBOTS_ERROR_TTL_MS = 5 * 60 * 1000;              // 5 min for transient errors/unknowns
const ROBOTS_CACHE_MAX_SIZE = 1000;
const ROBOTS_MAX_BYTES = 512 * 1024;                    // 512 KB cap for robots.txt body
const DEFAULT_USER_AGENT = "k-world-monitor/1.0";
const DEFAULT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// SSRF — private IP detection (INV-0028-2)
// ---------------------------------------------------------------------------

// Expand a compressed IPv6 address to its full 8-hextet zero-padded form.
// This normalizes all compressed and non-standard representations so that
// prefix-matching regexes always see exactly 4 hex digits per group.
// Examples:
//   "::1"             → "0000:0000:0000:0000:0000:0000:0000:0001"
//   "0:0:0:0:0:0:0:1" → same
//   "fc00::1"         → "fc00:0000:0000:0000:0000:0000:0000:0001"
// NOTE: does NOT handle dotted-decimal mixed notation (e.g. "::ffff:10.0.0.1");
// callers must screen for that form before calling expandIPv6.
function expandIPv6(addr: string): string {
  addr = addr.replace(/^\[|\]$/g, ""); // strip brackets if any
  if (!addr.includes("::")) {
    // No :: compression — just zero-pad each group
    return addr.split(":").map((g) => g.padStart(4, "0")).join(":");
  }
  const halves = addr.split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  return [...left, ...Array(missing).fill("0"), ...right]
    .map((g) => g.padStart(4, "0"))
    .join(":");
}

// Exported for unit testing.
export function isPrivateIp(addr: string, family: 4 | 6): boolean {
  if (family === 6) {
    const raw = addr.toLowerCase();

    // Handle dotted-decimal IPv4-mapped BEFORE expansion because expandIPv6
    // cannot parse mixed notation (e.g. "::ffff:10.0.0.1").
    // IPv4-mapped in dotted-decimal notation: ::ffff:a.b.c.d
    const v4mappedDec = raw.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (v4mappedDec) return isPrivateIp(v4mappedDec[1]!, 4);

    // Expand to full 8-group zero-padded form so every regex sees exactly
    // 4 hex digits in the first group. This catches all compressed variants
    // including "0:0:0:0:0:0:0:1" (long-form loopback, missed by === "::1").
    const a = expandIPv6(raw);

    // Loopback ::1 (0000::.../128)
    if (a === "0000:0000:0000:0000:0000:0000:0000:0001") return true;
    // Unspecified ::/128
    if (a === "0000:0000:0000:0000:0000:0000:0000:0000") return true;
    // Unique-local fc00::/7 (first byte 0xfc or 0xfd → groups fc__ or fd__)
    if (/^f[cd][0-9a-f]{2}:/i.test(a)) return true;
    // Link-local fe80::/10
    if (/^fe[89ab][0-9a-f]:/i.test(a)) return true;
    // Multicast ff00::/8
    if (/^ff[0-9a-f]{2}:/i.test(a)) return true;
    // IPv4-mapped in hex-group notation after full expansion:
    //   ::ffff:xxyy:zzww → "0000:0000:0000:0000:0000:ffff:xxyy:zzww"
    const v4mappedHex = a.match(
      /^0000:0000:0000:0000:0000:ffff:([0-9a-f]{4}):([0-9a-f]{4})$/i
    );
    if (v4mappedHex) {
      const hi = parseInt(v4mappedHex[1]!, 16);
      const lo = parseInt(v4mappedHex[2]!, 16);
      const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isPrivateIp(ipv4, 4);
    }
    return false;
  }

  // IPv4
  const parts = addr.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return true;
  const a = parts[0]!;
  const b = parts[1]!;
  const c = parts[2]!;
  // 0.0.0.0/8 — this host
  if (a === 0) return true;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 100.64.0.0/10 — carrier-grade NAT
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 127.0.0.0/8 — loopback
  if (a === 127) return true;
  // 169.254.0.0/16 — link-local / AWS metadata
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.0.2.0/24 — documentation
  if (a === 192 && b === 0 && c === 2) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 198.18.0.0/15 — benchmarking
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 198.51.100.0/24 — documentation
  if (a === 198 && b === 51 && c === 100) return true;
  // 203.0.113.0/24 — documentation
  if (a === 203 && b === 0 && c === 113) return true;
  // 224.0.0.0/4 — multicast
  if (a >= 224 && a <= 239) return true;
  // 240.0.0.0/4 — reserved
  if (a >= 240) return true;
  return false;
}

async function checkSsrf(
  hostname: string,
  dnsLookup: DnsLookupFn,
  timeoutMs: number
): Promise<void> {
  // Strip IPv6 literal brackets — URL.hostname returns "[::1]" for IPv6 literals,
  // but dns.lookup() expects the bare address without brackets.
  const hostForDns = hostname.replace(/^\[|\]$/g, "");

  let records: Array<{ address: string; family: 4 | 6 }>;
  try {
    // Race DNS against a timeout so a stalled resolver cannot hang beyond timeoutMs.
    const dnsTimeoutMs = Math.min(timeoutMs, 10_000);
    let dnsTimer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      dnsTimer = setTimeout(
        () => reject(new Error(`DNS lookup timed out after ${dnsTimeoutMs}ms`)),
        dnsTimeoutMs
      );
    });
    try {
      records = await Promise.race([dnsLookup(hostForDns), timeoutPromise]);
    } finally {
      clearTimeout(dnsTimer);
    }
  } catch (err) {
    throw new SsrfBlockedError(hostname, `DNS resolution failed: ${String(err)}`);
  }
  if (records.length === 0) {
    throw new SsrfBlockedError(hostname, "DNS returned no addresses");
  }
  for (const { address, family } of records) {
    if (isPrivateIp(address, family)) {
      throw new SsrfBlockedError(
        hostname,
        `resolved to private/reserved IP ${address}`
      );
    }
  }
  // DNS-rebinding (TOCTOU): the IP verified here may differ from the IP used by
  // fetch() if the DNS record changes between this check and the actual TCP connect.
  // Eliminating this window requires a custom HTTP stack with socket-level IP pinning,
  // which is out of scope for this layer (ADR-0028). The risk window is narrow under
  // normal TTLs and server-side mitigations (Host header validation).
}

// ---------------------------------------------------------------------------
// robots.txt cache + parser (INV-0028-5)
// ---------------------------------------------------------------------------

export interface RobotsRules {
  disallow: string[];
  allow: string[];
}

interface RobotsCacheEntry {
  rules: RobotsRules;
  expiresAt: number; // absolute epoch ms
}

const robotsCache = new Map<string, RobotsCacheEntry>();

function robotsCacheKey(url: URL, userAgent: string): string {
  // Include scheme + host + port (different origins have different robots.txt)
  // and user-agent (different bots can have different rule sets in the same file).
  return `${url.protocol}//${url.host}::${userAgent}`;
}

function robotsCacheSet(key: string, entry: RobotsCacheEntry): void {
  // Evict oldest (insertion-order first) entry when the cache is full.
  if (robotsCache.size >= ROBOTS_CACHE_MAX_SIZE) {
    const firstKey = robotsCache.keys().next().value;
    if (firstKey !== undefined) robotsCache.delete(firstKey);
  }
  robotsCache.set(key, entry);
}

// Exported for unit testing.
// Note: product-token extraction assumes "product/version" UA format (e.g.
// "k-world-monitor/1.0"). Composite UAs like "Mozilla/5.0 (compatible; ...)"
// are not used by this discovery layer; callers using non-standard UAs must
// extract and pass the product token themselves.
export function parseRobotsTxt(text: string, userAgent: string): RobotsRules {
  // Product token: "k-world-monitor/1.0" → "k-world-monitor".
  // RFC 9309 §2.2.1: matches if file token equals the product token or
  // starts with it followed by "/".
  // Extract product token: take the first whitespace- or slash-delimited segment.
  // This correctly handles composite UAs like "Mozilla/5.0 ..." by stopping at the
  // first space, and single-product UAs like "k-world-monitor/1.0" by stopping at "/".
  const productToken = userAgent.toLowerCase().split(/[\s/]/)[0]!.trim();

  const agentDisallow: string[] = [];
  const agentAllow: string[] = [];
  const starDisallow: string[] = [];
  const starAllow: string[] = [];

  // Per REP §2.2.2: if a matching agent-specific group exists, its rules apply
  // exclusively — never fall back to the wildcard group, even if the group is empty.
  let agentGroupSeen = false;
  let groupMatchesAgent = false;
  let groupMatchesStar = false;
  let inUaSection = true;
  // RFC 9309: a blank line is a group separator, but only when followed by a
  // User-agent line (not when followed by Disallow/Allow — blank lines within the
  // rule body of a group are valid, e.g. `User-agent: *\n\nDisallow: /` must
  // still disallow-all). We defer the group reset until we see what follows.
  let afterBlankLine = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = (raw.split("#")[0] ?? "").trim();

    if (!line) {
      afterBlankLine = true;
      continue;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) { afterBlankLine = false; continue; }
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const val = line.slice(colonIdx + 1).trim();

    if (key === "user-agent") {
      if (afterBlankLine || !inUaSection) {
        // A User-agent: line after a blank separator OR after rule lines starts a new group.
        groupMatchesAgent = false;
        groupMatchesStar = false;
        inUaSection = true;
      }
      afterBlankLine = false;
      const agentVal = val.toLowerCase();
      // Match product token exactly or as a version prefix ("bot" matches "bot/2.0").
      if (agentVal === productToken || agentVal.startsWith(productToken + "/")) {
        groupMatchesAgent = true;
        agentGroupSeen = true;
      }
      if (val === "*") {
        groupMatchesStar = true;
      }
    } else if (key === "disallow" || key === "allow") {
      afterBlankLine = false;
      inUaSection = false;
      if (!val) continue; // empty Disallow = allow all; empty Allow = no-op
      if (groupMatchesAgent) {
        if (key === "disallow") agentDisallow.push(val);
        else agentAllow.push(val);
      } else if (groupMatchesStar) {
        if (key === "disallow") starDisallow.push(val);
        else starAllow.push(val);
      }
    }
  }

  // If our bot appeared in any User-agent: group, use only those rules.
  // An empty specific group means "no restrictions" — do not fall back to *.
  return agentGroupSeen
    ? { disallow: agentDisallow, allow: agentAllow }
    : { disallow: starDisallow, allow: starAllow };
}

// Decode a percent-encoded URI path component for robots.txt rule comparison,
// per RFC 9309 §2.2.2 — decode everything except path-structure delimiters.
// Specifically, %2F (/), %3F (?), and %23 (#) must NOT be decoded because they
// change the structural meaning of the path:
//   /a%2Fb is a two-segment path  (/a/b would be three segments — different paths)
//   /page%3Fq=1 is a path containing "?" literally, not a query separator
// All other percent-encoded characters, including %2A (*) and %24 ($) which are
// robots.txt wildcard/end-anchor operators only in their bare (unencoded) form,
// are decoded so they compare correctly with bare characters in the path or rule.
function decodeUnreserved(s: string): string {
  return s.replace(/%([0-9A-Fa-f]{2})/g, (match, hex) => {
    const code = parseInt(hex, 16);
    // Keep path-structure delimiters encoded so they don't alter path semantics
    if (code === 0x2f || code === 0x3f || code === 0x23) { // / ? #
      return match;
    }
    return String.fromCharCode(code);
  });
}

// Test whether a single robots rule matches a decoded path.
// Supports RFC 9309 wildcard (*) and end-anchor ($) syntax.
// Both rule and path are decoded using unreserved-only decode (decodeUnreserved)
// so that reserved chars like %2F in a rule stay encoded and do not match /.
function ruleMatchesPath(rule: string, decodedPath: string): boolean {
  const hasEndAnchor = rule.endsWith("$");
  const base = hasEndAnchor ? rule.slice(0, -1) : rule;

  if (!base.includes("*")) {
    // No wildcard — simple prefix or exact match.
    // Check raw base for "*" first so %2A (encoded asterisk) is never treated
    // as a wildcard operator. Then decode the rule with unreserved-only decode
    // to match the encoding used for decodedPath.
    const decodedBase = decodeUnreserved(base);
    return hasEndAnchor ? decodedPath === decodedBase : decodedPath.startsWith(decodedBase);
  }

  // Wildcard path: split on literal (unencoded) * so that %2A in a rule segment
  // stays a literal asterisk after decoding and is not treated as a wildcard operator.
  // Each segment is decoded individually and its regex metacharacters (including
  // * from %2A and $ from %24) are escaped before joining with .*.
  const segments = base.split("*");
  const escapedSegments = segments.map((seg) => {
    const decoded = decodeUnreserved(seg);
    return decoded.replace(/[.+?^$*{}()|[\]\\]/g, "\\$&");
  });
  const escaped = escapedSegments.join(".*");
  const pattern = hasEndAnchor ? `^${escaped}$` : `^${escaped}`;
  return new RegExp(pattern).test(decodedPath);
}

// Exported for unit testing.
export function isRobotsPathDisallowed(rules: RobotsRules, path: string): boolean {
  // /robots.txt is implicitly always accessible per REP — never apply rules to it.
  if (path === "/robots.txt" || path.startsWith("/robots.txt?")) {
    return false;
  }

  // RFC 9309 §2.2.2: only decode unreserved characters (letters, digits, - . _ ~)
  // for path comparison. Reserved chars like %2F, %3F, %23 must stay percent-encoded
  // so that /a%2Fb does not incorrectly match rule /a/b.
  const decodedPath = decodeUnreserved(path);

  // RFC 9309 specificity rule: the longest matching rule wins regardless of kind.
  // Allow wins on tie (measured by pattern length excluding the $ anchor character).
  // Specificity is measured on the decoded rule (decodeUnreserved) so that
  // percent-encoded and plain-text equivalent rules have the same specificity weight,
  // consistent with how the path side is normalized before matching.
  let bestLength = -1;
  let bestIsDisallow = false;

  function ruleSpecificity(rule: string): number {
    const base = rule.endsWith("$") ? rule.slice(0, -1) : rule;
    return decodeUnreserved(base).length;
  }

  for (const rule of rules.disallow) {
    const ruleLen = ruleSpecificity(rule);
    if (ruleMatchesPath(rule, decodedPath) && ruleLen > bestLength) {
      bestLength = ruleLen;
      bestIsDisallow = true;
    }
  }
  for (const rule of rules.allow) {
    const ruleLen = ruleSpecificity(rule);
    // Allow wins on tie (>= instead of >).
    if (ruleMatchesPath(rule, decodedPath) && ruleLen >= bestLength) {
      bestLength = ruleLen;
      bestIsDisallow = false;
    }
  }

  return bestIsDisallow;
}

// Read a robots.txt response body with a hard byte cap to prevent memory exhaustion.
// Truncation is intentional: partial robots.txt still applies whatever rules were read.
async function readRobotsBody(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > ROBOTS_MAX_BYTES) {
        // Keep bytes up to the cap so rules in the over-limit chunk are not lost.
        const remaining = ROBOTS_MAX_BYTES - (total - value.byteLength);
        if (remaining > 0) chunks.push(value.slice(0, remaining));
        reader.cancel();
        break;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const buf = new Uint8Array(chunks.reduce((acc, c) => acc + c.byteLength, 0));
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  return new TextDecoder().decode(buf);
}

async function checkRobots(
  url: URL,
  userAgent: string,
  fetcher: FetchFn,
  timeoutMs: number
): Promise<void> {
  const cacheKey = robotsCacheKey(url, userAgent);
  const now = Date.now();
  const cached = robotsCache.get(cacheKey);
  let rules: RobotsRules;

  if (cached && now < cached.expiresAt) {
    rules = cached.rules;
  } else {
    const robotsUrl = `${url.protocol}//${url.host}/robots.txt`;
    const fetchHeaders = { "User-Agent": userAgent };

    let res: Response;
    let isTransient = false;
    try {
      res = await fetcher(robotsUrl, {
        headers: fetchHeaders,
        // redirect:manual prevents SSRF via a hostile 301/302 on the robots.txt endpoint.
        redirect: "manual",
        signal: AbortSignal.timeout(Math.min(timeoutMs, 10_000)),
      });

      // Follow same-host redirects up to 3 hops to handle canonical redirects
      // (http→https, apex↔www on the same host). Cross-host redirects stay
      // allow-all: we have SSRF-verified this host but not the redirect target.
      let currentRobotsUrl = robotsUrl;
      for (let hop = 0; hop < 3 && [301, 302, 303, 307, 308].includes(res.status); hop++) {
        const loc = res.headers.get("Location");
        if (!loc) break;
        try {
          const nextLoc = new URL(loc, currentRobotsUrl);
          // Allow same-host redirects including canonical http→https upgrade.
          const sameHost = nextLoc.host === url.host;
          const schemeOk =
            nextLoc.protocol === url.protocol ||
            (url.protocol === "http:" && nextLoc.protocol === "https:");
          if (!sameHost || !schemeOk) break;
          res = await fetcher(nextLoc.toString(), {
            headers: fetchHeaders,
            redirect: "manual",
            signal: AbortSignal.timeout(Math.min(timeoutMs, 10_000)),
          });
          currentRobotsUrl = nextLoc.toString();
        } catch {
          // Invalid Location — keep current response
          break;
        }
      }
    } catch {
      // Network error → fail-closed (disallow-all) with short TTL so the crawler
      // retries after the transient failure window. RFC 9309 §2.3.1.3: crawlers
      // SHOULD treat unreachable robots as "wait and retry", not as freely crawlable.
      rules = { disallow: ["/"], allow: [] };
      robotsCacheSet(cacheKey, { rules, expiresAt: now + ROBOTS_ERROR_TTL_MS });
      if (isRobotsPathDisallowed(rules, url.pathname + url.search)) {
        throw new RobotsDisallowedError(url.toString());
      }
      return;
    }

    if (res.ok) {
      const text = await readRobotsBody(res);
      rules = parseRobotsTxt(text, userAgent);
      robotsCacheSet(cacheKey, { rules, expiresAt: now + ROBOTS_CACHE_TTL_MS });
    } else if (res.status >= 500) {
      // 5xx: server error → RFC 9309 §2.3.1.4 requires disallow-all until retried.
      rules = { disallow: ["/"], allow: [] };
      robotsCacheSet(cacheKey, { rules, expiresAt: now + ROBOTS_ERROR_TTL_MS });
    } else {
      // 3xx (unresolved or cross-host), 4xx including 401/403 (RFC 9309 §2.3.1.3: robots.txt
      // "doesn't exist" → allow-all), e.g. 404 = no robots.txt → fail-open.
      rules = { disallow: [], allow: [] };
      isTransient = true;
      robotsCacheSet(cacheKey, { rules, expiresAt: now + ROBOTS_ERROR_TTL_MS });
    }
    void isTransient; // informational only
  }

  // RFC 9309 §2.2.2: match rules against path + query so that query-bearing
  // disallow rules (e.g. Disallow: /search?q=) are honoured. The query string
  // is already percent-encoded by the URL parser and decodeUnreserved handles
  // it consistently with the path component.
  const path = url.pathname + url.search;
  if (isRobotsPathDisallowed(rules, path)) {
    throw new RobotsDisallowedError(url.toString());
  }
}

// Exported to allow cache invalidation in tests.
export function clearRobotsCache(): void {
  robotsCache.clear();
}

// ---------------------------------------------------------------------------
// Content-type sniff (INV-0028-6)
// ---------------------------------------------------------------------------

export type ContentKind = "xml" | "json" | "html" | "executable" | "unknown";

// Executable magic bytes: ELF, PE, Mach-O (BE/LE fat/thin).
const EXECUTABLE_MAGICS: readonly Uint8Array[] = [
  new Uint8Array([0x7f, 0x45, 0x4c, 0x46]),         // ELF
  new Uint8Array([0x4d, 0x5a]),                       // PE (MZ)
  new Uint8Array([0xca, 0xfe, 0xba, 0xbe]),           // Mach-O fat
  new Uint8Array([0xfe, 0xed, 0xfa, 0xce]),           // Mach-O 32-bit BE
  new Uint8Array([0xce, 0xfa, 0xed, 0xfe]),           // Mach-O 32-bit LE
  new Uint8Array([0xfe, 0xed, 0xfa, 0xcf]),           // Mach-O 64-bit BE
  new Uint8Array([0xcf, 0xfa, 0xed, 0xfe]),           // Mach-O 64-bit LE
];

function startsWith(buf: Uint8Array, magic: Uint8Array): boolean {
  if (buf.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (buf[i] !== magic[i]) return false;
  }
  return true;
}

// Exported for unit testing.
export function sniffMagic(bytes: Uint8Array): ContentKind {
  for (const magic of EXECUTABLE_MAGICS) {
    if (startsWith(bytes, magic)) return "executable";
  }
  const head = new TextDecoder("utf-8", { fatal: false }).decode(
    bytes.slice(0, 512)
  );
  const trimmed = head.trimStart();
  if (trimmed.startsWith("<?xml") || trimmed.startsWith("<rss") || trimmed.startsWith("<feed")) return "xml";
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  if (/^<!doctype\s+html/i.test(trimmed) || trimmed.startsWith("<html")) return "html";
  return "unknown";
}

export class ContentTypeMismatchError extends Error {
  constructor(declared: string, sniffed: ContentKind) {
    super(`Content-type mismatch: declared=${declared} sniffed=${sniffed}`);
    this.name = "ContentTypeMismatchError";
  }
}

// ---------------------------------------------------------------------------
// Dependency injection types (for testing)
// ---------------------------------------------------------------------------

export type DnsLookupFn = (hostname: string) => Promise<Array<{ address: string; family: 4 | 6 }>>;
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

function defaultDnsLookup(hostname: string): Promise<Array<{ address: string; family: 4 | 6 }>> {
  return lookup(hostname, { all: true }) as Promise<Array<{ address: string; family: 4 | 6 }>>;
}

// ---------------------------------------------------------------------------
// SafeFetch options + response
// ---------------------------------------------------------------------------

export interface SafeFetchOptions {
  maxBytes: number;
  timeoutMs?: number;
  allowHttp?: boolean;
  userAgent?: string;
  /** Optional set of allowed hostnames for redirect re-validation. */
  allowedHosts?: Set<string>;
  /** Extra request headers merged into the outbound fetch (e.g. If-None-Match). */
  requestHeaders?: Record<string, string>;
}

export interface SafeFetchResponse {
  status: number;
  headers: Headers;
  body: Uint8Array;
  finalUrl: string;
  contentKind: ContentKind;
}

// Injectable for testing — override default implementations.
export interface SafeFetchDeps {
  dnsLookup?: DnsLookupFn;
  fetcher?: FetchFn;
}

// Build the outbound header set for a single fetch hop.
// - "User-Agent" is always set to the configured `userAgent` and cannot be
//   overridden by `requestHeaders` (robot policy is evaluated against this UA).
// - On cross-host hops, ALL caller-supplied requestHeaders are dropped.
//   A denylist approach (stripping only known sensitive headers) is insufficient
//   because callers may use custom auth headers (e.g. X-API-Key, X-Auth-Token)
//   that would otherwise be forwarded to an attacker-controlled redirect target.
//   Only same-host hops preserve caller headers.
function buildRequestHeaders(
  userAgent: string,
  requestHeaders: Record<string, string> | undefined,
  isCrossHost: boolean
): Record<string, string> {
  const out: Record<string, string> = { "User-Agent": userAgent };
  // Drop all caller headers on cross-host redirects to prevent credential leakage.
  if (isCrossHost || !requestHeaders) return out;
  for (const [k, v] of Object.entries(requestHeaders)) {
    if (k.toLowerCase() === "user-agent") continue; // always use configured UA
    out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Core implementation
// ---------------------------------------------------------------------------

export async function safeFetch(
  rawUrl: string,
  opts: SafeFetchOptions,
  deps: SafeFetchDeps = {}
): Promise<SafeFetchResponse> {
  const dnsLookup = deps.dnsLookup ?? defaultDnsLookup;
  const fetcher = (deps.fetcher ?? globalThis.fetch) as FetchFn;

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
  const allowHttp = opts.allowHttp ?? false;

  // Step 1: URL scheme allowlist
  let currentUrl: URL;
  try {
    currentUrl = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(rawUrl, "invalid URL");
  }

  function assertScheme(u: URL): void {
    if (u.protocol === "https:") return;
    if (u.protocol === "http:" && allowHttp) return;
    throw new SsrfBlockedError(
      u.toString(),
      `blocked scheme: ${u.protocol}`
    );
  }
  assertScheme(currentUrl);

  // Check initial host against allowlist before any network requests.
  // allowedHosts defines a hard egress boundary — the initial URL must be
  // validated here, not just redirect targets (which are checked at line ~622).
  if (opts.allowedHosts && !opts.allowedHosts.has(currentUrl.hostname)) {
    throw new SsrfBlockedError(currentUrl.toString(), `host not in allowedHosts: ${currentUrl.hostname}`);
  }

  // Step 2: DNS pre-resolve + private IP rejection
  await checkSsrf(currentUrl.hostname, dnsLookup, timeoutMs);

  // Step 3: robots.txt
  await checkRobots(currentUrl, userAgent, fetcher, timeoutMs);

  // Steps 4–5: fetch with redirect:manual, handle redirect chain
  let hops = 0;
  let response: Response;
  // Track the origin host so we can strip sensitive headers on cross-host hops.
  const initialHost = currentUrl.host;

  while (true) {
    const isCrossHost = currentUrl.host !== initialHost;
    response = await fetcher(currentUrl.toString(), {
      redirect: "manual",
      headers: buildRequestHeaders(userAgent, opts.requestHeaders, isCrossHost),
      signal: AbortSignal.timeout(timeoutMs),
    });

    // Non-redirect: proceed to body handling.
    // Only 301/302/303/307/308 are redirect statuses requiring a Location header.
    // 300 Multiple Choices, 304 Not Modified, 305, 306, etc. are final responses.
    const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
    if (!REDIRECT_STATUSES.has(response.status)) break;

    hops++;
    if (hops > MAX_REDIRECT_HOPS) {
      throw new RedirectError(`exceeded max redirect hops (${MAX_REDIRECT_HOPS})`);
    }

    const location = response.headers.get("Location");
    if (!location) {
      throw new RedirectError("3xx response missing Location header");
    }

    let nextUrl: URL;
    try {
      nextUrl = new URL(location, currentUrl.toString());
    } catch {
      throw new RedirectError(`invalid Location URL: ${location}`);
    }

    // Scheme downgrade: https → http is blocked
    if (currentUrl.protocol === "https:" && nextUrl.protocol === "http:") {
      throw new RedirectError(
        `scheme downgrade blocked: ${currentUrl.protocol} → ${nextUrl.protocol}`
      );
    }

    assertScheme(nextUrl);

    // Check host allowlist BEFORE making any external calls to the redirect target.
    // When allowedHosts is configured it defines a network boundary — unknown hosts
    // must not receive DNS queries or robots.txt requests.
    if (opts.allowedHosts && !opts.allowedHosts.has(nextUrl.hostname)) {
      throw new RedirectError(
        `redirect to disallowed host: ${nextUrl.hostname}`
      );
    }

    // SSRF re-check on redirect target
    await checkSsrf(nextUrl.hostname, dnsLookup, timeoutMs);

    // robots.txt re-check for redirected URL (may be a different origin)
    await checkRobots(nextUrl, userAgent, fetcher, timeoutMs);

    currentUrl = nextUrl;
  }

  const finalUrl = currentUrl.toString();

  // Step 6: Content-Length preflight (INV-0028-4)
  // 304 Not Modified carries no body; skip the size check to avoid a false
  // BodyTooLargeError from a stale Content-Length header on the cached response.
  const contentLengthHeader = response.headers.get("Content-Length");
  const declaredBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : null;
  if (response.status !== 304 && declaredBytes !== null && !isNaN(declaredBytes) && declaredBytes > opts.maxBytes) {
    throw new BodyTooLargeError(finalUrl, opts.maxBytes);
  }

  // Step 7: Streaming body read + byte cap + zip bomb ratio (INV-0028-4)
  if (!response.body) {
    return { status: response.status, headers: response.headers, body: new Uint8Array(0), finalUrl, contentKind: "unknown" };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  // Zip-bomb ratio check: only possible when both Content-Length and
  // Content-Encoding are declared. Content-Length gives us the compressed size;
  // totalBytes tracks decompressed bytes (the Fetch API decompresses
  // transparently before yielding stream chunks, so we cannot observe raw
  // compressed bytes for chunked-transfer responses).
  // When Content-Encoding is present but no Content-Length (chunked transfer),
  // the streaming byte cap (maxBytes) is the sole protection against
  // decompression bombs — a server sending a tiny compressed payload that
  // expands to a large body will still be terminated at maxBytes decompressed.
  const compressedSize = declaredBytes ?? 0;
  const zipBombCheckEnabled = compressedSize > 0 && response.headers.has("Content-Encoding");

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;

      if (totalBytes > opts.maxBytes) {
        reader.cancel();
        throw new BodyTooLargeError(finalUrl, opts.maxBytes);
      }

      // Zip bomb: decompressed / compressed > 100:1
      if (zipBombCheckEnabled && totalBytes / compressedSize > ZIP_BOMB_RATIO) {
        reader.cancel();
        throw new BodyTooLargeError(finalUrl, opts.maxBytes);
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  // Step 8: Content-type sniff (INV-0028-6)
  const sniff512 = body.slice(0, 512);
  const contentKind = sniffMagic(sniff512);
  if (contentKind === "executable") {
    throw new SsrfBlockedError(finalUrl, "response body is an executable binary");
  }

  return { status: response.status, headers: response.headers, body, finalUrl, contentKind };
}
