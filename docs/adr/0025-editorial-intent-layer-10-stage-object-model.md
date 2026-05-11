---
id: adr-0025
type: adr
title: Editorial Intent layer — 10-stage object model (Scenario → EditorialIntent → Thesis anchor 신설)
status: accepted
created_at: 2026-05-11
updated_at: 2026-05-11
deciders: [user]
supersedes: [adr-0011]
superseded_by: []

scope:
  in:
    - pipeline.editorial_intent_layer
    - pipeline.thesis_layer.intent_alignment
    - pipeline.publication_layer.intent_reference
    - storage.neo4j.editorial_intent_node
    - storage.markdown.curated_view.editorial_intent
    - cli.pipeline_intent_compose
  out:
    - pipeline.extraction_layer
    - pipeline.scenario_layer.composer
    - pipeline.publication_layer.cross_post_lint

invariants:
  - id: INV-0025-1
    statement: 9-stage object model 을 10-stage 로 확장 — Source → Document → Snapshot → Claim → Dossier → Scenario → **EditorialIntent** → Thesis → ContentDraft → Publication. ADR-0011 INV-0011-1 (9-stage) supersede.
    status: active
  - id: INV-0025-2
    statement: EditorialIntent 는 Thesis 의 parent anchor — Thesis 1개는 정확히 1개의 EditorialIntent 를 reference 한다 (Neo4j `:HAS_INTENT` relationship from Thesis to EditorialIntent). EditorialIntent 1개는 N 개 Thesis 및 N 개 ContentDraft 와 link 가능 (재사용 anchor, 동일 의도로 여러 thesis / 여러 format draft 생성 가능).
    status: active
  - id: INV-0025-3
    statement: EditorialIntent 필드 (frontmatter + Neo4j 노드 속성)는 다음을 보유한다 — `eit_id` (`eit_<sha256[0:10]>` prefix), `purpose` (str, 발행 목적 한 줄), `audience` (str, 누구를 위한 글), `tone` (enum — informational / cautionary / explainer / opinion / debate_trigger), `call_to_action` (str, nullable), `alignment_criteria` (str[], claim/scenario branch 선택 기준선), `exclusion_criteria` (str[], 의도적으로 제외할 axis), `bidirectional_weight_intent` (enum — risk_observer / opportunity_observer / resilience / asymmetric / balanced, ADR-0019 4축 중 운영자 weight 의도), `related_dossier_ids[]`, `related_scenario_revision_ids[]`, `decided_by_operator` (boolean, INV-0025-4 enforce), `created_at`.
    status: active
  - id: INV-0025-4
    statement: EditorialIntent 는 **운영자 명시 승인 의무** — LLM 자동 propose 는 허용하되 lock 은 사람 승인 필요. `decided_by_operator = true` flag 가 false 이거나 missing 이면 ContentDraft composer / publication preflight 가 reject. 이는 발행 의도가 LLM 자동 합성으로 흐르는 것을 차단 (NFR-002 reproducibility + 운영자 정체성 보존).
    status: active
  - id: INV-0025-5
    statement: ContentDraft + Publication 의 cite check 5+1 trace path 에 EditorialIntent 가 포함 — Publication → ContentDraft → Thesis → **EditorialIntent** → Scenario revision → Dossier → promoted Claim → Snapshot → Source. 10-stage 안에서도 NFR-003 의 5단계 trace 는 선택적 단계 skip 으로 유지 (예 ContentDraft → Thesis → EditorialIntent → Scenario revision → Claim → Snapshot 6 hops 도 가능하나 5단계 단축 path 보존).
    status: active
  - id: INV-0025-6
    statement: EditorialIntent 의 `bidirectional_weight_intent` 와 Thesis 의 `stance` + `market_stance` (ADR-0019 INV-0019-1) 는 align 의무 — divergence 발견 시 cite check 5+1 의 "one-sided thesis warning" (v1+) 또는 manual review trigger. 예 EditorialIntent `bidirectional_weight_intent = balanced` 인데 Thesis 가 `stance = constructive` 단일 방향이면 warning.
    status: active
  - id: INV-0025-7
    statement: EditorialIntent 는 reproducibility 강화 (NFR-002) — 같은 source set + scenario revision + EditorialIntent 면 운영자가 동일 Thesis 압축 + ContentDraft 산출에 도달 가능. ScenarioRevision (ADR-0009) 와 EditorialIntent 가 함께 일관성 anchor.
    status: active
  - id: INV-0025-8
    statement: EditorialIntent 는 vault 의 `editorial_intents/<eit_id>.md` 에 사람용 view 로 저장 (Markdown frontmatter + body). 자체 사이트 (ADR-0022) 에는 노출되지 않음 — internal canonical 보존 (ADR-0022 INV-0022-4 와 정합).
    status: active

