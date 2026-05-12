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
// Source bidirectional perspective enum (ADR-0019, AC-027)
// ---------------------------------------------------------------------------
export const SOURCE_PERSPECTIVE = ["risk", "opportunity", "neutral", "mixed"] as const;
export type SourcePerspective = (typeof SOURCE_PERSPECTIVE)[number];
export function isSourcePerspective(v: unknown): v is SourcePerspective {
  return typeof v === "string" && (SOURCE_PERSPECTIVE as readonly string[]).includes(v);
}
