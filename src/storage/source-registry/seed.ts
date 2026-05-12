/**
 * Source registry seed — INFRA-1B.1
 * Parses data/sources_seed.yaml, validates enums, and upserts rows into:
 *   SQLite:  source_material_policy (policy fields)
 * Generates src_<ULID> IDs keyed on slug for stable, idempotent re-runs.
 * Does NOT write to Neo4j — that layer is INFRA-1B.2+.
 *
 * Idempotency contract:
 *   - New slug   → assign src_<ULID>, INSERT slug map + UPSERT policy → action:"inserted"
 *   - Known slug → reuse existing source_id, UPSERT policy fields    → action:"updated"
 * Re-running the seed always propagates policy field changes from the YAML.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { load as yamlLoad } from "js-yaml";
import { monotonicFactory } from "ulid";
import { getDb } from "../sqlite/connection";
import {
  isArchivePolicy,
  isRawCloudPolicy,
  isExternalLlmPolicy,
  isSourcePerspective,
} from "../../utils/enums";

const ulid = monotonicFactory();

// ---------------------------------------------------------------------------
// YAML schema types
// ---------------------------------------------------------------------------

interface SeedCollectability {
  automation_reliability: number;
  legal_policy_clarity: number;
  anti_bot_friction: string;
  preferred_mode: string;
}

interface SeedSource {
  slug: string;
  name: string;
  publisher: string;
  url: string;
  rss_url?: string;
  api_base?: string;
  access_method: string;
  reliability_tier: number;
  source_perspective: string;
  meta_category: string;
  subtopic_tags: string[];
  collectability: SeedCollectability;
  archive_policy: string;
  raw_cloud_policy: string;
  external_llm_policy: string;
  notes?: string;
}

interface SeedFile {
  sources: SeedSource[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export class SeedValidationError extends Error {
  constructor(slug: string, field: string, value: unknown) {
    super(`Seed validation failed for "${slug}".${field}: invalid value "${value}"`);
    this.name = "SeedValidationError";
  }
}

const ALLOWED_SCHEMES = new Set(["https:", "http:"]);

function validateWebUrl(slug: string, field: string, value: string): void {
  let parsed: URL;
  try { parsed = new URL(value); } catch {
    throw new SeedValidationError(slug, field, value);
  }
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new SeedValidationError(slug, field, `non-web scheme: ${parsed.protocol}`);
  }
}

function validateSource(s: SeedSource): void {
  // Required string fields (data quality guard — catch undefined before DB write)
  for (const field of ["name", "publisher", "access_method", "meta_category"] as const) {
    if (typeof s[field] !== "string" || (s[field] as string).length === 0)
      throw new SeedValidationError(s.slug, field, s[field]);
  }
  if (!isSourcePerspective(s.source_perspective))
    throw new SeedValidationError(s.slug, "source_perspective", s.source_perspective);
  if (!isArchivePolicy(s.archive_policy))
    throw new SeedValidationError(s.slug, "archive_policy", s.archive_policy);
  if (!isRawCloudPolicy(s.raw_cloud_policy))
    throw new SeedValidationError(s.slug, "raw_cloud_policy", s.raw_cloud_policy);
  if (!isExternalLlmPolicy(s.external_llm_policy))
    throw new SeedValidationError(s.slug, "external_llm_policy", s.external_llm_policy);
  validateWebUrl(s.slug, "url", s.url);
  if (s.rss_url !== undefined) validateWebUrl(s.slug, "rss_url", s.rss_url);
  if (s.api_base !== undefined) validateWebUrl(s.slug, "api_base", s.api_base);
}

// ---------------------------------------------------------------------------
// Seed result
// ---------------------------------------------------------------------------

export interface SeedRow {
  source_id: string;
  slug: string;
  name: string;
  archive_policy: string;
  raw_cloud_policy: string;
  external_llm_policy: string;
  /** inserted = new source; updated = existing slug, policy re-applied */
  action: "inserted" | "updated";
}

export interface SeedResult {
  rows: SeedRow[];
  inserted: number;
  updated: number;
}

// ---------------------------------------------------------------------------
// Core seed function
// ---------------------------------------------------------------------------

