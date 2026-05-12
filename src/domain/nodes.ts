/**
 * TypeScript interfaces for Neo4j graph node property schemas.
 * These are informational overlays — Neo4j is schema-optional for properties.
 * Uniqueness constraints and required fields are enforced by v1_schema.cypher.
 * ADR-0011, ADR-0019, ADR-0025
 */

import type { ThesisStance, ThesisMarketStance, SourcePerspective } from "../utils/enums";

// ---------------------------------------------------------------------------
// Source (ADR-0011, ADR-0016, ADR-0019)
// ---------------------------------------------------------------------------
export interface SourceNode {
  source_id: string;           // `src_<ULID>`
  name: string;
  url: string;
  reliability_tier: number;    // 0-3 (INV-0011-2)
  collectability_score: number; // 0-1 (ADR-0016)
  source_perspective: SourcePerspective; // AC-027: risk≤50%, opportunity≥25%, neutral≥15%
  archive_policy: string;
  raw_cloud_policy: string;
  external_llm_policy: string;
  created_at: string;          // ISO 8601 datetime
}

// ---------------------------------------------------------------------------
// Scenario (ADR-0009, ADR-0019, AC-026)
// ---------------------------------------------------------------------------
export interface ScenarioNode {
  scenario_id: string;                  // `scn_<ULID>`
  title: string;
  summary: string;
  assumptions_json: string;            // JSON array (ADR-0009)
  branches_json: string;               // JSON array
  falsifiers_json: string;
  counterclaims_json: string;
  monitoring_signals_json: string;
  horizon: string;                     // Q-001 (open: enum TBD)
  meta_category: string;
  impact_targets: string;              // JSON array of target labels (AC-026)
  impact_direction_by_target: string;  // JSON dict: target → upside|downside|mixed|neutral (REQ-021 AC-026)
  transmission_channels: string;       // JSON array of channel labels (AC-026)
  created_at: string;                  // ISO 8601 datetime
}

// ---------------------------------------------------------------------------
// Thesis (ADR-0019, AC-026)
// ---------------------------------------------------------------------------
export interface ThesisNode {
  thesis_id: string;           // `ths_<ULID>`
  eit_id: string;              // FK to EditorialIntent
  statement: string;
  summary: string;
  stance: ThesisStance;        // AC-026: constructive|cautionary|neutral|mixed|asymmetric|exploratory
  market_stance?: ThesisMarketStance; // optional (ADR-0019)
  created_at: string;          // ISO 8601 datetime
  run_id: string;
}
