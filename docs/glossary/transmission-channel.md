---
id: glossary-transmission-channel
type: glossary_term
term: transmission_channel
term_type: capability
defined_in: ADR-0019
last_changed_by: ADR-0019
status: active
created_at: 2026-05-11
updated_at: 2026-05-11
aliases:
  - 전파 경로
  - propagation channel
detect_patterns:
  - "(?i)transmission\\s+channel"
  - "(?i)transmission_channels\\["
related_invariants:
  - INV-0019-2
provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true

applies_to_planes:
  - storage.neo4j.scenario_node.transmission_channels
forbidden_paths:
  - storage.r2.bytes              # transmission_channel은 metadata 분류 entity
---

# transmission_channel

## Definition

`transmission_channel`은 Scenario의 shock 전파 경로다 (ADR-0019). 충격이 어떤
회로를 통해 target에 도달하는지 추적한다.

v0 enum: `energy / credit / fx / policy / technology / information /
population`.

cross-cutting axis (Q-022)로도 사용 — region / time_horizon / shock_type /
transmission_channel 4 axis.

## Why this term exists

Round 22 GPT 권고 + R23 Claude 답변에서 `propagation_channel`로 제안 → R22
sub-Q에서 `transmission_channel`로 명명 일관. shock의 인과 추론(causes/
increases_risk_of 등)은 LLM hallucinate 위험이라 회피하고(R12/Q7), 대신 어떤
회로(channel)로 전파되는지 추적하는 분류만 도입.

비트코인 예시: bitcoin은 보통 macro scenario의 transmission_channel = finance
+ information으로 mapping (R22 sub-Q).

## Examples

- 긍정 예: scenario "USD funding shock" → transmission_channels = [credit, fx]
  + impact_direction_by_target에 winners/losers 분리
- 긍정 예: scenario "Energy crisis" → transmission_channels = [energy, policy,
  information]
- 부정 예: transmission_channels = [causes_recession] — 인과 추론 edge는 회피
  (R12/Q7 결정). enum 외 값은 reject.

## Drift history

- 2026-05-11 ADR-0019 (R22 + R23 + R25) — transmission_channels[] enum 신설
