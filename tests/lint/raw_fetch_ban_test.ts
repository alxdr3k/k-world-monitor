/**
 * Raw `fetch()` ban lint — INV-0028-1 static check (INFRA-1A.9.h1, Opus
 * PR #66~#78 adversarial review F4 follow-up).
 *
 * ADR-0028 INV-0028-1 statement explicitly forbids direct `fetch()` calls
 * inside `src/discovery/` and `src/extraction/`. Pre-check, the only
 * cross_ref was the `safeFetch` entry point — which proves the safe-fetch
 * module exists but says nothing about raw `fetch(` being absent elsewhere
 * (see DEC-020 Q-045 cross_ref_code semantic scope — `export_exists`
 * reachability heuristic, not enforcement proof). This static check closes
 * that gap by scanning the banned directories for raw `fetch(` tokens
 * after comment / string / regex-literal stripping.
 *
 * Contract (locked by these tests):
 *   - Scope: `src/discovery/**` + `src/extraction/**`.
 *   - Allowlist: `src/discovery/fetch/safe-fetch.ts` (canonical wrapper).
 *   - `fetch(` is flagged only when the preceding character is NOT `.`,
 *     `$`, or a Unicode identifier-continue char — so `obj.fetch(`,
 *     `$fetch(`, `prefetch(`, etc. do NOT trigger.
 *   - Comments and string literals do NOT contribute — uses
 *     `stripCommentsAndStrings` (same defang as `checkCrossRefCode`).
 *   - Line numbers in the warning message match what a human sees in the
 *     editor (1-based, matches `physicalLineCount` semantics).
 *   - Severity is warning-only per INV-0002-1; validator never exits
 *     non-zero from this check alone.
 */

import { describe, it, expect } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

import {
  RAW_FETCH_BAN_DIRS,
  RAW_FETCH_BAN_ALLOWLIST,
  RAW_FETCH_BAN_PATTERN,
  findRawFetchCalls,
} from "../../scripts/validate_invariants";

const REPO_ROOT = join(import.meta.dir, "..", "..");

// ---------------------------------------------------------------------------
// Pattern unit tests — preceding-char negative lookbehind exclusion
// ---------------------------------------------------------------------------

describe("RAW_FETCH_BAN_PATTERN (preceding-char exclusion)", () => {
  it("matches bare `fetch(` at start of file", () => {
    expect(findRawFetchCalls(`fetch("https://example.test/x")`)).toEqual([1]);
  });

  it("matches `await fetch(` (preceded by whitespace)", () => {
    expect(findRawFetchCalls(`const r = await fetch("u");`)).toEqual([1]);
  });

  it("matches `fetch (` with whitespace before paren", () => {
    expect(findRawFetchCalls(`fetch ("https://example.test/x")`)).toEqual([1]);
  });

  it("does NOT match `.fetch(` (method call on object)", () => {
    expect(findRawFetchCalls(`db.fetch("query")`)).toEqual([]);
  });

  it("does NOT match `obj.fetch(` (property access)", () => {
    expect(findRawFetchCalls(`client.fetch(url);`)).toEqual([]);
  });

  it("does NOT match `prefetch(` (identifier suffix)", () => {
    expect(findRawFetchCalls(`prefetch(resource)`)).toEqual([]);
  });

  it("does NOT match `$fetch(` (Nuxt-style sigil prefix)", () => {
    expect(findRawFetchCalls(`$fetch("u")`)).toEqual([]);
  });

  it("does NOT match identifier-continue char prefix (Unicode-aware)", () => {
    // `한글fetch(` — Korean identifier-continue chars before `fetch` should
    // be treated like ASCII word chars and excluded. Tests the
    // `\p{ID_Continue}` branch of the negative lookbehind.
    expect(findRawFetchCalls(`한글fetch(x)`)).toEqual([]);
  });

  it("reports correct 1-based line numbers across a multi-line file", () => {
    const code = [
      `// header comment`,
      `import { x } from "y";`,
      ``,
      `fetch("u1");`,
      `obj.fetch("ignored");`,
      ``,
      `await fetch("u2");`,
    ].join("\n");
    expect(findRawFetchCalls(code)).toEqual([4, 7]);
  });
});

// ---------------------------------------------------------------------------
// Comment / string literal stripping — false-positive defense
// ---------------------------------------------------------------------------

