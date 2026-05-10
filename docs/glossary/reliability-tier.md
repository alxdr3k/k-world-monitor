---
id: glossary-reliability-tier
type: glossary_term
term: reliability_tier
term_type: capability
defined_in: ADR-0005
last_changed_by: ADR-0005
status: active
created_at: 2026-05-11
updated_at: 2026-05-11
aliases:
  - reliability
  - source reliability
detect_patterns:
  - "(?i)reliability\\s+tier"
  - "(?i)신뢰\\s*등급"
related_invariants:
  - INV-0005-1
  - INV-0006-1
provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true

applies_to_planes:
  - storage.sqlite.document_table
  - pipeline.extraction_layer.routing
forbidden_paths:
  - storage.sqlite.claim_table.reliability   # reliability는 Document 속성, Claim에 직접 두지 않는다
  - mixed_field_with_extraction_confidence   # 단일 confidence 필드로 합치기 금지 (ADR-0005)
---

# reliability_tier

## Definition

`reliability_tier`는 Document 단위 출처 신뢰 등급이다. enum `high | medium |
low | unknown`. extractor routing 결정(auto-accept threshold 결합)과 dossier
가중치 산정에 사용된다. Claim 단위가 아니라 Document 단위 속성이다.

## Why this term exists

ADR-0005 — 단일 `confidence` 필드는 reliability(출처) / extraction
confidence(LLM) / evidence strength / lifecycle / scenario weight 다섯 개념을
섞는다. reliability는 Document 단위 속성으로 분리되어야 routing과 cost 결정에
쓸 수 있다.

## Examples

- 긍정 예: IMF 공식 보고서 → `reliability_tier=high` → Haiku 1차 추출 +
  extraction_confidence ≥ 0.85 시 auto-accept (ADR-0006)
- 긍정 예: 익명 블로그 포스트 → `reliability_tier=low` → 필수 reviewer 통과
- 부정 예: claim 단위로 reliability 부여 — Document 단위 속성

## Drift history

- 2026-05-11 ADR-0005 — confidence 분해 시 reliability_tier를 Document 속성으로
  도입 (initial definition)