preconditions:
  - id: PRE-0025-1
    statement: Neo4j schema 에 EditorialIntent 노드 + `:HAS_INTENT` relationship + `:USES_INTENT` (ContentDraft → EditorialIntent) 추가 — INFRA-1A.2 migration 에 포함.
  - id: PRE-0025-2
    statement: ContentDraft / Thesis frontmatter 에 `editorial_intent_id` 필드 추가 (Astro Content Collection Zod schema 에도 mirror — ADR-0022 INV-0022-3 build-time gate 확장).
  - id: PRE-0025-3
    statement: ID 체계 (ADR-0011 INV-0011-2) 에 `eit_` prefix 추가. 전체 ID schema = `src_/doc_/snap_/clm_/dos_/scn_/eit_/ths_/drf_/pub_/edge_/run_/aci_/mcl_/met_` (met_ 는 ADR-0024 derived_metric).

defines:
  - term: editorial_intent
    role: primary
  - term: alignment_criteria
    role: primary
  - term: exclusion_criteria
    role: primary
  - term: bidirectional_weight_intent
    role: primary
  - term: tone_enum
    role: primary
  - term: pipeline_object_model
    role: extends

invariant_review:
  status: pending
  reviewed_at: null
  fingerprint: null
unresolved_warnings: []
reviewed_terms:
  - claim
  - dossier
  - scenario
  - thesis
  - content_draft
  - publication
  - source_perspective
reviewed_scopes:
  - pipeline.thesis_layer
  - pipeline.publication_layer
  - storage.neo4j.editorial_intent_node
  - storage.markdown.curated_view

provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true
---

# ADR-0025: Editorial Intent layer — 10-stage object model

## Status

accepted — 2026-05-11

**Supersedes ADR-0011** (9-stage object model → 10-stage with EditorialIntent
anchor).

## Context

ADR-0011 의 9-stage object model (Source → Document → Snapshot → Claim →
Dossier → Scenario → Thesis → ContentDraft → Publication) 은 정보 합성
chain 은 명확하나 **운영자의 발행 의도(authorial intent / editorial stance)**
가 어디에도 명시되지 않는 문제가 있다.

사용자 발화 (2026-05-11): "내가 어떤 글이나 영상을 발행할 때는 어떤 의도가
있는데, 그 의도는 가설 뒤에 숨어있거든. 내 의도에 따라서 가설과 주장, 근거,
스토리 등이 align 되어야 하니까, 각 요소들의 기준선이 필요해."

문제:
1. **Thesis 가 floating** — Scenario revision 에서 Thesis 로 압축할 때
   어떤 의도로 stance / market_stance 를 선택했는지 명시 안 됨. 운영자가
   직접 의도를 잡지 않으면 LLM 이 default 합성 결과를 그대로 발행.
2. **ContentDraft 4-format 사이 일관성 부재** — 같은 thesis 를 blog_long
   / youtube_long / shorts / newsletter 로 변환할 때 의도 일관성 보장
   없음. 의도 명시가 있으면 4-format 모두 align.
3. **재사용 anchor 부재** — 같은 의도로 여러 thesis 또는 여러 format draft
   를 만들 때 의도 자체가 reusable anchor 가 없음. ScenarioRevision
   (ADR-0009) 는 데이터 anchor, Thesis 는 주장 anchor, 그 사이 의도
   anchor 가 빠짐.
4. **reproducibility 갭 (NFR-002)** — 같은 source + scenario 로도 다른
   thesis 가 가능. 의도 명시 없으면 운영자 본인도 6개월 후 같은 결론
   도달 X.
5. **bidirectional framing (ADR-0019) 의 운영자 의도 표면화 부재** —
   risk/opportunity/resilience/asymmetric 4축 중 어디에 weight 둘지가
   thesis stance 에 숨어있고 명시 안 됨.

본 ADR 은 **EditorialIntent 를 Scenario revision 과 Thesis 사이의 anchor**
로 도입 — 9-stage → 10-stage 확장.

## Decision

### 1. 10-stage object model

