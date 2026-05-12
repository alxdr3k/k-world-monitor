// =============================================================================
// k-world-monitor — Neo4j graph schema v1
// ADR-0011 (object model), ADR-0012 (storage split), ADR-0013 (edge ledger),
// ADR-0014 (native features), ADR-0017 (access_interventions),
// ADR-0018 (manual_claim_entry), ADR-0025 (editorial_intent 10-stage)
// Q-024 resolved: v0 = APOC standard + Cypher 5.x core only
// =============================================================================

// --- Node uniqueness constraints -------------------------------------------
// Each constraint also creates a supporting b-tree index.

CREATE CONSTRAINT source_unique IF NOT EXISTS
FOR (n:Source) REQUIRE n.source_id IS UNIQUE;

CREATE CONSTRAINT document_unique IF NOT EXISTS
FOR (n:Document) REQUIRE n.doc_id IS UNIQUE;

CREATE CONSTRAINT snapshot_unique IF NOT EXISTS
FOR (n:Snapshot) REQUIRE n.snap_id IS UNIQUE;

CREATE CONSTRAINT claim_unique IF NOT EXISTS
FOR (n:Claim) REQUIRE n.claim_id IS UNIQUE;

CREATE CONSTRAINT dossier_unique IF NOT EXISTS
FOR (n:Dossier) REQUIRE n.dossier_id IS UNIQUE;

CREATE CONSTRAINT scenario_unique IF NOT EXISTS
FOR (n:Scenario) REQUIRE n.scenario_id IS UNIQUE;

CREATE CONSTRAINT scenario_revision_unique IF NOT EXISTS
FOR (n:ScenarioRevision) REQUIRE n.revision_id IS UNIQUE;

CREATE CONSTRAINT editorial_intent_unique IF NOT EXISTS
FOR (n:EditorialIntent) REQUIRE n.eit_id IS UNIQUE;

CREATE CONSTRAINT thesis_unique IF NOT EXISTS
FOR (n:Thesis) REQUIRE n.thesis_id IS UNIQUE;

CREATE CONSTRAINT content_draft_unique IF NOT EXISTS
FOR (n:ContentDraft) REQUIRE n.draft_id IS UNIQUE;

CREATE CONSTRAINT publication_unique IF NOT EXISTS
FOR (n:Publication) REQUIRE n.pub_id IS UNIQUE;

CREATE CONSTRAINT access_intervention_unique IF NOT EXISTS
FOR (n:AccessIntervention) REQUIRE n.intervention_id IS UNIQUE;

CREATE CONSTRAINT manual_claim_entry_unique IF NOT EXISTS
FOR (n:ManualClaimEntry) REQUIRE n.manual_claim_id IS UNIQUE;

// --- Node property existence constraints ------------------------------------
// Enforce required fields at DB level for core entities.

CREATE CONSTRAINT source_id_exists IF NOT EXISTS
FOR (n:Source) REQUIRE n.source_id IS NOT NULL;

CREATE CONSTRAINT claim_lifecycle_exists IF NOT EXISTS
FOR (n:Claim) REQUIRE n.lifecycle_state IS NOT NULL;

CREATE CONSTRAINT editorial_intent_operator_lock_exists IF NOT EXISTS
FOR (n:EditorialIntent) REQUIRE n.decided_by_operator IS NOT NULL;

// --- Edge UNIQUE constraint (ADR-0013) --------------------------------------
// Prevents duplicate semantic edges between same pair with same scope.
// Applies to the 5 v0 relation types.
// NOTE: r.from_id / r.to_id are denormalized properties on each relationship
// (the source/target node IDs), required by the uniqueness constraint.
// Application code must always set these when creating edges.

CREATE CONSTRAINT edge_supports_unique IF NOT EXISTS
FOR ()-[r:SUPPORTS]-()
REQUIRE (r.from_id, r.to_id, r.scope) IS UNIQUE;

CREATE CONSTRAINT edge_contradicts_unique IF NOT EXISTS
FOR ()-[r:CONTRADICTS]-()
REQUIRE (r.from_id, r.to_id, r.scope) IS UNIQUE;