export function seedSources(opts: { dryRun?: boolean; dataRoot?: string } = {}): SeedResult {
  const dataRoot = opts.dataRoot ?? join(process.cwd(), "data");
  const seedPath = join(dataRoot, "sources_seed.yaml");

  const raw = readFileSync(seedPath, "utf-8");
  const parsed = yamlLoad(raw);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as Record<string, unknown>)["sources"])
  ) {
    throw new Error(
      `sources_seed.yaml must be an object with a sources array (got ${parsed === null ? "null" : typeof parsed})`
    );
  }
  const sources = (parsed as SeedFile).sources;

  // Validate all sources and check slug uniqueness before any DB writes
  const slugsSeen = new Set<string>();
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    if (s === null || typeof s !== "object" || typeof (s as unknown as Record<string, unknown>)["slug"] !== "string") {
      throw new SeedValidationError(`index[${i}]`, "shape", `expected object with slug string, got ${JSON.stringify(s)}`);
    }
    const slug = (s as SeedSource).slug;
    if (slug.length === 0) {
      throw new SeedValidationError(`index[${i}]`, "slug", "empty slug is not allowed");
    }
    if (slugsSeen.has(slug)) {
      throw new SeedValidationError(slug, "slug", `duplicate slug in sources_seed.yaml`);
    }
    slugsSeen.add(slug);
    validateSource(s as SeedSource);
  }

  // Dry-run: validate + preview without DB access (assumes fresh DB — all rows shown as inserted)
  if (opts.dryRun) {
    const rows: SeedRow[] = sources.map((s) => ({
      source_id: `src_${ulid()}`,
      slug: s.slug,
      name: s.name,
      archive_policy: s.archive_policy,
      raw_cloud_policy: s.raw_cloud_policy,
      external_llm_policy: s.external_llm_policy,
      action: "inserted" as const,
    }));
    return { rows, inserted: rows.length, updated: 0 };
  }

  const db = getDb();
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  // Fail fast with actionable message if migrations have not been run
  const policyTableExists = db.query<{ name: string }, []>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='source_material_policy'"
  ).get();
  if (!policyTableExists) {
    throw new Error(
      "source_material_policy table not found. Run migrations first: bun run migrate:sqlite"
    );
  }

  // Fail fast if slug-map migration has not been applied (DEC-015: DDL lives in v3 migration)
  const slugMapTableExists = db.query<{ name: string }, []>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='source_registry_slug_map'"
  ).get();
  if (!slugMapTableExists) {
    throw new Error(
      "source_registry_slug_map table not found. Run migrations first: bun run migrate:sqlite"
    );
  }

  const getIdBySlug = db.query<{ source_id: string }, [string]>(
    "SELECT source_id FROM source_registry_slug_map WHERE slug = ?"
  );

  const insertSlugMap = db.prepare(
    "INSERT OR IGNORE INTO source_registry_slug_map (slug, source_id) VALUES (?, ?)"
  );

  // Upsert policy fields so re-runs propagate YAML changes to existing rows.
  // updated_at is explicitly set on UPDATE because SQLite DEFAULT only fires on INSERT.
  const upsertPolicy = db.prepare(`
    INSERT INTO source_material_policy
      (source_id, archive_policy, raw_cloud_policy, external_llm_policy, checked_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET
      archive_policy      = excluded.archive_policy,
      raw_cloud_policy    = excluded.raw_cloud_policy,
      external_llm_policy = excluded.external_llm_policy,
      checked_at          = excluded.checked_at,
      updated_at          = strftime('%Y-%m-%dT%H:%M:%SZ','now')
  `);

  const rows: SeedRow[] = [];

  const runAll = db.transaction(() => {
    for (const s of sources) {
      const existing = getIdBySlug.get(s.slug);
      if (existing) {
        // Slug already mapped — re-apply policy fields in case YAML changed
        upsertPolicy.run(
          existing.source_id,
          s.archive_policy,
          s.raw_cloud_policy,
          s.external_llm_policy,
          now
        );
        rows.push({
          source_id: existing.source_id,
          slug: s.slug,
          name: s.name,
          archive_policy: s.archive_policy,
          raw_cloud_policy: s.raw_cloud_policy,
          external_llm_policy: s.external_llm_policy,
          action: "updated",
        });
        continue;
      }

      const generated_id = `src_${ulid()}`;
      insertSlugMap.run(s.slug, generated_id);
      // Re-read canonical ID: if INSERT was ignored (concurrent seeder race),
      // use the already-mapped ID to avoid orphan policy rows.
      const canonical = getIdBySlug.get(s.slug)!;
      upsertPolicy.run(
        canonical.source_id,
        s.archive_policy,
        s.raw_cloud_policy,
        s.external_llm_policy,
        now
      );
      rows.push({
        source_id: canonical.source_id,
        slug: s.slug,
        name: s.name,
        archive_policy: s.archive_policy,
        raw_cloud_policy: s.raw_cloud_policy,
        external_llm_policy: s.external_llm_policy,
        action: "inserted",
      });
    }
  });

  runAll();

  const inserted = rows.filter((r) => r.action === "inserted").length;
  const updated = rows.filter((r) => r.action === "updated").length;
  return { rows, inserted, updated };
}
