---
id: glossary-source
type: glossary_term
term: source
term_type: capability
defined_in: ADR-0011
last_changed_by: ADR-0019
status: active
created_at: 2026-05-11
updated_at: 2026-05-11
aliases:
  - 출처
  - source registry entry
  - publisher
detect_patterns:
  - "(?i)source\\s+registry"
  - "(?i)publisher"
related_invariants:
  - INV-0011-1
  - INV-0011-2
  - INV-0011-4
  - INV-0016-2
  - INV-0016-3
  - INV-0017-1
  - INV-0019-5
provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true

applies_to_planes:
  - pipeline.source_layer
  - storage.neo4j.source_node
  - storage.sqlite.source_policy
forbidden_paths:
  - storage.r2.bytes              # Source는 메타 entity, 원본 bytes는 Snapshot.r2_key가 가리키며 그조차도 permitted artifact 한정
  - pipeline.publication_layer    # Source는 publication 단계에 직접 쓰이지 않는다
---

# source

## Definition

`Source`는 9-stage 객체 모델의 Tier 0 — publisher/registry entity다. 같은
publisher의 여러 Document를 묶고 `reliability_tier`, `collectability_score`,
`source_policy` (archive/raw_cloud/external_llm 3 필드), `access_method`,
`source_perspective` (risk_observer / opportunity_observer / neutral / mixed)를
보유한다.

Round 3 lock 시점의 7-stage 모델(ADR-0003)은 Document에 publisher 필드를 직접
박았지만, Tier A-D 분류·access intervention cascade·policy gate가 별도 entity
로 분리될 필요가 생겨 Round 6/Q1에서 Source가 추가됐다 (ADR-0011).

## Why this term exists

ADR-0011에서 9-stage 파이프라인의 source layer를 Source / Document / Snapshot /
Claim 4-tier로 분리하기로 결정한 이유는 publisher-level entity가 다음을
anchor하기 때문이다:

- `reliability_tier` (high/medium/low/unknown) — ADR-0005
- `collectability_score` (4 dimension) — ADR-0016
- `source_policy` (archive_policy + raw_cloud_policy + external_llm_policy) —
  ADR-0017
- `access_method` (api/rss/sitemap/public_page/manual_only/do_not_collect) —
  ADR-0016
- `source_perspective` (양방향 framing 분포 균형) — ADR-0019

`source_reliability` ⊥ `source_collectability` (ADR-0016 INV-0016-4) — Reuters는
tier 1 high reliability지만 wire-service full text는 anti-bot heavy + paywall로
backbone source 부적합.

## Examples

- 긍정 예: IMF (publisher) → Document {WEO 2026-04 PDF/HTML, GFSR 2026-Q1,
  Article IV reports ...} → Tier A, reliability_tier=high, source_perspective=
  neutral, access_method=api
- 긍정 예: Korea Herald (publisher) → 여러 Document → Tier B (robots 허용
  public page), source_perspective=mixed, access_method=rss
- 부정 예: 같은 publisher의 다른 기사 URL을 별도 Source로 등록 — Document
  layer에서 처리할 일
- 부정 예: collectability_score 없이 reliability_tier만 입력 — 두 차원 분리
  강제 (INV-0016-4)

## Drift history

- 2026-05-11 ADR-0011 — Source(Tier 0) 추가, 9-stage 모델로 확장
- 2026-05-11 ADR-0016 — Tier A-D 분류 + collectability_score 추가
- 2026-05-11 ADR-0017 — source_policy 3 필드 추가
- 2026-05-11 ADR-0019 — source_perspective tag 추가 (양방향 framing)
