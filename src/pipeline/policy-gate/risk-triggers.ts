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

import {
  isArchivePolicy,
  isExternalLlmPolicy,
  isPipelineAction,
  isPipelineStage,
  isRawCloudPolicy,
  type ArchivePolicy,
  type ExternalLlmPolicy,
  type PipelineAction,
  type PipelineStage,
  type PolicyGateMode,
  type RawCloudPolicy,
  type RiskTrigger,
  type GateDecision,
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
// Three-tier match strategy to balance recall (must catch operator naming
// variants) vs precision (must NOT false-positive on Reuters-adjacent
// research/institute names or common English words containing the same
// letter sequences):
//
//   1. Long-canonical substrings (≥6 chars, unlikely to false-positive):
//      simple `lower.includes(p)` match. Covers "associated press",
//      "agence france-presse", "yonhap news agency", etc.
//
//   2. Short acronyms (≤4 chars, high false-positive risk):
//      word-boundary regex match. Codex PR #68 round 1 P1 finding:
//      bare "AP" was missing from tier 1 because adding "ap" as a
//      substring would match "Aperture" / "MAPS" / "happenstance".
//      `\bap\b` matches "AP" / "AP News" / " AP " but not "Aperture" /
//      "happen". Same hardening applied to AFP (vs "Stafford") and TASS.
//
//   3. Reuters specialization regex with Institute deny-list (GPT review
//      post-PR-#68 finding 1): plain `reuters` substring matches
//      "Reuters Institute Digital News Report" (Oxford Reuters Institute
//      — research/study org, NOT wire service). Use a `\breuters\b`
//      word-boundary with `(?!\s+institute)` negative lookahead so
//      "Reuters" / "Reuters News" / "Reuters Wire" fire but
//      "Reuters Institute" / "Reuters Institute for the Study of
//      Journalism" do not. Other long-canonical entries (associated
//      press / bloomberg / yonhap / kyodo / xinhua / interfax / agence
//      france-presse) have low Institute-like false-positive risk in
//      current seed and global naming conventions — kept in tier 1.
//
// Future hardening: derive from data/source-profiles.yaml
// source_role='wire_service' first-class flag (anchor
// INFRA-1B.1.h2-source-profile / AI-P1-4) — all three tiers become
// unnecessary once source profile carries explicit wire_service
// classification.
// ---------------------------------------------------------------------------
const WIRE_SERVICE_SUBSTRINGS = [
  "associated press",
  "agence france-presse",
  "bloomberg",
  "yonhap", // 연합뉴스 (KR)
  "kyodo",  // 共同通信 (JP)
  "xinhua", // 新华社 (CN)
  "interfax",
] as const;

// Word-boundary regexes for short acronyms (PR #68 round 1 Codex P1
// finding — "AP" / "AFP" / "TASS" common false-positive risks:
// Aperture / MAPS / happen / Stafford / atlas-like words). Case-insensitive.
const WIRE_SERVICE_WORD_BOUNDARY_REGEXES = [
  /\bap\b/i,    // Associated Press bare alias
  /\bafp\b/i,   // Agence France-Presse bare alias
  /\btass\b/i,  // TASS bare alias
] as const;

// Reuters specialization with Institute deny-list (GPT review post-PR-#68
// finding 1) — see tier 3 comment above for rationale.
const WIRE_SERVICE_REUTERS_REGEX = /\breuters\b(?!\s+institute)/i;

function isWireService(sourceName: string | undefined): boolean {
  if (!sourceName) return false;
  const lower = sourceName.toLowerCase();
  if (WIRE_SERVICE_SUBSTRINGS.some((p) => lower.includes(p))) return true;
  if (WIRE_SERVICE_REUTERS_REGEX.test(sourceName)) return true;
  return WIRE_SERVICE_WORD_BOUNDARY_REGEXES.some((re) => re.test(sourceName));
}

// ---------------------------------------------------------------------------
// Per-trigger detection. Each function returns a DetectedRisk or null.
// Detectors are independent — a single pipeline action may trip multiple
// triggers (e.g., wire-service article raw cache trips both trigger 4 and 5).
// ---------------------------------------------------------------------------

/**
 * Trigger 1: source policy unknown OR external_llm_policy != 'allowed' AND
 * intended action sends payload (raw text OR excerpt) to external LLM.
 *
 * Covers both `external_llm_call_with_raw_text` and
 * `external_llm_call_with_excerpt` (Codex PR #68 round 3 P1 finding):
 * ADR-0017 INV-0017-1 의 `external_llm_policy` 는 raw / excerpt 구분 없이
 * "외부 LLM 송신 허용 여부" 전체를 covering 하는 단일 enum. detector 가
 * raw text 만 검사하면 excerpt 송신이 manual_review_required / prohibited
 * / unknown 정책 source 에서 stage-default mode (batch_report → allow)
 * 로 통과 → 정책 우회. detector 이름의 "RawText" 표현은 historical
 * (PR #67 D1a 결정 lock 시점에 raw text 만 명시) 이지만 contract 는 두
 * action 모두 enforce.
 *
 * "source policy unknown" 의 fail-closed 해석 (Codex PR #68 round 2 P2
 * finding): `sourceId === null` (unregistered source — no
 * source_material_policy row) 인 경우 caller 가 externalLlmPolicy 를
 * 'allowed' 로 잘못 채워도 fail-closed block. ADR-0017 본문의
 * "source policy unknown" 의 정확한 해석 = sourceId 가 source registry 에
 * 없거나 externalLlmPolicy 가 unknown OR != 'allowed'.
 *
 * Contract (ADR-0017 vs ADR-0012 INV-0012-7): ADR-0012 INV-0012-7 의
 * 초기 표현 `external_llm_policy ≠ prohibited` 는 manual_review_required
 * 를 통과시키는 약한 조건. ADR-0017 / AC-023 의 정합 표현은
 * `external_llm_policy === 'allowed'` 만 통과 + sourceId 등록 필수. 본
 * detector 는 후자 (strict). ADR-0012 INV-0012-7 문구 정합 보정은 별도
 * follow-up doc-PR scope (PR 1b 외).
 */
function detectExternalLlmRawTextUnauthorized(
  ctx: RiskTriggerContext
): DetectedRisk | null {
  const llmActions: PipelineAction[] = [
    "external_llm_call_with_raw_text",
    "external_llm_call_with_excerpt",
  ];
  if (!llmActions.includes(ctx.intendedAction)) return null;
  if (ctx.sourceId === null) {
    return {
      trigger: "external_llm_raw_text_unauthorized",
      rationale: `source unregistered (sourceId=null) — fail-closed block for ${ctx.intendedAction} regardless of externalLlmPolicy=${ctx.externalLlmPolicy}`,
    };
  }
  if (ctx.externalLlmPolicy === "allowed") return null;
  return {
    trigger: "external_llm_raw_text_unauthorized",
    rationale: `external_llm_policy=${ctx.externalLlmPolicy} (must be 'allowed' for ${ctx.intendedAction})`,
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
 * **robots.txt disallow scope boundary** (GPT review post-PR-#68 +
 * 운영자 결정 옵션 b+ 2026-05-17): robots.txt disallow violations are
 * enforced at the discovery safe-fetch boundary (ADR-0028
 * `safe-fetch.ts` `isRobotsPathDisallowed()` + `RobotsDisallowedError`),
 * NOT as a standalone ADR-0017 RiskTrigger in v0. Source-level "no
 * scraping" / "no AI" / "no archive" / "no redistribution" terms are
 * codified at source registration time as
 * `archive_policy='do_not_collect'` and detected here as
 * terms_violation. Future ledger coupling of robots.txt enforcement
 * (safe-fetch RobotsDisallowedError → policy_decisions ledger row) is
 * tracked as `INFRA-1B.5.h3-robots-disallow-ledger-coupling` follow-up
 * anchor (planned, NOT gate-blocking, see IMPL_PLAN).
 *
 * Fires for any non-discovery collection-class action — discovery_fetch
 * (metadata-only RSS poll) is a borderline case but ADR-0017 §Decision
 * 단계별 default mode 에서 Discovery 도 위험 행동 inline_block 적용
 * 이므로 본 detector 도 discovery_fetch 포함.
 *
 * Codex PR #68 round 2 P1 finding fix: `external_llm_call_with_raw_text`
 * + `external_llm_call_with_excerpt` 가 allowlist 에서 누락되어 있던
 * 문제 — `archive_policy='do_not_collect'` 인 source 의 external LLM
 * 송신이 terms 의 "no AI / no redistribution" 조항을 우회. allowlist 에
 * 두 action 추가하여 fail-closed block.
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
    "external_llm_call_with_raw_text",
    "external_llm_call_with_excerpt",
  ];
  if (!collectionActions.includes(ctx.intendedAction)) return null;
  // Opus PR #66~#78 review F2: sourceId=null (unregistered source) general
  // fail-closed for ALL collection actions. Pre-fix, extract_full_text /
  // chunk_create / discovery_fetch with sourceId=null + archive='unknown'
  // sentinel fell through every detector and hit stage-default mode —
  // content_production stage default = batch_report → allow, silently
  // permitting full-text extraction on an unregistered source whose terms
  // are unknown by definition. Detector 1 (external_llm) already had this
  // fail-closed for LLM actions; detectors 5 / 7 / 8 cover quote / embed /
  // r2 paths via the archive≠full_snapshot_allowed branch. This generalizes
  // the unregistered-source fail-closed to the remaining extract / chunk /
  // discovery actions under the same terms_violation trigger ID — semantic
  // = "no source registry row → no proof of compliant terms → fail-closed".
  // The symmetric `evaluatePolicyGate` throw guard (sourceId=null requires
  // all 3 policies = 'unknown') prevents the orthogonal attack where a
  // caller fills sourceId=null with permissive policy values.
  if (ctx.sourceId === null) {
    return {
      trigger: "terms_violation",
      rationale: `sourceId=null (unregistered source — no source_material_policy row, terms compliance unproven) + intended_action=${ctx.intendedAction} — fail-closed`,
    };
  }
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
 *
 * Codex PR #68 round 3 P2 finding (sourceName missing fail-closed):
 * caller 가 등록된 source 의 sourceName 을 populate 안 한 경우
 * (`sourceName` 이 undefined / empty), 본 detector 는 wire-service 분류
 * 가능 여부를 판단할 수 없음. fail-closed 채택 — sourceId 가 있는데
 * sourceName 누락이면 trigger 4 fire (over-block). 운영자는 source
 * registry 의 sourceName field 가 항상 populated 되도록 강제 (registry
 * seed + caller path 모두). sourceId=null + sourceName 누락은 detector
 * 1 의 unregistered fail-closed 가 cover하므로 본 detector 는 sourceId
 * 가 있는 경우만 conservative block 으로 처리.
 */
function detectWireServiceFullText(
  ctx: RiskTriggerContext
): DetectedRisk | null {
  const fullTextActions: PipelineAction[] = ["extract_full_text", "chunk_create"];
  if (!fullTextActions.includes(ctx.intendedAction)) return null;
  // sourceName 누락 fail-closed (PR #68 round 3 P2). sourceId=null 경로는
  // detector 1 의 unregistered fail-closed 가 covering 하므로 본 detector
  // 의 sourceName-missing branch 는 sourceId 가 있을 때만 fire.
  const sourceNameMissing =
    ctx.sourceName === undefined || ctx.sourceName.trim().length === 0;
  if (sourceNameMissing) {
    if (ctx.sourceId === null) return null;
    return {
      trigger: "wire_service_full_text",
      rationale: `source_name missing for registered source (sourceId=${ctx.sourceId}) + intended_action=${ctx.intendedAction} — fail-closed wire-service suspect (caller must populate sourceName for full-text-class actions)`,
    };
  }
  if (!isWireService(ctx.sourceName)) return null;
  return {
    trigger: "wire_service_full_text",
    rationale: `source_name=${ctx.sourceName} matches wire-service allowlist (v0 hardcoded) + intended_action=${ctx.intendedAction}`,
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
 *
 * Runtime fail-closed guard (GPT review post-PR-#68 P2 finding 3 —
 * 운영자 결정 옵션 b+ 2026-05-17): the `default` branch is a TypeScript
 * `never`-exhaustiveness check at compile time + a runtime throw for
 * JS/raw callers that bypass the type system. Policy gate is a safety
 * boundary — any unknown stage MUST fail-closed (throw) rather than
 * default to a permissive mode.
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
    default: {
      const _exhaustive: never = stage;
      throw new Error(
        `stageDefaultMode: invalid stage (must be PIPELINE_STAGE enum): ${String(_exhaustive)}`
      );
    }
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

// ---------------------------------------------------------------------------
// Stage-action compatibility matrix (Codex PR #68 round 5 P1 finding 3 fix
// — 운영자 결정 옵션 (a) 2026-05-18 GPT review).
//
// v0 matrix is storage-class containment, NOT a full 5 stage × 11 action
// philosophical closure. The point is: storage-class actions (r2_upload /
// embed / chunk_create / raw_cache) must NOT fall into non-risk allow via
// stage default `batch_report` in content_production / interactive_
// exploration. r2_upload with permissive policies (archive=full +
// raw_cloud=allowed_public) in content_production stage is a caller
// stage-labeling bug, not a policy decision — throw rather than allow.
//
// Compatibility check is applied AFTER detectRisks() because INV-0017-4
// says risk triggers are mode-invariant inline_block. If a risk fires,
// the action is blocked regardless of stage — compatibility mismatch
// must NOT mask that risk block. Only non-risk evaluations consult this
// matrix.
//
// Future hardening: derive from a richer stage × action policy table as
// new actions / stages land (e.g., publication_preflight sub-stages).
// ---------------------------------------------------------------------------
const COMPATIBLE_ACTIONS_BY_STAGE: Record<PipelineStage, readonly PipelineAction[]> = {
  discovery: ["discovery_fetch"],
  extract_cache_embed_cloud_upload: [
    "extract_full_text",
    "raw_cache",
    "chunk_create",
    "embed",
    "r2_upload",
    "external_llm_call_with_raw_text",
    "external_llm_call_with_excerpt",
  ],
  interactive_exploration: [
    "discovery_fetch",
    "extract_full_text",
    "external_llm_call_with_raw_text",
    "external_llm_call_with_excerpt",
  ],
  content_production: [
    "discovery_fetch",
    "extract_full_text",
    "external_llm_call_with_raw_text",
    "external_llm_call_with_excerpt",
    "quote_storage",
    "image_inclusion",
  ],
  publication_preflight: [
    "publication_preflight",
    "quote_storage",
    "image_inclusion",
  ],
};

function assertStageActionCompatible(
  stage: PipelineStage,
  action: PipelineAction
): void {
  const allowed = COMPATIBLE_ACTIONS_BY_STAGE[stage];
  if (!allowed.includes(action)) {
    throw new Error(
      `evaluatePolicyGate: stage-action incompatibility — intendedAction=${action} is not compatible with stage=${stage} (compatible actions: ${allowed.join(", ")}). This is a call-site stage-labeling bug, not a policy decision. v0 matrix per Codex PR #68 round 5 P1 finding 3.`
    );
  }
}

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
  // Runtime fail-closed boundary guards (GPT review post-PR-#68 P2 finding
  // 3 — 운영자 결정 옵션 b+ 2026-05-17): TypeScript types catch this at
  // compile time, but JS / raw callers (test fixtures, future cross-
  // language bindings, manual REPL) MUST fail-closed on unknown stage
  // or intended_action. Policy gate is a safety boundary — silent
  // fallthrough to default mode would be a legal-safety regression.
  if (!isPipelineStage(input.stage)) {
    throw new Error(
      `evaluatePolicyGate: invalid stage (must be PIPELINE_STAGE enum): ${JSON.stringify(input.stage)}`
    );
  }
  if (!isPipelineAction(input.ctx.intendedAction)) {
    throw new Error(
      `evaluatePolicyGate: invalid intendedAction (must be PIPELINE_ACTION enum): ${JSON.stringify(input.ctx.intendedAction)}`
    );
  }
  // Codex PR #68 round 5 P1 fix — policy field runtime fail-closed
  // (Findings 1 + 2 — detectPaywalledSourceFetch / detectTermsViolation
  // silently returned non-risk for typo'd archivePolicy like
  // `full_snapshot_allowd` / `do_not_collet` → stage default fallback
  // bypass). The 3 source-policy fields accept the ArchivePolicy /
  // RawCloudPolicy / ExternalLlmPolicy enums + the literal "unknown"
  // sentinel (used for unregistered sources). Any other string is a
  // call-site bug — throw before any detector runs so the malformed
  // value cannot bypass trigger evaluation.
  if (
    input.ctx.archivePolicy !== "unknown" &&
    !isArchivePolicy(input.ctx.archivePolicy)
  ) {
    throw new Error(
      `evaluatePolicyGate: invalid archivePolicy (must be ARCHIVE_POLICY enum or 'unknown' sentinel): ${JSON.stringify(input.ctx.archivePolicy)}`
    );
  }
  if (
    input.ctx.rawCloudPolicy !== "unknown" &&
    !isRawCloudPolicy(input.ctx.rawCloudPolicy)
  ) {
    throw new Error(
      `evaluatePolicyGate: invalid rawCloudPolicy (must be RAW_CLOUD_POLICY enum or 'unknown' sentinel): ${JSON.stringify(input.ctx.rawCloudPolicy)}`
    );
  }
  if (
    input.ctx.externalLlmPolicy !== "unknown" &&
    !isExternalLlmPolicy(input.ctx.externalLlmPolicy)
  ) {
    throw new Error(
      `evaluatePolicyGate: invalid externalLlmPolicy (must be EXTERNAL_LLM_POLICY enum or 'unknown' sentinel): ${JSON.stringify(input.ctx.externalLlmPolicy)}`
    );
  }
  // Codex PR #68 round 6 P1 fix — registered source 의 `unknown` sentinel
  // fail-closed. `unknown` sentinel 은 documented use case 가 unregistered
  // source (sourceId === null) 만임. registered source (sourceId !== null)
  // 에 `unknown` 이 도달하면 source policy lookup / mapping bug —
  // restrictive default fallback 으로 silently allow 되어선 안 됨. throw
  // 로 fail-closed.
  if (input.ctx.sourceId !== null) {
    if (input.ctx.archivePolicy === "unknown") {
      throw new Error(
        `evaluatePolicyGate: registered source (sourceId=${JSON.stringify(input.ctx.sourceId)}) cannot have archivePolicy='unknown' — 'unknown' sentinel is for unregistered sources only. Likely source policy lookup bug.`
      );
    }
    if (input.ctx.rawCloudPolicy === "unknown") {
      throw new Error(
        `evaluatePolicyGate: registered source (sourceId=${JSON.stringify(input.ctx.sourceId)}) cannot have rawCloudPolicy='unknown' — 'unknown' sentinel is for unregistered sources only. Likely source policy lookup bug.`
      );
    }
    if (input.ctx.externalLlmPolicy === "unknown") {
      throw new Error(
        `evaluatePolicyGate: registered source (sourceId=${JSON.stringify(input.ctx.sourceId)}) cannot have externalLlmPolicy='unknown' — 'unknown' sentinel is for unregistered sources only. Likely source policy lookup bug.`
      );
    }
  }
  // Opus PR #66~#78 review F2: symmetric throw for the unregistered source
  // direction. `unknown` sentinel 은 unregistered source (sourceId === null)
  // 의 documented contract — registered source 가 'unknown' 을 가지면 위
  // throw 가 잡듯이, unregistered source 가 'unknown' 이 아닌 구체적
  // policy 값을 가지는 것도 call-site bug (caller 가 등록되지 않은 source
  // 에 임의의 permissive 값을 채워 넣는 경로). 이 throw 가 없으면 detector
  // 5/7/8 의 archive≠full_snapshot_allowed branch 가 caller 의 거짓
  // permissive 값에 속아 risk 를 누락시킬 수 있다. 이 boundary throw 는
  // sourceId=null 의 모든 policy 필드가 정확히 'unknown' 이어야 함을
  // 강제하여 detector 의 fail-closed 가설 (registered 만 구체 값을 가짐)
  // 을 유지한다.
  if (input.ctx.sourceId === null) {
    if (input.ctx.archivePolicy !== "unknown") {
      throw new Error(
        `evaluatePolicyGate: unregistered source (sourceId=null) must have archivePolicy='unknown' sentinel (got ${JSON.stringify(input.ctx.archivePolicy)}). Likely caller bug: filling source-policy fields on a source that lacks a source_material_policy row.`
      );
    }
    if (input.ctx.rawCloudPolicy !== "unknown") {
      throw new Error(
        `evaluatePolicyGate: unregistered source (sourceId=null) must have rawCloudPolicy='unknown' sentinel (got ${JSON.stringify(input.ctx.rawCloudPolicy)}). Likely caller bug: filling source-policy fields on a source that lacks a source_material_policy row.`
      );
    }
    if (input.ctx.externalLlmPolicy !== "unknown") {
      throw new Error(
        `evaluatePolicyGate: unregistered source (sourceId=null) must have externalLlmPolicy='unknown' sentinel (got ${JSON.stringify(input.ctx.externalLlmPolicy)}). Likely caller bug: filling source-policy fields on a source that lacks a source_material_policy row.`
      );
    }
  }
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
  // Codex PR #68 round 5 P1 finding 3 fix (운영자 결정 옵션 (a),
  // GPT review 2026-05-18): stage-action compatibility check is applied
  // ONLY on the non-risk path. INV-0017-4 requires risk triggers to
  // remain mode-invariant inline_block — compatibility throw must not
  // mask a risk block. See COMPATIBLE_ACTIONS_BY_STAGE comment for the
  // v0 storage-class containment rationale.
  assertStageActionCompatible(input.stage, input.ctx.intendedAction);
  const gateMode = stageDefaultMode(input.stage);
  const decision = modeToNonRiskDecision(gateMode);
  return {
    decision,
    gateMode,
    triggers: [],
    rationale: `non_risk_action stage=${input.stage} intended_action=${input.ctx.intendedAction} (stage-default mode)`,
  };
}
