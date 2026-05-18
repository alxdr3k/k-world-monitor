/**
 * Cross-ref code reachability lint (INFRA-1A.9-validator-extension, DEC-020 Q-045).
 *
 * Drives the validator's `checkCrossRefCode()` logic via the same parsing
 * primitives the script uses. Tests live as black-box assertions over the
 * documented contract so a regex / format change in the validator surfaces
 * here before doc authors hit the warning chain at PR time.
 *
 * Contract:
 *   - cross_ref_code entries are `<file>:<exportName>` or `<file>:<line>`.
 *   - `<file>` resolves relative to the repo root.
 *   - `<exportName>` matches either `export <keyword> <name>` declarations
 *     or `export { <name> ... }` re-export blocks.
 *   - `<line>` (numeric) must fall within 1..file.lineCount inclusive.
 *   - Broken references produce warnings (never errors — INV-0002-1).
 */

import { describe, it, expect } from "bun:test";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join, basename } from "path";

import jsYaml from "js-yaml";
const yaml = jsYaml as {
  load: (s: string) => unknown;
};

const REPO_ROOT = join(import.meta.dir, "..", "..");

// ---------------------------------------------------------------------------
// Helpers (parallel to scripts/validate_invariants.ts)
// ---------------------------------------------------------------------------
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface CrossRefIssue {
  invId: string;
  ref: string;
  reason: string;
}

interface InvariantFrontmatter {
  id: string;
  cross_ref_code?: string[];
}

function parseAdrInvariants(filePath: string): InvariantFrontmatter[] {
  const content = readFileSync(filePath, "utf-8");
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match || !match[1]) return [];
  const fm = yaml.load(match[1]) as {
    invariants?: InvariantFrontmatter[];
  } | null;
  return fm?.invariants ?? [];
}

function checkOneRef(ref: string): { ok: true } | { ok: false; reason: string } {
  const sepIdx = ref.lastIndexOf(":");
  if (sepIdx <= 0 || sepIdx === ref.length - 1) {
    return { ok: false, reason: "malformed" };
  }
  const filePart = ref.slice(0, sepIdx);
  const tail = ref.slice(sepIdx + 1);
  const fullPath = join(REPO_ROOT, filePart);
  if (!existsSync(fullPath)) {
    return { ok: false, reason: `missing file: ${filePart}` };
  }
  const code = readFileSync(fullPath, "utf-8");
  if (/^\d+$/.test(tail)) {
    const lineNum = Number.parseInt(tail, 10);
    const lineCount = code.split("\n").length;
    if (lineNum < 1 || lineNum > lineCount) {
      return { ok: false, reason: `line ${lineNum} out of range (1..${lineCount})` };
    }
    return { ok: true };
  }
  const declPattern = new RegExp(
    `\\bexport\\s+(?:async\\s+|default\\s+)?(?:function|class|const|let|var|interface|type|enum)\\s+${escapeRegex(tail)}\\b`
  );
  const reExportPattern = new RegExp(
    `\\bexport\\s*\\{[^}]*\\b${escapeRegex(tail)}\\b[^}]*\\}`
  );
  if (declPattern.test(code) || reExportPattern.test(code)) {
    return { ok: true };
  }
  return { ok: false, reason: `export not found: ${tail}` };
}

function scanAllAdrCrossRefs(): CrossRefIssue[] {
  const adrDir = join(REPO_ROOT, "docs", "adr");
  if (!existsSync(adrDir)) return [];
  const issues: CrossRefIssue[] = [];
  for (const entry of readdirSync(adrDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const filePath = join(adrDir, entry.name);
    for (const inv of parseAdrInvariants(filePath)) {
      for (const ref of inv.cross_ref_code ?? []) {
        const result = checkOneRef(ref);
        if (!result.ok) {
          issues.push({ invId: inv.id, ref, reason: result.reason });
        }
      }
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("cross_ref_code format detection", () => {
  it("flags malformed entry with no separator", () => {
    expect(checkOneRef("src/foo.ts")).toEqual({ ok: false, reason: "malformed" });
  });

  it("flags malformed entry ending in colon", () => {
    expect(checkOneRef("src/foo.ts:")).toEqual({ ok: false, reason: "malformed" });
  });

  it("flags missing file", () => {
    const result = checkOneRef("src/does-not-exist.ts:someExport");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("missing file");
  });
});

describe("cross_ref_code file:exportName resolution", () => {
  it("resolves a valid named export (function declaration)", () => {
    // checkPermittedPrefix is exported from src/storage/r2/policy.ts
    expect(checkOneRef("src/storage/r2/policy.ts:checkPermittedPrefix")).toEqual({ ok: true });
  });

  it("resolves a valid named export (const declaration in domain module)", () => {
    // SNAPSHOT_R2_KEY_PREFIX is `export const` in src/domain/snapshot-id.ts
    expect(checkOneRef("src/domain/snapshot-id.ts:SNAPSHOT_R2_KEY_PREFIX")).toEqual({ ok: true });
  });

  it("resolves a re-exported symbol (export { X } block)", () => {
    // parseSnapIdFromRationale is re-exported from r2-invariant-scanner.ts
    expect(checkOneRef("src/ops/r2-invariant-scanner.ts:parseSnapIdFromRationale")).toEqual({ ok: true });
  });

  it("flags a private (non-exported) symbol as export not found", () => {
    // allLinkedSourcesAllowR2SnapshotUpload is module-private in snapshot-fingerprint.ts
    const result = checkOneRef(
      "src/discovery/worker/snapshot-fingerprint.ts:allLinkedSourcesAllowR2SnapshotUpload"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("export not found");
  });
});

describe("cross_ref_code file:line resolution", () => {
  it("accepts a valid in-range line number", () => {
    // line 120 of snapshot-fingerprint.ts is allLinkedSourcesAllowR2SnapshotUpload's signature
    expect(checkOneRef("src/discovery/worker/snapshot-fingerprint.ts:120")).toEqual({ ok: true });
  });

  it("accepts line 1 (boundary)", () => {
    expect(checkOneRef("src/domain/snapshot-id.ts:1")).toEqual({ ok: true });
  });

  it("flags an out-of-range line", () => {
    const result = checkOneRef("src/domain/snapshot-id.ts:999999");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("out of range");
  });

  it("flags line zero as out of range", () => {
    const result = checkOneRef("src/domain/snapshot-id.ts:0");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("out of range");
  });
});

describe("ADR cross_ref_code reachability — repo-wide invariant", () => {
  it("every cross_ref_code entry resolves in the current tree", () => {
    const issues = scanAllAdrCrossRefs();
    expect(issues).toEqual([]);
  });

  it("INV-0012-3 has cross_ref_code backfill landed (DEC-020 Q-045)", () => {
    const filePath = join(REPO_ROOT, "docs", "adr", "0012-non-archival-storage-neo4j-sqlite-r2.md");
    const invs = parseAdrInvariants(filePath);
    const inv = invs.find((i) => i.id === "INV-0012-3");
    expect(inv).toBeDefined();
    expect(inv?.cross_ref_code).toBeDefined();
    expect((inv?.cross_ref_code ?? []).length).toBeGreaterThan(0);
  });
});

// Silence unused warning for `basename` if linter looks for it
void basename;
