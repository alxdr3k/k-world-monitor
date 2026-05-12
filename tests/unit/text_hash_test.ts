/**
 * Unit tests for text normalization, SHA-256 hashing, and enum validators.
 * Supports AC-007 (quote ≤ 200 chars + quote_hash required).
 */

import { describe, it, expect } from "bun:test";
import { normalizeText, truncateCodePoints, isWithinLimit } from "../../src/utils/text";
import { sha256Hex, sha256Prefix } from "../../src/utils/hash";
import {
  isRunStatus,
  isRunStage,
  isLlmVendor,
  isReviewType,
  isReviewOutcome,
  isArchivePolicy,
  isQuoteReason,
  isSourceAccessedVia,
  RUN_STATUS,
  RUN_STAGE,
  LLM_VENDOR,
  QUOTE_REASON,
} from "../../src/utils/enums";

// ---------------------------------------------------------------------------
// normalizeText
// ---------------------------------------------------------------------------
describe("normalizeText", () => {
  it("trims leading and trailing whitespace", () => {
    expect(normalizeText("  hello world  ")).toBe("hello world");
  });

  it("collapses internal whitespace to single space", () => {
    expect(normalizeText("foo   bar\t\nbaz")).toBe("foo bar baz");
  });

  it("applies Unicode NFC normalization", () => {
    // 'é' can be represented as precomposed (U+00E9) or decomposed (e + U+0301)
    const decomposed = "é"; // NFD form
    const precomposed = "é";  // NFC form
    expect(normalizeText(decomposed)).toBe(precomposed);
  });

  it("returns empty string for whitespace-only input", () => {
    expect(normalizeText("   \t\n  ")).toBe("");
  });

  it("preserves non-ASCII characters after normalization", () => {
    expect(normalizeText("  한국어 텍스트  ")).toBe("한국어 텍스트");
  });
});

// ---------------------------------------------------------------------------
// truncateCodePoints + isWithinLimit
// ---------------------------------------------------------------------------
describe("truncateCodePoints", () => {
  it("returns string unchanged if within limit", () => {
    expect(truncateCodePoints("hello", 10)).toBe("hello");
  });

  it("truncates to maxLen code points", () => {
    const s = "a".repeat(210);
    expect(truncateCodePoints(s, 200).length).toBe(200);
  });

  it("handles multibyte characters correctly (code points, not bytes)", () => {
    // Each emoji is 2 UTF-16 code units but 1 code point
    const emoji = "😀".repeat(205); // 205 code points
    const result = truncateCodePoints(emoji, 200);
    expect([...result].length).toBe(200);
  });
});