```
Source → Document → Snapshot → Claim → Dossier → Scenario
                                                    │
                                                    ▼ (decided_by_operator)
                                                EditorialIntent
                                                    │ :HAS_INTENT
                                                    ▼
                                                Thesis (stance + market_stance
                                                       constrained by intent)
                                                    │
                                                    ▼
                                                ContentDraft (format 별 분기,
                                                              :USES_INTENT
                                                              FK to EditorialIntent)
                                                    │
                                                    ▼
                                                Publication (cite check 5+1)
```

ADR-0011 의 9-stage 가 7번째에서 Scenario → Thesis 로 직결되던 것이 본
ADR 에서 Scenario → **EditorialIntent** → Thesis 의 3-hop 으로 확장.

### 2. EditorialIntent 필드

| 필드 | 타입 | 의미 | 예시 |
|---|---|---|---|
| `eit_id` | str (PK) | `eit_<sha256[0:10]>` | `eit_a3f8b912c4` |
| `purpose` | str | 발행 목적 한 줄 | "한국 부동산 정책 변화의 macro 리스크를 1인 자산형성기 직장인에게 전달" |
| `audience` | str | 타겟 독자 | "1인 자산형성기 직장인 / 부동산 매수 검토자" |
| `tone` | enum | 톤 | `informational` / `cautionary` / `explainer` / `opinion` / `debate_trigger` |
| `call_to_action` | str / null | 무엇을 하길 원하는가 | "추가 검토 후 본인 상황에 맞는 결정 / 단순 정보 전달 / 토론 trigger" |
| `alignment_criteria` | str[] | claim/scenario branch 선택 기준선 | ["정책 변화 → 가계 부채 → 매수 결정 의 인과 chain", "1~3년 horizon"] |
| `exclusion_criteria` | str[] | 의도적으로 제외할 axis | ["투자 추천 아님", "단기 traders 무관", "1주택 외 다주택 관점 제외"] |
| `bidirectional_weight_intent` | enum | ADR-0019 4축 weight | `risk_observer` / `opportunity_observer` / `resilience` / `asymmetric` / `balanced` |
| `related_dossier_ids` | str[] | 입력 dossier | `[dos_xxx, dos_yyy]` |
| `related_scenario_revision_ids` | str[] | 입력 scenario revision | `[scn_xxx#rev_2]` |
| `decided_by_operator` | bool | 운영자 명시 승인 (INV-0025-4) | `true` (false / null 이면 ContentDraft 거부) |
| `created_at` | iso datetime | | |

### 3. EditorialIntent 작성 워크플로

1. **LLM 자동 propose (선택)** — Scenario revision 입력 + 운영자가 좋아하는
   tone preference / audience 입력 → LLM (Tier 1 GPT-5.5 Pro standard,
   ADR-0023) 이 EditorialIntent draft 제안. `decided_by_operator = false`.
2. **운영자 명시 lock** — 운영자가 CLI `pipeline intent compose` 또는
   manual edit 으로 EditorialIntent draft 검토 + 수정 + lock. `decided_
   by_operator = true`.
3. **Thesis composer 진입** — 운영자가 lock 한 EditorialIntent 를
   reference 해서 Thesis 합성 (ADR-0023 Tier 1 default GPT-5.5 Pro
   standard, high-stakes flag 시 Tier 0 cross-vendor review).
4. **ContentDraft 4-format 분기** (v0 = blog_long only, DEC-005) — 같은
   EditorialIntent 를 reference 해서 각 format 별 draft 생성. 4 format
   사이 일관성 보장.
5. **Publication preflight cite check 5+1** — trace path 에 EditorialIntent
   포함 (INV-0025-5). 운영자가 의도와 다른 thesis stance / market_stance
   를 만들면 warning (INV-0025-6).

### 4. CLI 명령 신규

- `pipeline intent compose <scenario_revision_id> [--tone informational |
  cautionary | ...] [--audience <str>] [--weight-intent risk_observer |
  ...]` — LLM 자동 propose + 운영자 명시 승인 flow
- `pipeline intent show <eit_id>` — frontmatter + body 확인
- `pipeline intent lock <eit_id>` — `decided_by_operator = true` 전환
- `pipeline thesis compose <scenario_revision_id> --intent <eit_id>` —
  thesis composer 가 intent reference (기존 `pipeline thesis compose`
  signature 갱신)
- `pipeline draft compose <thesis_id> --format blog_long --intent
  <eit_id>` — ContentDraft composer 가 intent reference

### 5. Storage

