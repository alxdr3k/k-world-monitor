---
id: glossary-evidence-quote
type: glossary_term
term: evidence_quote
term_type: capability
defined_in: ADR-0008
last_changed_by: ADR-0008
status: active
created_at: 2026-05-11
updated_at: 2026-05-11
aliases:
  - 인용 증거
  - quote evidence
detect_patterns:
  - "(?i)evidence\\s+quote"
  - "(?i)인용\\s*증거"
related_invariants:
  - INV-0008-1
  - INV-0008-2
provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true

applies_to_planes:
  - storage.sqlite.claim_table.evidence
  - pipeline.cite_check_layer
forbidden_paths:
  - quote_length_over_200_chars        # NFR-005: ≤ 200자 강제
  - quote_without_locator              # locator(page / section / line range) 없는 quote 금지
  - quote_without_hash                 # quote_hash(sha256 of normalized text) 없는 quote 금지
---

# evidence_quote

## Definition

`evidence_quote`는 Claim이 출처 Snapshot의 어느 부분에서 왔는지 기록하는
짧은 인용(≤ 200자)이다. `quote` + `locator(page/section/line range)` +
`quote_hash(sha256)` 세 필드를 모두 가진다. "원문 인용 전면 금지"는 검증성을
파괴하므로 폐기되었고(ADR-0003 Round 2 비판 R9), 짧은 quote + hash로 검증 가능
하게 한다.

## Why this term exists

ADR-0008 — cite check가 quote 변경을 검출하려면 hash가 필요하고, 운영자가
빠르게 검증하려면 quote 텍스트가 필요하며, NFR-003 5-step trace를 위해 locator
가 필요하다. 셋 중 하나라도 없으면 evidence가 아니다.

## Examples

- 긍정 예: quote="2026년 글로벌 GDP 성장률 전망 3.1%", locator="WEO Apr 2026 p.12
  Table 1.1", quote_hash="sha256:a1b2..." (총 23자)
- 부정 예: 250자 quote — 정책 위반 (NFR-005)
- 부정 예: locator만 있고 quote 없는 evidence — 운영자 검증 불가능
- 부정 예: 같은 quote 텍스트지만 hash 다름 — 추출 시점 normalization 차이로
  drift 의심, cite check가 alert

## Drift history

- 2026-05-11 ADR-0008 — quote ≤ 200자 + locator + quote_hash 정책 lock
  (initial definition); 원문 인용 전면 금지 폐기
