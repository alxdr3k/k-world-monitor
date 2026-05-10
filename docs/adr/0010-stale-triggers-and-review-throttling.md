---
id: adr-0010
type: adr
title: Stale triggers (time / snapshot diff / counterclaim) and review queue throttling
status: accepted
created_at: 2026-05-11
updated_at: 2026-05-11
deciders: [user, claude-opus-4-7]
supersedes: []
superseded_by: []

scope:
  in:
    - pipeline.extraction_layer.review_throttling
    - pipeline.cite_check_layer.stale_check
    - storage.sqlite.claim_table.claim_status
    - pipeline.scenario_layer.cascade
  out:
    - pipeline.extraction_layer.routing    # routing은 ADR-0006
    - storage.sqlite.edge_table            # edge ledger는 ADR-0007

invariants:
  - id: INV-0010-1
    statement: claim의 stale 전이 트리거는 (a) 시간 기반 (b) snapshot diff 기반 (c) counterclaim 등록 시 셋 다 적용한다. 어느 하나라도 누락은 정책 위반
    status: active
  - id: INV-0010-2
    statement: review queue auto-confirm 조건은 reliability_tier=high ∧ extraction_confidence ≥ 0.85 (ADR-0006 INV-0006-4와 동치). 이외 모든 claim은 reviewer queue에 적재한다
    status: active
  - id: INV-0010-3
    statement: stale로 전이된 claim을 인용하는 ContentDraft / Publication은 cascade 알림을 받는다 (ADR-0008 cite check stale_check가 lake source)
    status: active

preconditions:
  - id: PRE-0010-1
    statement: ADR-0008 cite check가 stale_check를 구현해 cascade 진입점 제공
  - id: PRE-0010-2
    statement: 시간 기반 stale의 임계값(주제별 stale_after)은 Q-002 결정 후 활성화. 그 전에는 default 30일 placeholder

defines: []

invariant_review:
  status: pending
  reviewed_at: null
  fingerprint: null
unresolved_warnings: []
reviewed_terms:
  - claim
  - reliability_tier
  - extraction_confidence
reviewed_scopes:
  - pipeline.extraction_layer.review_throttling
  - pipeline.cite_check_layer.stale_check
  - storage.sqlite.claim_table.claim_status
  - pipeline.scenario_layer.cascade
  - pipeline.extraction_layer.routing
  - storage.sqlite.edge_table

provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true
---

# ADR-0010: Stale triggers and review queue throttling

## Status

accepted — 2026-05-11

## Context

ideation Round 3 Claude 메타 리뷰 A2 — stale 트리거를 단일 기준(시간만)으로
두면 (a) 시간 안 지나도 출처가 바뀐 경우 (b) 직접 반박 자료가 등록된 경우를
놓친다. A3 — review queue가 모든 claim을 사람에게 던지면 burnout. high
reliability + 고신뢰도 추출은 자동 confirm.

## Decision

stale 전이 트리거(셋 다 적용):

| 트리거 | 조건 |
|---|---|
| time | `now > snapshot.fetched_at + dossier.stale_after` (Q-002 결정 후, 그 전에는 default 30일 placeholder) |
| snapshot_diff | 같은 Document에 새 Snapshot이 fetch되고 sha256 변경 |
| counterclaim | edge_ledger에 contradicts edge가 등록됨 (provenance ∈ {user_confirmed, llm_inferred}) |

셋 중 하나라도 만족하면 claim_status: confirmed → stale 전이.

review queue throttling:

```
incoming claim → routing(ADR-0006)
  ├── reliability_tier=high ∧ extraction_confidence ≥ 0.85 → claim_status: draft → confirmed (auto)
  └── otherwise → reviewer queue → reviewer 결정 후 confirmed/disputed/dropped
```

## Alternatives Considered

- **A** (chosen): 3-trigger stale + auto-confirm threshold
  - pros: 출처 갱신 / 반박 등록도 stale로 잡음, reviewer 부담 감소
  - cons: snapshot diff 매번 sha256 비교 (비용은 작음)
- **B** (discarded — Round 1): 시간 기반 stale만
  - pros: 단순
  - cons: 출처 갱신 / 반박 등록 놓침 (Round 3 메타 리뷰 A2)
- **C** (discarded): 모든 claim reviewer queue
  - pros: 사람 검수 100%
  - cons: 운영자 burnout (Round 3 메타 리뷰 A3)

## Consequences

- 긍정:
  - stale cascade 자동화 — Publication 정정 트리거 가능
  - reviewer queue 부담 감소
  - high reliability 출처에 대한 빠른 통과

- 부정 / trade-off:
  - auto-confirm threshold(0.85)의 fp 위험 — 첫 50건 manual 비교로 보정 (SPIKE-002)
  - snapshot_diff 트리거는 polling 주기에 의존 (cron / push)

- 후속 작업:
  - Q-002 결정 후 dossier별 stale_after 적용
  - SPIKE-002: auto-confirm threshold 보정
  - INFRA-1B 단계: stale 트리거 cron + sha256 diff worker

## References

- ideation: Round 3 메타 리뷰 A2/A3 / Round 3 결정 (15)(16)
- 관련 ADR: ADR-0006, ADR-0008, ADR-0009
