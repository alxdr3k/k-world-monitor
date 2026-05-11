---
id: glossary-source-perspective
type: glossary_term
term: source_perspective
term_type: capability
defined_in: ADR-0019
last_changed_by: ADR-0019
status: active
created_at: 2026-05-11
updated_at: 2026-05-11
aliases:
  - 출처 시각
  - source viewpoint
detect_patterns:
  - "(?i)source\\s+perspective"
  - "(?i)source_perspective"
related_invariants:
  - INV-0019-5
provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true

applies_to_planes:
  - storage.neo4j.source_node.source_perspective
  - pipeline.discovery_layer.tier_a_seed_balance
forbidden_paths:
  - storage.r2.bytes              # source_perspective는 metadata tag
---

# source_perspective

## Definition

`source_perspective`는 Source의 관점 tag다 (ADR-0019). v0 enum: `risk_observer
/ opportunity_observer / neutral / mixed`.

Q21 Tier A seed 작성 시 분포 균형 강제 (INV-0019-5):
- risk_observer ≤ 50%
- opportunity_observer ≥ 25%
- neutral ≥ 15%

bidirectional framing(4축 병렬 — risk + opportunity + resilience + asymmetric
impact)을 source registry seed 단계부터 의도적으로 반영.

## Why this term exists

Round 23 사용자 발의: "상방 요인들도 동일한 성능으로 커버 가능한가?" 검토
결과 시스템 architecture는 양방향 가능하지만 명명·default·시드 source가
risk-centric으로 편향됨 — 특히 Q21 Tier A 후보가 대부분 risk observer (IMF
risks / WEF / WHO). 명시적 perspective tag + 분포 균형으로 편향 완화.

v0 manual 분류 (30~50 source는 사람 가능). v2+에서 LLM 자동 분류 옵션 검토
(사용자 review 필수).

## Examples

- 긍정 예: IMF Global Risks Report — risk_observer
- 긍정 예: McKinsey productivity outlook — opportunity_observer
- 긍정 예: FRED API — neutral (data, no editorial)
- 긍정 예: Reuters mainline — mixed (위험/기회 모두 보도)
- 부정 예: 모든 source를 mixed로 분류 → 분포 균형 강제 위반 시 lint warning
- 부정 예: source의 reliability_tier를 source_perspective로 추론 — 두 축은
  독립이며, source_perspective ⊥ reliability_tier ⊥ collectability_score

## Drift history

- 2026-05-11 ADR-0019 (R23 + R25) — source_perspective tag 신설, Q21 분포
  균형 강제
