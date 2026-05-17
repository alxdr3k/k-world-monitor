// Policy gate risk-trigger detection (INFRA-1B.5.h2-policy-gate-risk-triggers,
// AC-023 / TEST-023, AI-P1-11 D1a/D2a 결정 lock 2026-05-17).
//
// Implements ADR-0017 INV-0017-4 List A: 8 source-access risk triggers that
// are mode-invariant inline_block — and combines them with INV-0017-3
// stage-default mode mapping into a single evaluatePolicyGate() entry point.
//
// ADR-0017 INV-0017-4 List A (canonical, AI-P1-11 D1a 결정):
//   1. source policy unknown 인데 raw text 를 외부 LLM 에 보내려 함
//   2. source 가 paywalled / proprietary
//   3. terms 에 no scraping / no AI / no archive / no redistribution
//   4. wire-service full text (Reuters / AP / AFP / Bloomberg ...)
//   5. article / report 원문 quote · cache
//   6. 기사 / 리포트 도표 · 스크린샷 콘텐츠 추가
//   7. raw source embedding · indexing
//   8. raw source cloud upload
//
// retrospective AI-P1-11 의 List B (promise_or_implication / legal_advice /
// medical_advice / ...) 는 ADR-0017 범위 밖 (content-production safety
// 도메인). P0-M6 publication 슬라이스에서 별도 axis 로 처리 — 본 module 의
// scope 아님.
//
// Evaluation contract (ADR-0017 INV-0017-2/3/4):
//   - any risk trigger detected → decision='block', gate_mode='inline_block'
//     (INV-0017-4 mode-invariant override)
//   - no risk trigger → gate_mode = stageDefaultMode(stage) (INV-0017-3),
//     decision = mode-mapped (inline_block → block, inline_warn → warn,
//     batch_report → allow)
//
// All decisions (risk + non-risk) are recorded via
// src/pipeline/policy-gate/decision-ledger.ts → policy_decisions row with
// intended_action=NULL (operator-gate namespace, v7 ALTER comment +
// v8 enum trigger WHEN clause).

import type {
  ArchivePolicy,
  ExternalLlmPolicy,
  PipelineAction,
  PipelineStage,
  PolicyGateMode,
  RawCloudPolicy,
  RiskTrigger,
  GateDecision,
} from "../../utils/enums";

// ---------------------------------------------------------------------------
// Context shape — caller provides the source's policy 3 필드 + intended
// pipeline action + optional source metadata for wire-service detection.
// ---------------------------------------------------------------------------

/**
 * Source policy 3 필드 + metadata required for trigger detection.
 *
 * `unknown` sentinel applies when the source is unregistered (no
 * source_material_policy row) — INV-0017-4 trigger 1 fires on unknown
 * external_llm_policy by design.
 */
export interface RiskTriggerContext {
  /** FK to source_material_policy.source_id. `null` if source unregistered. */
  sourceId: string | null;
  archivePolicy: ArchivePolicy | "unknown";
  rawCloudPolicy: RawCloudPolicy | "unknown";
  externalLlmPolicy: ExternalLlmPolicy | "unknown";
  intendedAction: PipelineAction;
  /**
   * Optional source display name — used for INV-0017-4 trigger 4
   * (wire_service_full_text) hardcoded allowlist match. v0 detection
   * strategy; future hardening anchor = data/source-profiles.yaml
   * (INFRA-1B.1.h2-source-profile) for first-class source_role flag.
   */
  sourceName?: string;
  /** Optional URL — included in rationale + future URL-pattern detection. */
  url?: string;
}

export interface DetectedRisk {
  trigger: RiskTrigger;
  /** Human-readable explanation included in the policy_decisions.rationale. */
  rationale: string;
}