CREATE CONSTRAINT edge_qualifies_unique IF NOT EXISTS
FOR ()-[r:QUALIFIES]-()
REQUIRE (r.from_id, r.to_id, r.scope) IS UNIQUE;

CREATE CONSTRAINT edge_updates_unique IF NOT EXISTS
FOR ()-[r:UPDATES]-()
REQUIRE (r.from_id, r.to_id, r.scope) IS UNIQUE;

CREATE CONSTRAINT edge_supersedes_unique IF NOT EXISTS
FOR ()-[r:SUPERSEDES]-()
REQUIRE (r.from_id, r.to_id, r.scope) IS UNIQUE;

// --- Additional indexes (lookup performance) --------------------------------

CREATE INDEX source_name_idx IF NOT EXISTS FOR (n:Source) ON (n.name);
CREATE INDEX source_reliability_tier_idx IF NOT EXISTS FOR (n:Source) ON (n.reliability_tier);
CREATE INDEX source_collectability_score_idx IF NOT EXISTS FOR (n:Source) ON (n.collectability_score);

CREATE INDEX document_source_fk_idx IF NOT EXISTS FOR (n:Document) ON (n.source_id);
CREATE INDEX document_published_at_idx IF NOT EXISTS FOR (n:Document) ON (n.published_at);

CREATE INDEX snapshot_url_idx IF NOT EXISTS FOR (n:Snapshot) ON (n.url);
CREATE INDEX snapshot_content_hash_idx IF NOT EXISTS FOR (n:Snapshot) ON (n.content_hash);
CREATE INDEX snapshot_accessed_at_idx IF NOT EXISTS FOR (n:Snapshot) ON (n.accessed_at);

CREATE INDEX claim_lifecycle_state_idx IF NOT EXISTS FOR (n:Claim) ON (n.lifecycle_state);
CREATE INDEX claim_source_id_idx IF NOT EXISTS FOR (n:Claim) ON (n.source_id);
CREATE INDEX claim_created_at_idx IF NOT EXISTS FOR (n:Claim) ON (n.created_at);

CREATE INDEX scenario_created_at_idx IF NOT EXISTS FOR (n:Scenario) ON (n.created_at);
CREATE INDEX thesis_created_at_idx IF NOT EXISTS FOR (n:Thesis) ON (n.created_at);
CREATE INDEX thesis_stance_idx IF NOT EXISTS FOR (n:Thesis) ON (n.stance);
CREATE INDEX source_perspective_idx IF NOT EXISTS FOR (n:Source) ON (n.source_perspective);

CREATE INDEX access_intervention_status_idx IF NOT EXISTS FOR (n:AccessIntervention) ON (n.status);
CREATE INDEX access_intervention_severity_idx IF NOT EXISTS FOR (n:AccessIntervention) ON (n.severity);
CREATE INDEX access_intervention_session_id_idx IF NOT EXISTS FOR (n:AccessIntervention) ON (n.session_id);

CREATE INDEX manual_claim_entry_session_id_idx IF NOT EXISTS FOR (n:ManualClaimEntry) ON (n.session_id);

// --- Full-text search indexes (ADR-0014, SPIKE-001) -------------------------
// Native Lucene FTS. analyzer=english for graph-object keyword search.
// Q-024 resolved: Cypher 5.x SHOW FULLTEXT INDEXES / CREATE FULLTEXT INDEX allowed.

CREATE FULLTEXT INDEX claim_fts IF NOT EXISTS
FOR (n:Claim)
ON EACH [n.statement, n.summary]
OPTIONS {
  indexConfig: {
    `fulltext.analyzer`: "english",
    `fulltext.eventually_consistent`: false
  }
};

CREATE FULLTEXT INDEX source_fts IF NOT EXISTS
FOR (n:Source)
ON EACH [n.name, n.description, n.url]
OPTIONS {
  indexConfig: {
    `fulltext.analyzer`: "english",
    `fulltext.eventually_consistent`: false
  }
};

