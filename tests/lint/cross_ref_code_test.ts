/**
 * Cross-ref code reachability lint (INFRA-1A.9-validator-extension, DEC-020 Q-045).
 *
 * Drives the validator's `checkOneCrossRef()` / helper exports directly so
 * production logic + tests cannot accidentally share the same bug. The
 * previous incarnation of this file mirrored the validator's parsing logic
 * locally — Codex PR #72 round 3 P2 flagged that parallel-implementation
 * smell and Cycle 14 hardening replaces those mirrors with named imports
 * from `scripts/validate_invariants`.
 *
 * Contract (locked by these tests):
 *   - `<file>:<exportName>` or `<file>:<line>` with everything else malformed.
 *   - `<file>` is repo-root-relative; absolute paths, `..` traversal, and
 *     symlink escapes via canonicalization are rejected.
 *   - `<exportName>` matches `export <kw> <name>` declarations (including
 *     `default async function* name`, `abstract class name`, type-only),
 *     re-export blocks `export { name }` and `export { foo as name }`
 *     (alias right-hand side only), and type-prefixed re-exports
 *     `export { type Name }` / `export { type Foo as Name }`.
 *   - Matches MUST ignore comments and string literals so doc snippets do
 *     not produce false-reachable warnings.
 *   - `<line>` (numeric) must fall within 1..physicalLineCount(file).
 *     Newline-terminated files count addressable lines, not split tokens.
 *   - Broken references emit warnings (never errors — INV-0002-1).
 */

import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join, basename } from "path";

import jsYaml from "js-yaml";
const yaml = jsYaml as {
  load: (s: string) => unknown;
};

import {
  adrFiles,
  decisionFiles,
  checkOneCrossRef,
  extractReExportedNames,
  hasNamedDeclaration,
  isInsideRepo,
  physicalLineCount,
  stripCommentsAndStrings,
} from "../../scripts/validate_invariants";

const REPO_ROOT = join(import.meta.dir, "..", "..");

// ---------------------------------------------------------------------------
// Helpers (test-only — frontmatter parser + repo-wide scan)
// ---------------------------------------------------------------------------
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

interface CrossRefIssue {
  source: string;
  invId: string;
  ref: string;
  reason: string;
}

interface ScanResult {
  issues: CrossRefIssue[];
  inspectedFileCount: number;
}