// ---------------------------------------------------------------------------
// Wire-service allowlist (INV-0017-4 trigger 4).
//
// v0 hardcoded — case-insensitive match on RiskTriggerContext.sourceName.
// Two-tier match strategy to balance recall (must catch operator naming
// variants) vs precision (must NOT false-positive on common English words
// containing the same letter sequences):
//
//   1. Long-canonical substrings (≥6 chars, unlikely to false-positive):
//      simple `lower.includes(p)` match. Covers "associated press",
//      "agence france-presse", "yonhap news agency", etc.
//
//   2. Short acronyms (≤4 chars, high false-positive risk):
//      word-boundary regex match. Codex PR #68 P1 finding: bare "AP" was
//      missing from tier 1 because adding "ap" as a substring would match
//      "Aperture" / "MAPS" / "happenstance". `\bap\b` matches "AP" /
//      "AP News" / " AP " but not "Aperture" / "happen". Same hardening
//      applied to AFP (vs "Stafford") and TASS.
//
// Future hardening: derive from data/source-profiles.yaml
// source_role='wire_service' first-class flag (anchor
// INFRA-1B.1.h2-source-profile / AI-P1-4) — both tiers become unnecessary
// once source profile carries explicit wire_service classification.
// ---------------------------------------------------------------------------
const WIRE_SERVICE_SUBSTRINGS = [
  "reuters",
  "associated press",
  "agence france-presse",
  "bloomberg",
  "yonhap", // 연합뉴스 (KR)
  "kyodo",  // 共同通信 (JP)
  "xinhua", // 新华社 (CN)
  "interfax",
] as const;

// Word-boundary regexes for short acronyms (PR #68 Codex P1 finding —
// "AP" / "AFP" / "TASS" common false-positive risks: Aperture / MAPS /
// happen / Stafford / atlas-like words). Case-insensitive.
const WIRE_SERVICE_WORD_BOUNDARY_REGEXES = [
  /\bap\b/i,    // Associated Press bare alias
  /\bafp\b/i,   // Agence France-Presse bare alias
  /\btass\b/i,  // TASS bare alias
] as const;

function isWireService(sourceName: string | undefined): boolean {
  if (!sourceName) return false;
  const lower = sourceName.toLowerCase();
  if (WIRE_SERVICE_SUBSTRINGS.some((p) => lower.includes(p))) return true;
  return WIRE_SERVICE_WORD_BOUNDARY_REGEXES.some((re) => re.test(sourceName));
}

// ---------------------------------------------------------------------------
// Per-trigger detection. Each function returns a DetectedRisk or null.
// Detectors are independent — a single pipeline action may trip multiple
// triggers (e.g., wire-service article raw cache trips both trigger 4 and 5).
// ---------------------------------------------------------------------------

/**
 * Trigger 1: source policy unknown OR external_llm_policy != 'allowed' AND
 * intended action sends raw text to external LLM.
 *
 * Contract (ADR-0017 vs ADR-0012 INV-0012-7): ADR-0012 INV-0012-7 의
 * 초기 표현 `external_llm_policy ≠ prohibited` 는 manual_review_required
 * 를 통과시키는 약한 조건. ADR-0017 / AC-023 의 정합 표현은
 * `external_llm_policy === 'allowed'` 만 통과. 본 detector 는 후자
 * (strict — only `allowed` passes). ADR-0012 INV-0012-7 문구 정합 보정은
 * 별도 follow-up doc-PR scope (PR 1b 외).
 */
function detectExternalLlmRawTextUnauthorized(
  ctx: RiskTriggerContext
): DetectedRisk | null {
  if (ctx.intendedAction !== "external_llm_call_with_raw_text") return null;
  if (ctx.externalLlmPolicy === "allowed") return null;
  return {
    trigger: "external_llm_raw_text_unauthorized",
    rationale: `external_llm_policy=${ctx.externalLlmPolicy} (must be 'allowed' for raw-text LLM call)`,
  };
}

