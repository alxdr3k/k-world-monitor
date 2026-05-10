---
id: glossary-edge
type: glossary_term
term: edge
term_type: capability
defined_in: ADR-0007
last_changed_by: ADR-0007
status: active
created_at: 2026-05-11
updated_at: 2026-05-11
aliases:
  - edge record
  - relation edge
detect_patterns:
  - "(?i)edge\\s+ledger"
  - "(?i)관계\\s*엣지"
related_invariants:
  - INV-0007-1
  - INV-0007-2
provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true

applies_to_planes:
  - storage.sqlite.edge_table
  - pipeline.scenario_layer.edge_query
forbidden_paths:
  - storage.markdown.frontmatter.supports_array     # `supports[]/contradicts[]` frontmatter 배열 금지
  - storage.markdown.frontmatter.contradicts_array  # frontmatter 배열은 query / dedupe / provenance 추적 불가
---

# edge

## Definition

`Edge`는 두 객체(Claim ↔ Claim, Claim ↔ Scenario, Scenario ↔ Scenario,
Document ↔ Document)간 관계 record다. SQLite `edges` 테이블에 저장되며
`relation_type ∈ {supports, contradicts, qualifies, updates, supersedes}` +
`scope` + `rationale` + `provenance` 필드를 가진다.

frontmatter에 `supports[] / contradicts[]` 배열로 두는 방식은 폐기되었다
(ADR-0003 Round 2 비판 R7) — 배열은 query/dedupe/provenance 불가능.

## Why this term exists

ADR-0007 — Scenario validation, cite cascade, supersedes 진화 모두 edge query에
의존한다. frontmatter 배열로는 양방향 query, attribution chain, edge별 reviewer
trail이 불가능하다.

## Examples

- 긍정 예: `edge_001`: claim_a `contradicts` claim_b, scope="동일 분기 시점
  지표", rationale="A는 yoy 1%, B는 mom 2% 보고", provenance=user_confirmed
- 긍정 예: scenario_v1 `supersedes` scenario_v0 (edge로 lineage 추적)
- 부정 예: claim frontmatter `contradicts: [clm_xyz]` — 정책 위반

## Drift history

- 2026-05-11 ADR-0007 — edge ledger 도입 (initial definition); frontmatter
  배열 패턴 폐기
