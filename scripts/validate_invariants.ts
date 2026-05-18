#!/usr/bin/env bun
/**
 * Invariant validator — ADR-0002
 *
 * Exit code: always 0 (warning level only — INV-0002-1)
 * Modes:
 *   (default)           read-only validation, print warnings
 *   --regenerate        write docs/_generated/ artifacts + validate
 *   --write-warnings    foreground only: persist unresolved_warnings into doc frontmatter
 *   --fixture <name>    run a regression fixture (scope-creep | glossary-drift)
 *   --ci                annotation-only mode (never writes files)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, realpathSync } from "fs";
import { join, basename, isAbsolute, relative, sep } from "path";

// js-yaml — types cast because @types/js-yaml may not expose all overloads
import jsYaml from "js-yaml";
const yaml = jsYaml as {
  load: (s: string) => unknown;
  dump: (o: unknown) => string;
};

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const argv = new Set(Bun.argv.slice(2));
const fixtureIndex = Bun.argv.indexOf("--fixture");
const fixtureName = fixtureIndex >= 0 ? Bun.argv[fixtureIndex + 1] : null;

const MODE_REGEN = argv.has("--regenerate");
const MODE_WRITE = argv.has("--write-warnings") && !argv.has("--ci");
const MODE_FIXTURE = argv.has("--fixture");
const MODE_CI = argv.has("--ci");

const REPO_ROOT = join(import.meta.dir, "..");
const DOCS = join(REPO_ROOT, "docs");
const GENERATED = join(DOCS, "_generated");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface DocFrontmatter {
  id?: string;
  type?: string;
  status?: string;
  invariants?: Array<{
    id: string;
    statement: string;
    status: string;
    /**
     * Optional cross-references from this invariant to the code that enforces
     * it. Each entry is `<file>:<exportName>` (preferred, stable across line
     * shifts) or `<file>:<line>` (precise, fragile). Validator reports broken
     * references as warnings — INV-0002-1 keeps the validator warning-level.
     * Backfill priority per DEC-020 Q-045: INV-0012-3 / INV-0028-* /
     * INV-0023-3 / INV-0017 (INFRA-1A.9-validator-extension).
     */
    cross_ref_code?: string[];
  }>;
  scope?: { in?: string[]; out?: string[] };
  defines?: Array<{ term: string; role: string }>;
  touches?: Array<{ id: string; relation: string }>;
  term_effects?: unknown[];
  reviewed_terms?: string[];
  reviewed_scopes?: string[];
  unresolved_warnings?: string[];
}

interface Warning {
  severity: "error" | "warning" | "info";
  file: string;
  message: string;
}

const warnings: Warning[] = [];
function warn(file: string, message: string, severity: Warning["severity"] = "warning"): void {
  warnings.push({ severity, file, message });
  const prefix = severity === "error" ? "⚠ ERROR" : severity === "warning" ? "⚠ WARN" : "ℹ INFO";
  console.warn(`${prefix} [${basename(file)}] ${message}`);
}

// ---------------------------------------------------------------------------
// Frontmatter parser (YAML between --- markers)
// ---------------------------------------------------------------------------
function parseFrontmatter(filePath: string): DocFrontmatter | null {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match || !match[1]) return null;
  try {
    return yaml.load(match[1]) as DocFrontmatter;
  } catch {
    warn(filePath, "YAML parse error in frontmatter");
    return null;
  }
}

function readBodyAfterFrontmatter(filePath: string): string {
  const content = readFileSync(filePath, "utf-8");
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

// ---------------------------------------------------------------------------
// Collect all docs
// ---------------------------------------------------------------------------
function glob(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...glob(full, ext));
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      results.push(full);
    }
  }
  return results;
}

export const adrFiles = glob(join(DOCS, "adr"), ".md").filter(
  (f) => !basename(f).startsWith("README") && !basename(f).startsWith("0001-example")
);
const questionFiles = glob(join(DOCS, "questions"), ".md");
export const decisionFiles = glob(join(DOCS, "decisions"), ".md");
const glossaryFiles = glob(join(DOCS, "glossary"), ".md");

