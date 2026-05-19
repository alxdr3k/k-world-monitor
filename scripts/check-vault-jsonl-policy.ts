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
 * Permitted `type` frontmatter values for vault files. Mirrors ADR-0012
 * INV-0012-5 statement (Document hub / Dossier / Scenario / Thesis /
 * ContentDraft / Publication / promoted claim) plus ADR-0025
 * (EditorialIntent — `vault/editorial_intents/<eit_id>.md`, added per
 * PR #94 codex review round 1 P2; ADR-0025 IS accepted roadmap so the
 * vault guard must allow this kind).
 *
 * Matched case-insensitively after stripping non-alphanumeric separators
 * (so `Content Draft`, `content_draft`, `content-draft` all map to
 * `contentdraft`; `Editorial Intent` / `editorial_intent` /
 * `EditorialIntent` all map to `editorialintent`).
 */
export const PERMITTED_VAULT_KINDS: ReadonlySet<string> = new Set([
  "documenthub",
  "dossier",
  "scenario",
  "thesis",
  "contentdraft",
  "publication",
  "promotedclaim",
  "editorialintent",
]);

/**
 * File extensions scanned inside `VAULT_ROOTS`. ADR-0022 INV-0022-* +
 * IMPL_PLAN PUB-1A.1 emit ContentDraft / Publication as `.mdx`
 * (`vault/publications/blog_long/<slug>.mdx`); Astro Content Collection
 * uses `glob("vault/publications/**\/*.{md,mdx}")`. Both extensions must
 * be scanned (PR #94 codex review round 1 P2 — earlier `.md`-only walk
 * let MDX vault files bypass INV-0012-5 entirely).
 */
export const VAULT_FILE_EXTENSIONS: readonly string[] = [".md", ".mdx"];

/**
 * Vault `type` value (normalized form) treated as a promoted-claim entry.
 * Promoted claims have the additional INV-0012-5 obligation that they be
 * cited by at least one scenario in the same vault.
 */
const PROMOTED_CLAIM_KIND = "promotedclaim";
const SCENARIO_KIND = "scenario";

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

function walk(
  root: string,
  repoRoot: string,
  extensions: readonly string[],
): string[] {
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
      } else if (s.isFile() && extensions.some((ext) => name.endsWith(ext))) {
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

function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown> | null;
  body: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: null, body: content };
  let parsed: unknown;
  try {
    parsed = yamlLoad(match[1]!);
  } catch {
    return { frontmatter: null, body: match[2] ?? "" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { frontmatter: null, body: match[2] ?? "" };
  }
  return {
    frontmatter: parsed as Record<string, unknown>,
    body: match[2] ?? "",
  };
}

// ---------------------------------------------------------------------------
// INV-0012-5 — Vault content kinds
// ---------------------------------------------------------------------------

export interface VaultFileEntry {
  path: string;
  type: string | null;
  /** Parsed YAML frontmatter (production callers via findVaultFiles always
   *  populate this; tests may omit). Used by assertPromotedClaimsAreCited
   *  to read scenario `cited_claims:` and promoted-claim `claim_id:`. */
  frontmatter?: Record<string, unknown> | null;
  /** Markdown/MDX body (production callers via findVaultFiles always
   *  populate this; tests may omit). Used by assertPromotedClaimsAreCited
   *  for fallback whole-word scenario-body citation search. */
  body?: string;
}

/**
 * Enumerate all vault files (extensions in `VAULT_FILE_EXTENSIONS` —
 * `.md` + `.mdx`) under every `VAULT_ROOTS` directory that exists,
 * parsing the YAML frontmatter for each. Returns an empty array if no
 * vault root exists (the vault has not been implemented yet).
 *
 * MDX support (PR #94 codex round 1 P2): ADR-0022 + IMPL_PLAN PUB-1A.1
 * emit ContentDraft / Publication as `.mdx`; both extensions must be
 * scanned so MDX vault files cannot bypass INV-0012-5.
 */
export function findVaultFiles(repoRoot: string): VaultFileEntry[] {
  const out: VaultFileEntry[] = [];
  for (const root of VAULT_ROOTS) {
    const full = join(repoRoot, root);
    const files = walk(full, repoRoot, VAULT_FILE_EXTENSIONS);
    for (const path of files) {
      const content = readFileSync(join(repoRoot, path), "utf8");
      const { frontmatter, body } = parseFrontmatter(content);
      const typeRaw = frontmatter?.type;
      out.push({
        path,
        type: typeof typeRaw === "string" ? typeRaw : null,
        frontmatter,
        body,
      });
    }
  }
  return out;
}

