/**
 * Domain enum definitions and runtime validators.
 * TypeScript const enums + is*() guards for all enum-constrained DB columns.
 * These mirror the SQLite trigger constraints in migrations/sqlite/v2_enum_constraints.sql.
 */

// ---------------------------------------------------------------------------
// run_ledger enums (ADR-0023)
// ---------------------------------------------------------------------------
export const RUN_STATUS = ["running", "completed", "failed"] as const;
export type RunStatus = (typeof RUN_STATUS)[number];
export function isRunStatus(v: unknown): v is RunStatus {
  return typeof v === "string" && (RUN_STATUS as readonly string[]).includes(v);
}

export const RUN_STAGE = [
  "discover",
  "extract",
  "dossier",
  "scenario",
  "thesis",
  "cite_check",
  "publication",
] as const;
export type RunStage = (typeof RUN_STAGE)[number];
export function isRunStage(v: unknown): v is RunStage {
  return typeof v === "string" && (RUN_STAGE as readonly string[]).includes(v);
}

export const LLM_VENDOR = ["openai", "anthropic", "google"] as const;
export type LlmVendor = (typeof LLM_VENDOR)[number];
export function isLlmVendor(v: unknown): v is LlmVendor {
  return typeof v === "string" && (LLM_VENDOR as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// cross_vendor_review_ledger enums (ADR-0023 INV-0023-4)
// ---------------------------------------------------------------------------
export const REVIEW_TYPE = [
  "preflight_cite_overclaim",
  "scenario_adversarial",
  "high_stakes_thesis",
] as const;
export type ReviewType = (typeof REVIEW_TYPE)[number];
export function isReviewType(v: unknown): v is ReviewType {
  return typeof v === "string" && (REVIEW_TYPE as readonly string[]).includes(v);
}

export const REVIEW_OUTCOME = ["pass", "fail", "conditional"] as const;
export type ReviewOutcome = (typeof REVIEW_OUTCOME)[number];
export function isReviewOutcome(v: unknown): v is ReviewOutcome {
  return typeof v === "string" && (REVIEW_OUTCOME as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Source policy enums (ADR-0017, source_material_policy)
// ---------------------------------------------------------------------------
export const ARCHIVE_POLICY = [
  "metadata_only",
  "excerpt_only",
  "full_snapshot_allowed",
  "do_not_collect",
] as const;
export type ArchivePolicy = (typeof ARCHIVE_POLICY)[number];
export function isArchivePolicy(v: unknown): v is ArchivePolicy {
  return typeof v === "string" && (ARCHIVE_POLICY as readonly string[]).includes(v);
}

export const RAW_CLOUD_POLICY = ["always_prohibited", "allowed_public_data_only"] as const;
export type RawCloudPolicy = (typeof RAW_CLOUD_POLICY)[number];
export function isRawCloudPolicy(v: unknown): v is RawCloudPolicy {
  return typeof v === "string" && (RAW_CLOUD_POLICY as readonly string[]).includes(v);
}

export const EXTERNAL_LLM_POLICY = ["allowed", "manual_review_required", "prohibited"] as const;
export type ExternalLlmPolicy = (typeof EXTERNAL_LLM_POLICY)[number];
export function isExternalLlmPolicy(v: unknown): v is ExternalLlmPolicy {
  return typeof v === "string" && (EXTERNAL_LLM_POLICY as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// ManualClaimEntry quote_reason enum (ADR-0018)
// ---------------------------------------------------------------------------
export const QUOTE_REASON = [
  "exact_wording_matters",
  "policy_language_analysis",
  "direct_publication_quote",
  "rebuttal_or_critique",
] as const;
export type QuoteReason = (typeof QUOTE_REASON)[number];
export function isQuoteReason(v: unknown): v is QuoteReason {
  return typeof v === "string" && (QUOTE_REASON as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// ManualClaimEntry source_accessed_via enum (ADR-0018)
// ---------------------------------------------------------------------------
export const SOURCE_ACCESSED_VIA = [
  "manual_browser",
  "manual_app",
  "manual_pdf_read",
  "manual_print",
  "manual_offline",
] as const;
export type SourceAccessedVia = (typeof SOURCE_ACCESSED_VIA)[number];
export function isSourceAccessedVia(v: unknown): v is SourceAccessedVia {
  return typeof v === "string" && (SOURCE_ACCESSED_VIA as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// AccessIntervention enums (ADR-0017)
// ---------------------------------------------------------------------------
export const ACCESS_RESULT = [
  "blocked",
  "paywalled",
  "bot_protected",
  "terms_unclear",
  "404",
] as const;
export type AccessResult = (typeof ACCESS_RESULT)[number];
export function isAccessResult(v: unknown): v is AccessResult {
  return typeof v === "string" && (ACCESS_RESULT as readonly string[]).includes(v);
}

export const INTERVENTION_SEVERITY = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type InterventionSeverity = (typeof INTERVENTION_SEVERITY)[number];
export function isInterventionSeverity(v: unknown): v is InterventionSeverity {
  return typeof v === "string" && (INTERVENTION_SEVERITY as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Thesis bidirectional stance enums (ADR-0019, AC-026)
// ---------------------------------------------------------------------------
export const THESIS_STANCE = [
  "constructive",
  "cautionary",
  "neutral",
  "mixed",
  "asymmetric",
  "exploratory",
] as const;
export type ThesisStance = (typeof THESIS_STANCE)[number];
export function isThesisStance(v: unknown): v is ThesisStance {
  return typeof v === "string" && (THESIS_STANCE as readonly string[]).includes(v);
}

export const THESIS_MARKET_STANCE = [
  "bullish",
  "bearish",
  "range_bound",
  "volatility_up",
  "volatility_down",
  "neutral",
] as const;
export type ThesisMarketStance = (typeof THESIS_MARKET_STANCE)[number];
export function isThesisMarketStance(v: unknown): v is ThesisMarketStance {
  return typeof v === "string" && (THESIS_MARKET_STANCE as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// policy_decisions.intended_action audit ledger enums
// (INFRA-1B.3.x-audit, AC-032 / NFR-008, ADR-0012 INV-0012-3)
// ---------------------------------------------------------------------------
export const INTENDED_ACTION = ["r2_upload"] as const;
export type IntendedAction = (typeof INTENDED_ACTION)[number];
export function isIntendedAction(v: unknown): v is IntendedAction {
  return typeof v === "string" && (INTENDED_ACTION as readonly string[]).includes(v);
}

// R2UploadDecision values populate policy_decisions.decision when
// intended_action='r2_upload'. Every r2Put call site in
// src/discovery/worker/snapshot-fingerprint.ts inserts:
//   - one 'attempted' row BEFORE r2Put returns (so an r2Put exception still
//     leaves an audit trail for NFR-008 reconstruction)
//   - one outcome row AFTER r2Put returns ('uploaded' | 'skipped_toctou' |
//     'set_r2_key_failed_neo4j')
// The 'blocked_by_policy' value is NOT a runtime row — policy gating happens
// before r2Put is reached; absence of an audit row for a Snapshot proves
// no upload was attempted (ADR-0012 INV-0012-3 audit-by-absence).
export const R2_UPLOAD_DECISION = [
  "attempted",
  "uploaded",
  "skipped_toctou",
  "set_r2_key_failed_neo4j",
] as const;
export type R2UploadDecision = (typeof R2_UPLOAD_DECISION)[number];
export function isR2UploadDecision(v: unknown): v is R2UploadDecision {
  return typeof v === "string" && (R2_UPLOAD_DECISION as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// policy_gate enums (ADR-0017 INV-0017-2/3/4/5, AC-023 / TEST-023,
// INFRA-1B.5.h2-policy-gate-risk-triggers, AI-P1-11 D1a/D2a 결정 lock
// 2026-05-17)
//
// Generic policy_gate decision rows are written via
// src/pipeline/policy-gate/decision-ledger.ts with intended_action=NULL
// (operator-policy-gate namespace per v7 ALTER comment + v8 trigger
// `policy_decisions_intended_action_enum_ins` WHEN NEW.intended_action IS
// NOT NULL clause — operator-gate rows bypass the r2_upload enum
// triggers).
//
// POLICY_GATE_MODE mirrors the v1 schema CHECK constraint on
// policy_decisions.policy_gate_mode.
// ---------------------------------------------------------------------------
export const POLICY_GATE_MODE = ["inline_block", "inline_warn", "batch_report"] as const;
export type PolicyGateMode = (typeof POLICY_GATE_MODE)[number];
export function isPolicyGateMode(v: unknown): v is PolicyGateMode {
  return typeof v === "string" && (POLICY_GATE_MODE as readonly string[]).includes(v);
}

// GATE_DECISION = ADR-0017 INV-0017-5 spec (allow/warn/block). The
// policy_decisions.decision column has no CHECK constraint for
// operator-gate rows (intended_action IS NULL), so this enum is enforced
// at the writer boundary only (defense-in-depth — symmetric to the
// r2_upload decision enum trigger in v8).
export const GATE_DECISION = ["allow", "warn", "block"] as const;
export type GateDecision = (typeof GATE_DECISION)[number];
export function isGateDecision(v: unknown): v is GateDecision {
  return typeof v === "string" && (GATE_DECISION as readonly string[]).includes(v);
}

// RISK_TRIGGER = ADR-0017 INV-0017-4 의 List A 8 trigger ID. order
// matches the canonical list in docs/glossary/policy-gate.md +
// ADR-0017 §Decision. Each trigger is mode-invariant inline_block per
// INV-0017-4.
export const RISK_TRIGGER = [
  "external_llm_raw_text_unauthorized",
  "paywalled_source_fetch",
  "terms_violation",
  "wire_service_full_text",
  "article_raw_quote_or_cache",
  "image_inclusion_without_license",
  "raw_embedding",
  "raw_cloud_upload",
] as const;
export type RiskTrigger = (typeof RISK_TRIGGER)[number];
export function isRiskTrigger(v: unknown): v is RiskTrigger {
  return typeof v === "string" && (RISK_TRIGGER as readonly string[]).includes(v);
}

// PIPELINE_ACTION = call-site intended_action enum that the policy_gate
// evaluator accepts. NOT the same as policy_decisions.intended_action
// column (which is namespace marker — NULL for operator-gate rows,
// 'r2_upload' for R2 audit hook). The trigger column on the ledger row
// captures the risk trigger ID (or 'non_risk_action' for stage-default
// non-risk decisions).
export const PIPELINE_ACTION = [
  "discovery_fetch",
  "extract_full_text",
  "raw_cache",
  "chunk_create",
  "embed",
  "r2_upload",
  "external_llm_call_with_raw_text",
  "external_llm_call_with_excerpt",
  "quote_storage",
  "image_inclusion",
  "publication_preflight",
] as const;
export type PipelineAction = (typeof PIPELINE_ACTION)[number];
export function isPipelineAction(v: unknown): v is PipelineAction {
  return typeof v === "string" && (PIPELINE_ACTION as readonly string[]).includes(v);
}

// PIPELINE_STAGE = ADR-0017 INV-0017-3 의 stage enum + default mode
// mapping. Used by evaluatePolicyGate to choose the gate_mode for
// non-risk decisions (when no RISK_TRIGGER fires).
export const PIPELINE_STAGE = [
  "discovery",
  "extract_cache_embed_cloud_upload",
  "interactive_exploration",
  "content_production",
  "publication_preflight",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGE)[number];
export function isPipelineStage(v: unknown): v is PipelineStage {
  return typeof v === "string" && (PIPELINE_STAGE as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Source bidirectional perspective enum (ADR-0019, AC-027)
// ---------------------------------------------------------------------------
export const SOURCE_PERSPECTIVE = ["risk_observer", "opportunity_observer", "neutral", "mixed"] as const;
export type SourcePerspective = (typeof SOURCE_PERSPECTIVE)[number];
export function isSourcePerspective(v: unknown): v is SourcePerspective {
  return typeof v === "string" && (SOURCE_PERSPECTIVE as readonly string[]).includes(v);
}