function scanCrossRefsAcross(files: string[]): ScanResult {
  const issues: CrossRefIssue[] = [];
  let inspectedFileCount = 0;
  for (const filePath of files) {
    inspectedFileCount += 1;
    for (const inv of parseAdrInvariants(filePath)) {
      for (const ref of inv.cross_ref_code ?? []) {
        const result = checkOneCrossRef(ref);
        if (!result.ok) {
          issues.push({
            source: basename(filePath),
            invId: inv.id,
            ref: typeof ref === "string" ? ref : JSON.stringify(ref),
            reason: result.reason,
          });
        }
      }
    }
  }
  return { issues, inspectedFileCount };
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------
describe("checkOneCrossRef — format detection", () => {
  it("flags malformed entry with no separator", () => {
    expect(checkOneCrossRef("src/foo.ts")).toEqual({ ok: false, reason: "malformed" });
  });

  it("flags malformed entry ending in colon", () => {
    expect(checkOneCrossRef("src/foo.ts:")).toEqual({ ok: false, reason: "malformed" });
  });

  it("flags missing file", () => {
    const result = checkOneCrossRef("src/does-not-exist.ts:someExport");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("missing file");
  });
});

// ---------------------------------------------------------------------------
// file:exportName resolution
// ---------------------------------------------------------------------------
describe("checkOneCrossRef — file:exportName resolution", () => {
  it("resolves a valid named export (function declaration)", () => {
    expect(checkOneCrossRef("src/storage/r2/policy.ts:checkPermittedPrefix")).toEqual({ ok: true });
  });

  it("resolves a valid named export (const declaration)", () => {
    expect(checkOneCrossRef("src/domain/snapshot-id.ts:SNAPSHOT_R2_KEY_PREFIX")).toEqual({ ok: true });
  });

  it("resolves a re-exported symbol (`export { X }` block)", () => {
    expect(checkOneCrossRef("src/ops/r2-invariant-scanner.ts:parseSnapIdFromRationale")).toEqual({ ok: true });
  });

  it("flags a private (non-exported) symbol as export not found", () => {
    const result = checkOneCrossRef(
      "src/discovery/worker/snapshot-fingerprint.ts:allLinkedSourcesAllowR2SnapshotUpload"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("export not found");
  });
});

// ---------------------------------------------------------------------------
// file:line resolution
// ---------------------------------------------------------------------------
describe("checkOneCrossRef — file:line resolution", () => {
  it("accepts a valid in-range line number", () => {
    expect(checkOneCrossRef("src/discovery/worker/snapshot-fingerprint.ts:120")).toEqual({ ok: true });
  });

  it("accepts line 1 (boundary)", () => {
    expect(checkOneCrossRef("src/domain/snapshot-id.ts:1")).toEqual({ ok: true });
  });

  it("flags an out-of-range line", () => {
    const result = checkOneCrossRef("src/domain/snapshot-id.ts:999999");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("out of range");
  });

  it("flags line zero as out of range", () => {
    const result = checkOneCrossRef("src/domain/snapshot-id.ts:0");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("out of range");
  });
});

// ---------------------------------------------------------------------------
// Codex PR #72 round 1 P2 regression
// ---------------------------------------------------------------------------
const FIXTURE = "tests/lint/fixtures/cross_ref_code_fixtures.ts";

describe("re-export alias name validation (round 1 P2 #1)", () => {
  it("accepts the alias (right-hand side) of `export { foo as bar }`", () => {
    expect(checkOneCrossRef(`${FIXTURE}:renamedExternal`)).toEqual({ ok: true });
  });

  it("rejects the internal source name on the left-hand side of `as`", () => {
    const result = checkOneCrossRef(`${FIXTURE}:internalSecret`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("export not found");
  });

  it("extractReExportedNames does not include the import-name side", () => {
    const code = readFileSync(join(REPO_ROOT, FIXTURE), "utf-8");
    const names = extractReExportedNames(code);
    expect(names.has("renamedExternal")).toBe(true);
    expect(names.has("internalSecret")).toBe(false);
  });
});

describe("repo-root path escape rejection (round 1 P2 #2)", () => {
  it("rejects absolute path", () => {
    const result = checkOneCrossRef("/etc/passwd:root");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("escapes repo root");
  });

  it("rejects `../` traversal", () => {
    const result = checkOneCrossRef("../sibling-repo/src/foo.ts:x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("escapes repo root");
  });

  it("rejects nested `../../` traversal", () => {
    const result = checkOneCrossRef("src/../../../../etc/passwd:x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("escapes repo root");
  });

  it("accepts plain relative path", () => {
    expect(isInsideRepo("src/domain/snapshot-id.ts")).toBe(true);
  });
});

describe("declaration forms (round 1 P2 #3)", () => {
  it("matches `export default async function name()`", () => {
    expect(checkOneCrossRef(`${FIXTURE}:defaultAsyncDecl`)).toEqual({ ok: true });
  });

  it("matches `export async function* name()` (generator + async)", () => {
    expect(checkOneCrossRef(`${FIXTURE}:plainAsyncGenerator`)).toEqual({ ok: true });
  });

  it("matches `export function* name()` (generator only)", () => {
    expect(checkOneCrossRef(`${FIXTURE}:plainGenerator`)).toEqual({ ok: true });
  });

  it("matches `export async function name()`", () => {
    expect(checkOneCrossRef(`${FIXTURE}:plainAsync`)).toEqual({ ok: true });
  });

  it("matches plain `export function name()`", () => {
    expect(checkOneCrossRef(`${FIXTURE}:plainFunction`)).toEqual({ ok: true });
  });

  it("matches `export class`, `export interface`, `export type`, `export enum`", () => {
    expect(checkOneCrossRef(`${FIXTURE}:PlainClass`)).toEqual({ ok: true });
    expect(checkOneCrossRef(`${FIXTURE}:PlainInterface`)).toEqual({ ok: true });
    expect(checkOneCrossRef(`${FIXTURE}:PlainType`)).toEqual({ ok: true });
    expect(checkOneCrossRef(`${FIXTURE}:PlainEnum`)).toEqual({ ok: true });
  });

  it("matches `export const name`", () => {
    expect(checkOneCrossRef(`${FIXTURE}:plainConst`)).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// Codex PR #72 round 2 regression
// ---------------------------------------------------------------------------
describe("physical line count for newline-terminated files (round 2 P2 #1)", () => {
  it("returns N for a string that ends in newline", () => {
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

  it("rejects last_line + 1 for newline-terminated source files", () => {
    const code = readFileSync(join(REPO_ROOT, "src/domain/snapshot-id.ts"), "utf-8");
    const wcCount = physicalLineCount(code);
    const oneOver = wcCount + 1;
    const result = checkOneCrossRef(`src/domain/snapshot-id.ts:${oneOver}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("out of range");
  });
});

describe("symlink-aware repo-boundary check (round 2 P2 #2)", () => {
  it("rejects path that exits repo via realpath even if syntactically inside", () => {
    expect(isInsideRepo("/tmp/escape-target.ts")).toBe(false);
  });

  it("accepts a real in-repo file", () => {
    expect(isInsideRepo("src/domain/snapshot-id.ts")).toBe(true);
  });

  it("accepts a path inside the repo even when the file does not yet exist", () => {
    expect(isInsideRepo("src/does-not-exist-yet.ts")).toBe(true);
  });
});

describe("type-prefixed re-export specifiers (round 2 P2 #3)", () => {
  it("strips a leading `type` token from bare specifiers", () => {
    expect(extractReExportedNames("export { type Foo };").has("Foo")).toBe(true);
  });

  it("strips a leading `type` token from aliased specifiers", () => {
    const names = extractReExportedNames("export { type Foo as Bar };");
    expect(names.has("Bar")).toBe(true);
    expect(names.has("Foo")).toBe(false);
  });

  it("handles mixed value + type specifiers in one block", () => {
    const names = extractReExportedNames(
      "export { plain, type Foo, type Inner as Public, alias as renamed };"
    );
    expect(names.has("plain")).toBe(true);
    expect(names.has("Foo")).toBe(true);
    expect(names.has("Public")).toBe(true);
    expect(names.has("renamed")).toBe(true);
    expect(names.has("Inner")).toBe(false);
    expect(names.has("alias")).toBe(false);
  });

  it("still handles `export type { Foo, Bar }` block form", () => {
    const names = extractReExportedNames("export type { Foo, Bar };");
    expect(names.has("Foo")).toBe(true);
    expect(names.has("Bar")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Codex PR #72 round 3 regression
// ---------------------------------------------------------------------------
describe("ignore exports inside comments and strings (round 3 P2 — raw-text regex)", () => {
  it("hasNamedDeclaration ignores `// export function name`", () => {
    const code = "// export function ghostFn(): void {}\n";
    expect(hasNamedDeclaration(code, "ghostFn")).toBe(false);
  });

  it("hasNamedDeclaration ignores `/* export function name */`", () => {
    const code = "/* export function commentedOut(): void {} */\n";
    expect(hasNamedDeclaration(code, "commentedOut")).toBe(false);
  });

  it("hasNamedDeclaration ignores string-literal snippets", () => {
    const dq = `const sample = "export function inDoubleQuotes(): void {}";\n`;
    const sq = `const sample = 'export function inSingleQuotes(): void {}';\n`;
    const tpl = "const sample = `export function inTemplateLiteral(): void {}`;\n";
    expect(hasNamedDeclaration(dq, "inDoubleQuotes")).toBe(false);
    expect(hasNamedDeclaration(sq, "inSingleQuotes")).toBe(false);
    expect(hasNamedDeclaration(tpl, "inTemplateLiteral")).toBe(false);
  });

  it("hasNamedDeclaration still matches real exports beside commented siblings", () => {
    const code = `
      // export function ghostFn(): void {}
      export function realFn(): void {}
    `;
    expect(hasNamedDeclaration(code, "ghostFn")).toBe(false);
    expect(hasNamedDeclaration(code, "realFn")).toBe(true);
  });

  it("stripCommentsAndStrings preserves non-comment content", () => {
    const stripped = stripCommentsAndStrings(
      "export function keep(): void {} // export function drop()"
    );
    expect(stripped).toContain("export function keep()");
    expect(stripped).not.toContain("export function drop()");
  });
});

describe("re-export block matching ignores comments/strings (round 4 P2 #1)", () => {
  it("does not import names from `// export { ... }`", () => {
    const code = "// export { internal as fakeName };\n";
    const names = extractReExportedNames(code);
    expect(names.has("fakeName")).toBe(false);
    expect(names.has("internal")).toBe(false);
  });

  it("does not import names from `/* export { ... } */`", () => {
    const code = "/* export { internal as fakeName }; */\n";
    expect(extractReExportedNames(code).has("fakeName")).toBe(false);
  });

  it("does not import names from a string-literal `export { ... }` snippet", () => {
    const code = `const sample = "export { internal as fakeName }";\n`;
    expect(extractReExportedNames(code).has("fakeName")).toBe(false);
  });

  it("still imports names from a real `export { ... }` block beside commented ones", () => {
    const code = `
      // export { ghost as ghostAlias };
      export { real as realAlias };
    `;
    const names = extractReExportedNames(code);
    expect(names.has("ghostAlias")).toBe(false);
    expect(names.has("realAlias")).toBe(true);
  });
});

describe("hasNamedDeclaration accepts non-ASCII / `$` identifiers (round 4 P2 #2)", () => {
  it("matches `export const foo$ = ...`", () => {
    const code = "export const foo$ = 1;\n";
    expect(hasNamedDeclaration(code, "foo$")).toBe(true);
  });

  it("matches `export const $$ = ...`", () => {
    const code = "export const $$ = 2;\n";
    expect(hasNamedDeclaration(code, "$$")).toBe(true);
  });

  it("matches `export const 한글 = ...` (non-ASCII identifier)", () => {
    const code = "export const 한글 = 3;\n";
    expect(hasNamedDeclaration(code, "한글")).toBe(true);
  });

  it("still rejects a partial match where the target is a prefix of a longer identifier", () => {
    // `foo` should NOT match `fooBar` because the trailing terminator
    // check excludes ASCII word chars + `$`.
    const code = "export const fooBar = 1;\n";
    expect(hasNamedDeclaration(code, "foo")).toBe(false);
  });

  it("still rejects when an identifier prefix is followed by `$`", () => {
    const code = "export const foo$ = 1;\n";
    expect(hasNamedDeclaration(code, "foo")).toBe(false);
  });
});

describe("stripCommentsAndStrings ordering (round 4 P2 #3)", () => {
  it("does not eat real exports on the same line as a URL string literal", () => {
    // `"http://example"` must be stripped as a string before the `//`
    // inside it is interpreted as a line comment. The real export later
    // on the same line must survive.
    const code = `const u = "http://example"; export const realExport = 1;\n`;
    expect(hasNamedDeclaration(code, "realExport")).toBe(true);
  });

  it("does not eat real exports on the same line as a `//` inside a single-quoted string", () => {
    const code = `const u = 'a//b'; export function ghostFn(): void {}\n`;
    expect(hasNamedDeclaration(code, "ghostFn")).toBe(true);
  });

  it("does not eat real exports on the same line as a `//` inside a template literal", () => {
    const code = "const u = `a//b`; export class HoldIt {}\n";
    expect(hasNamedDeclaration(code, "HoldIt")).toBe(true);
  });

  it("still strips genuine line comments after stripping strings", () => {
    const code = `// export function ghostFn(): void {}\nexport function realFn(): void {}\n`;
    expect(hasNamedDeclaration(code, "ghostFn")).toBe(false);
    expect(hasNamedDeclaration(code, "realFn")).toBe(true);
  });
});

describe("hasNamedDeclaration ignores regex literals (round 5 P2 #1)", () => {
  it("does not match `/export function ghostFn/` regex literal", () => {
    const code = "const re = /export function ghostFn/g;\n";
    expect(hasNamedDeclaration(code, "ghostFn")).toBe(false);
  });

  it("still matches real exports beside a regex literal on the same line", () => {
    const code = "const re = /\\bexport function ghostFn\\b/g; export const realConst = 1;\n";
    expect(hasNamedDeclaration(code, "ghostFn")).toBe(false);
    expect(hasNamedDeclaration(code, "realConst")).toBe(true);
  });

  it("does not eat division operator (`a / b`) as a regex literal", () => {
    // The regex-literal stripper only triggers after operator/punctuator/
    // start-of-line context. `a / b * c` should remain unaffected.
    const code = "const v = a / b * c; export const div = v;\n";
    expect(hasNamedDeclaration(code, "div")).toBe(true);
  });
});

describe("checkOneCrossRef handles non-string scalars (round 5 P1 #2)", () => {
  it("returns ok:false instead of throwing on a numeric scalar", () => {
    const result = checkOneCrossRef(123 as unknown);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("not a string scalar");
  });

  it("returns ok:false on an object scalar", () => {
    const result = checkOneCrossRef({ foo: "bar" } as unknown);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("not a string scalar");
  });

  it("returns ok:false on a boolean scalar", () => {
    const result = checkOneCrossRef(true as unknown);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("not a string scalar");
  });

  it("returns ok:false on null", () => {
    const result = checkOneCrossRef(null as unknown);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("not a string scalar");
  });
});

describe("hasNamedDeclaration uses Unicode-aware boundary (round 5 P3 #3)", () => {
  it("does not match `한글` target against `한글가` identifier", () => {
    const code = "export const 한글가 = 1;\n";
    expect(hasNamedDeclaration(code, "한글")).toBe(false);
  });

  it("matches exact `한글` identifier", () => {
    const code = "export const 한글 = 1;\n";
    expect(hasNamedDeclaration(code, "한글")).toBe(true);
  });

  it("does not match `한글가` target against `한글` identifier", () => {
    const code = "export const 한글 = 1;\n";
    expect(hasNamedDeclaration(code, "한글가")).toBe(false);
  });

  it("matches mixed ASCII + non-ASCII identifiers", () => {
    const code = "export const foo한글 = 1;\n";
    expect(hasNamedDeclaration(code, "foo한글")).toBe(true);
    expect(hasNamedDeclaration(code, "foo")).toBe(false);
  });
});

describe("stripCommentsAndStrings handles strings-before-block-comments (round 5 P2 #4)", () => {
  it("does not eat real exports between two string literals containing `/*` / `*/`", () => {
    const code = `
      const a = "/*";
      export const between = 1;
      const b = "*/";
    `;
    expect(hasNamedDeclaration(code, "between")).toBe(true);
  });

  it("does not treat `\"/* */\"` string content as a comment span", () => {
    const code = `const x = "/* not a real comment */"; export const survivor = 1;\n`;
    expect(hasNamedDeclaration(code, "survivor")).toBe(true);
  });
});

describe("stripCommentsAndStrings strips regex literals before line comments (round 6 P2 #2)", () => {
  it("preserves real exports following a regex containing `//`", () => {
    const code = `const re = /https?:\\/\\//; export const keep = 1;\n`;
    expect(hasNamedDeclaration(code, "keep")).toBe(true);
  });

  it("preserves real exports following a regex containing `/*`", () => {
    const code = `const re = /\\/\\*/; export const survive = 1;\n`;
    expect(hasNamedDeclaration(code, "survive")).toBe(true);
  });

  it("still strips a genuine line comment that follows a regex literal", () => {
    const code = `const re = /pattern/; // export function ghostFn(): void {}\nexport function realFn(): void {}\n`;
    expect(hasNamedDeclaration(code, "ghostFn")).toBe(false);
    expect(hasNamedDeclaration(code, "realFn")).toBe(true);
  });
});

describe("extractReExportedNames accepts Unicode identifiers (round 6 P3 #3)", () => {
  it("captures the alias side `한글 as 공개`", () => {
    const code = "export { 한글 as 공개 };\n";
    const names = extractReExportedNames(code);
    expect(names.has("공개")).toBe(true);
    expect(names.has("한글")).toBe(false);
  });

  it("captures a bare non-ASCII specifier `export { 한글 }`", () => {
    expect(extractReExportedNames("export { 한글 };\n").has("한글")).toBe(true);
  });

  it("ignores ES2020+ string-literal aliases (defer — Cycle 14 follow-up)", () => {
    // Documents the explicit defer decision: `export { foo as "string-name" }`
    // is not yet supported and is logged as a follow-up anchor in the PR
    // description / IMPL_PLAN. This test pins the current behavior so a
    // future cycle that adds the feature also updates this assertion.
    const code = `export { foo as "string-name" };\n`;
    expect(extractReExportedNames(code).has("string-name")).toBe(false);
  });
});

describe("test imports validator helpers directly (round 3 P2 — parallel impl)", () => {
  it("checkOneCrossRef is the same function the validator's checkCrossRefCode calls", () => {
    // Sanity probe: if test were re-implementing logic, a bug fix in the
    // production helper would not surface here. Assert function references
    // come from the validator module by exercising a fixture-rooted ref
    // and observing the production-grade reason text.
    const result = checkOneCrossRef(`${FIXTURE}:internalSecret`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Production-generated reason text — "export not found: <name>"
      expect(result.reason.startsWith("export not found:")).toBe(true);
    }
  });
});

describe("repo-wide scan uses validator's file lists (round 3 P2 — recursion + filter parity)", () => {
  it("adrFiles and decisionFiles come from the validator with recursive glob + README filter", () => {
    expect(Array.isArray(adrFiles)).toBe(true);
    expect(Array.isArray(decisionFiles)).toBe(true);
    expect(adrFiles.length).toBeGreaterThan(0);
    // Validator filters README* / 0001-example* — test parity follows automatically
    // since we consume the same lists.
    const adrBasenames = adrFiles.map((f) => basename(f));
    for (const name of adrBasenames) {
      expect(name.startsWith("README")).toBe(false);
      expect(name.startsWith("0001-example")).toBe(false);
    }
  });
});

describe("DEC-coverage regression (round 3 P3 + round 5 P3 #6)", () => {
  it("scan helper iterates exactly the validator's decisionFiles list", () => {
    // Codex PR #72 round 5 P3 (#6): pre-fix assertion was tautological —
    // `before` and `after` were both issue counts (default 0 in this repo)
    // and `after >= before` held even if scanCrossRefsAcross never iterated
    // its input. ScanResult now exposes `inspectedFileCount` so the test
    // can assert real iteration on docs/decisions.
    expect(decisionFiles.length).toBeGreaterThan(0);

    const emptyScan = scanCrossRefsAcross([]);
    expect(emptyScan.inspectedFileCount).toBe(0);

    const decScan = scanCrossRefsAcross(decisionFiles);
    expect(decScan.inspectedFileCount).toBe(decisionFiles.length);

    // The issue list itself may be empty if no DEC carries cross_ref_code;
    // the iteration-count assertion above is what protects against the
    // regression "DEC scan silently skipped".
    expect(decScan.issues).toBeInstanceOf(Array);
  });
});

// ---------------------------------------------------------------------------
// Repo-wide reachability invariant (uses production file lists)
// ---------------------------------------------------------------------------
describe("cross_ref_code reachability — repo-wide invariant", () => {
  it("every cross_ref_code entry across adrFiles + decisionFiles resolves", () => {
    const { issues } = scanCrossRefsAcross([...adrFiles, ...decisionFiles]);
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
