---
id: adr-0009
type: adr
title: Scenario validate (falsifier/counterclaim 강제) and scenario_revisions ledger
status: accepted
created_at: 2026-05-11
updated_at: 2026-05-11
deciders: [user, claude-opus-4-7, gpt]
supersedes: []
superseded_by: []

scope:
  in:
    - pipeline.scenario_layer.validate
    - storage.sqlite.scenario_table
    - storage.sqlite.scenario_revisions
    - pipeline.scenario_layer.edge_query
  out:
    - pipeline.cite_check_layer            # cite check는 ADR-0008
    - pipeline.extraction_layer.routing    # routing은 ADR-0006

invariants:
  - id: INV-0009-1
    statement: scenario validate는 다음을 검출한다 — assumption weight 누락, branch 누락(최소 2개), falsifier 누락(branch 당 ≥ 1), counterclaim 누락(scenario 당 ≥ 1 또는 명시 "no_counterclaim_known" + rationale), monitoring signal 누락(branch 당 ≥ 1)
    status: active
  - id: INV-0009-2
    statement: scenario 변경은 새 row를 scenario_revisions ledger에 추가하는 방식으로만 표현한다 (in-place mutation 금지)
    status: active
  - id: INV-0009-3
    statement: scenario revision 간 lineage는 supersedes / updates edge로 추적한다 (ADR-0007 edge ledger)
    status: active
  - id: INV-0009-4
    statement: ContentDraft가 scenario를 인용할 때는 scenario_id + revision_id를 모두 보존한다 (NFR-003 5-step trace의 무결성)
    status: active

preconditions:
  - id: PRE-0009-1
    statement: ADR-0007 edge ledger가 도입돼 있다 (supersedes / updates edge 의존)
  - id: PRE-0009-2
    statement: ADR-0008 cite check가 horizon mismatch를 검출 가능 (Q-001 horizon enum 결정 후 활성화)

defines: []

invariant_review:
  status: pending
  reviewed_at: null
  fingerprint: null
unresolved_warnings: []
reviewed_terms:
  - scenario
  - claim
  - edge
reviewed_scopes:
  - pipeline.scenario_layer.validate
  - storage.sqlite.scenario_table
  - storage.sqlite.scenario_revisions
  - pipeline.scenario_layer.edge_query
  - pipeline.cite_check_layer
  - pipeline.extraction_layer.routing

provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true
---

# ADR-0009: Scenario validate and revisions ledger

## Status

accepted — 2026-05-11

## Context

ideation Round 2 비판 R3 — confirmed claim만 가진 scenario는 cherry-picking
유발. Round 3 Claude 메타 리뷰 A4 — scenario는 시간에 따라 진화한다. in-place
mutation은 NFR-002 reproducibility를 깨뜨린다 (다른 작업자가 같은 scenario에
도달 불가).

## Decision

scenario validate 의무 검사:

| 검사 | 임계 |
|---|---|
| assumption weight 누락 | assumptions[].weight 가 모든 entry에 채워졌는가 |
| branch 누락 | branches[] 길이 ≥ 2 |
| falsifier 누락 | branches[].falsifiers[] 길이 ≥ 1 |
| counterclaim 누락 | scenario.counterclaims[] 길이 ≥ 1, 또는 명시 `no_counterclaim_known` + rationale |
| monitoring signal 누락 | branches[].monitoring_signals[] 길이 ≥ 1 |

scenario_revisions ledger:

| 컬럼 | 타입 | 비고 |
|---|---|---|
| revision_id | TEXT PK | `scn_<id>_r<n>` |
| scenario_id | TEXT NOT NULL | base scenario id |
| revision_no | INTEGER NOT NULL | 단조 증가 |
| created_at | TEXT NOT NULL | ISO8601 |
| created_by | TEXT NOT NULL | run_id 또는 user |
| body_snapshot | TEXT NOT NULL | scenario 본문(JSON serialized) |
| change_summary | TEXT | 한 줄 요약 |

revision 간 lineage는 edge ledger의 supersedes / updates로 추적
(ADR-0007 결합).

## Alternatives Considered

- **A** (chosen): 강제 검사 5종 + revisions ledger + edge로 lineage
  - pros: cherry-picking 차단, reproducibility 보장, lineage query 가능
  - cons: validate 책임 + ledger 운영 부담
- **B** (discarded — Round 1): scenario in-place mutation
  - pros: 단순
  - cons: NFR-002 reproducibility 깨짐, 같은 ContentDraft 다시 합성 시 다른
    결과
- **C** (discarded): ledger만, validate 없음
  - pros: 단순
  - cons: cherry-picking 무방비 (Round 2 비판 R3)

## Consequences

- 긍정:
  - scenario validate가 publish gate로 작동
  - lineage query로 시간 진화 추적
  - reproducibility(NFR-002) 강화

- 부정 / trade-off:
  - revisions ledger 크기 증가 (단일 scenario도 많은 revision 누적 가능)
  - validate 5종 구현 부담

- 후속 작업:
  - INFRA-1B 단계: scenario_revisions 테이블 + validate 함수
  - PUB-1A 단계: scenario validate를 ContentDraft compose 직전 gate로
  - Q-001 horizon enum 정의 후 horizon mismatch cite check 활성화

## References

- ideation: Round 2 비판 R3 / Round 3 메타 리뷰 A4 / Round 3 결정 (4)(11)
- 관련 ADR: ADR-0003, ADR-0007, ADR-0008, ADR-0010