/**
 * Asserts every vault file (Markdown or MDX) declares a `type` in
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

/**
 * Extract the claim ID for a `promoted_claim` vault file. Preference
 * order: explicit `claim_id` frontmatter field (when string) → filename
 * basename without extension (e.g., `vault/promoted_claims/c_abc123.md`
 * → `c_abc123`). Returns null only when neither source yields a non-empty
 * string (should not happen for well-formed promoted-claim files).
 */
function extractClaimId(file: VaultFileEntry): string | null {
  const fmId = file.frontmatter?.claim_id;
  if (typeof fmId === "string" && fmId.trim() !== "") return fmId.trim();
  const base = file.path.split("/").pop() ?? "";
  for (const ext of VAULT_FILE_EXTENSIONS) {
    if (base.endsWith(ext)) return base.slice(0, -ext.length) || null;
  }
  return base || null;
}

/**
 * Extract the set of claim IDs cited by a scenario file. Two sources are
 * considered (gradual rollout — vault frontmatter format is not yet
 * locked):
 *   1. Frontmatter `cited_claims:` field — array of string claim IDs.
 *      Preferred canonical form.
 *   2. Markdown body text — any whole-word occurrence of a string
 *      matching the claim_id pattern serves as a citation. Permits
 *      narrative-style citations.
 */
function extractScenarioCitations(scenario: VaultFileEntry): Set<string> {
  const out = new Set<string>();
  const fmList = scenario.frontmatter?.cited_claims;
  if (Array.isArray(fmList)) {
    for (const item of fmList) {
      if (typeof item === "string" && item.trim() !== "") out.add(item.trim());
    }
  }
  return out;
}

/**
 * Asserts every vault file with `type: promoted_claim` is cited by at
 * least one vault scenario (INV-0012-5 — "scenario에 인용된 promoted
 * claim만 둔다"). Citation is detected when the promoted claim's ID
 * appears in either:
 *   - any scenario's frontmatter `cited_claims:` list, OR
 *   - any scenario's body markdown text (as a whole-word occurrence).
 *
 * Vacuously true when no `promoted_claim` files exist (no obligation to
 * cite something that does not exist). Throws `VaultJsonlPolicyError`
 * listing every orphaned promoted claim at once.
 *
 * PR #94 codex review round 1 P2 follow-up — earlier
 * `assertVaultContentKinds` allowed every `promoted_claim` file
 * unconditionally; the INV-0012-5 statement also requires that they be
 * cited by a scenario.
 */
export function assertPromotedClaimsAreCited(
  files: readonly VaultFileEntry[],
): void {
  const scenarios = files.filter(
    (f) => f.type !== null && normalizeKind(f.type) === SCENARIO_KIND,
  );
  const promotedClaims = files.filter(
    (f) => f.type !== null && normalizeKind(f.type) === PROMOTED_CLAIM_KIND,
  );
  if (promotedClaims.length === 0) return;

  // Aggregate cited claim IDs from every scenario.
  const cited = new Set<string>();
  const scenarioBodies: { path: string; body: string }[] = [];
  for (const sc of scenarios) {
    for (const id of extractScenarioCitations(sc)) cited.add(id);
    scenarioBodies.push({ path: sc.path, body: sc.body ?? "" });
  }

  const violations: string[] = [];
  for (const claim of promotedClaims) {
    const claimId = extractClaimId(claim);
    if (claimId === null) {
      violations.push(
        `  - ${claim.path}: cannot derive claim_id (frontmatter 'claim_id' missing and filename basename empty)`,
      );
      continue;
    }
    if (cited.has(claimId)) continue;
    // Fallback: look for whole-word occurrence in any scenario body.
    const escaped = claimId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?:^|[^A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`);
    const found = scenarioBodies.some(({ body }) => pattern.test(body));
    if (!found) {
      violations.push(
        `  - ${claim.path}: claim_id '${claimId}' is not cited by any vault scenario (frontmatter cited_claims[] or body text)`,
      );
    }
  }
  if (violations.length > 0) {
    throw new VaultJsonlPolicyError(
      `INV-0012-5: promoted claim file(s) not cited by any scenario (ADR-0012 INV-0012-5 — "scenario에 인용된 promoted claim만 둔다"). Add the claim_id to a scenario's frontmatter cited_claims[] list, or reference it in the scenario body, or remove the promoted-claim vault file:\n${violations.join("\n")}`,
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
  return walk(repoRoot, repoRoot, [".jsonl"]);
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
  assertPromotedClaimsAreCited(vaultFiles);
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
