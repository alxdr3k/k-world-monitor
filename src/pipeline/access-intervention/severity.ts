// Deterministic severity scoring for access_interventions (INFRA-1B.5).
// INV-0017-7: default is deterministic (no LLM). LLM is opt-in, not implemented here.
//
// Severity = f(gate_mode, importance_score, related_assumption_ids).
// When related_assumption_ids are provided (explicit scenario linkage), severity
// is elevated one step above the pure gate_mode baseline.
//
// GateMode is the intervention disposition (inline_block / inline_warn / batch_report).
// It is NOT the same as policy_result (manual_only / metadata_only / excluded), which
// is the source-policy outcome stored on the AccessIntervention node (ADR-0017).

export type GateMode = "inline_block" | "inline_warn" | "batch_report";
export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** Canonical policy outcome for the source (ADR-0017 schema). */
export type PolicyResult = "manual_only" | "metadata_only" | "excluded";

export interface SeverityInput {
  gateMode: GateMode;
  importanceScore: number;          // 0.0–1.0
  relatedAssumptionIds?: string[];  // explicit Scenario.assumptions linkage
}

// Base severity by gate_mode × importance_score bucket.
// importance_score in [0, 1]; buckets: low <0.4, mid 0.4–0.69, high ≥0.7.
const BASE: Record<GateMode, [Severity, Severity, Severity]> = {
  //                          low           mid          high
  inline_block:  ["HIGH",   "HIGH",    "CRITICAL"],
  inline_warn:   ["LOW",    "MEDIUM",  "HIGH"],
  batch_report:  ["LOW",    "LOW",     "MEDIUM"],
};

const SEVERITY_ORDER: Severity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

function elevate(s: Severity): Severity {
  const idx = SEVERITY_ORDER.indexOf(s);
  return SEVERITY_ORDER[Math.min(idx + 1, SEVERITY_ORDER.length - 1)]!;
}

export function computeSeverity(input: SeverityInput): Severity {
  if (!Number.isFinite(input.importanceScore)) {
    // NaN or ±Infinity: treat as lowest bucket to avoid silent HIGH/CRITICAL escalation.
    const base = BASE[input.gateMode][0];
    const hasAssumptionLink =
      Array.isArray(input.relatedAssumptionIds) &&
      input.relatedAssumptionIds.length > 0;
    return hasAssumptionLink ? elevate(base) : base;
  }
  const score = Math.max(0, Math.min(1, input.importanceScore));
  const bucket = score < 0.4 ? 0 : score < 0.7 ? 1 : 2;
  const base = BASE[input.gateMode][bucket];

  // Explicit scenario linkage bumps severity by one step.
  const hasAssumptionLink =
    Array.isArray(input.relatedAssumptionIds) &&
    input.relatedAssumptionIds.length > 0;

  return hasAssumptionLink ? elevate(base) : base;
}