describe("findRawFetchCalls — comment / string literal defense", () => {
  it("ignores `fetch(` inside a line comment", () => {
    expect(findRawFetchCalls(`// example: fetch("u")`)).toEqual([]);
  });

  it("ignores `fetch(` inside a block comment", () => {
    expect(findRawFetchCalls(`/* TODO: replace fetch(url) with safeFetch */`)).toEqual([]);
  });

  it("ignores `fetch(` inside a double-quoted string", () => {
    expect(findRawFetchCalls(`const msg = "use safeFetch instead of fetch(url)";`)).toEqual([]);
  });

  it("ignores `fetch(` inside a single-quoted string", () => {
    expect(findRawFetchCalls(`const msg = 'use safeFetch instead of fetch(url)';`)).toEqual([]);
  });

  it("ignores `fetch(` inside a template literal (no interpolation)", () => {
    expect(findRawFetchCalls("const msg = `use safeFetch instead of fetch(url)`;")).toEqual([]);
  });

  it("matches `fetch(` AFTER a block comment ends (no over-strip)", () => {
    const code = `/* note: fetch(comment) */ fetch("u")`;
    expect(findRawFetchCalls(code)).toEqual([1]);
  });
});

// ---------------------------------------------------------------------------
// Repo-wide invariant — actual codebase must currently honor INV-0028-1.
//
// This is the "live" assertion that links the static check to the
// invariant: if any production file in src/discovery/** or src/extraction/**
// introduces a raw `fetch(` outside the allowlist, this test fails. Since
// `checkRawFetchBan()` itself emits warnings (not errors) per INV-0002-1,
// we mirror its scan here to surface violations as test failures — the
// validator stays warning-level for ledger drift purposes, while this
// regression test pins production-code compliance.
// ---------------------------------------------------------------------------

describe("ADR-0028 INV-0028-1 repo-wide raw `fetch(` ban", () => {
  it("scopes match the ADR statement (src/discovery + src/extraction)", () => {
    expect([...RAW_FETCH_BAN_DIRS]).toEqual(["src/discovery", "src/extraction"]);
  });

  it("allowlist contains exactly the safe-fetch module", () => {
    expect([...RAW_FETCH_BAN_ALLOWLIST]).toEqual([
      "src/discovery/fetch/safe-fetch.ts",
    ]);
  });

  it("safe-fetch.ts exists at the allowlisted path", () => {
    const safeFetchPath = join(REPO_ROOT, "src/discovery/fetch/safe-fetch.ts");
    expect(existsSync(safeFetchPath)).toBe(true);
  });

  it("no production file under src/discovery/** or src/extraction/** has a raw `fetch(` outside the allowlist", () => {
    // Reimplement the helper's traversal locally so the test ALSO probes
    // the directory walk (not just the regex), and reports failing files
    // with line numbers in the expect failure message.
    function walkTs(dir: string): string[] {
      const { readdirSync } = require("fs") as typeof import("fs");
      if (!existsSync(dir)) return [];
      const out: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          out.push(...walkTs(full));
        } else if (
          entry.isFile() &&
          (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
        ) {
          out.push(full);
        }
      }
      return out;
    }
    const allowlistAbs = new Set(
      RAW_FETCH_BAN_ALLOWLIST.map((p) => join(REPO_ROOT, p))
    );
    const violations: Array<{ file: string; lines: number[] }> = [];
    for (const relDir of RAW_FETCH_BAN_DIRS) {
      const abs = join(REPO_ROOT, relDir);
      for (const file of walkTs(abs)) {
        if (allowlistAbs.has(file)) continue;
        const code = readFileSync(file, "utf-8");
        const hits = findRawFetchCalls(code);
        if (hits.length > 0) {
          violations.push({ file: file.slice(REPO_ROOT.length + 1), lines: hits });
        }
      }
    }
    if (violations.length > 0) {
      const detail = violations
        .map((v) => `${v.file}:${v.lines.join(",")}`)
        .join(" | ");
      throw new Error(
        `ADR-0028 INV-0028-1 raw fetch ban violated — ${violations.length} ` +
          `file(s) have raw \`fetch(\` outside the allowlist: ${detail}`
      );
    }
    expect(violations).toEqual([]);
  });
});
