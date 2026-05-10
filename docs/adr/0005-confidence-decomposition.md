---
id: adr-0005
type: adr
title: Confidence decomposition (reliability_tier / extraction_confidence / claim_status / scenario weight)
status: accepted
created_at: 2026-05-11
updated_at: 2026-05-11
deciders: [user, claude-opus-4-7, gpt]
supersedes: []
superseded_by: []

scope:
  in:
    - storage.sqlite.document_table.reliability_tier
    - storage.sqlite.claim_table.extraction_confidence
    - storage.sqlite.claim_table.claim_status
    - storage.sqlite.scenario_table.assumptions_weight
  out:
    - pipeline.extraction_layer.routing      # auto-accept threshold는 ADR-0006
    - storage.sqlite.edge_table              # edge ledger는 ADR-0007

invariants:
  - id: INV-0005-1
    statement: reliability_tier ∈ {high, medium, low, unknown}는 Document 단위 속성이다 (Claim에 직접 두지 않는다)
    status: active
  - id: INV-0005-2
    statement: extraction_confidence (0-1)는 Claim 단위 속성이며 LLM 추출 경로에서만 채워진다 (manual_intake는 null)
    status: active
  - id: INV-0005-3
    statement: claim_status ∈ {draft, confirmed, disputed, stale, retracted}는 Claim 단위 lifecycle이다 (frontmatter ledger 변경으로만 전이)
    status: active
  - id: INV-0005-4
    statement: scenario assumptions[] weight (0-1)는 scenario 안의 속성이며 claim 자체의 confidence가 아니다
    status: active
  - id: INV-0005-5
    statement: 단일 confidence 필드는 도입하지 않는다 (reliability / extraction / lifecycle / scenario weight 5개념을 섞으면 routing 정책이 무너진다)
    status: active
  - id: INV-0005-6
    statement: evidence_strength는 별도 필드로 두지 않는다. claim_status + reliability_tier로 파생한다
    status: active

preconditions: []

defines:
  - term: reliability_tier
    role: primary
  - term: extraction_confidence
    role: primary

invariant_review:
  status: pending
  reviewed_at: null
  fingerprint: null
unresolved_warnings: []
reviewed_terms:
  - reliability_tier
  - extraction_confidence
  - claim
reviewed_scopes:
  - storage.sqlite.document_table.reliability_tier
  - storage.sqlite.claim_table.extraction_confidence
  - storage.sqlite.claim_table.claim_status
  - storage.sqlite.scenario_table.assumptions_weight
  - pipeline.extraction_layer.routing
  - storage.sqlite.edge_table

provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true
---

# ADR-0005: Confidence decomposition

## Status

accepted — 2026-05-11

## Context

ideation Round 2 비판 R3 — 단일 `confidence: 0-1` 필드는 5개 개념을 한 곳에
섞는다.

1. 출처 reliability (Document 속성)
2. LLM extraction confidence (Claim 속성, LLM 추출 경로 한정)
3. evidence strength (보조 개념)
4. lifecycle status (Claim 속성, enum)
5. scenario weight (scenario 안의 assumption 속성)

섞이면 routing(extractor가 Sonnet으로 escalate해야 하는지), review queue
throttling(자동 confirm 가능한지), scenario validate(weight 누락 여부)
정책이 모두 깨진다. Round 3에서 evidence_strength는 파생 가능 → 별도 필드
미도입.

## Decision

다음과 같이 분해한다.

| 개념 | 위치 | 형식 |
|---|---|---|
| reliability_tier | Document | enum {high, medium, low, unknown} |
| extraction_confidence | Claim | float 0-1 (LLM only, else null) |
| claim_status | Claim | enum {draft, confirmed, disputed, stale, retracted} |
| scenario assumption weight | Scenario.assumptions[].weight | float 0-1 |
| evidence_strength | (derived) | claim_status + reliability_tier로 view 계산 |

단일 `confidence` 필드는 영구 폐기.

## Alternatives Considered

- **A** (chosen): 4분해 + evidence_strength는 derived
  - pros: routing/review/scenario validate 정책이 명확, drift 차단
  - cons: 필드 4개로 frontmatter / 스키마 부담 증가
- **B** (discarded — Round 1): 단일 confidence (0-1)
  - pros: 단순
  - cons: routing 정책 표현 불가, scenario weight와 claim status 혼동
- **C** (discarded — Round 2 GPT 초안): 5분해 (evidence_strength 별도)
  - pros: 가장 명시적
  - cons: evidence_strength는 status + reliability에서 파생 가능, 중복 — Round
    3 Claude 메타 리뷰에서 제외

## Consequences

- 긍정:
  - LLM routing(ADR-0006) auto-accept threshold가 reliability_tier ∧
    extraction_confidence 조합으로 명확히 표현 가능
  - scenario validate가 assumption weight 누락을 차단 가능
  - claim_status lifecycle을 별도 ledger로 추적 가능

- 부정 / trade-off:
  - 새 필드 4개에 대한 schema validator 필요
  - manual_intake claim의 extraction_confidence=null 처리 로직 필요

- 후속 작업:
  - SQLite 스키마에 4 필드 적용 (INFRA-1A.2 slice)
  - ADR-0006 auto-accept threshold lock (이 ADR 의존)
  - 글로서리 reliability_tier, extraction_confidence 작성 (완료)

## References

- ideation: Round 2 비판 R3 / Round 3 결정 (8)
- 관련 ADR: ADR-0003, ADR-0006