- Neo4j: `EditorialIntent` 노드 + `:HAS_INTENT` (Thesis → EditorialIntent)
  + `:USES_INTENT` (ContentDraft → EditorialIntent) relationship.
- Markdown vault: `vault/editorial_intents/<eit_id>.md` — frontmatter +
  body (audience description + 운영자 노트). 자체 사이트 비노출 (INV-0025-8).
- SQLite: editorial_intent metadata 별도 테이블 미필요 (Neo4j 가 primary).
- ADR-0022 INV-0022-3 build-time gate 의 Zod schema 에 ContentDraft
  frontmatter `editorial_intent_id` 필드 추가 — dead-link `eit_id` 도
  build fail.

### 6. 영향 받는 invariants / docs

- **ADR-0011 INV-0011-1 supersede** (9-stage → 10-stage).
- **ADR-0011 INV-0011-2 (ID schema) 확장** — `eit_` prefix 추가.
- **ADR-0019 INV-0019-1** (thesis stance + market_stance) 와 align —
  EditorialIntent bidirectional_weight_intent 가 thesis stance 의
  default guide.
- **ADR-0009** (scenario validate + revisions ledger) 와 정합 —
  EditorialIntent 는 ScenarioRevision 입력으로 생성, ScenarioRevision
  변경 시 EditorialIntent 도 revision 가능 (별도 ledger 또는 super-
  sede 표시).
- **ADR-0015** (cite check 5+1) trace path 확장 — INV-0025-5.
- **ADR-0022** (자체 사이트 publishing) — INV-0022-4 의 internal
  canonical 보존과 정합 (EditorialIntent 는 사이트 비노출).
- **ADR-0023 / DEC-010** (LLM routing v2) — EditorialIntent propose 는
  Tier 1 default (GPT-5.5 Pro standard). 운영자 lock 후 Thesis composer
  진입.

### 7. v0 turn-key MVP gate 영향 (DEC-009 + PUB-1A.5)

DEC-009 의 "한국 부동산 시장/정책의 현주소, 리스크" 첫 발행에서:
1. Scenario revision 1건 → 운영자가 EditorialIntent 작성 / lock (예
   purpose = "한국 부동산 정책 변화의 macro risk 를 1인 자산형성기
   직장인에게 전달", audience = "...", tone = `cautionary`,
   bidirectional_weight_intent = `risk_observer`).
2. Thesis composer → EditorialIntent reference, stance + market_stance
   align.
3. ContentDraft (blog_long) composer → EditorialIntent reference.
4. Publication preflight → EditorialIntent 가 trace path 에 포함.

PUB-1A.5 진입 시점에 운영자 명시 EditorialIntent 작성 의무.

## Alternatives Considered

- **A** (chosen) — EditorialIntent 를 Scenario 와 Thesis 사이의 명시
  anchor 로 도입 (10-stage):
  - pros: 운영자 의도 명시 → thesis/draft 일관성 + reproducibility (NFR-002)
    + bidirectional framing (ADR-0019) 의 운영자 weight 표면화 + 4-format
    재사용 anchor (DEC-005 v0 blog_long only 이후 v1+ youtube_long /
    shorts / newsletter activation 시 같은 intent 재사용)
  - cons: 10-stage 로 trace depth 증가 — NFR-003 5단계 trace 유지에
    선택적 skip 의무. ID 체계 / Neo4j schema migration 부담
- **B** — EditorialIntent 를 Thesis 의 필드로 흡수 (thesis.purpose,
  thesis.tone 등):
  - pros: stage 수 변경 없음, schema 단순
  - cons: 재사용 anchor 부재 (같은 intent 로 여러 thesis 생성 시 중복),
    LLM 자동 thesis 합성과 운영자 명시 의도 분리 안 됨, 4-format draft
    사이 의도 일관성 보장 안 됨. **rejected**.
- **C** — EditorialIntent 를 ContentDraft 의 필드로 흡수 (draft.purpose
  등):
  - pros: draft 수준에서 의도 명시
  - cons: thesis 자체가 의도 없이 floating, 4-format draft 사이 의도
    분기 가능 (불일치). **rejected**.
- **D** — EditorialIntent 를 별도 Publication metadata 로 두기 (Pub →
  EditorialIntent backward link):
  - pros: 발행 시점 의도 lock
  - cons: thesis composer 가 의도 모르고 합성 → publication 시점에서야
    intent 정렬 검사 (너무 늦음). thesis stance 가 intent 와 다르게 합성
    돼도 retroactive justification 만 가능. **rejected**.
