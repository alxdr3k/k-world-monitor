---
id: glossary-scenario
type: glossary_term
term: scenario
term_type: capability
defined_in: ADR-0003
last_changed_by: ADR-0009
status: active
created_at: 2026-05-11
updated_at: 2026-05-11
aliases:
  - 시나리오
  - macro scenario
detect_patterns:
  - "(?i)scenario\\s+model"
  - "(?i)시나리오\\s*모델"
related_invariants:
  - INV-0003-5
  - INV-0007-1
  - INV-0009-1
provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true

applies_to_planes:
  - pipeline.scenario_layer
  - storage.markdown.scenario
  - storage.neo4j.scenario_node             # ADR-0012 supersede
  - storage.neo4j.scenario_revision_node    # ADR-0012 supersede
forbidden_paths:
  - pipeline.publication_layer.direct        # Publication은 Scenario를 직접 인용하지 않고 ContentDraft를 거친다
  - storage.markdown.candidate_claim_inline  # Scenario는 promoted claim만 인용
---

# scenario

## Definition

`Scenario`는 가정 / 드라이버 / 분기 / falsifier / counterclaim / monitoring
signal을 가진 macro 모델이다. 단일 결과를 주장하는 것이 아니라 여러 가능
경로(branches)를 명시하고 각 경로의 가정을 추적한다. assumption별 `weight: 0-1`
는 scenario 안의 속성이며 claim 자체의 confidence가 아니다 (ADR-0005).

`scenario_revisions` ledger로 시간 진화를 추적하고, 다른 scenario를 `supersedes`
또는 `updates` edge로 가리킨다 (ADR-0007 + ADR-0009).

## Why this term exists

ADR-0003 Round 2 비판 R3 — confirmed claim만 가진 scenario는 cherry-picking을
유발한다. Scenario는 counterclaim / falsifier / monitoring signal을 같이
보유해야 검증 가능한 모델이다.

## Examples

- 긍정 예: "Scenario: 2026 한국 부동산 연착륙" — 가정 5개(weight 명시), branches
  3개(연착륙 / 횡보 / 급락), falsifier 4개, counterclaim 2건, monitoring signal
  3개 (KB 매주 지수, 거래량, 미분양)
- 긍정 예: 새 통계 발표 후 `scenario_revisions`에 새 revision 추가, 이전
  revision은 `superseded_by` 갱신
- 부정 예: 가정 없이 결론만 있는 scenario — assumption ledger 강제
- 부정 예: candidate claim 그대로 인용 — promoted only

## Drift history

- 2026-05-11 ADR-0003 — 7-stage 모델 도입 (initial definition)
- 2026-05-11 ADR-0009 — `scenario_revisions` ledger + `supersedes`/`updates`
  edge로 시간 진화 추적 정책 lock
- Q-001에서 horizon enum(1Q / 1Y / 5Y / generational?) 결정 보류 중
