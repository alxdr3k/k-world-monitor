---
id: adr-0011
type: adr
title: 9-stage pipeline object model with Source + Thesis (supersedes ADR-0003)
status: superseded
created_at: 2026-05-11
updated_at: 2026-05-11
deciders: [user, claude-opus-4-7, gpt]
supersedes: [adr-0003]
superseded_by: [adr-0025]

scope:
  in:
    - pipeline.source_layer
    - pipeline.aggregation_layer
    - pipeline.scenario_layer
    - pipeline.thesis_layer
    - pipeline.publication_layer
    - storage.neo4j.source_node
    - storage.neo4j.thesis_node
    - storage.neo4j.scenario_node
    - storage.neo4j.dossier_node
    - storage.neo4j.claim_node
  out:
    - storage.r2.bytes                # bytes 정책은 ADR-0012
    - storage.neo4j.edges             # edge ledger는 ADR-0013
    - pipeline.extraction_layer.routing # LLM routing은 ADR-0006

invariants:
  - id: INV-0011-1
    statement: 객체 모델은 정확히 9-stage이며 순서는 Source → Document → Snapshot → Claim → Dossier → Scenario → Thesis → ContentDraft → Publication이다 (역방향 / skip 금지)
    status: active
  - id: INV-0011-2
    statement: Source(=publisher/registry entity, Tier 0)는 Document 그룹의 상위 컨테이너다. Document.publisher 필드는 Source FK로 표현하며, reliability_tier와 collectability_score(ADR-0016)는 Source 단위 속성이다
    status: active
  - id: INV-0011-3
    statement: Thesis는 Scenario와 ContentDraft 사이의 재사용 가능한 핵심 주장 단위다. 같은 Thesis는 blog long / youtube long / shorts / newsletter 4개 형식의 ContentDraft에 재사용된다
    status: active
  - id: INV-0011-4
    statement: source layer는 Source / Document / Snapshot / Claim 4-tier로 분리된다 (ADR-0003의 3-tier source layer 확장). SourceNote=URL 1:1 모델은 폐기됐다
    status: active
  - id: INV-0011-5
    statement: Claim lifecycle은 draft / confirmed / disputed / stale / retracted / source_changed / source_unavailable / needs_recorroboration 8-state다 (ADR-0003 5-state 확장, R9/Q4)
    status: active
  - id: INV-0011-6
    statement: Scenario는 Dossier를 거쳐 합성되며 promoted claim만 인용한다 (ADR-0003 INV-0003-4, INV-0003-5 보존)
    status: active
  - id: INV-0011-7
    statement: ContentDraft는 cite_check pass 없이 Publication으로 승격되지 않는다 (ADR-0003 INV-0003-6 보존, cite check 5-check는 ADR-0015)
    status: active
  - id: INV-0011-8
    statement: Publication은 인용된 promoted claim id, dossier id, scenario id, scenario revision id, thesis id를 ledger로 보존한다 (NFR-003 5-step trace anchor)
    status: active

preconditions:
  - id: PRE-0011-1
    statement: Neo4j Community Edition graph store가 도입돼 있다 (ADR-0012)
  - id: PRE-0011-2
    statement: R2 permitted artifact store가 도입돼 있다 (ADR-0012)

defines:
  - term: source
    role: primary
  - term: thesis
    role: primary
  - term: document
    role: secondary    # ADR-0003에서 primary로 정의됨, 본 ADR은 Source 추가 후 위치 명시만
  - term: snapshot
    role: secondary
  - term: claim
    role: secondary
  - term: dossier
    role: secondary
  - term: scenario
    role: secondary
  - term: content_draft
    role: secondary
  - term: publication
    role: secondary

invariant_review:
  status: pending
  reviewed_at: null
  fingerprint: null
unresolved_warnings: []
reviewed_terms:
  - source
  - document
  - snapshot
  - claim
  - dossier
  - scenario
  - thesis
  - content_draft
  - publication
reviewed_scopes:
  - pipeline.source_layer
  - pipeline.aggregation_layer
  - pipeline.scenario_layer
  - pipeline.thesis_layer
  - pipeline.publication_layer
  - storage.neo4j.source_node
  - storage.neo4j.thesis_node
  - storage.neo4j.scenario_node
  - storage.neo4j.dossier_node
  - storage.neo4j.claim_node
  - storage.r2.bytes
  - storage.neo4j.edges
  - pipeline.extraction_layer.routing

provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true
---

# ADR-0011: 9-stage pipeline object model with Source + Thesis

## Status

accepted — 2026-05-11. Supersedes ADR-0003.

## Context

ideation `research-content-pipeline-architecture` Round 3 lock은 7-stage(Document
→ Snapshot → Claim → Dossier → Scenario → ContentDraft → Publication)를
확정했고 ADR-0003이 이를 기록했다. 그러나 Round 6/Q1 + Round 12/Q7에서 두 stage
가 추가됐다:

1. **Source (Tier 0)**: publisher/registry entity. 같은 publisher의 여러
   Document를 묶고 reliability_tier + collectability_score(ADR-0016) + source
   policy(ADR-0017)를 보유한다. Round 3 모델은 Document에 publisher 필드를
   직접 박았지만 Tier A-D 분류·policy gate·access intervention이 별도 entity로
   분리될 필요가 생겼다.