/**
 * Trigger 2: paywalled / proprietary source — INV-0017-4 의 #2.
 *
 * v0 detection proxy: archive_policy ∈ {metadata_only, excerpt_only} →
 * paywall / proprietary indicator (ADR-0016 Tier B-C indicator). v0
 * schema has no dedicated paywall_flag column — future hardening anchor
 * = data/source-profiles.yaml (INFRA-1B.1.h2-source-profile).
 *
 * Trigger only fires for full-text-class actions (extract_full_text /
 * chunk_create) — discovery_fetch (RSS metadata) is allowed even on
 * paywalled sources.
 */
function detectPaywalledSourceFetch(
  ctx: RiskTriggerContext
): DetectedRisk | null {
  const fullTextActions: PipelineAction[] = ["extract_full_text", "chunk_create"];
  if (!fullTextActions.includes(ctx.intendedAction)) return null;
  if (
    ctx.archivePolicy !== "metadata_only" &&
    ctx.archivePolicy !== "excerpt_only"
  ) {
    return null;
  }
  return {
    trigger: "paywalled_source_fetch",
    rationale: `archive_policy=${ctx.archivePolicy} (paywalled / proprietary indicator) + intended_action=${ctx.intendedAction}`,
  };
}

/**
 * Trigger 3: terms violation (no scraping / no AI / no archive / no
 * redistribution) — INV-0017-4 의 #3.
 *
 * v0 detection proxy: archive_policy='do_not_collect' is the codified
 * outcome of these terms during source registration. v0 schema does not
 * store free-form terms text — future hardening anchor =
 * data/source-profiles.yaml (terms_clauses field, AI-P1-4).
 *
 * Fires for any non-discovery collection-class action — discovery_fetch
 * (metadata-only RSS poll) is a borderline case but ADR-0017 §Decision
 * 단계별 default mode 에서 Discovery 도 위험 행동 inline_block 적용
 * 이므로 본 detector 도 discovery_fetch 포함.
 */
function detectTermsViolation(ctx: RiskTriggerContext): DetectedRisk | null {
  const collectionActions: PipelineAction[] = [
    "discovery_fetch",
    "extract_full_text",
    "raw_cache",
    "chunk_create",
    "embed",
    "r2_upload",
    "quote_storage",
  ];
  if (!collectionActions.includes(ctx.intendedAction)) return null;
  if (ctx.archivePolicy !== "do_not_collect") return null;
  return {
    trigger: "terms_violation",
    rationale: `archive_policy=do_not_collect (terms forbid scraping / AI / archive / redistribution) + intended_action=${ctx.intendedAction}`,
  };
}

/**
 * Trigger 4: wire-service full text — INV-0017-4 의 #4.
 *
 * v0 detection: hardcoded allowlist (Reuters / AP / AFP / Bloomberg /
 * Yonhap / Kyodo / Xinhua / TASS / Interfax) match against
 * RiskTriggerContext.sourceName. Future hardening anchor =
 * source.source_role='wire_service' first-class field
 * (INFRA-1B.1.h2-source-profile, AI-P1-4).
 *
 * Trigger fires for full-text-class actions only.
 */
function detectWireServiceFullText(
  ctx: RiskTriggerContext
): DetectedRisk | null {
  const fullTextActions: PipelineAction[] = ["extract_full_text", "chunk_create"];
  if (!fullTextActions.includes(ctx.intendedAction)) return null;
  if (!isWireService(ctx.sourceName)) return null;
  return {
    trigger: "wire_service_full_text",
    rationale: `source_name=${ctx.sourceName ?? "<empty>"} matches wire-service allowlist (v0 hardcoded) + intended_action=${ctx.intendedAction}`,
  };
}

/**
 * Trigger 5: article / report 원문 quote 또는 raw cache — INV-0017-4 의 #5.
 *
 * Fires when intended_action ∈ {quote_storage, raw_cache} AND archive_policy
 * is anything other than full_snapshot_allowed. The complementary trigger 8
 * (raw_cloud_upload) covers R2 specifically; this one covers the SQLite
 * raw_cache_items + Neo4j Chunk path.
 */