// ---------------------------------------------------------------------------
// Check 1: ID uniqueness + no-skip across ADR / Q / DEC
// ---------------------------------------------------------------------------
function checkIdUniqueness(): void {
  const seen = new Map<string, string>(); // id → file
  const allDocs = [...adrFiles, ...questionFiles, ...decisionFiles];

  for (const file of allDocs) {
    const fm = parseFrontmatter(file);
    if (!fm?.id) {
      warn(file, "Missing frontmatter `id` field");
      continue;
    }
    const id = fm.id.toLowerCase();
    if (seen.has(id)) {
      warn(file, `Duplicate ID '${id}' — also in ${seen.get(id)}`);
    } else {
      seen.set(id, file);
    }
  }

  // Check for sequential gaps in ADR IDs (adr-NNNN)
  const adrIds = [...seen.entries()]
    .filter(([id]) => id.startsWith("adr-"))
    .map(([id]) => parseInt(id.replace("adr-", ""), 10))
    .filter((n) => !isNaN(n))
    .sort((a, b) => a - b);

  for (let i = 1; i < adrIds.length; i++) {
    const prev = adrIds[i - 1] ?? 0;
    const curr = adrIds[i] ?? 0;
    if (curr - prev > 1) {
      console.info(`ℹ INFO [adr/] Gap in ADR IDs: ${prev} → ${curr} (IDs ${prev + 1}–${curr - 1} missing)`);
    }
  }
}

// ---------------------------------------------------------------------------
// Check 2: Glossary term drift (Case 2 — ADR-0002)
// term_effects in Q/DEC must match what's in glossary term files.
// ---------------------------------------------------------------------------
function buildGlossaryTermSet(): Set<string> {
  const terms = new Set<string>();
  for (const file of glossaryFiles) {
    const fm = parseFrontmatter(file);
    if (fm?.id) terms.add(fm.id.toLowerCase().replace(/^term-/, "").replace(/-/g, "_"));
    // Also accept bare filename without extension
    terms.add(basename(file, ".md").replace(/-/g, "_"));
  }
  return terms;
}