CREATE FULLTEXT INDEX document_fts IF NOT EXISTS
FOR (n:Document)
ON EACH [n.title, n.summary]
OPTIONS {
  indexConfig: {
    `fulltext.analyzer`: "english",
    `fulltext.eventually_consistent`: false
  }
};

CREATE FULLTEXT INDEX scenario_fts IF NOT EXISTS
FOR (n:Scenario)
ON EACH [n.title, n.summary, n.assumptions_json]
OPTIONS {
  indexConfig: {
    `fulltext.analyzer`: "english",
    `fulltext.eventually_consistent`: false
  }
};

CREATE FULLTEXT INDEX thesis_fts IF NOT EXISTS
FOR (n:Thesis)
ON EACH [n.statement, n.summary]
OPTIONS {
  indexConfig: {
    `fulltext.analyzer`: "english",
    `fulltext.eventually_consistent`: false
  }
};

// --- Node property schemas (informational comments only) --------------------
// Neo4j is schema-optional for properties; constraints above enforce IDs.
// Full property definitions live in docs/current/DATA_MODEL.md.

// Source {
//   source_id: string,            // `src_<ULID>`
//   name: string,
//   url: string,
//   reliability_tier: integer,    // 0-3 (ADR-0011 INV-0011-2)
//   collectability_score: float,  // 0-1 (ADR-0016)
//   source_perspective: string,   // risk_observer|opportunity_observer|neutral|mixed (ADR-0019 REQ-022)
//   archive_policy: string,       // metadata_only|excerpt_only|full_snapshot_allowed|do_not_collect
//   raw_cloud_policy: string,     // always_prohibited|allowed_public_data_only
//   external_llm_policy: string,  // allowed|manual_review_required|prohibited
//   created_at: datetime
// }

// Document {
//   doc_id: string,               // `doc_<ULID>`
//   source_id: string,            // FK to Source
//   url: string,
//   canonical_url: string,
//   title: string,
//   published_at: datetime,
//   language: string,
//   meta_category: string,        // 정책|경제|사회|대중문화 (DEC-004)
//   created_at: datetime
// }

// Snapshot {
//   snap_id: string,              // `snap_<ULID>`
//   doc_id: string,               // FK to Document
//   url: string,
//   accessed_at: datetime,
//   content_hash: string,         // sha256 hex (ADR-0012)
//   locator: string,              // page/section/line
//   mime: string,
//   byte_size: integer,
//   r2_key: string,               // null for most snapshots (ADR-0012 INV-0012-3 exception only)
//   created_at: datetime
// }

// Claim {
//   claim_id: string,             // `clm_<ULID>`
//   source_id: string,
//   snap_id: string,
//   statement: string,
//   summary: string,
//   lifecycle_state: string,      // draft|confirmed|disputed|stale|retracted|source_changed|source_unavailable|needs_recorroboration (ADR-0011 INV-0011-5)
//   extraction_confidence: float, // 0-1
//   evidence_json: string,        // JSON: quote, attribution, provenance
//   created_at: datetime,
//   updated_at: datetime,
//   run_id: string                // FK to run_ledger
// }

// Dossier {
//   dossier_id: string,           // `dos_<ULID>`
//   title: string,
//   topic: string,
//   created_at: datetime,
//   updated_at: datetime
// }

// Scenario {
//   scenario_id: string,                      // `scn_<ULID>`
//   title: string,
//   summary: string,
//   assumptions_json: string,                 // JSON array (ADR-0009)
//   branches_json: string,                    // JSON array
//   falsifiers_json: string,
//   counterclaims_json: string,
//   monitoring_signals_json: string,
//   horizon: string,                          // Q-001 (open: enum TBD)
//   meta_category: string,
//   impact_targets: string,                   // JSON array of target labels (ADR-0019 AC-026)
//   impact_direction_by_target: string,       // JSON dict target→upside|downside|mixed|neutral (REQ-021 AC-026)
//   transmission_channels: string,            // JSON array of channel labels (AC-026)
//   created_at: datetime
// }