function detectArticleRawQuoteOrCache(
  ctx: RiskTriggerContext
): DetectedRisk | null {
  const quoteCacheActions: PipelineAction[] = ["quote_storage", "raw_cache"];
  if (!quoteCacheActions.includes(ctx.intendedAction)) return null;
  if (ctx.archivePolicy === "full_snapshot_allowed") return null;
  return {
    trigger: "article_raw_quote_or_cache",
    rationale: `archive_policy=${ctx.archivePolicy} (must be 'full_snapshot_allowed' for quote/cache) + intended_action=${ctx.intendedAction}`,
  };
}

/**
 * Trigger 6: image inclusion without license — INV-0017-4 의 #6.
 *
 * v0 stub: image storage is not yet implemented in the pipeline (no
 * Neo4j Image node, no R2 image prefix). Conservative default = block ALL
 * image_inclusion intents until license-tracking lands. Future hardening
 * anchor = data/source-profiles.yaml license_url + image_license enum.
 */
function detectImageInclusionWithoutLicense(
  ctx: RiskTriggerContext
): DetectedRisk | null {
  if (ctx.intendedAction !== "image_inclusion") return null;
  return {
    trigger: "image_inclusion_without_license",
    rationale: `intended_action=image_inclusion — v0 conservative block (image license tracking not yet implemented, see future hardening anchor)`,
  };
}

/**
 * Trigger 7: raw source embedding / indexing — INV-0017-4 의 #7.
 *
 * Fires when intended_action='embed' AND archive_policy is not
 * full_snapshot_allowed. raw_cloud_policy is independent (embedding can
 * happen entirely on local infrastructure), so the only constraint is
 * archive_policy permissibility.
 */
function detectRawEmbedding(ctx: RiskTriggerContext): DetectedRisk | null {
  if (ctx.intendedAction !== "embed") return null;
  if (ctx.archivePolicy === "full_snapshot_allowed") return null;
  return {
    trigger: "raw_embedding",
    rationale: `archive_policy=${ctx.archivePolicy} (must be 'full_snapshot_allowed' for raw embedding) + intended_action=embed`,
  };
}

/**
 * Trigger 8: raw source cloud upload — INV-0017-4 의 #8.
 *
 * Fires when intended_action='r2_upload' AND either archive_policy or
 * raw_cloud_policy is restrictive. NOTE: snapshot-fingerprint.ts already
 * enforces this at the r2Put call site via allLinkedSourcesAllowR2SnapshotUpload()
 * (INFRA-1B.3.h1-policy-fix PR #41 + INFRA-1B.3.h4 PR #53). This module's
 * detection is the **generic policy_gate evaluation** path — call-site
 * enforcement remains the runtime guarantee (defense-in-depth symmetric to
 * v8 audit trigger), and a row from this evaluator is the audit-trail
 * counterpart for non-r2Put callers (e.g., bulk re-upload audit).
 */
function detectRawCloudUpload(ctx: RiskTriggerContext): DetectedRisk | null {
  if (ctx.intendedAction !== "r2_upload") return null;
  const archiveOk = ctx.archivePolicy === "full_snapshot_allowed";
  const cloudOk = ctx.rawCloudPolicy === "allowed_public_data_only";
  if (archiveOk && cloudOk) return null;
  return {
    trigger: "raw_cloud_upload",
    rationale: `archive_policy=${ctx.archivePolicy} (need 'full_snapshot_allowed') AND raw_cloud_policy=${ctx.rawCloudPolicy} (need 'allowed_public_data_only') for r2_upload`,
  };
}

const DETECTORS: ReadonlyArray<(ctx: RiskTriggerContext) => DetectedRisk | null> = [
  detectExternalLlmRawTextUnauthorized,
  detectPaywalledSourceFetch,
  detectTermsViolation,
  detectWireServiceFullText,
  detectArticleRawQuoteOrCache,
  detectImageInclusionWithoutLicense,
  detectRawEmbedding,
  detectRawCloudUpload,
];

