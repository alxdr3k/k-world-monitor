/**
 * Source registry seed — INFRA-1B.1
 * Parses data/sources_seed.yaml, validates enums, and upserts rows into:
 *   SQLite:  source_material_policy (policy fields)
 * Generates src_<ULID> IDs keyed on slug for stable, idempotent re-runs.
 * Does NOT write to Neo4j — that layer is INFRA-1B.2+.
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

function validateSource(s: SeedSource): void {
  if (!isSourcePerspective(s.source_perspective))
    throw new SeedValidationError(s.slug, "source_perspective", s.source_perspective);
  if (!isArchivePolicy(s.archive_policy))
    throw new SeedValidationError(s.slug, "archive_policy", s.archive_policy);
  if (!isRawCloudPolicy(s.raw_cloud_policy))
    throw new SeedValidationError(s.slug, "raw_cloud_policy", s.raw_cloud_policy);
  if (!isExternalLlmPolicy(s.external_llm_policy))
    throw new SeedValidationError(s.slug, "external_llm_policy", s.external_llm_policy);
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
  action: "inserted" | "skipped";
}

export interface SeedResult {
  rows: SeedRow[];
  inserted: number;
  skipped: number;
}

// ---------------------------------------------------------------------------
// Core seed function
// ---------------------------------------------------------------------------

export function seedSources(opts: { dryRun?: boolean; dataRoot?: string } = {}): SeedResult {
  const dataRoot = opts.dataRoot ?? join(process.cwd(), "data");
  const seedPath = join(dataRoot, "sources_seed.yaml");

  const raw = readFileSync(seedPath, "utf-8");
  const parsed = yamlLoad(raw) as SeedFile;
  const sources = parsed.sources;

  // Validate all sources before any DB writes
  for (const s of sources) {
    validateSource(s);
  }

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
    return { rows, inserted: rows.length, skipped: 0 };
  }

  const db = getDb();
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  // Ensure slug→source_id mapping table exists for idempotency
  db.run(`
    CREATE TABLE IF NOT EXISTS source_registry_slug_map (
      slug      TEXT PRIMARY KEY,
      source_id TEXT NOT NULL
    )
  `);

  const getIdBySlug = db.query<{ source_id: string }, [string]>(
    "SELECT source_id FROM source_registry_slug_map WHERE slug = ?"
  );

  const insertSlugMap = db.prepare(
    "INSERT OR IGNORE INTO source_registry_slug_map (slug, source_id) VALUES (?, ?)"
  );

  const insertPolicy = db.prepare(`
    INSERT OR IGNORE INTO source_material_policy
      (source_id, archive_policy, raw_cloud_policy, external_llm_policy, checked_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const rows: SeedRow[] = [];

  const runAll = db.transaction(() => {
    for (const s of sources) {
      const existing = getIdBySlug.get(s.slug);
      if (existing) {
        rows.push({
          source_id: existing.source_id,
          slug: s.slug,
          name: s.name,
          archive_policy: s.archive_policy,
          raw_cloud_policy: s.raw_cloud_policy,
          external_llm_policy: s.external_llm_policy,
          action: "skipped",
        });
        continue;
      }

      const source_id = `src_${ulid()}`;
      insertSlugMap.run(s.slug, source_id);
      insertPolicy.run(
        source_id,
        s.archive_policy,
        s.raw_cloud_policy,
        s.external_llm_policy,
        now
      );
      rows.push({
        source_id,
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
  const skipped = rows.filter((r) => r.action === "skipped").length;
  return { rows, inserted, skipped };
}
