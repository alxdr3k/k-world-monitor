/**
 * Unit tests for INFRA-1A.3 R2 policy enforcement (AC-003, AC-020, AC-032).
 * No network required — pure policy logic + crypto.subtle sha256.
 *
 * AC-003: R2 permitted-artifact prefix policy enforced at write time.
 * AC-020: raw_cloud_policy=always_prohibited — raw text keys rejected.
 * AC-032: sha256 round-trip integrity verified without network.
 */

import { describe, it, expect } from "bun:test";
import {
  PERMITTED_PREFIXES,
  checkPermittedPrefix,
  matchedPrefix,
  assertSha256,
  sha256HexBuf,
  PermittedPrefixViolation,
} from "../../src/storage/r2/policy";

// ---------------------------------------------------------------------------
// PERMITTED_PREFIXES registry (AC-003)
// ---------------------------------------------------------------------------
describe("PERMITTED_PREFIXES", () => {
  it("has 9 permitted prefixes matching DEC-007 runbook", () => {
    expect(PERMITTED_PREFIXES).toHaveLength(9);
  });

  it("includes all DEC-007 prefixes", () => {
    const expected = [
      "backups/neo4j/",
      "backups/sqlite/",
      "audit/jsonl/",
      "tmp/multipart/",
      "permitted_artifact/dataset/",
      "permitted_artifact/derived/snapshot/",
      "permitted_artifact/derived/dossier/",
      "permitted_artifact/derived/publication/",
      "permitted_artifact/evidence-pack/",
    ];
    for (const p of expected) {
      expect(PERMITTED_PREFIXES).toContain(p as never);
    }
  });

  it("all prefixes end with /", () => {
    for (const p of PERMITTED_PREFIXES) {
      expect(p.endsWith("/")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// checkPermittedPrefix — permitted keys (AC-003)
// ---------------------------------------------------------------------------
describe("checkPermittedPrefix — accepts permitted keys", () => {
  const validKeys = [
    "backups/neo4j/2026-05-12.dump",
    "backups/sqlite/2026-05-12.db",
    "audit/jsonl/2026-05.jsonl.gz",
    "tmp/multipart/upload-abc123",
    "permitted_artifact/dataset/fred/series.parquet",
    "permitted_artifact/derived/snapshot/snap_01HZ.bin",
    "permitted_artifact/derived/dossier/dos_01HZ/chart.svg",
    "permitted_artifact/derived/publication/pub_01HZ/index.html",
    "permitted_artifact/evidence-pack/ep_01HZ.zip",
  ];

  for (const key of validKeys) {
    it(`accepts "${key}"`, () => {
      expect(() => checkPermittedPrefix(key)).not.toThrow();
    });
  }
});

// ---------------------------------------------------------------------------
// checkPermittedPrefix — raw text / unpermitted keys (AC-020)
// ADR-0012 INV-0012-4: raw_cloud_policy = always_prohibited
// ---------------------------------------------------------------------------
describe("checkPermittedPrefix — rejects raw/unpermitted keys (AC-020)", () => {
  const rejectedKeys = [
    "raw/article.txt",
    "articles/nytimes/2026-05-12.html",
    "snapshots/full_text.txt",
    "cache/scraped_content.json",
    "documents/report.pdf",
    "source_data/imf_weo.xlsx",
    "",
    "/",
    "permitted_artifact",               // missing trailing content
    "permitted_artifact/",              // not a specific sub-prefix
    "backups/",                         // not specific enough
  ];

  for (const key of rejectedKeys) {
    it(`rejects "${key}"`, () => {
      expect(() => checkPermittedPrefix(key)).toThrow(PermittedPrefixViolation);
    });
  }

  it("error message names the key and references ADR-0012", () => {
    try {
      checkPermittedPrefix("raw/bad.txt");
    } catch (e) {
      expect(e).toBeInstanceOf(PermittedPrefixViolation);
      expect((e as Error).message).toContain("raw/bad.txt");
      expect((e as Error).message).toContain("ADR-0012");
    }
  });
});

// ---------------------------------------------------------------------------
// matchedPrefix
// ---------------------------------------------------------------------------
describe("matchedPrefix", () => {
  it("returns matched prefix for valid key", () => {
    expect(matchedPrefix("backups/neo4j/2026-05-12.dump")).toBe("backups/neo4j/");
    expect(matchedPrefix("permitted_artifact/dataset/fred/data.parquet")).toBe(
      "permitted_artifact/dataset/"
    );
  });

  it("returns null for unpermitted key", () => {
    expect(matchedPrefix("raw/article.txt")).toBeNull();
    expect(matchedPrefix("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sha256Hex + assertSha256 — round-trip integrity (AC-032)
// ---------------------------------------------------------------------------
describe("sha256 round-trip integrity (AC-032)", () => {
  it("sha256Hex produces consistent hex for fixed input", async () => {
    const input = new TextEncoder().encode("open-license-dataset-content").buffer as ArrayBuffer;
    const hex1 = await sha256HexBuf(input);
    const hex2 = await sha256HexBuf(input);
    expect(hex1).toBe(hex2);
    expect(hex1).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(hex1)).toBe(true);
  });

  it("sha256Hex produces different hashes for different inputs", async () => {
    const a = new TextEncoder().encode("dataset-a").buffer as ArrayBuffer;
    const b = new TextEncoder().encode("dataset-b").buffer as ArrayBuffer;
    expect(await sha256HexBuf(a)).not.toBe(await sha256HexBuf(b));
  });

  it("assertSha256 passes when hash matches", async () => {
    const buf = new TextEncoder().encode("permitted artifact payload").buffer as ArrayBuffer;
    const expectedHex = await sha256HexBuf(buf);
    await expect(assertSha256(buf, expectedHex)).resolves.toBeUndefined();
  });

  it("assertSha256 accepts uppercase hex (normalizes to lowercase)", async () => {
    const buf = new TextEncoder().encode("test").buffer as ArrayBuffer;
    const lowerHex = await sha256HexBuf(buf);
    await expect(assertSha256(buf, lowerHex.toUpperCase())).resolves.toBeUndefined();
  });

  it("assertSha256 throws on hash mismatch (tampered content)", async () => {
    const original = new TextEncoder().encode("original").buffer as ArrayBuffer;
    const tampered = new TextEncoder().encode("tampered").buffer as ArrayBuffer;
    const originalHash = await sha256HexBuf(original);
    await expect(assertSha256(tampered, originalHash)).rejects.toThrow("SHA-256 mismatch");
  });

  it("known sha256 vector: empty string", async () => {
    const empty = new ArrayBuffer(0);
    const hex = await sha256HexBuf(empty);
    // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(hex).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});
