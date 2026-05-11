---
id: glossary-thesis
type: glossary_term
term: thesis
term_type: capability
defined_in: ADR-0011
last_changed_by: ADR-0019
status: active
created_at: 2026-05-11
updated_at: 2026-05-11
aliases:
  - 논지
  - core thesis
detect_patterns:
  - "(?i)core\\s+thesis"
  - "(?i)thesis\\s+stance"
related_invariants:
  - INV-0011-1
  - INV-0011-3
  - INV-0019-4
  - INV-0019-8
provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true

applies_to_planes:
  - pipeline.thesis_layer
  - storage.neo4j.thesis_node
  - storage.markdown.thesis
forbidden_paths:
  - storage.r2.bytes              # Thesis는 derived object, raw bytes 없음
  - pipeline.source_layer         # Thesis는 source layer를 지난 합성 단계의 산출물
---

# thesis

## Definition

`Thesis`는 9-stage 객체 모델의 Scenario와 ContentDraft 사이에 위치한 재사용
가능한 핵심 주장 단위다 (ADR-0011). Scenario revision을 압축한 single core
proposition으로, 같은 Thesis가 4개 ContentDraft format(blog_long / youtube_long
/ shorts / newsletter)에 재사용된다.

Thesis는 두 stance 필드를 보유한다 (ADR-0019):
- `stance` ∈ {constructive, cautionary, neutral, mixed, asymmetric, exploratory}
  — 일반 thesis
- `market_stance` ∈ {bullish, bearish, range_bound, volatility_up,
  volatility_down, neutral} — 자산/시장 thesis (optional v0, 필수 v1)

두 필드는 mutual exclusive 아님 — 자산 thesis는 stance(constructive) +
market_stance(bullish) 둘 다 가질 수 있다.

## Why this term exists

Round 12/Q7에서 GPT 비판으로 Thesis 객체가 추가됐다. Round 3 lock 7-stage
모델은 Scenario → ContentDraft 직행이었지만, 같은 핵심 주장을 블로그 long /
유튜브 long / shorts / 뉴스레터로 4번 다시 작성하는 비용을 막아야 했다.

Round 23/Round 25에서 bidirectional framing의 anchor가 됨 — thesis.stance /
market_stance가 한쪽으로 강하게 기울었는데 EvidencePack opposing/mitigating/
uncertainty가 비어 있으면 publication preflight 6번째 warning 발생 (ADR-0015
INV-0015-7, ADR-0019 INV-0019-4).

## Examples

- 긍정 예 — 일반 thesis: "AI capex spike가 2026~2028 productivity boom으로
  연결될 가능성이 ≥ 40%" → stance=constructive, market_stance=null
- 긍정 예 — 자산 thesis: "Bitcoin ETF inflow + institutional allocation으로
  2026-Q2까지 risk-on rally" → stance=constructive, market_stance=bullish
- 긍정 예 — asymmetric: "원유 가격 상승은 한국 수출↓ + 산유국 수출↑" →
  stance=asymmetric, market_stance=null (impact_targets로 winners/losers 분리)
- 부정 예: 같은 Thesis 본문을 4 format draft마다 복사해서 다시 씀 — Thesis
  재사용 anchor 의미 상실
- 부정 예: thesis.stance=bullish — bullish는 market_stance 전용 enum이고
  일반 stance는 constructive 사용

## Drift history

- 2026-05-11 ADR-0011 — Thesis 객체 9-stage에 추가
- 2026-05-11 ADR-0019 — thesis.stance + thesis.market_stance(optional v0 /
  필수 v1) 도입