function checkTermEffects(): void {
  const glossaryTerms = buildGlossaryTermSet();
  const allDocs = [...questionFiles, ...decisionFiles, ...adrFiles];

  for (const file of allDocs) {
    const fm = parseFrontmatter(file);
    if (!fm) continue;

    const effects = (fm.term_effects ?? []) as Array<{ term?: string; action?: string }>;
    for (const effect of effects) {
      if (!effect.term) {
        warn(file, "`term_effects[]` entry missing `term` field");
        continue;
      }
      const normalised = effect.term.toLowerCase().replace(/-/g, "_");
      if (!glossaryTerms.has(normalised)) {
        warn(file, `term_effects references term '${effect.term}' — no matching glossary file found (Case 2 drift risk)`);
      }
    }

    // reviewed_terms cross-check
    const reviewedTerms = (fm.reviewed_terms ?? []) as string[];
    for (const term of reviewedTerms) {
      const normalised = term.toLowerCase().replace(/-/g, "_");
      if (!glossaryTerms.has(normalised)) {
        warn(file, `reviewed_terms includes '${term}' — no matching glossary file found`, "info");
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Check 3: Scope creep detection (Case 1 — ADR-0002)
// If body text cites a namespace AND that namespace is in another ADR's scope.out,
// flag it as a potential scope creep.
// ---------------------------------------------------------------------------
function buildScopeOutMap(): Map<string, string[]> {
  const map = new Map<string, string[]>(); // namespace → [adr-id list that declared it out-of-scope]
  for (const file of adrFiles) {
    const fm = parseFrontmatter(file);
    const adrId = fm?.id ?? basename(file, ".md");
    for (const ns of fm?.scope?.out ?? []) {
      const existing = map.get(ns) ?? [];
      existing.push(adrId);
      map.set(ns, existing);
    }
  }
  return map;
}

function checkScopeCreep(): void {
  const scopeOutMap = buildScopeOutMap();
  const allDocs = [...questionFiles, ...decisionFiles, ...adrFiles];

  for (const file of allDocs) {
    const fm = parseFrontmatter(file);
    if (!fm) continue;

    const docId = fm.id ?? basename(file, ".md");
    const body = readBodyAfterFrontmatter(file);

    for (const [ns, adrIds] of scopeOutMap) {
      if (body.includes(ns)) {
        const selfAdr = adrIds.find((a) => a === docId);
        if (!selfAdr) {
          warn(
            file,
            `Body cites namespace '${ns}' which is declared out-of-scope by [${adrIds.join(", ")}] — potential scope creep (Case 1)`,
            "info"
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Check 4: Required frontmatter fields
// ---------------------------------------------------------------------------
function checkRequiredFields(): void {
  for (const file of adrFiles) {
    const fm = parseFrontmatter(file);
    if (!fm) continue;
    for (const field of ["id", "type", "status", "scope", "invariants"] as const) {
      if (fm[field] === undefined || fm[field] === null) {
        warn(file, `Missing required ADR field: '${field}'`);
      }
    }
  }

  for (const file of questionFiles) {
    const fm = parseFrontmatter(file);
    if (!fm) continue;
    for (const field of ["id", "type", "status"] as const) {
      if (fm[field] === undefined || fm[field] === null) {
        warn(file, `Missing required Q field: '${field}'`);
      }
    }
    if (!fm.unresolved_warnings) {
      warn(file, "Missing `unresolved_warnings` field (required for Q docs)", "info");
    }
  }

  for (const file of decisionFiles) {
    const fm = parseFrontmatter(file);
    if (!fm) continue;
    for (const field of ["id", "type", "status"] as const) {
      if (fm[field] === undefined || fm[field] === null) {
        warn(file, `Missing required DEC field: '${field}'`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Check 5: cross_ref_code reachability (DEC-020 Q-045 / INFRA-1A.9)
// ---------------------------------------------------------------------------
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isInsideRepo(filePart: string): boolean {
  if (isAbsolute(filePart)) return false;
  const joined = join(REPO_ROOT, filePart);
  const rel = relative(REPO_ROOT, joined);
  if (rel.startsWith("..") || isAbsolute(rel)) return false;
  if (rel === "") return false;
  if (joined !== REPO_ROOT && !joined.startsWith(REPO_ROOT + sep)) return false;

  // Canonicalize via realpathSync to defeat symlink escapes. Walk up to the
  // nearest existing ancestor so non-existing files don't crash this check
  // (they fail later at existsSync with a clearer warning).
  const canonicalRoot = (() => {
    try { return realpathSync(REPO_ROOT); } catch { return REPO_ROOT; }
  })();
  let probe = joined;
  let canonicalResolved: string | null = null;
  // Safety bound: REPO_ROOT length / 2 is a generous depth ceiling.
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
  if (canonicalResolved === null) {
    // No ancestor exists (extreme edge): rely on the syntactic check alone.
    return true;
  }
  return (
    canonicalResolved === canonicalRoot ||
    canonicalResolved.startsWith(canonicalRoot + sep)
  );
}

/**
 * Physical line count that matches `wc -l + 1 if file does not end with
 * newline` semantics — i.e., the number of addressable lines a human or
 * editor sees. `String#split("\n").length` overcounts by one when the
 * file is newline-terminated (the final split yields an empty element).
 * Codex PR #72 round 2 P2 (#1): pre-fix accepted `last_line + 1` as
 * in-range for newline-terminated files (which is most source code).
 */
export function physicalLineCount(code: string): number {
  if (code === "") return 0;
  const parts = code.split("\n");
  // If the file ends with `\n`, split produces one trailing empty entry;
  // drop it so the count matches the highest addressable line.
  if (parts.length > 0 && parts[parts.length - 1] === "") {
    return parts.length - 1;
  }
  return parts.length;
}

/**
 * Parse `export { ... }` re-export blocks and return the set of externally
 * importable names. Aliases follow `import-name as exported-name` — only the
 * right-hand side is importable from outside the module.
 * Codex PR #72 round 1 P2: pre-fix regex treated both sides of `foo as bar`
 * as valid, silently passing broken cross_ref_code entries.
 */
export function extractReExportedNames(code: string): Set<string> {
  // Codex PR #72 round 4 P2 (#1): pre-fix matched `export { ... }` blocks
  // in raw source text, so a snippet like `// export { internal as fakeName }`
  // would add `fakeName` to the importable set. Strip comments/strings first
  // (same defang as hasNamedDeclaration) so only real re-export blocks
  // contribute names.
  const stripped = stripCommentsAndStrings(code);
  const names = new Set<string>();
  const blockPattern = /\bexport\s*(?:type\s+)?\{([^}]*)\}/g;
  for (const match of stripped.matchAll(blockPattern)) {
    const body = match[1] ?? "";
    for (const rawEntry of body.split(",")) {
      // Strip an optional `type ` prefix on individual specifiers — TypeScript
      // 4.5+ allows `export { type Foo }` and `export { type Foo as Bar }` to
      // mark a single specifier as type-only inside a value re-export block.
      // Codex PR #72 round 2 P2 (#3): pre-fix dropped these specifiers and
      // emitted false `export not found` warnings for type-only re-exports.
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
      // Anything else (malformed entry) is silently skipped — the validator
      // does not own TypeScript syntax validation.
    }
  }
  return names;
}

/**
 * Match `export ... name` declarations including:
 *   - `export function name`, `export async function name`, `export function* name`,
 *     `export async function* name`
 *   - `export default function name`, `export default async function name`,
 *     `export default function* name`, `export default async function* name`
 *   - `export class name`, `export default class name`, `export abstract class name`
 *   - `export const|let|var name`, `export interface|type|enum name`
 * Codex PR #72 round 1 P2: pre-fix regex permitted only ONE modifier (async OR
 * default), missing `default async` and generator forms.
 */
/**
 * Strip comments, string literals, and regex literals from TS/JS source.
 * Codex PR #72 round 3 P2: pre-fix accepted `// export function foo` as
 * a real declaration.
 *
 * Codex PR #72 round 4 P2 (#3): pre-fix line-comment strip ran BEFORE
 * string literals, so a URL inside a string (`"http://example"`) had its
 * `//` interpreted as a comment start.
 *
 * Codex PR #72 round 5 P2 (#4): pre-fix block-comment strip ran BEFORE
 * string literals, so string content like `"/*" ... "*\/"` was misread as
 * a block-comment span and any real exports between those string literals
 * were deleted. New order: strings (template / double / single) → block
 * comments → line comments → regex literals. Strings go first so their
 * content (including `//`, `/*`, `*\/`) cannot be reinterpreted by later
 * passes.
 *
 * Codex PR #72 round 5 P2 (#1): pre-fix did not strip regex literals, so
 * `/export function ghostFn/` in source text would falsely satisfy a
 * `cross_ref_code` reference to `ghostFn`. We strip `\/.../<flags>` after
 * comments — without full token-stream context we cannot reliably
 * distinguish regex literals from division operators, so we use a
 * conservative heuristic: only strip when the opener is at start-of-line
 * or follows an operator/assignment token. This catches the common
 * "regex literal on its own line" case (the one Codex flagged) without
 * eating `a / b * c` arithmetic.
 */
export function stripCommentsAndStrings(code: string): string {
  return code
    .replace(/`(?:\\[\s\S]|\$\{[^}]*\}|[^`\\])*`/g, "``")
    .replace(/"(?:\\[\s\S]|[^"\\])*"/g, '""')
    .replace(/'(?:\\[\s\S]|[^'\\])*'/g, "''")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    // Regex literal heuristic: opener must be at start-of-line or follow
    // an operator/punctuator/keyword token. Avoids `a / b` matches.
    .replace(
      /(^|[\s=(,;:!&|?+\-*%<>{}[\]^~]|\breturn\b|\btypeof\b|\bin\b|\bof\b|\bvoid\b)(\/(?:\\[\s\S]|\[[^\]]*\]|[^/\n\\])+\/[gimsuyd]*)/g,
      "$1 "
    );
}

export function hasNamedDeclaration(code: string, name: string): boolean {
  const stripped = stripCommentsAndStrings(code);
  const escName = escapeRegex(name);
  // Codex PR #72 round 4 P2 (#2): JS regex `\b` only treats ASCII
  // [A-Za-z0-9_] as word characters, so identifiers ending in `$` or
  // containing non-ASCII letters (e.g. `한글`) failed the trailing
  // boundary check and were reported as `export not found` even when
  // genuinely exported. Replace the trailing `\b` with a negative
  // lookahead that excludes any character JS allows as an identifier
  // continuation (ASCII word chars + `$`). The leading position is
  // already anchored to whitespace via the preceding `\s+`, so a
  // single trailing terminator check is sufficient.
  // Codex PR #72 round 5 P3 (#3): the ASCII-only negative lookahead
  // `(?![A-Za-z0-9_$])` still let a non-ASCII target (`한글`) match a
  // longer identifier (`한글가`) because the trailing `가` was not in the
  // ASCII set. The lookahead is now Unicode-aware via `\p{ID_Continue}`,
  // which covers every code point JS treats as an identifier continuation,
  // plus `$` since ID_Continue technically excludes it.
  const tail = `(?![\\p{ID_Continue}$])`;
  // function declarations (with optional default/async modifiers, generator `*`)
  const fnPattern = new RegExp(
    `\\bexport\\s+(?:default\\s+)?(?:async\\s+)?function\\s*\\*?\\s+${escName}${tail}`,
    "u"
  );
  if (fnPattern.test(stripped)) return true;
  // class declarations (with optional default/abstract modifiers)
  const classPattern = new RegExp(
    `\\bexport\\s+(?:default\\s+)?(?:abstract\\s+)?class\\s+${escName}${tail}`,
    "u"
  );
  if (classPattern.test(stripped)) return true;
  // simple keyword declarations
  const keywordPattern = new RegExp(
    `\\bexport\\s+(?:const|let|var|interface|type|enum)\\s+${escName}${tail}`,
    "u"
  );
  return keywordPattern.test(stripped);
}

/**
 * Single-ref validation extracted from `checkCrossRefCode` so external
 * callers (the test suite) can exercise the exact production logic
 * instead of reimplementing it. Codex PR #72 round 3 P2: pre-extract
 * the test file mirrored helpers — a shared mistake on both sides could
 * pass green tests while regressing production. Returns ok/false with a
 * human-readable reason for the warning path.
 */
export function checkOneCrossRef(
  ref: unknown
): { ok: true } | { ok: false; reason: string } {
  // Codex PR #72 round 5 P1 (#2): YAML scalars are not guaranteed to be
  // strings. A numeric or object-typed entry (`cross_ref_code: [123]`)
  // hit `ref.lastIndexOf` and threw, aborting the entire validator and
  // violating the INV-0002-1 warning-only contract. Type-guard at the
  // entry so non-string scalars surface as warnings instead of crashes.
  if (typeof ref !== "string") {
    return { ok: false, reason: `not a string scalar (got ${typeof ref})` };
  }
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
  let code: string;
  try {
    code = readFileSync(fullPath, "utf-8");
  } catch {
    return { ok: false, reason: `file unreadable: ${filePart}` };
  }
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

export function checkCrossRefCode(): void {
  for (const file of [...adrFiles, ...decisionFiles]) {
    const fm = parseFrontmatter(file);
    if (!fm?.invariants) continue;
    for (const inv of fm.invariants) {
      // Codex PR #72 round 5 P1 (#2): defensive cast — YAML may yield
      // any type. `checkOneCrossRef` itself type-guards so we forward
      // each entry as `unknown` and let the helper produce a structured
      // warning instead of throwing on `.lastIndexOf` of a non-string.
      const refs = (inv.cross_ref_code ?? []) as unknown[];
      if (refs.length === 0) continue;
      for (const ref of refs) {
        const result = checkOneCrossRef(ref);
        if (!result.ok) {
          const refRepr = typeof ref === "string" ? ref : JSON.stringify(ref);
          warn(file, `${inv.id} cross_ref_code ${result.reason}: ${refRepr}`);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Generate artifacts (--regenerate)
// ---------------------------------------------------------------------------
function generateArtifacts(): void {
  if (!existsSync(GENERATED)) mkdirSync(GENERATED, { recursive: true });

  // scope_tree.yaml — namespace tree from all ADR scope.in
  const scopeTree: Record<string, string[]> = {};
  for (const file of adrFiles) {
    const fm = parseFrontmatter(file);
    const adrId = fm?.id ?? basename(file, ".md");
    for (const ns of fm?.scope?.in ?? []) {
      const top = ns.split(".")[0] ?? ns;
      scopeTree[top] = scopeTree[top] ?? [];
      if (!scopeTree[top]?.includes(ns)) scopeTree[top]?.push(ns);
    }
    void adrId;
  }
  writeFileSync(join(GENERATED, "scope_tree.yaml"), yaml.dump({ scope_tree: scopeTree }));
  console.log("[regen] wrote docs/_generated/scope_tree.yaml");

  // term_usage.yaml — per-term usage in reviewed_terms across all docs
  const termUsage: Record<string, number> = {};
  for (const file of [...adrFiles, ...questionFiles, ...decisionFiles]) {
    const fm = parseFrontmatter(file);
    for (const term of fm?.reviewed_terms ?? []) {
      termUsage[term] = (termUsage[term] ?? 0) + 1;
    }
  }
  writeFileSync(join(GENERATED, "term_usage.yaml"), yaml.dump({ term_usage: termUsage }));
  console.log("[regen] wrote docs/_generated/term_usage.yaml");

  // effective_invariant_policy.yaml — merged invariant list from all active ADRs
  const invariants: Array<{ id: string; adr: string; statement: string; status: string }> = [];
  for (const file of adrFiles) {
    const fm = parseFrontmatter(file);
    if (!fm?.invariants) continue;
    const adrId = fm.id ?? basename(file, ".md");
    for (const inv of fm.invariants) {
      invariants.push({ id: inv.id, adr: adrId, statement: inv.statement, status: inv.status });
    }
  }
  writeFileSync(
    join(GENERATED, "effective_invariant_policy.yaml"),
    yaml.dump({ invariants })
  );
  console.log("[regen] wrote docs/_generated/effective_invariant_policy.yaml");
}

// ---------------------------------------------------------------------------
// Fixture tests (--fixture)
// ---------------------------------------------------------------------------
function runFixture(name: string): void {
  if (name === "scope-creep") {
    // Fixture: a synthetic doc that uses a namespace declared out-of-scope
    console.log("[fixture:scope-creep] scanning for scope-out namespace citations in body text...");
    checkScopeCreep();
    console.log("[fixture:scope-creep] complete");
  } else if (name === "glossary-drift") {
    console.log("[fixture:glossary-drift] scanning for term_effects → glossary drift...");
    checkTermEffects();
    console.log("[fixture:glossary-drift] complete");
  } else {
    console.warn(`Unknown fixture name: '${name}'. Available: scope-creep, glossary-drift`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main(): void {
  if (MODE_CI) console.log("[ci] Annotation-only mode — no files will be modified.");

  if (MODE_FIXTURE && fixtureName) {
    runFixture(fixtureName);
  } else {
    checkRequiredFields();
    checkIdUniqueness();
    checkTermEffects();
    checkScopeCreep();
    checkCrossRefCode();

    if (MODE_REGEN && !MODE_CI) generateArtifacts();

    const errors = warnings.filter((w) => w.severity === "error").length;
    const warns = warnings.filter((w) => w.severity === "warning").length;
    const infos = warnings.filter((w) => w.severity === "info").length;

    console.log(`\nInvariant check complete: ${errors} errors, ${warns} warnings, ${infos} infos.`);
    if (warnings.length === 0) console.log("✓ All checks passed.");
  }

  // Always exit 0 — warning level only (INV-0002-1)
  process.exit(0);
}

if (import.meta.main) {
  main();
}
