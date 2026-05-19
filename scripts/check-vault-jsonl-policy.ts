/**
 * Vault content rules + JSONL canonical-store guard — pure config/policy validator.
 *
 * Operator decision D4 (2026-05-18) — ADR-0012 INV-0012-5 + INV-0012-6 are
 * policy invariants without runtime code enforcement. Enforce them as a
 * pure validator over the repo's filesystem and documentation.
 *
 * INV-0012-5: Markdown vault에는 Document hub / Dossier / Scenario /
 *             Thesis / ContentDraft / Publication / promoted claim만 둔다.
 *             candidate claim 자동 markdown 생성은 금지.
 * INV-0012-6: JSONL은 (a) import/export 포맷, (b) human-readable audit
 *             export(월별 또는 발행 시점) 용도만 사용한다. canonical
 *             저장소 아님.
 *
 * The validator is intentionally narrow:
 *   - Vault content scan iterates `VAULT_ROOTS` (vault/, docs/vault/) if
 *     they exist. Currently no vault root exists in the repo — the
 *     assertion is vacuously satisfied but the framework is ready for the
 *     future vault implementation.
 *   - JSONL location guard iterates every *.jsonl in the repo (except
 *     node_modules / .git) and requires each to live under an allowlisted
 *     intermediate / log path. Adding a new *.jsonl outside the allowlist
 *     fails fast.
 *   - The validator does NOT execute any runtime vault writer / JSONL
 *     reader; it does NOT cover INV-0012-5's "candidate claim 자동
 *     markdown 생성 금지" via execution analysis (that would require
 *     EXTR-1A.* phase wiring). Static path/kind checks only.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { load as yamlLoad } from "js-yaml";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Filesystem roots scanned for vault content (INV-0012-5). */
export const VAULT_ROOTS: readonly string[] = ["vault", "docs/vault"];

/**
 * Permitted `type` frontmatter values for Markdown files inside any
 * `VAULT_ROOTS` directory. Mirrors ADR-0012 INV-0012-5 statement:
 *   Document hub / Dossier / Scenario / Thesis / ContentDraft /
 *   Publication / promoted claim (scenario에 인용된).
 *
 * Matched case-insensitively after stripping non-alphanumeric separators
 * (so `Content Draft`, `content_draft`, `content-draft` all map to
 * `contentdraft`).
 */
export const PERMITTED_VAULT_KINDS: ReadonlySet<string> = new Set([
  "documenthub",
  "dossier",
  "scenario",
  "thesis",
  "contentdraft",
  "publication",
  "promotedclaim",
]);

/**
 * Allowlist of paths where JSONL files MAY live (INV-0012-6 — JSONL is
 * derived/log/intermediate artifact only, NOT canonical store). Any
 * `*.jsonl` outside these paths is treated as a potential canonical-store
 * violation.
 *
 * Each entry is a path prefix relative to repo root, with trailing slash.
 * Add new entries when an operator legitimately introduces a new
 * intermediate JSONL artifact location.
 */
export const ALLOWED_JSONL_PATH_PREFIXES: readonly string[] = [
  ".dev-cycle/",           // dev-cycle helper internal state (briefs / audit passes)
  "docs/audit-export/",    // human-readable monthly / publication audit exports
  "docs/_generated/",      // invariant validator generated artifacts
  "tests/fixtures/",       // test fixtures (NOT canonical runtime data)
  "tests/lint/fixtures/",
  "tests/policy/fixtures/",
];

/** Files / directories skipped during repo scans. */
const SCAN_SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
]);

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class VaultJsonlPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultJsonlPolicyError";
  }
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

function walk(root: string, repoRoot: string, extension: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const visit = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (SCAN_SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      let s;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        visit(full);
      } else if (s.isFile() && name.endsWith(extension)) {
        out.push(relative(repoRoot, full));
      }
    }
  };
  visit(root);
  return out;
}

function normalizeKind(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseFrontmatterType(content: string): string | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = yamlLoad(match[1]!);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const typeRaw = (parsed as Record<string, unknown>).type;
  return typeof typeRaw === "string" ? typeRaw : null;
}

// ---------------------------------------------------------------------------
// INV-0012-5 — Vault content kinds
// ---------------------------------------------------------------------------

export interface VaultFileEntry {
  path: string;
  type: string | null;
}

/**
 * Enumerate all `.md` files under every `VAULT_ROOTS` directory that
 * exists, parsing the YAML frontmatter `type` field for each. Returns
 * an empty array if no vault root exists (the vault has not been
 * implemented yet).
 */
