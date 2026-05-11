---
id: adr-0015
type: adr
title: Evidence (nullable quote + quote_reason + storage_level) and cite check 5-check + 6th warning (supersedes ADR-0008)
status: accepted
created_at: 2026-05-11
updated_at: 2026-05-11
deciders: [user, claude-opus-4-7, gpt]
supersedes: [adr-0008]
superseded_by: []

scope:
  in:
    - storage.neo4j.claim_node.evidence
    - storage.policy.quote_reason
    - storage.policy.storage_level
    - pipeline.cite_check_layer
    - pipeline.cite_check_layer.stale_check
    - pipeline.cite_check_layer.horizon_check
    - pipeline.cite_check_layer.unit_check
    - pipeline.cite_check_layer.overclaim_check
    - pipeline.cite_check_layer.retracted_check
    - pipeline.cite_check_layer.access_intervention_check
    - pipeline.cite_check_layer.bidirectional_warning
  out:
    - pipeline.scenario_layer.validate     # scenario validate는 ADR-0009
    - storage.neo4j.edges                  # edge ledger는 ADR-0013

invariants:
  - id: INV-0015-1
    statement: claim의 evidence는 (quote, locator, quote_hash, quote_reason, storage_level) 5-tuple이다. quote는 schema-level nullable이며 storage_level=excerpt_evidence일 때만 채워진다. quote가 채워진 경우 ≤ 200자 + quote_reason 명시 필수 (R10/Q5, R14/Q9-4)
    status: active
  - id: INV-0015-2
    statement: quote_reason ∈ {exact_wording_matters, policy_language_analysis, direct_publication_quote, rebuttal_or_critique}. 없으면 quote 저장 금지 (cite check inline_block)
    status: active
  - id: INV-0015-3
    statement: storage_level ∈ {transient_only, metadata_only, metadata_hash_locator, excerpt_evidence}. default는 transient_only. dataset_vintage / licensed_full_snapshot은 storage_level이 아닌 별개 객체로 분류 (R10/Q5)
    status: active
  - id: INV-0015-4
    statement: quote_hash는 normalized text의 sha256이다. 같은 quote 텍스트가 다른 hash를 내면 normalization drift로 cite check alert (ADR-0008 INV-0008-2 보존)
    status: active
  - id: INV-0015-5
    statement: cite check는 v0에서 5종을 block한다 — stale, retracted, horizon mismatch, unit mismatch, overclaim. cite check block 시 ContentDraft는 Publication으로 승격되지 않는다 (ADR-0008 INV-0008-3 보존)
    status: active
  - id: INV-0015-6
    statement: cite check 5번째 block check 추가 — unresolved HIGH/CRITICAL access_intervention(status=pending_user_review, ADR-0018)을 핵심 근거로 인용 시 inline_block. severity LOW/MEDIUM은 hint로만 사용 가능 (R18)
    status: active
  - id: INV-0015-7
    statement: cite check 6번째는 v1+ warning(block 아님) — thesis.stance/market_stance가 한쪽 방향으로 강하게 기울었는데 opposing_evidence/mitigating_factors/uncertainty_factors가 비어 있을 때 warn (R23/R25 bidirectional framing)
    status: active
  - id: INV-0015-8
    statement: "원문 인용 전면 금지" 정책은 폐기됐다 (검증성을 파괴). 짧은 quote + quote_reason + hash로 검증 가능하게 한다. 다만 default는 비저장 (storage_level=transient_only) — 정당한 사유 있을 때만 excerpt_evidence로 격상

preconditions:
  - id: PRE-0015-1
    statement: text normalization 알고리즘이 정의돼 있다 (whitespace / quote 문자 / 줄바꿈 정규화)
  - id: PRE-0015-2
    statement: access_intervention severity 산정(ADR-0018) 후 5번째 block check가 활성화됨
  - id: PRE-0015-3
    statement: thesis.stance/market_stance + impact_targets (ADR-0019) 도입 후 6번째 warning check가 활성화됨

