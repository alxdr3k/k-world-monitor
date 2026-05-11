---
id: glossary-impact-target
type: glossary_term
term: impact_target
term_type: capability
defined_in: ADR-0019
last_changed_by: ADR-0019
status: active
created_at: 2026-05-11
updated_at: 2026-05-11
aliases:
  - 영향 대상
  - impact target
detect_patterns:
  - "(?i)impact\\s+target"
  - "(?i)impact_targets\\["
related_invariants:
  - INV-0019-2
  - INV-0019-9
provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true

applies_to_planes:
  - storage.neo4j.scenario_node.impact_targets
  - storage.neo4j.scenario_node.impact_direction_by_target
forbidden_paths:
  - storage.r2.bytes              # impact_target은 metadata 분류 entity
---

# impact_target

## Definition

`impact_target`은 Scenario의 영향 대상 식별자다 (ADR-0019). `scenario.
impact_targets[]`에 enum 값으로 누적되고, `scenario.impact_direction_by_target`
dict에서 target별 direction(`upside / downside / mixed / neutral`)이 정의된다.

예시 target 값: `global_growth`, `korea_exports`, `us_equities`,
`emerging_markets`, `energy_importers`, `energy_exporters`, `public_health`,
`social_stability`, `bitcoin`, `ai_capex`.

같은 Scenario가 target에 따라 winners/losers로 갈리는 비대칭 영향을 표현 가능
— `asymmetric`은 별도 enum 값이 아니라 impact_direction_by_target 분포에서
derive되는 파생 속성.

## Why this term exists

Round 23/Round 25 GPT 메타 재검토에서 도출. R23에서 단일 `scenario.valence`
5값 enum이 제안됐지만, asymmetric outcome(예: 원유 가격 상승 → 한국 수출
downside + 산유국 upside)을 한 필드로 표현 불가. R25 정정으로 target별 분리.

v0는 scenario embedded dict로 시작(`impact_direction_by_target: {korea_exports:
downside, energy_exporters: upside}`). v1에서 ImpactAssessment 별도 Neo4j 노드
+ HAS_IMPACT/AFFECTS/TRANSMITTED_THROUGH edges (Q-029).

## Examples

- 긍정 예: scenario "원유 가격 +30%" → impact_targets = [korea_exports,
  energy_exporters, global_inflation], impact_direction_by_target =
  {korea_exports: downside, energy_exporters: upside, global_inflation: upside}
  → asymmetric은 derive
- 긍정 예: scenario "AI productivity boom" → impact_targets = [us_equities,
  ai_capex, productivity_index], 모두 upside → summary_valence=upside
- 부정 예: impact_targets 비어 있는 scenario — INV-0019-2 위반 (v0부터 필수)
- 부정 예: 같은 target에 두 direction 동시 입력(`korea_exports: upside,
  korea_exports: downside`) — dict 충돌, validate 차단

## Drift history

- 2026-05-11 ADR-0019 (R23 → R25 정정) — scenario.valence 단일 enum 폐기 후
  impact_targets + impact_direction_by_target dict로 분리. asymmetric은 derive.