export function findVaultFiles(repoRoot: string): VaultFileEntry[] {
  const out: VaultFileEntry[] = [];
  for (const root of VAULT_ROOTS) {
    const full = join(repoRoot, root);
    const files = walk(full, repoRoot, ".md");
    for (const path of files) {
      const content = readFileSync(join(repoRoot, path), "utf8");
      out.push({ path, type: parseFrontmatterType(content) });
    }
  }
  return out;
}

/**
 * Asserts every vault Markdown file declares a `type` in
 * `PERMITTED_VAULT_KINDS` (case-insensitive, separator-insensitive).
 *
 * Throws `VaultJsonlPolicyError` listing every offending file at once.
 * Vacuously true when no vault root exists (returns silently — `findVaultFiles`
 * returns empty array).
 */
export function assertVaultContentKinds(files: readonly VaultFileEntry[]): void {
  const violations: string[] = [];
  for (const f of files) {
    if (f.type === null) {
      violations.push(`  - ${f.path}: missing 'type' frontmatter`);
      continue;
    }
    if (!PERMITTED_VAULT_KINDS.has(normalizeKind(f.type))) {
      violations.push(`  - ${f.path}: forbidden type='${f.type}' (permitted: ${[...PERMITTED_VAULT_KINDS].join(", ")})`);
    }
  }
  if (violations.length > 0) {
    throw new VaultJsonlPolicyError(
      `INV-0012-5: Markdown vault contains files with forbidden / missing type (ADR-0012 INV-0012-5 — only Document hub / Dossier / Scenario / Thesis / ContentDraft / Publication / promoted claim allowed):\n${violations.join("\n")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// INV-0012-6 — JSONL not canonical store
// ---------------------------------------------------------------------------

/**
 * Enumerate every `*.jsonl` file in the repo (skipping `node_modules` /
 * `.git` / build dirs). Returns paths relative to `repoRoot`.
 */
export function findJsonlFiles(repoRoot: string): string[] {
  return walk(repoRoot, repoRoot, ".jsonl");
}

function isUnderAllowedPrefix(path: string): boolean {
  for (const prefix of ALLOWED_JSONL_PATH_PREFIXES) {
    if (path.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Asserts every JSONL file is under one of the `ALLOWED_JSONL_PATH_PREFIXES`
 * (intermediate / log / fixture paths). Any `*.jsonl` in src/, scripts/,
 * data/, migrations/, docs/adr/, docs/decisions/, etc. is a potential
 * canonical-store violation per INV-0012-6 — JSONL must be derived /
 * log / intermediate artifact only.
 *
 * Throws `VaultJsonlPolicyError` listing every offending path at once.
 */
export function assertJsonlIsNotCanonical(files: readonly string[]): void {
  const violations = files.filter((p) => !isUnderAllowedPrefix(p));
  if (violations.length > 0) {
    throw new VaultJsonlPolicyError(
      `INV-0012-6: JSONL file(s) found outside allowlisted intermediate / log paths (ADR-0012 INV-0012-6 — JSONL is import/export + audit-export format only, NOT canonical store). Allowlisted prefixes: ${ALLOWED_JSONL_PATH_PREFIXES.join(", ")}. Violating files:\n${violations.map((p) => `  - ${p}`).join("\n")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Aggregate entry point
// ---------------------------------------------------------------------------

/**
 * Run both ADR-0012 INV-0012-5 + INV-0012-6 invariant checks against
 * `repoRoot`. Throws on the first violation (fail-fast). Used by the
 * test suite `tests/policy/vault_jsonl_policy_test.ts` and (optionally)
 * by a future CLI guard.
 */
export function checkVaultJsonlPolicy(repoRoot: string): void {
  const vaultFiles = findVaultFiles(repoRoot);
  assertVaultContentKinds(vaultFiles);
  const jsonlFiles = findJsonlFiles(repoRoot);
  assertJsonlIsNotCanonical(jsonlFiles);
}

if (import.meta.main) {
  const root = process.argv[2] ?? process.cwd();
  try {
    checkVaultJsonlPolicy(root);
    console.log(`OK: ${root} satisfies ADR-0012 INV-0012-5 + INV-0012-6.`);
    process.exit(0);
  } catch (err) {
    console.error(`FAIL: ${(err as Error).message}`);
    process.exit(1);
  }
}
