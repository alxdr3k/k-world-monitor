// Deterministic severity scoring for access_interventions (INFRA-1B.5).
// INV-0017-7: default is deterministic (no LLM). LLM is opt-in, not implemented here.
//
// Severity = f(policy_result, importance_score, related_assumption_ids).
// When related_assumption_ids are provided (explicit scenario linkage), severity
// is elevated one step above the pure policy_result baseline.

export type PolicyResult = "inline_block" | "inline_warn" | "batch_report";
export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface SeverityInput {
  policyResult: PolicyResult;
  importanceScore: number;          // 0.0–1.0
  relatedAssumptionIds?: string[];  // explicit Scenario.assumptions linkage
}

// Base severity by policy_result × importance_score bucket.
// importance_score in [0, 1]; buckets: low <0.4, mid 0.4–0.69, high ≥0.7.
const BASE: Record<PolicyResult, [Severity, Severity, Severity]> = {
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
  const score = Math.max(0, Math.min(1, input.importanceScore));
  const bucket = score < 0.4 ? 0 : score < 0.7 ? 1 : 2;
  const base = BASE[input.policyResult][bucket];

  // Explicit scenario linkage bumps severity by one step.
  const hasAssumptionLink =
    Array.isArray(input.relatedAssumptionIds) &&
    input.relatedAssumptionIds.length > 0;

  return hasAssumptionLink ? elevate(base) : base;
}