defines:
  - term: evidence_quote
    role: primary
  - term: quote_reason
    role: primary
  - term: storage_level
    role: primary

invariant_review:
  status: pending
  reviewed_at: null
  fingerprint: null
unresolved_warnings: []
reviewed_terms:
  - evidence_quote
  - quote_reason
  - storage_level
  - claim
  - thesis
  - publication
  - access_intervention
reviewed_scopes:
  - storage.neo4j.claim_node.evidence
  - storage.policy.quote_reason
  - storage.policy.storage_level
  - pipeline.cite_check_layer
  - pipeline.cite_check_layer.stale_check
  - pipeline.cite_check_layer.horizon_check
  - pipeline.cite_check_layer.unit_check
  - pipeline.cite_check_layer.overclaim_check
  - pipeline.cite_check_layer.retracted_check
  - pipeline.cite_check_layer.access_intervention_check
  - pipeline.cite_check_layer.bidirectional_warning
  - pipeline.scenario_layer.validate
  - storage.neo4j.edges

provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true
---

# ADR-0015: Evidence (nullable + quote_reason + storage_level) and cite check 5+1

## Status

accepted — 2026-05-11. Supersedes ADR-0008.

## Context

ADR-0008(Round 3 lock)은 짧은 quote(≤200자) + locator + quote_hash를 evidence로
"허용"했고 cite check 5종(stale/retracted/horizon/unit/overclaim)을 정의했다.
ideation은 이 결정을 두 번 supersede했다:

- **Round 10/Q5**: 짧은 quote 기본 허용 → **기본 nullable + quote_reason
  enum 필수**로 강화. storage_level 4단계(L0~L3) + 별개 객체(dataset_vintage /
  licensed_full_snapshot) 신설.
- **Round 11/Q6**: 시각 자료(스크린샷/캡처/방송 클립) visual_policy enum 신설
  (별도 ADR — 본 ADR은 텍스트 quote만 다룸).
- **Round 18**: publication preflight v0 4-check → 5-check 확장 (unresolved
  HIGH/CRITICAL access_intervention 핵심 근거 사용 금지).
- **Round 23/R25**: 6번째 check 추가 (one-sided thesis warning, block 아닌
  warning). bidirectional framing(ADR-0019)과 연결.

## Decision

**evidence 정책**:

claim 당 evidence = (quote, locator, quote_hash, quote_reason, storage_level)

| 필드 | 타입 | 비고 |
|---|---|---|
| quote | string nullable | ≤ 200자 (NFR-005). default null (저장 안 함) |
| locator | string | page / section / line range. 모든 evidence에 필수 |
| quote_hash | string nullable | quote 채워진 경우 normalized text의 sha256 |
| quote_reason | enum nullable | quote 채워진 경우 필수. {exact_wording_matters, policy_language_analysis, direct_publication_quote, rebuttal_or_critique} |
| storage_level | enum | {transient_only, metadata_only, metadata_hash_locator, excerpt_evidence}. default transient_only |

**storage_level 4단계** (R10/Q5):
- `transient_only` (L0, default) — 메모리/local tmp에서만 처리, finalize 시 삭제
- `metadata_only` (L1) — URL / title / publisher / accessed_at만 저장
- `metadata_hash_locator` (L2) — + content_hash + locator
- `excerpt_evidence` (L3) — + quote + quote_reason (인용 사유 명시)

별개 객체 (storage_level이 아닌 별도 분류):
- `dataset_vintage` (open license dataset의 observation_date + vintage_date)
- `licensed_full_snapshot` (예외적 라이선스 허용 시)

**cite check 5종 (모두 v0 block)**:

