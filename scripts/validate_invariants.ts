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

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "fs";
import { join, basename } from "path";

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
  invariants?: Array<{ id: string; statement: string; status: string }>;
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

const adrFiles = glob(join(DOCS, "adr"), ".md").filter(
  (f) => !basename(f).startsWith("README") && !basename(f).startsWith("0001-example")
);
const questionFiles = glob(join(DOCS, "questions"), ".md");
const decisionFiles = glob(join(DOCS, "decisions"), ".md");
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

main();
