---
id: glossary-manual-claim-entry
type: glossary_term
term: manual_claim_entry
term_type: capability
defined_in: ADR-0018
last_changed_by: ADR-0018
status: active
created_at: 2026-05-11
updated_at: 2026-05-11
aliases:
  - 수동 입력
  - manual feedback
detect_patterns:
  - "(?i)manual\\s+claim"
  - "(?i)manual\\s+feedback"
related_invariants:
  - INV-0018-1
  - INV-0018-2
  - INV-0018-3
  - INV-0018-5
  - INV-0018-6
provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true

applies_to_planes:
  - pipeline.manual_feedback_inbound
  - storage.neo4j.manual_claim_entry_node
  - cli.pipeline_feedback
forbidden_paths:
  - storage.r2.bytes              # raw_text_stored=false 강제 (INV-0018-3)
  - pipeline.extraction_layer.routing.auto  # manual은 LLM routing 우회
---

# manual_claim_entry

## Definition

`ManualClaimEntry`는 사용자가 직접 외부 source에 접근해 입력한 derived claim
record다 (ADR-0018). collection policy를 우회하는 게 아니라, 사람이 수집을
수행한 후 derivation 단계로 진입하는 워크플로우다.

**3-way 분리** (한 row 한 필드만 채워짐):
- `user_written_claim` — 객관적 사실 재구성
- `user_opinion` — 본인 해석/의견
- `referenced_quote` — 짧은 원문 인용 (≤200자, quote_reason 필수, attribution_json
  필수)

CLI `pipeline feedback add|bulk|link|from-report` + `pipeline intervention
review <id>`의 manual_claim option으로 진입한다.

## Why this term exists

Round 14/Q9-5에서 high-risk source fallback으로 신설. Round 17/Q12-1에서
Tier C/D source를 흡수. Round 18에서 사용자 발의로 능동적 워크플로우로 격상.
3-way 분리는 publication preflight가 문장별 자동 판정 (객관 claim vs 본인
의견 vs 원문 인용) 가능하게 한다.

`raw_text_stored=false` 강제 (INV-0018-3) — 사용자가 손으로 입력한 derived
record이므로 raw text는 보관하지 않는다 (ADR-0012 raw cloud prohibition과
일관).

## Examples

- 긍정 예 — 객관 claim: 사용자가 paywall 뒤 WSJ 기사 본 후 `pipeline feedback
  add` → user_written_claim="WSJ에 따르면 2026-Q1 미국 산업생산 +0.3% MoM" +
  attribution_json=...
- 긍정 예 — 본인 의견: user_opinion="이 GDP revision 패턴은 2018 cycle과
  유사" + 다른 field는 비어 있음
- 긍정 예 — 인용: referenced_quote="The committee will be patient" + quote_reason=
  policy_language_analysis + attribution_json (Fed 발표문, ≤200자)
- 부정 예: user_written_claim에 의견 섞기 — "WSJ에 따르면 산업생산 +0.3%, 이는
  recession 신호다" → 두 row로 분리해야 (혼합 금지, INV-0018-1)
- 부정 예: raw_text_stored=true로 raw HTML 저장 — 강제 false (INV-0018-3)

## Drift history

- 2026-05-11 ADR-0014/Q9-5 — manual_claim_entries 테이블 도입 (high-risk
  source fallback)
- 2026-05-11 ADR-0017/Q12-1 — Tier C/D 흡수
- 2026-05-11 ADR-0018 — 3-way 분리(claim/opinion/quote) + CLI + 3-option
  intervention review
