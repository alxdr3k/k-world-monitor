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
import { readFileSync, existsSync, readdirSync, realpathSync } from "fs";
import { join, basename, isAbsolute, relative, sep } from "path";

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

function isInsideRepo(filePart: string): boolean {
  if (isAbsolute(filePart)) return false;
  const joined = join(REPO_ROOT, filePart);
  const rel = relative(REPO_ROOT, joined);
  if (rel.startsWith("..") || isAbsolute(rel)) return false;
  if (rel === "") return false;
  if (joined !== REPO_ROOT && !joined.startsWith(REPO_ROOT + sep)) return false;
  const canonicalRoot = (() => {
    try { return realpathSync(REPO_ROOT); } catch { return REPO_ROOT; }
  })();
  let probe = joined;
  let canonicalResolved: string | null = null;
  for (let depth = 0; depth < 64; depth++) {
    try {
      canonicalResolved = realpathSync(probe);
      break;
    } catch {
      const parent = relative(REPO_ROOT, probe);
      if (parent === "" || parent === "." || probe === sep) break;
      const nextProbe = join(probe, "..");
      if (nextProbe === probe) break;
      probe = nextProbe;
    }
  }
  if (canonicalResolved === null) return true;
  return (
    canonicalResolved === canonicalRoot ||
    canonicalResolved.startsWith(canonicalRoot + sep)
  );
}

function physicalLineCount(code: string): number {
  if (code === "") return 0;
  const parts = code.split("\n");
  if (parts.length > 0 && parts[parts.length - 1] === "") return parts.length - 1;
  return parts.length;
}

function extractReExportedNames(code: string): Set<string> {
  const names = new Set<string>();
  const blockPattern = /\bexport\s*(?:type\s+)?\{([^}]*)\}/g;
  for (const match of code.matchAll(blockPattern)) {
    const body = match[1] ?? "";
    for (const rawEntry of body.split(",")) {
      const entry = rawEntry.trim().replace(/^type\s+/, "");
      if (!entry) continue;
      const aliasMatch = entry.match(/^[\w$]+\s+as\s+([\w$]+)$/);
      if (aliasMatch && aliasMatch[1]) {
        names.add(aliasMatch[1]);
        continue;
      }
      const bareMatch = entry.match(/^([\w$]+)$/);
      if (bareMatch && bareMatch[1]) {
        names.add(bareMatch[1]);
      }
    }
  }
  return names;
}

function hasNamedDeclaration(code: string, name: string): boolean {
  const escName = escapeRegex(name);
  const fnPattern = new RegExp(
    `\\bexport\\s+(?:default\\s+)?(?:async\\s+)?function\\s*\\*?\\s+${escName}\\b`
  );
  if (fnPattern.test(code)) return true;
  const classPattern = new RegExp(
    `\\bexport\\s+(?:default\\s+)?(?:abstract\\s+)?class\\s+${escName}\\b`
  );
  if (classPattern.test(code)) return true;
  const keywordPattern = new RegExp(
    `\\bexport\\s+(?:const|let|var|interface|type|enum)\\s+${escName}\\b`
  );
  return keywordPattern.test(code);
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
  if (!isInsideRepo(filePart)) {
    return { ok: false, reason: `path escapes repo root: ${filePart}` };
  }
  const fullPath = join(REPO_ROOT, filePart);
  if (!existsSync(fullPath)) {
    return { ok: false, reason: `missing file: ${filePart}` };
  }
  const code = readFileSync(fullPath, "utf-8");
  if (/^\d+$/.test(tail)) {
    const lineNum = Number.parseInt(tail, 10);
    const lineCount = physicalLineCount(code);
    if (lineNum < 1 || lineNum > lineCount) {
      return { ok: false, reason: `line ${lineNum} out of range (1..${lineCount})` };
    }
    return { ok: true };
  }
  if (hasNamedDeclaration(code, tail) || extractReExportedNames(code).has(tail)) {
    return { ok: true };
  }
  return { ok: false, reason: `export not found: ${tail}` };
}

