/**
 * TEST-008 — Frontmatter relation array lint (AC-008)
 *
 * Asserts that no markdown file in the repo has frontmatter keys
 * `supports`, `contradicts`, or `qualifies` as YAML sequences.
 * All semantic edges (SUPPORTS / CONTRADICTS / QUALIFIES / UPDATES /
 * SUPERSEDES) must live in the Neo4j graph — never in doc frontmatter.
 *
 * Scope: docs/ and any future paths that might hold data-adjacent markdown.
 * Exclusions: docs/_generated/ (generated artifacts, never doc-authored).
 */

import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join, relative, basename } from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function globMd(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip generated artifacts — they are never hand-authored
      if (entry.name === "_generated") continue;
      results.push(...globMd(full));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(full);
    }
  }
  return results;
}

function parseFrontmatterKeys(content: string): string[] {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match || !match[1]) return [];
  // Extract top-level YAML keys: lines that start with a word character
  // followed by a colon (not indented, i.e., not nested keys).
  const lines = match[1].split(/\r?\n/);
  const keys: string[] = [];
  for (const line of lines) {
    const keyMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*):/);
    if (keyMatch && keyMatch[1]) keys.push(keyMatch[1]);
  }
  return keys;
}

function isFrontmatterValueArray(content: string, key: string): boolean {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match || !match[1]) return false;
  // Match the key followed by either:
  //   - an inline sequence: key: [...]
  //   - a block sequence: key:\n  - item
  const inlineRe = new RegExp(`^${key}:\\s*\\[`, "m");
  const blockRe = new RegExp(`^${key}:\\s*\\n(?:\\s+-\\s)`, "m");
  return inlineRe.test(match[1]) || blockRe.test(match[1]);
}

// ---------------------------------------------------------------------------
// The three forbidden top-level relation-array keys (AC-008)
// supports / contradicts / qualifies must never appear as frontmatter arrays.
// (updates and supersedes are excluded: `supersedes:` is ADR structural metadata.)
// ---------------------------------------------------------------------------
const FORBIDDEN_RELATION_KEYS = ["supports", "contradicts", "qualifies"] as const;

const REPO_ROOT = join(import.meta.dir, "../..");
const DOCS_DIR = join(REPO_ROOT, "docs");

// ---------------------------------------------------------------------------
// Collect violations
// ---------------------------------------------------------------------------
interface Violation {
  file: string;
  key: string;
}

function collectViolations(): Violation[] {
  const violations: Violation[] = [];
  const files = globMd(DOCS_DIR);

  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    const frontmatterKeys = parseFrontmatterKeys(content);

    for (const key of FORBIDDEN_RELATION_KEYS) {
      if (frontmatterKeys.includes(key) && isFrontmatterValueArray(content, key)) {
        violations.push({ file: relative(REPO_ROOT, file), key });
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("TEST-008 — no frontmatter relation arrays (AC-008)", () => {
  it("docs/ contains zero markdown files with supports[] in frontmatter", () => {
    const found = collectViolations().filter((v) => v.key === "supports");
    expect(found).toEqual([]);
  });

  it("docs/ contains zero markdown files with contradicts[] in frontmatter", () => {
    const found = collectViolations().filter((v) => v.key === "contradicts");
    expect(found).toEqual([]);
  });

  it("docs/ contains zero markdown files with qualifies[] in frontmatter", () => {
    const found = collectViolations().filter((v) => v.key === "qualifies");
    expect(found).toEqual([]);
  });

  it("total relation-array violations across all docs is 0", () => {
    const all = collectViolations();
    if (all.length > 0) {
      // Surface failing files for easy diagnosis
      const msg = all.map((v) => `  ${v.file}: '${v.key}' is a frontmatter array`).join("\n");
      throw new Error(`Frontmatter relation arrays found (must be Neo4j edges):\n${msg}`);
    }
    expect(all.length).toBe(0);
  });

  it("helper — parseFrontmatterKeys extracts top-level YAML keys correctly", () => {
    const sample = `---\nid: q-001\ntype: question\nsupports:\n  - clm_001\n---\n# body`;
    expect(parseFrontmatterKeys(sample)).toContain("supports");
    expect(parseFrontmatterKeys(sample)).toContain("id");
  });

  it("helper — isFrontmatterValueArray detects inline sequence", () => {
    const sample = `---\nsupports: [clm_001, clm_002]\n---\n# body`;
    expect(isFrontmatterValueArray(sample, "supports")).toBe(true);
  });

  it("helper — isFrontmatterValueArray detects block sequence", () => {
    const sample = `---\nsupports:\n  - clm_001\n  - clm_002\n---\n# body`;
    expect(isFrontmatterValueArray(sample, "supports")).toBe(true);
  });

  it("helper — isFrontmatterValueArray returns false for scalar value", () => {
    const sample = `---\nsupports: null\n---\n# body`;
    expect(isFrontmatterValueArray(sample, "supports")).toBe(false);
  });

  it("helper — ADR supersedes: [...] is NOT flagged (excluded key)", () => {
    // supersedes is a FORBIDDEN_RELATION_KEYS exclusion — only supports/contradicts/qualifies checked
    const sample = `---\nsupersedes: [adr-0008]\n---\n# ADR body`;
    const violations: Violation[] = [];
    const frontmatterKeys = parseFrontmatterKeys(sample);
    for (const key of FORBIDDEN_RELATION_KEYS) {
      if (frontmatterKeys.includes(key) && isFrontmatterValueArray(sample, key)) {
        violations.push({ file: "test", key });
      }
    }
    expect(violations).toEqual([]);
  });
});
