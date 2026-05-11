---
id: glossary-collectability-score
type: glossary_term
term: collectability_score
term_type: capability
defined_in: ADR-0016
last_changed_by: ADR-0016
status: active
created_at: 2026-05-11
updated_at: 2026-05-11
aliases:
  - 수집 가능성 점수
detect_patterns:
  - "(?i)collectability\\s+score"
related_invariants:
  - INV-0016-2
  - INV-0016-3
  - INV-0016-4
  - INV-0016-5
provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true

applies_to_planes:
  - storage.neo4j.source_node
  - storage.policy.tier_classification
  - pipeline.discovery_layer
forbidden_paths:
  - pipeline.publication_layer    # collectability는 수집 단계 속성이지 publication 정책 아님
---

# collectability_score

## Definition

`collectability_score`는 Source의 수집 가능성 4 dimension 평가다 (ADR-0016):

```yaml
collectability_score:
  automation_reliability: 0.0-1.0    # 자동 수집 성공률
  legal_policy_clarity: 0.0-1.0      # 약관/license 명확도
  anti_bot_friction: none | light | moderate | hard | blocked
  preferred_mode: api | rss | manual | excluded
```

Tier 분류(A-D)와 함께 source 운영 정책을 결정한다. `source_reliability`
(ADR-0005 reliability_tier)와는 직교(⊥) 차원이다 — Reuters는 tier 1 high
reliability지만 wire-service full text는 anti-bot heavy + paywall로 backbone
부적합.

## Why this term exists

Round 17/Q12-1에서 GPT가 제안한 보강. Round 3 lock에서는 source를 reliability_
tier만으로 평가했지만, "공식 API/RSS/open dataset(자동)" vs "anti-bot
hard(manual)"의 구분이 운영상 중요하다는 것이 드러났다.

Q21 Tier A seed 작성 시 collectability_score를 manual로 입력 (v0). 운영 중
누적 데이터로 보정. v2+에서 LLM 자동 분류 옵션 검토 가능.

## Examples

- 긍정 예: FRED API → automation_reliability=0.95 / legal_policy_clarity=1.0
  (public data) / anti_bot_friction=none / preferred_mode=api → Tier A
- 긍정 예: WSJ → automation_reliability=0.2 (paywall) /
  legal_policy_clarity=0.7 (terms 명확하지만 제한적) / anti_bot_friction=hard
  / preferred_mode=manual → Tier D
- 긍정 예: Federal Reserve press release page → automation_reliability=0.9 /
  legal_policy_clarity=1.0 / anti_bot_friction=light / preferred_mode=sitemap
  → Tier B
- 부정 예: reliability_tier=high인 Reuters를 자동으로 collectability=high로
  추론 — 두 차원 직교 (INV-0016-4)
- 부정 예: anti_bot_friction=hard인 source에 Tier A 부여 + 자동 수집 — Tier
  분류 위반

## Drift history

- 2026-05-11 ADR-0016 — collectability_score + Tier A-D + access_method +
  source_reliability ⊥ source_collectability 원칙 신설
