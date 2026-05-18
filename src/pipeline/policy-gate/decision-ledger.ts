// Generic policy_gate decision ledger writer
// (INFRA-1B.5.h2-policy-gate-risk-triggers, AC-023 / TEST-023 evidence,
// AI-P1-11 D1a/D2a 결정 lock 2026-05-17).
//
// Implements ADR-0017 INV-0017-5 — "모든 policy_gate 결정은 policy_decisions
// ledger 에 기록한다" — for the operator-facing policy gate. NOT to be
// confused with src/storage/audit/policy-decisions.ts's
// recordR2UploadDecision, which is the R2-upload-specific audit hook
// (intended_action='r2_upload', enum-trigger-constrained decision values).
//
// Namespace contract (v7 ALTER comment + v8 trigger
// policy_decisions_intended_action_enum_ins WHEN NEW.intended_action IS
// NOT NULL): rows written by this module have intended_action=NULL, which
// bypasses the v8 r2_upload enum triggers and keeps the operator-gate
// decision column free-form (allow / warn / block per ADR-0017
// INV-0017-5).
//
// trigger_type semantics (v1 schema column, NOT NULL): for risk-triggered
// decisions this column carries the RiskTrigger ID
// (`raw_cloud_upload` / `wire_service_full_text` / etc.). For non-risk
// stage-default decisions this column carries the sentinel
// `non_risk_action` so operator audit queries can `GROUP BY trigger_type`
// without NULL handling.
//
// risk_level / intervention_id columns are part of ADR-0017 INV-0017-5
// 's spec but NOT in the v1 schema (drift). v0 omits them — they are
// captured in `rationale` text instead. Future hardening anchor =
// v10 migration `policy_decisions_risk_level_intervention_id` (separate
// schema slice; see PR follow-up).
//
// **Multi-trigger ledger semantics — Option A: one row per evaluation**
// (GPT review post-PR-#68 P2 finding 4 — 운영자 결정 옵션 b+ 2026-05-17):
// when `evaluatePolicyGate()` returns a `PolicyGateResult` with multiple
// `triggers[]` (e.g., raw_cache on a do_not_collect source fires both
// trigger 3 terms_violation AND trigger 5 article_raw_quote_or_cache),
// the caller writes ONE `recordPolicyGateDecision()` row per evaluation
// with:
//   - `triggerType` = the **primary** (first detected) trigger, ordered
//     by ADR-0017 INV-0017-4 List A canonical sequence (DETECTORS array
//     order in risk-triggers.ts).
//   - `rationale` = the full `PolicyGateResult.rationale` string, which
//     serializes ALL detected triggers (format:
//     `[trigger_id] rationale | [trigger_id] rationale | ...`).
// Operator multi-trigger audit aggregation queries the `rationale` text
// via `LIKE '%[trigger_id]%'`. This Option A keeps the policy_decisions
// row count proportional to evaluator calls (not detected risks: N
// detected risks in one evaluation = 1 ledger row, not N rows). This
// row-count proportionality is a writer-side ledger contract for the
// operator-gate namespace — NOT to be confused with ADR-0012 INV-0012-3
// audit-by-absence (which is a reader-side enforcement-trace property
// specific to R2 upload, where the absence of any audit row for a
// Snapshot is the canonical proof of no upload attempt).
//
// Option B (one row per detected trigger) is deferred until an operator-
// driven multi-trigger aggregation use case emerges (e.g., per-trigger
// fp/fn analytics, per-trigger rule-mining). v0 audit queries can
// achieve trigger-level aggregation through `rationale` LIKE filters
// without schema change.

import { monotonicFactory } from "ulid";
import { getDb } from "../../storage/sqlite/connection";
import {
  isGateDecision,
  isPolicyGateMode,
  isRiskTrigger,
  type GateDecision,
  type PolicyGateMode,
  type RiskTrigger,
} from "../../utils/enums";

const ulid = monotonicFactory();

/**
 * Sentinel trigger_type value for non-risk (stage-default) policy_gate
 * decisions. Kept distinct from the 8 RiskTrigger enum members so audit
 * queries can `WHERE trigger_type = 'non_risk_action'` to isolate
 * stage-default decisions.
 */
export const NON_RISK_TRIGGER_TYPE = "non_risk_action" as const;

export type LedgerTriggerType = RiskTrigger | typeof NON_RISK_TRIGGER_TYPE;

/**
 * v0 writer-boundary validator for trigger_type. Mirrors the
 * ADR-0017 INV-0017-4 RiskTrigger enum + adds the NON_RISK_TRIGGER_TYPE
 * sentinel. Defense-in-depth — the policy_decisions.trigger_type column
 * has no DB-level CHECK constraint in v1 schema (free-form text), so a
 * raw-SQL caller could write arbitrary values; this assertion blocks
 * drift at the canonical writer entry.
 */
function isLedgerTriggerType(v: unknown): v is LedgerTriggerType {
  return v === NON_RISK_TRIGGER_TYPE || isRiskTrigger(v);
}

export interface PolicyGateDecisionInput {
  /** FK to research_session.session_id. */
  sessionId: string;
  /** FK to source_material_policy.source_id. `null` if source unregistered. */
  sourceId: string | null;
  url: string;
  /** RiskTrigger ID for risk decisions, NON_RISK_TRIGGER_TYPE for stage-default. */
  triggerType: LedgerTriggerType;
  decision: GateDecision;
  gateMode: PolicyGateMode;
  /** Free-form rationale — should include intended_action + policy field values for audit trace. */
  rationale: string;
}

/**
 * Insert one immutable row into policy_decisions for a generic
 * policy_gate decision (operator-gate namespace, intended_action=NULL).
 *
 * Returns the generated decision_id (`pdec_<ULID>`).
 *
 * Throws if any field shape violates v0 writer-boundary contracts —
 * the v1 schema CHECK constraint on policy_gate_mode + TypeScript types
 * already cover most paths, but explicit assertion is kept symmetric
 * to assertValidSnapId in src/storage/audit/policy-decisions.ts
 * (Cycle 7 INFRA-1B.3.h6 writer-boundary hardening lesson).
 */
export function recordPolicyGateDecision(
  input: PolicyGateDecisionInput
): string {
  if (!isLedgerTriggerType(input.triggerType)) {
    throw new Error(
      `recordPolicyGateDecision: invalid triggerType (must be RiskTrigger enum or '${NON_RISK_TRIGGER_TYPE}'): ${JSON.stringify(input.triggerType)}`
    );
  }
  if (!isGateDecision(input.decision)) {
    throw new Error(
      `recordPolicyGateDecision: invalid decision (must be GATE_DECISION enum: allow|warn|block): ${JSON.stringify(input.decision)}`
    );
  }
  if (!isPolicyGateMode(input.gateMode)) {
    throw new Error(
      `recordPolicyGateDecision: invalid gateMode (must be POLICY_GATE_MODE enum: inline_block|inline_warn|batch_report): ${JSON.stringify(input.gateMode)}`
    );
  }
  const decisionId = `pdec_${ulid()}`;
  // intended_action is left NULL — operator-gate namespace per v7 ALTER
  // comment. This bypasses the v8 r2_upload enum triggers.
  getDb()
    .prepare(
      `INSERT INTO policy_decisions
         (decision_id, session_id, source_id, url, trigger_type,
          policy_gate_mode, decision, rationale)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      decisionId,
      input.sessionId,
      input.sourceId,
      input.url,
      input.triggerType,
      input.gateMode,
      input.decision,
      input.rationale
    );
  return decisionId;
}