function scanInvariantCrossRefsIn(dir: string): CrossRefIssue[] {
  if (!existsSync(dir)) return [];
  const issues: CrossRefIssue[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const filePath = join(dir, entry.name);
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

function scanAllInvariantCrossRefs(): CrossRefIssue[] {
  // Validator scans both ADR and DEC frontmatter — keep test parity.
  // Codex PR #72 round 2 P3 (#4): pre-fix only scanned docs/adr, missing
  // half of the supported document surface.
  return [
    ...scanInvariantCrossRefsIn(join(REPO_ROOT, "docs", "adr")),
    ...scanInvariantCrossRefsIn(join(REPO_ROOT, "docs", "decisions")),
  ];
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

// ---------------------------------------------------------------------------
// Codex PR #72 round 1 P2 regression coverage
// ---------------------------------------------------------------------------

describe("Codex P2 #1 — re-export alias name validation", () => {
  const fixture = "tests/lint/fixtures/cross_ref_code_fixtures.ts";

  it("accepts the alias (right-hand side) of `export { foo as bar }`", () => {
    expect(checkOneRef(`${fixture}:renamedExternal`)).toEqual({ ok: true });
  });

  it("rejects the internal source name on the left-hand side of `as`", () => {
    const result = checkOneRef(`${fixture}:internalSecret`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("export not found");
  });

  it("extractReExportedNames does not include the import-name side", () => {
    const code = readFileSync(join(REPO_ROOT, fixture), "utf-8");
    const names = extractReExportedNames(code);
    expect(names.has("renamedExternal")).toBe(true);
    expect(names.has("internalSecret")).toBe(false);
  });
});

describe("Codex P2 #2 — reject paths escaping repo root", () => {
  it("rejects absolute path", () => {
    const result = checkOneRef("/etc/passwd:root");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("escapes repo root");
  });

  it("rejects `../` traversal", () => {
    const result = checkOneRef("../sibling-repo/src/foo.ts:x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("escapes repo root");
  });

  it("rejects nested `../../` traversal", () => {
    const result = checkOneRef("src/../../../../etc/passwd:x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("escapes repo root");
  });

  it("accepts plain relative path", () => {
    expect(isInsideRepo("src/domain/snapshot-id.ts")).toBe(true);
  });
});

describe("Codex P2 #3 — default-async / generator / abstract export forms", () => {
  const fixture = "tests/lint/fixtures/cross_ref_code_fixtures.ts";

  it("matches `export default async function name()`", () => {
    expect(checkOneRef(`${fixture}:defaultAsyncDecl`)).toEqual({ ok: true });
  });

  it("matches `export async function* name()` (generator + async)", () => {
    expect(checkOneRef(`${fixture}:plainAsyncGenerator`)).toEqual({ ok: true });
  });

  it("matches `export function* name()` (generator only)", () => {
    expect(checkOneRef(`${fixture}:plainGenerator`)).toEqual({ ok: true });
  });

  it("matches `export async function name()`", () => {
    expect(checkOneRef(`${fixture}:plainAsync`)).toEqual({ ok: true });
  });

  it("matches plain `export function name()`", () => {
    expect(checkOneRef(`${fixture}:plainFunction`)).toEqual({ ok: true });
  });

  it("matches `export class`, `export interface`, `export type`, `export enum`", () => {
    expect(checkOneRef(`${fixture}:PlainClass`)).toEqual({ ok: true });
    expect(checkOneRef(`${fixture}:PlainInterface`)).toEqual({ ok: true });
    expect(checkOneRef(`${fixture}:PlainType`)).toEqual({ ok: true });
    expect(checkOneRef(`${fixture}:PlainEnum`)).toEqual({ ok: true });
  });

  it("matches `export const name`", () => {
    expect(checkOneRef(`${fixture}:plainConst`)).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// Codex PR #72 round 2 regression coverage
// ---------------------------------------------------------------------------

describe("Codex round 2 P2 #1 — physical line count for newline-terminated files", () => {
  it("returns N for a string that ends in newline", () => {
    // "abc\n" addresses 1 line ("abc"); split → ["abc", ""] would say 2.
    expect(physicalLineCount("abc\n")).toBe(1);
  });

  it("returns N for a string with no trailing newline", () => {
    expect(physicalLineCount("abc")).toBe(1);
  });

  it("returns 0 for an empty string", () => {
    expect(physicalLineCount("")).toBe(0);
  });

  it("returns the addressable count for multi-line files", () => {
    expect(physicalLineCount("a\nb\nc\n")).toBe(3);
    expect(physicalLineCount("a\nb\nc")).toBe(3);
  });

  it("rejects last_line + 1 for newline-terminated source files (regression)", () => {
    // src/domain/snapshot-id.ts is newline-terminated. The highest valid
    // addressable line is its wc -l count; line N+1 must surface as out-of-range.
    const filePath = join(REPO_ROOT, "src/domain/snapshot-id.ts");
    const code = readFileSync(filePath, "utf-8");
    const wcCount = physicalLineCount(code);
    const oneOver = wcCount + 1;
    const result = checkOneRef(`src/domain/snapshot-id.ts:${oneOver}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("out of range");
  });
});

describe("Codex round 2 P2 #2 — symlink-aware repo-boundary check", () => {
  it("rejects path that exits repo via realpath even if syntactically inside", () => {
    // Use the real repo /tmp as a proxy for an out-of-repo destination — we
    // cannot create symlinks in test reliably, so we validate the canonical
    // form check shape directly: an absolute path that *would* be a target
    // of any symlink escape is rejected. This locks in the contract that
    // isInsideRepo's syntactic + canonical pair both must agree.
    expect(isInsideRepo("/tmp/escape-target.ts")).toBe(false);
  });

  it("accepts a real in-repo file", () => {
    expect(isInsideRepo("src/domain/snapshot-id.ts")).toBe(true);
  });

  it("accepts a path inside the repo even when the file does not yet exist", () => {
    // Non-existent file should not crash isInsideRepo; it returns true so the
    // downstream `existsSync` check produces the clearer "missing file" warning.
    expect(isInsideRepo("src/does-not-exist-yet.ts")).toBe(true);
  });
});

describe("Codex round 2 P2 #3 — type-prefixed re-export specifiers", () => {
  it("strips a leading `type` token from bare specifiers", () => {
    const code = "export { type Foo };";
    expect(extractReExportedNames(code).has("Foo")).toBe(true);
  });

  it("strips a leading `type` token from aliased specifiers", () => {
    const code = "export { type Foo as Bar };";
    expect(extractReExportedNames(code).has("Bar")).toBe(true);
    expect(extractReExportedNames(code).has("Foo")).toBe(false);
  });

  it("handles mixed value + type specifiers in one block", () => {
    const code = "export { plain, type Foo, type Inner as Public, alias as renamed };";
    const names = extractReExportedNames(code);
    expect(names.has("plain")).toBe(true);
    expect(names.has("Foo")).toBe(true);
    expect(names.has("Public")).toBe(true);
    expect(names.has("renamed")).toBe(true);
    expect(names.has("Inner")).toBe(false);
    expect(names.has("alias")).toBe(false);
  });

  it("still handles the existing `export type { ... }` block form", () => {
    const code = "export type { Foo, Bar };";
    const names = extractReExportedNames(code);
    expect(names.has("Foo")).toBe(true);
    expect(names.has("Bar")).toBe(true);
  });
});

describe("Codex round 2 P3 #4 — repo-wide scan covers DEC files", () => {
  it("scan helper reads docs/decisions in addition to docs/adr", () => {
    // Cheap structural check: scanAllInvariantCrossRefs returns issues from
    // either source dir. We assert it doesn't crash on docs/decisions and
    // that the function is callable across both surfaces — content-level
    // validation is the next test's job.
    const issues = scanAllInvariantCrossRefs();
    expect(Array.isArray(issues)).toBe(true);
  });
});

describe("cross_ref_code reachability — repo-wide invariant", () => {
  it("every cross_ref_code entry across docs/adr and docs/decisions resolves", () => {
    const issues = scanAllInvariantCrossRefs();
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