describe("isWithinLimit", () => {
  it("returns true when string is at the limit", () => {
    expect(isWithinLimit("a".repeat(200), 200)).toBe(true);
  });

  it("returns false when string exceeds the limit", () => {
    expect(isWithinLimit("a".repeat(201), 200)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sha256Hex
// ---------------------------------------------------------------------------
describe("sha256Hex", () => {
  it("returns 64-character lowercase hex string", () => {
    const hash = sha256Hex("test");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("is deterministic for the same input", () => {
    expect(sha256Hex("hello")).toBe(sha256Hex("hello"));
  });

  it("produces different hashes for different inputs", () => {
    expect(sha256Hex("hello")).not.toBe(sha256Hex("world"));
  });

  it("known SHA-256 value for empty string", () => {
    // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("is sensitive to Unicode form (normalize before hashing)", () => {
    const decomposed = "é";
    const precomposed = "é";
    // Different Unicode representations hash differently without normalization
    expect(sha256Hex(decomposed)).not.toBe(sha256Hex(precomposed));
    // But after normalization they match
    expect(sha256Hex(normalizeText(decomposed))).toBe(sha256Hex(normalizeText(precomposed)));
  });
});

// ---------------------------------------------------------------------------
// sha256Prefix
// ---------------------------------------------------------------------------
describe("sha256Prefix", () => {
  it("returns the first N hex characters (ADR-0025 eit_ id pattern)", () => {
    const hash = sha256Hex("some input");
    expect(sha256Prefix("some input", 10)).toBe(hash.slice(0, 10));
  });

  it("10-char prefix is sufficient for eit_ id format", () => {
    const prefix = sha256Prefix("editorial-intent-content", 10);
    expect(prefix).toHaveLength(10);
    expect(prefix).toMatch(/^[0-9a-f]+$/);
  });
});

// ---------------------------------------------------------------------------
// Enum validators — run_ledger
// ---------------------------------------------------------------------------
describe("isRunStatus", () => {
  it.each(RUN_STATUS as unknown as string[])("accepts '%s'", (v) => {
    expect(isRunStatus(v)).toBe(true);
  });

  it("rejects unknown status", () => {
    expect(isRunStatus("pending")).toBe(false);
    expect(isRunStatus(null)).toBe(false);
    expect(isRunStatus(42)).toBe(false);
  });
});

describe("isRunStage", () => {
  it.each(RUN_STAGE as unknown as string[])("accepts '%s'", (v) => {
    expect(isRunStage(v)).toBe(true);
  });

  it("rejects unknown stage", () => {
    expect(isRunStage("ingest")).toBe(false);
    expect(isRunStage("")).toBe(false);
  });
});

describe("isLlmVendor", () => {
  it.each(LLM_VENDOR as unknown as string[])("accepts '%s'", (v) => {
    expect(isLlmVendor(v)).toBe(true);
  });

  it("rejects unknown vendor", () => {
    expect(isLlmVendor("meta")).toBe(false);
    expect(isLlmVendor("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Enum validators — cross_vendor_review_ledger
// ---------------------------------------------------------------------------
describe("isReviewType", () => {
  it("accepts all 3 valid review types", () => {
    expect(isReviewType("preflight_cite_overclaim")).toBe(true);
    expect(isReviewType("scenario_adversarial")).toBe(true);
    expect(isReviewType("high_stakes_thesis")).toBe(true);
  });

  it("rejects invalid review type", () => {
    expect(isReviewType("generic_review")).toBe(false);
  });
});

describe("isReviewOutcome", () => {
  it("accepts pass/fail/conditional", () => {
    expect(isReviewOutcome("pass")).toBe(true);
    expect(isReviewOutcome("fail")).toBe(true);
    expect(isReviewOutcome("conditional")).toBe(true);
  });

  it("rejects unknown outcome", () => {
    expect(isReviewOutcome("unknown")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Enum validators — ManualClaimEntry (ADR-0018)
// ---------------------------------------------------------------------------
describe("isQuoteReason", () => {
  it.each(QUOTE_REASON as unknown as string[])("accepts '%s'", (v) => {
    expect(isQuoteReason(v)).toBe(true);
  });

  it("rejects invalid quote_reason", () => {
    expect(isQuoteReason("interesting")).toBe(false);
    expect(isQuoteReason("")).toBe(false);
  });
});

describe("isArchivePolicy", () => {
  it("accepts all 4 archive policies", () => {
    expect(isArchivePolicy("metadata_only")).toBe(true);
    expect(isArchivePolicy("excerpt_only")).toBe(true);
    expect(isArchivePolicy("full_snapshot_allowed")).toBe(true);
    expect(isArchivePolicy("do_not_collect")).toBe(true);
  });

  it("rejects unknown policy", () => {
    expect(isArchivePolicy("cache_only")).toBe(false);
  });
});

describe("isSourceAccessedVia", () => {
  it("accepts all 5 access methods", () => {
    expect(isSourceAccessedVia("manual_browser")).toBe(true);
    expect(isSourceAccessedVia("manual_app")).toBe(true);
    expect(isSourceAccessedVia("manual_pdf_read")).toBe(true);
    expect(isSourceAccessedVia("manual_print")).toBe(true);
    expect(isSourceAccessedVia("manual_offline")).toBe(true);
  });

  it("rejects unknown access method", () => {
    expect(isSourceAccessedVia("automatic")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Round-trip: normalize → hash → consistent quote_hash
// ---------------------------------------------------------------------------
describe("quote hash round-trip (AC-007 pattern)", () => {
  it("same quote text always produces the same hash after normalization", () => {
    const quoteA = "  The GDP grew by 3.2%  ";
    const quoteB = "The  GDP  grew by 3.2%";
    // Both normalize to "The GDP grew by 3.2%"
    expect(sha256Hex(normalizeText(quoteA))).toBe(sha256Hex(normalizeText(quoteB)));
  });

  it("quote hash is 64-char hex — suitable for quote_hash field in evidence_json", () => {
    const hash = sha256Hex(normalizeText("sample quote text"));
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("enforces 200 code-point limit before hashing", () => {
    const longQuote = "x".repeat(250);
    expect(isWithinLimit(longQuote, 200)).toBe(false);
    const capped = truncateCodePoints(longQuote, 200);
    expect(isWithinLimit(capped, 200)).toBe(true);
    // Hashing the capped version is deterministic
    const h1 = sha256Hex(normalizeText(capped));
    const h2 = sha256Hex(normalizeText(capped));
    expect(h1).toBe(h2);
  });
});
