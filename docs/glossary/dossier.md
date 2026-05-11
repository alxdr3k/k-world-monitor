---
id: glossary-dossier
type: glossary_term
term: dossier
term_type: capability
defined_in: ADR-0003
last_changed_by: ADR-0003
status: active
created_at: 2026-05-11
updated_at: 2026-05-11
aliases:
  - 도시에
  - 주제 현황판
  - subject brief
detect_patterns:
  - "(?i)subject\\s+brief"
  - "(?i)주제\\s*현황판"
related_invariants:
  - INV-0003-4
provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true

applies_to_planes:
  - pipeline.aggregation_layer
  - storage.markdown.dossier
  - storage.neo4j.dossier_node      # ADR-0012 supersede
forbidden_paths:
  - storage.markdown.candidate_claim   # Dossier는 promoted claim만 인용
  - pipeline.scenario_layer.bypass     # Scenario는 Dossier를 거쳐야 한다 (Source → Claim → Scenario 직행 금지)
---

# dossier

## Definition

`Dossier`는 주제별 현황판이다. 동일 주제의 promoted claim, open question,
counterclaim, monitoring signal을 모아 시나리오가 매번 동일 자료를 재합성하지
않게 한다. 한 Dossier는 하나의 주제(예: "한국 부동산 가격 사이클",
"동아시아 통상 마찰")를 가지고 `stale_after`로 갱신 주기를 가진다.

## Why this term exists

ADR-0003 Round 2 비판 R4 — `Source → Claim → Scenario` 직행은 비약이고, 같은
주제를 매번 재합성한다. Dossier는 reusability anchor로, scenario validation
직전 단계에서 주제별 promoted claim 묶음 + counterclaim 풀을 제공한다.

## Examples

- 긍정 예: "Dossier: 한국 부동산 가격 사이클" — 통계청 / 국토부 / KB부동산 출처
  promoted claim 30건 + open question 5건 + counterclaim 3건
- 긍정 예: stale_after = 14일 (월간 통계 주기 기반)
- 부정 예: 단일 기사 1건만 가진 Dossier — Dossier는 다중 출처 합성 단위
- 부정 예: candidate claim을 그대로 인용 — Dossier는 confirmed/promoted만

## Drift history

- 2026-05-11 ADR-0003 — Document → Snapshot → Claim → Dossier → Scenario →
  ContentDraft → Publication 7-stage 도입 (initial definition)
- Q-002에서 `stale_after` 기본값 결정 보류 중