| 검사 | 트리거 |
|---|---|
| stale | 인용 claim의 claim_status ∈ {stale, source_changed, source_unavailable, needs_recorroboration} or 인용 snapshot이 newer revision 보유 (R9/Q4 claim_status 확장 반영) |
| retracted | 인용 claim의 claim_status=retracted (cascade로 Publication corrected) |
| horizon mismatch | scenario.horizon ≠ claim.horizon (Q-001 enum 결정 후 enforce) |
| unit mismatch | claim.unit_metadata vs ContentDraft 표현 비교 (yoy/mom/qoq/etc) |
| overclaim | LLM 비교 prompt: ContentDraft 문장 vs evidence quote의 원의미 강도. quote 없으면 overclaim 검출 약화 (운영자가 매번 출처 검토 필요) |

**5번째 block 추가 (R18)**: **unresolved HIGH/CRITICAL access_intervention**
(ADR-0018)을 핵심 근거로 인용 시 inline_block. severity LOW/MEDIUM은 hint로만.

**6번째 warning (R23/R25, v1+)**: **one-sided thesis warning** — thesis.stance
또는 thesis.market_stance가 한쪽으로 강하게 기울었는데 EvidencePack의
opposing_evidence / mitigating_factors / uncertainty_factors가 비어 있을 때
warn (block 아님). bidirectional framing(ADR-0019) 활성화 후 enforce.

cite check 1~5 block 시 ContentDraft state를 reviewing으로 되돌린다. 6번째
warning은 reviewer가 명시적으로 dismiss 가능.

## Alternatives Considered

- **A** (chosen): nullable quote + quote_reason 필수 + storage_level 4단계 +
  5 block + 1 warning
  - pros: default 비저장으로 저작권/약관 안전, 정당한 사유 명시로 fair-use
    범위, bidirectional framing과 자연스러운 통합
  - cons: quote 비어있을 때 overclaim 검출 약화 (운영자 검토 부담 ↑)
- **B** (discarded — ADR-0008): 짧은 quote 기본 허용
  - pros: overclaim 검출 강력
  - cons: default 저장 → 저작권/약관 위험 (R10/Q5에서 폐기)
- **C** (discarded — Round 1): 원문 인용 전면 금지
  - cons: 검증 불가, 운영자가 매번 출처 열어야 함 (ADR-0008 본문 보존)
- **D** (discarded — R10/Q5 GPT 안): storage_level 5단계 (L0~L5)
  - pros: 더 명시적
  - cons: L4(dataset)와 L5(full snapshot)는 storage *level*이 아닌 별개 storage
    *kind* — 별개 객체로 분리(R10/Q5 Claude push back)

## Consequences

- 긍정:
  - default 비저장으로 저작권/약관/평판 안전 (R8/Q3 시스템 정체성과 일관)
  - quote_reason로 인용 사유 audit 가능
  - 5번째 access_intervention check로 publication core evidence가 보장된 source
    에서만 나옴
  - 6번째 warning으로 bidirectional framing 자연스러운 enforce

- 부정 / trade-off:
  - quote 비어있을 때 overclaim 검출은 LLM 호출 시 원문 비교 불가 → 운영자
    수동 검토 부담 증가
  - normalization 알고리즘 정의 부담(PRE-0015-1) ADR-0008과 동일
  - 6th warning은 ADR-0019 활성화 후에만 enforce (v1+)

- 후속 작업:
  - INFRA-1A.5 slice: text normalization util + sha256 helper
  - INFRA-1B 단계: storage_level enum + quote_reason enum migration
  - PUB-1A 단계: cite check 5종 block 구현 + 6번째 warning v1+ 후속
  - Q-001 horizon enum 정의 후 horizon check enforce
  - ADR-0018 access_intervention severity 산정 활성화 후 5번째 block enforce
  - ADR-0019 thesis.stance/market_stance 활성화 후 6번째 warning enforce

## References

- ideation 출처: Round 3 결정 (9)(11) (ADR-0008 보존), Round 10/Q5 (quote
  nullable + quote_reason + storage_level), Round 11/Q6 (visual_policy —
  별도 ADR), Round 18 (5번째 access_intervention block), Round 23/R25 (6번째
  bidirectional warning)
- Supersedes: ADR-0008
- 관련 ADR: ADR-0011, ADR-0012, ADR-0013, ADR-0017, ADR-0018, ADR-0019