2. **Thesis**: Scenario와 ContentDraft 사이의 재사용 가능한 핵심 주장. 같은
   Thesis가 블로그 long / 유튜브 long / shorts / 뉴스레터 4개 형식의
   ContentDraft에 재사용된다. 운영자가 "같은 주장을 4번 다시 쓰는" 비용을
   막는다.

또한 Round 9/Q4는 claim_status 3개 추가를 결정했다(source_changed /
source_unavailable / needs_recorroboration).

## Decision

객체 모델은 9-stage로 lock한다.

```
Source → Document → Snapshot → Claim → Dossier → Scenario → Thesis → ContentDraft → Publication
└────────── source layer (4-tier) ──────────┘  └────────── publication layer (5-stage) ──────────┘
```

source layer 4-tier 책임:

| Tier | 책임 |
|---|---|
| Source | publisher/registry entity. reliability_tier, collectability_score, source policy 보유 (ADR-0016, ADR-0017) |
| Document | 동일 실체로 묶이는 URL 그룹. publisher는 Source FK |
| Snapshot | fetch 시점 fingerprint record (URL, accessed_at, content_hash, locator). R2 binary 보관은 예외 (ADR-0012) |
| Claim | snapshot에서 추출한 단일 사실. evidence_quote(nullable) + quote_reason + extraction_confidence + claim_status |

publication layer 5-stage 책임:

| Stage | 책임 |
|---|---|
| Dossier | 주제별 promoted claim + counterclaim + monitoring signal 합성 |
| Scenario | drivers/assumptions(weight)/branches/falsifiers/counterclaim/monitoring/impact_targets + scenario_revisions ledger (ADR-0019) |
| Thesis | scenario를 압축한 재사용 가능한 핵심 주장. thesis.stance + thesis.market_stance(optional) (ADR-0019) |
| ContentDraft | Thesis + Dossier → 초고 (format별 분기). cite_check 통과 시 Publication 승격 |
| Publication | live/corrected/retracted state + 인용 ledger (5-step trace anchor) |

Claim lifecycle 8-state (ADR-0003 5-state + R9/Q4 3개 추가):
- draft / confirmed / disputed / stale / retracted (Round 3)
- source_changed / source_unavailable / needs_recorroboration (Round 9)

ID 체계: `src_/doc_/snap_/clm_/dos_/scn_/ths_/drf_/pub_/edge_/run_` 접두 + 단조
증가 식별자.

## Alternatives Considered

- **A** (chosen): 9-stage with Source + Thesis
  - pros: publisher-level entity 분리로 policy/access intervention/collectability
    추적 가능; Thesis 재사용으로 4-format content production 자연스러움; 5-step
    trace 보존
  - cons: 객체 종류 9개 + edge ledger로 학습 비용 추가 증가
- **B** (discarded — Round 3 lock): 7-stage without Source + Thesis (ADR-0003)
  - pros: 모델 단순
  - cons: publisher policy를 Document에 박으면 Tier A-D 분류·access intervention
    cascade 어려움; 같은 Thesis 4번 재작성 비용
- **C** (discarded — Round 2 GPT): 5-tier source (Source/Document/Snapshot/Chunk
  /Claim)
  - pros: 가장 명시적
  - cons: Chunk는 검색 인덱스 내부 객체로 충분 (Round 3 메타 리뷰 결정)
- **D** (discarded): Thesis를 ContentDraft 내부 필드로
  - pros: 객체 감소
  - cons: 같은 thesis가 여러 draft에 재사용될 때 dedupe/lineage 불가능

## Consequences

- 긍정:
  - publisher-level entity(Source)가 collectability/policy/access intervention의
    anchor가 됨
  - Thesis가 4-format content production의 재사용 anchor가 됨
  - 5-step trace(Publication → ContentDraft → Thesis → Scenario → Claim →
    Snapshot → R2 bytes)는 9-stage 안에서 5단계 이내 유지 가능 (선택적 단계
    skip, NFR-003)
  - claim lifecycle 8-state로 source 변경/소실 감지 가능

- 부정 / trade-off:
  - Source 객체 추가로 v0 부트스트랩 시 source registry seed 작성 필요(Q21)
  - Thesis ID 체계 결정 필요(Q-008)
  - 9-stage에 새 stage 추가는 새 ADR 필요 (rigidity)

- 후속 작업:
  - ADR-0012: storage 분담 (Neo4j / SQLite / R2)
  - ADR-0013: edge ledger via Neo4j
  - ADR-0016: collection realism (Tier A-D, collectability_score)
  - ADR-0017: source policy gate
  - ADR-0019: bidirectional framing (scenario.impact_targets, thesis.stance)
  - INFRA-1A.1 slice 재작성 — 9-stage 글로서리 + Source/Thesis 추가

## References

- ideation 출처: `docs/discovery/research-content-pipeline-ideation.md`
  Round 6/Q1 (Source/Thesis 추가), Round 12/Q7 (Thesis 핵심 기여), Round 9/Q4
  (claim_status 확장), Round 20 (`alxdr3k/k-world-monitor` external repo 결정)
- 관련 ADR: ADR-0012, ADR-0013, ADR-0014, ADR-0015, ADR-0016, ADR-0017,
  ADR-0018, ADR-0019, ADR-0020, ADR-0021
- Supersedes: ADR-0003