- **E** — 도입 안 하기 (ADR-0011 9-stage 유지):
  - pros: 변경 비용 0
  - cons: 운영자 의도 floating, NFR-002 reproducibility 갭 유지,
    4-format 재사용 anchor 부재. **rejected** (사용자 결정).

## Consequences

- 긍정:
  - 운영자 의도가 명시 anchor → thesis / 4-format draft / publication
    일관성 보장
  - reproducibility 강화 (NFR-002) — 같은 source + scenario revision +
    EditorialIntent 면 동일 thesis + draft 도달
  - bidirectional framing (ADR-0019) 의 운영자 weight 표면화 →
    one-sided thesis warning (cite check 5+1) 의 detection 정확도 ↑
  - 4-format 재사용 anchor — v1+ newsletter / youtube_long / shorts
    activation (Q-032) 시 같은 EditorialIntent 로 4 draft 일관 생성
  - 운영자 명시 lock 의무 (INV-0025-4) — LLM 자동 합성이 발행 의도까지
    삼키는 것 차단 (1인 운영자의 authorial voice 보존)
- 부정:
  - 10-stage 로 NFR-003 5단계 trace 유지 부담 — 선택적 skip 의무 (예
    Scenario revision 직접 Thesis 까지 skip 가능 BUT EditorialIntent 도
    포함하면 6 hops, 단축 path 보장 필요)
  - ID 체계 + Neo4j schema migration 부담 (INFRA-1A.2 commit 직전)
  - 운영자 작업 부담 ↑ — 발행 1건당 EditorialIntent 명시 작성 의무 (v0
    PUB-1A.5 진입 시점)
  - ContentDraft frontmatter + Astro Zod schema 확장 (ADR-0022 INV-0022-3
    build-time gate 에 editorial_intent_id 추가)
- 후속 작업:
  - ADR-0011 status: superseded by ADR-0025 (object model 부분만 supersede,
    ID 체계 + frontmatter 4-format reuse 등 다른 INV 는 그대로)
  - 신규 slice `AGG-1A.5` — EditorialIntent composer + CLI `pipeline intent
    compose/show/lock` + Neo4j `:HAS_INTENT` / `:USES_INTENT` relationship
    + vault `editorial_intents/` 디렉토리 + Astro Zod schema 확장
  - IMPL plan AGG-1A.4 (Thesis composer) 갱신 — EditorialIntent reference
    의무
  - IMPL plan PUB-1A.1 (ContentDraft composer) 갱신 — EditorialIntent
    reference 의무
  - IMPL plan PUB-1A.5 (첫 발행) — EditorialIntent 명시 작성 단계 포함
  - PRD REQ-001 (9-stage → 10-stage), REQ-005 (ID 체계 + eit_),
    REQ-021 (thesis stance align + intent), NFR-002 (reproducibility 강화)
    갱신
  - HLD Architecture Diagram + Components + Data Model 갱신
  - HLD CLI: `pipeline intent compose/show/lock` 추가
  - glossary `editorial_intent.md` + `alignment_criteria.md` + `tone_enum.md`
    신규
  - ADR-0022 INV-0022-3 build-time gate 확장 — ContentDraft frontmatter
    editorial_intent_id dead-link 도 build fail
  - 신규 Q — EditorialIntent revision 정책 (ScenarioRevision 처럼
    append-only ledger? vs in-place edit + version 표기?)

## References

- ADR-0011 (superseded — 9-stage object model)
- ADR-0009 (scenario validate + revisions ledger — EditorialIntent 가
  ScenarioRevision 입력으로 생성)
- ADR-0019 (bidirectional framing — bidirectional_weight_intent 가 4축
  weight 표면화)
- ADR-0015 (cite check 5+1 — INV-0025-5 trace path 확장)
- ADR-0022 (자체 사이트 publishing — INV-0022-3 build-time gate 확장,
  INV-0022-4 internal canonical 보존)
- ADR-0023 (LLM routing v2 — EditorialIntent propose Tier 1 default)
- DEC-005 (v0 turn-key publish scope — blog_long only, 4-format anchor
  EditorialIntent 가 v1+ activation 시 재사용)
- DEC-009 (첫 발행 = 한국 부동산 — EditorialIntent 명시 작성 의무)
- Q-036 (첫 발행 sub-topic 좁히기 — EditorialIntent purpose / audience /
  tone 결정 input)