// ScenarioRevision {
//   revision_id: string,          // `scn_<id>_r<n>` (ADR-0009)
//   scenario_id: string,
//   revision_no: integer,
//   created_at: datetime,
//   created_by: string,           // run_id or "user"
//   body_snapshot: string,        // JSON serialized scenario body
//   change_summary: string
// }

// EditorialIntent {
//   eit_id: string,               // `eit_<sha256[0:10]>` (ADR-0025)
//   purpose: string,
//   audience: string,
//   tone: string,                 // informational|cautionary|explainer|opinion|debate_trigger
//   call_to_action: string,
//   alignment_criteria_json: string,
//   exclusion_criteria_json: string,
//   bidirectional_weight_intent: string, // risk_observer|opportunity_observer|resilience|asymmetric|balanced
//   related_dossier_ids_json: string,
//   related_scenario_revision_ids_json: string,
//   decided_by_operator: boolean, // INV-0025-4: ContentDraft rejected if false
//   created_at: datetime
// }

// Thesis {
//   thesis_id: string,            // `ths_<ULID>`
//   eit_id: string,               // FK to EditorialIntent
//   statement: string,
//   summary: string,
//   stance: string,               // ADR-0019
//   market_stance: string,        // optional, ADR-0019
//   created_at: datetime,
//   run_id: string
// }

// ContentDraft {
//   draft_id: string,             // `drf_<ULID>`
//   thesis_id: string,
//   eit_id: string,               // FK to EditorialIntent (INV-0025-5)
//   format: string,               // blog_long|youtube_long|shorts|newsletter (v0=blog_long only, DEC-005)
//   status: string,               // draft|reviewing|ready|published|dropped
//   body_path: string,            // vault relative path
//   cite_check_passed: boolean,
//   created_at: datetime
// }

// Publication {
//   pub_id: string,               // `pub_<ULID>`
//   draft_id: string,
//   thesis_id: string,
//   eit_id: string,
//   status: string,               // live|corrected|retracted
//   published_at: datetime,
//   canonical_url: string,
//   meta_category: string,
//   trace_claim_ids_json: string, // NFR-003 5-step trace anchor (ADR-0011 INV-0011-8)
//   trace_dossier_ids_json: string,
//   trace_scenario_ids_json: string,
//   trace_scenario_revision_ids_json: string,
//   correction_ledger_json: string
// }

// AccessIntervention {  (ADR-0017)
//   intervention_id: string,      // `aci_<ULID>`
//   session_id: string,
//   scenario_id: string,
//   thesis_id: string,
//   url: string,
//   source_name: string,
//   attempted_action: string,
//   access_result: string,        // blocked|paywalled|bot_protected|terms_unclear|404
//   policy_result: string,        // manual_only|metadata_only|excluded
//   related_query: string,
//   why_it_matters: string,
//   importance_score: float,
//   severity: string,             // LOW|MEDIUM|HIGH|CRITICAL
//   fallback_used_json: string,
//   requested_user_action: string,
//   status: string,               // pending_user_review|resolved|ignored
//   created_at: datetime,
//   resolved_at: datetime
// }

// ManualClaimEntry {  (ADR-0018)
//   manual_claim_id: string,      // `mcl_<ULID>`
//   session_id: string,
//   source_id: string,
//   url: string,
//   canonical_url: string,
//   title: string,
//   publisher: string,
//   author: string,
//   published_at: datetime,
//   source_accessed_at: datetime,
//   source_accessed_via: string,  // manual_browser|manual_app|manual_pdf_read|manual_print|manual_offline
//   user_written_claim: string,
//   user_opinion: string,
//   referenced_quote: string,     // ≤200 chars, quote_reason required if present
//   quote_reason: string,         // exact_wording_matters|policy_language_analysis|direct_publication_quote|rebuttal_or_critique
//   attribution_json: string,
//   self_assessed_confidence: float,
//   policy_gate_passed: boolean,
//   raw_text_stored: boolean,     // ALWAYS false (INV-0018-3)
//   created_at: datetime,
//   intervention_id: string       // FK to AccessIntervention
// }
