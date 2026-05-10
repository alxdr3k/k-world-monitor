---
id: glossary-extraction-confidence
type: glossary_term
term: extraction_confidence
term_type: capability
defined_in: ADR-0005
last_changed_by: ADR-0005
status: active
created_at: 2026-05-11
updated_at: 2026-05-11
aliases:
  - llm extraction confidence
  - llm confidence
detect_patterns:
  - "(?i)extraction\\s+confidence"
  - "(?i)추출\\s*신뢰도"
related_invariants:
  - INV-0005-2
  - INV-0006-1
provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true

applies_to_planes:
  - storage.sqlite.claim_table
  - pipeline.extraction_layer.review_throttling
forbidden_paths:
  - storage.sqlite.document_table.extraction_confidence  # Document 단위에는 두지 않는다
  - manual_intake_path                                   # extraction_confidence는 LLM 추출에만 부여
---

# extraction_confidence

## Definition

`extraction_confidence`는 LLM이 Snapshot에서 Claim을 추출할 때 부여하는 0-1
신뢰도 점수다. Claim 단위 속성이며 LLM 추출 경로에서만 채워진다(manual_intake
는 null). `reliability_tier=high` ∧ `extraction_confidence ≥ 0.85` 일 때
auto-accept(ADR-0006).

## Why this term exists

ADR-0005 — 단일 `confidence`로 LLM 추출 신뢰도와 출처 신뢰도를 섞으면 routing /
review queue 정책이 무너진다. extraction_confidence는 LLM이 prompt 안에서
(0-1) 출력하도록 강제한다.

## Examples

- 긍정 예: claim "IMF 2026 GDP 3.1%" → extraction_confidence=0.92,
  reliability_tier=high → auto-accept
- 긍정 예: 익명 블로그 추출 claim → extraction_confidence=0.7,
  reliability_tier=low → reviewer queue
- 부정 예: manual_intake claim에 LLM 점수 부여 — null이어야 함

## Drift history

- 2026-05-11 ADR-0005 — confidence 분해 시 extraction_confidence를 Claim 속성
  으로 도입 (initial definition)
- 2026-05-11 ADR-0006 — auto-accept threshold 0.85 lock
