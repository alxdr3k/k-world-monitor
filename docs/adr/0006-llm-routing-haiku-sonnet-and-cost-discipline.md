---
id: adr-0006
type: adr
title: LLM routing — Haiku 1차 + Sonnet escalate, prompt caching, batch API, auto-accept threshold
status: superseded
created_at: 2026-05-11
updated_at: 2026-05-11
deciders: [user, claude-opus-4-7]
supersedes: []
superseded_by: [adr-0023]

scope:
  in:
    - pipeline.extraction_layer.routing
    - pipeline.extraction_layer.review_throttling
    - storage.sqlite.run_table.cost_ledger
    - pipeline.extraction_layer.parser_split
  out:
    - storage.neo4j.claim_node.fields    # claim 필드 자체는 ADR-0005; ADR-0012 Claim moved to Neo4j
    - pipeline.scenario_layer.validate     # scenario validate는 ADR-0009
    - pipeline.cite_check_layer            # cite check는 ADR-0008

invariants:
  - id: INV-0006-1
    statement: 기본 LLM은 Haiku 4.5 (1차 추출). Sonnet 4.6은 reliability_tier ∈ {medium, low} ∨ extraction_confidence < 0.85 인 경우에만 escalate한다
    status: active
  - id: INV-0006-2
    statement: extractor는 article(LLM) / dataset(parser) / report(LLM with structure prompt) 3종으로 분리한다. 단일 LLM extractor로 통합 처리 금지
    status: active
  - id: INV-0006-3
    statement: prompt caching + batch API를 사용한다 (NFR-004 비용 상한 충족 위함)
    status: active
  - id: INV-0006-4
    statement: review queue는 auto-accept한다 — reliability_tier=high ∧ extraction_confidence ≥ 0.85
    status: active
  - id: INV-0006-5
    statement: 모든 LLM 호출은 run_ ledger에 (model, tokens_in, tokens_out, cost, cached_tokens, batch_id?)를 기록한다
    status: active

preconditions:
  - id: PRE-0006-1
    statement: Anthropic SDK가 Haiku 4.5 (`claude-haiku-4-5-20251001`) + Sonnet 4.6 (`claude-sonnet-4-6`) 모델 ID로 호출 가능
  - id: PRE-0006-2
    statement: prompt caching API 가용
  - id: PRE-0006-3
    statement: batch API 가용 (대량 비동기 추출용)

defines: []

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
  - pipeline.extraction_layer.routing
  - pipeline.extraction_layer.review_throttling
  - storage.sqlite.run_table.cost_ledger
  - pipeline.extraction_layer.parser_split
  - storage.neo4j.claim_node.fields
  - pipeline.scenario_layer.validate
  - pipeline.cite_check_layer

provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true
---

# ADR-0006: LLM routing — Haiku 1차 + Sonnet escalate

## Status

accepted — 2026-05-11

## Context

ideation Round 3 Claude 메타 리뷰 A1 — GPT는 비용 모델을 다루지 않았다. 대량
수집 환경에서는 LLM 비용 제어가 곧 운영 가능성이다. 동시에 Round 2 비판 R6 —
article과 dataset을 같은 LLM 추출로 다루면 dataset의 정밀도가 깨진다.

운영자 환경: 1인 운영, 비용 상한 일별 고정 필요(PRD NFR-004), Haiku는 빠르고
저렴하지만 long-tail에서 hallucination이 늘어남.

## Decision

라우팅:

```
Snapshot → extractor split
  ├── article(text) → Haiku 4.5 (extract_claims prompt)
  ├── dataset(table/csv/api) → parser (LLM 미사용)
  └── report(structured PDF) → Haiku 4.5 with structure prompt

extraction result → confidence gate
  ├── reliability_tier=high ∧ extraction_confidence ≥ 0.85 → auto-confirm
  ├── reliability_tier ∈ {medium, low} → reviewer queue
  └── extraction_confidence < 0.85 → Sonnet 4.6 re-extract → reviewer queue
```

Cost discipline:

- prompt caching (system + extractor schema는 cached prefix)
- batch API (큐에 쌓인 snapshot은 batch로 묶음)
- run_ ledger에 model / tokens / cost / cached_tokens / batch_id 기록
- 일별 비용 threshold 초과 시 큐 throttling (시끄럽지 않게 backoff)

## Alternatives Considered

- **A** (chosen): Haiku 1차 + Sonnet escalate + parser split + prompt caching + batch + auto-accept threshold
  - pros: NFR-004 비용 상한 충족, dataset 정밀도 보장, reviewer queue 부담 감소
  - cons: 라우팅 로직 복잡도, escalate 결정 룰의 변화에 민감
- **B** (discarded): Sonnet only
  - pros: 단순, 정확도 균일
  - cons: 비용 폭증, 일별 상한 초과
- **C** (discarded): Haiku only
  - pros: 가장 저렴
  - cons: 저신뢰 출처 / low confidence 결과를 reviewer가 모두 떠안음 — burnout
- **D** (discarded): 단일 LLM extractor로 article/dataset/report 통합
  - pros: 코드 단순
  - cons: dataset 정밀도 손실 (Round 2 비판 R6) — parser 분리 필수

## Consequences

- 긍정:
  - 비용 모델 예측 가능 (대부분 Haiku, escalate 비율 추적)
  - reviewer queue throttling으로 사람 부담 감소
  - parser 분리로 dataset 정밀도 유지

- 부정 / trade-off:
  - escalate threshold(0.85)는 운영 데이터로 보정 필요 (초기 추정치)
  - prompt caching 적중률에 따라 비용 변동 — 모니터링 필요
  - batch API 사용 시 latency 증가 (큐 기반이라 수용)

- 후속 작업:
  - INFRA-1B 단계에서 routing 코드 + run_ ledger 구현
  - threshold 0.85의 첫 50건 manual review 비교로 보정 (SPIKE-002 후보)
  - `Anthropic SDK` 호출 예제는 `docs/current/RUNTIME.md`에 추가

## References

- ideation: Round 3 A1 (LLM 비용), Round 2 비판 R6 (extractor 분리), Round 3
  결정 (12)(13)
- 관련 ADR: ADR-0005, ADR-0010
