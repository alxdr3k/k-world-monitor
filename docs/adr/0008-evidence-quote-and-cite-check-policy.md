---
id: adr-0008
type: adr
title: Evidence quote (≤200자 + locator + quote_hash) and cite check coverage
status: accepted
created_at: 2026-05-11
updated_at: 2026-05-11
deciders: [user, claude-opus-4-7, gpt]
supersedes: []
superseded_by: []

scope:
  in:
    - storage.sqlite.claim_table.evidence
    - pipeline.cite_check_layer
    - pipeline.cite_check_layer.stale_check
    - pipeline.cite_check_layer.horizon_check
    - pipeline.cite_check_layer.unit_check
    - pipeline.cite_check_layer.overclaim_check
    - pipeline.cite_check_layer.retracted_check
  out:
    - pipeline.scenario_layer.validate     # scenario validate는 ADR-0009
    - storage.sqlite.edge_table            # edge ledger는 ADR-0007

invariants:
  - id: INV-0008-1
    statement: claim의 evidence는 (quote, locator, quote_hash) 3-tuple을 가진다. quote는 ≤ 200자(NFR-005). 셋 중 하나라도 없는 evidence는 invalid다
    status: active
  - id: INV-0008-2
    statement: quote_hash는 normalized text의 sha256이다. 같은 quote 텍스트가 다른 hash를 내면 normalization drift로 cite check가 alert
    status: active
  - id: INV-0008-3
    statement: cite check는 다음 5종을 검출한다 — stale, retracted, horizon mismatch, unit mismatch, overclaim. cite check 실패 ContentDraft는 Publication으로 승격되지 않는다
    status: active
  - id: INV-0008-4
    statement: "원문 인용 전면 금지" 정책은 폐기됐다 (검증성을 파괴) — 짧은 quote + hash로 검증 가능하게 한다
    status: active

preconditions:
  - id: PRE-0008-1
    statement: text normalization 알고리즘이 정의돼 있다 (whitespace / quote 문자 / 줄바꿈 정규화)

defines:
  - term: evidence_quote
    role: primary

invariant_review:
  status: pending
  reviewed_at: null
  fingerprint: null
unresolved_warnings: []
reviewed_terms:
  - evidence_quote
  - claim
  - publication
reviewed_scopes:
  - storage.sqlite.claim_table.evidence
  - pipeline.cite_check_layer
  - pipeline.cite_check_layer.stale_check
  - pipeline.cite_check_layer.horizon_check
  - pipeline.cite_check_layer.unit_check
  - pipeline.cite_check_layer.overclaim_check
  - pipeline.cite_check_layer.retracted_check
  - pipeline.scenario_layer.validate
  - storage.sqlite.edge_table

provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true
---

# ADR-0008: Evidence quote and cite check coverage

## Status

accepted — 2026-05-11

## Context

ideation Round 2 비판 R8 — 원래 cite check는 "인용된 claim이 존재하는지"만 봤다.
실제 위험은 stale (claim은 살아있으나 출처가 갱신됨), horizon mismatch
(scenario는 1Y, 인용 claim은 1Q), unit mismatch (yoy vs mom), overclaim
(원문이 말하지 않은 강한 결론), retracted cascade다.

Round 2 비판 R9 — Round 1의 "원문 인용 전면 금지"는 검증성 자해다. 짧은 quote
는 fair-use 범위에서 허용 가능하고, 검증의 핵심이다. Round 3에서 사용자가 짧은
quote + hash 정책으로 결정.

## Decision

evidence 정책:

- claim 당 evidence = (quote, locator, quote_hash)
- quote ≤ 200자 (NFR-005)
- locator: page / section / line range (snapshot 안에서의 위치)
- quote_hash: normalized text의 sha256 (whitespace / quote 문자 / 줄바꿈 정규화 후)
- 셋 중 하나라도 비면 invalid claim

cite check 5종 (모두 implementation 의무):

| 검사 | 트리거 |
|---|---|
| stale | 인용 claim의 claim_status=stale or 인용 snapshot이 newer revision 보유 |
| retracted | 인용 claim의 claim_status=retracted (cascade로 Publication corrected) |
| horizon mismatch | scenario.horizon ≠ claim.horizon (Q-001 enum 정의 후 enforce) |
| unit mismatch | claim.unit_metadata vs ContentDraft 표현 비교 (yoy/mom/qoq/etc) |
| overclaim | LLM 비교 prompt: ContentDraft 문장 vs evidence quote의 원의미 강도 |

cite check 실패 시 ContentDraft state를 reviewing으로 되돌린다. pass 없이는
Publication 승격 금지.

## Alternatives Considered

- **A** (chosen): 짧은 quote(≤200자) + locator + quote_hash + 5종 cite check
  - pros: 검증성 + 운영자 빠른 검토 + cascade 자동화
  - cons: cite check 5종 구현 비용
- **B** (discarded — Round 1): 원문 인용 전면 금지 + locator만
  - pros: 라이선스 완전 안전
  - cons: 검증 불가능, 운영자가 매번 출처 열어야 함 (Round 2 비판 R9)
- **C** (discarded): quote 길이 무제한
  - pros: 풍부한 컨텍스트
  - cons: fair-use / 라이선스 위험, hash 정렬 비용 — 200자로 제한 (NFR-005)
- **D** (discarded): cite check를 stale 검출만
  - pros: 단순
  - cons: horizon / unit / overclaim 검출 안 되면 콘텐츠 신뢰 무너짐 (Round 2
    비판 R8)

## Consequences

- 긍정:
  - 5단계 trace의 마지막 단계(quote → R2 bytes)가 hash로 무결성 보장
  - cascade 자동화로 retracted/stale 콘텐츠 정정 자동 트리거
  - cite check가 publish gate로 작동

- 부정 / trade-off:
  - normalization 알고리즘 정의 부담 (PRE-0008-1)
  - overclaim 검출은 LLM 호출 (비용 있음, run_ ledger 기록)
  - horizon enum 정의(Q-001) 전에는 horizon check가 placeholder

- 후속 작업:
  - INFRA-1B 단계: text normalization util + sha256 helper
  - PUB-1A 단계: cite check 5종 구현
  - Q-001 horizon enum 정의 후 horizon check enforce

## References

- ideation: Round 2 비판 R8/R9 / Round 3 결정 (9)(11)
- 관련 ADR: ADR-0003, ADR-0007, ADR-0009