/**
 * Run all 8 detectors against the given context. Order preserved =
 * ADR-0017 INV-0017-4 List A order. Returns an empty array if no risk
 * fires (non-risk action — stage-default mode applies per INV-0017-3).
 */
export function detectRisks(ctx: RiskTriggerContext): DetectedRisk[] {
  const detected: DetectedRisk[] = [];
  for (const detector of DETECTORS) {
    const risk = detector(ctx);
    if (risk) detected.push(risk);
  }
  return detected;
}

// ---------------------------------------------------------------------------
// Stage-default mode mapping (ADR-0017 INV-0017-3).
// ---------------------------------------------------------------------------

/**
 * Per-stage default policy_gate_mode for non-risk actions. Risk actions
 * (any DetectedRisk fires) override this to inline_block per INV-0017-4.
 */
export function stageDefaultMode(stage: PipelineStage): PolicyGateMode {
  switch (stage) {
    case "discovery":
      return "inline_warn";
    case "extract_cache_embed_cloud_upload":
      return "inline_block";
    case "interactive_exploration":
      return "batch_report";
    case "content_production":
      return "batch_report";
    case "publication_preflight":
      return "inline_block";
  }
}

/**
 * mode → decision mapping for non-risk actions. ADR-0017 INV-0017-5 의
 * decision enum (allow / warn / block) 과 INV-0017-2 mode enum 간 매핑:
 *   - inline_block → block (action 자체가 stage-default 로 차단)
 *   - inline_warn  → warn (allow with warning recorded)
 *   - batch_report → allow (action proceeds; non-risk action 누적 없음.
 *                            risk action 의 누적은 access_intervention 이
 *                            INV-0017-6, 본 module 영역 외)
 */
function modeToNonRiskDecision(mode: PolicyGateMode): GateDecision {
  switch (mode) {
    case "inline_block":
      return "block";
    case "inline_warn":
      return "warn";
    case "batch_report":
      return "allow";
  }
}

// ---------------------------------------------------------------------------
// Combined evaluation — top-level entrypoint.
// ---------------------------------------------------------------------------

export interface EvaluatePolicyGateInput {
  stage: PipelineStage;
  ctx: RiskTriggerContext;
}

export interface PolicyGateResult {
  decision: GateDecision;
  gateMode: PolicyGateMode;
  /** Empty array if no risk fired — stage-default mode applies. */
  triggers: DetectedRisk[];
  /** Human-readable rationale string suitable for policy_decisions.rationale. */
  rationale: string;
}

/**
 * Apply ADR-0017 INV-0017-3 + INV-0017-4 jointly:
 *   - if any risk trigger fires: gate_mode='inline_block', decision='block'
 *     (mode-invariant override per INV-0017-4)
 *   - else: gate_mode = stageDefaultMode(stage), decision derived from mode
 *
 * Does NOT write to policy_decisions — that is decision-ledger.ts's
 * responsibility. Separation lets callers run a pre-flight evaluation
 * (e.g., for operator UI preview) without committing an audit row, and
 * lets tests assert evaluation logic independently of SQLite I/O.
 */
export function evaluatePolicyGate(
  input: EvaluatePolicyGateInput
): PolicyGateResult {
  const triggers = detectRisks(input.ctx);
  if (triggers.length > 0) {
    return {
      decision: "block",
      gateMode: "inline_block",
      triggers,
      rationale: triggers
        .map((t) => `[${t.trigger}] ${t.rationale}`)
        .join(" | "),
    };
  }
  const gateMode = stageDefaultMode(input.stage);
  const decision = modeToNonRiskDecision(gateMode);
  return {
    decision,
    gateMode,
    triggers: [],
    rationale: `non_risk_action stage=${input.stage} intended_action=${input.ctx.intendedAction} (stage-default mode)`,
  };
}
