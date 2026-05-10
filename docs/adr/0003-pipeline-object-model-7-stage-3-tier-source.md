---
id: adr-0003
type: adr
title: 7-stage pipeline object model with 3-tier source layer
status: accepted
created_at: 2026-05-11
updated_at: 2026-05-11
deciders: [user, claude-opus-4-7, gpt]
supersedes: []
superseded_by: []

scope:
  in:
    - pipeline.source_layer
    - pipeline.aggregation_layer
    - pipeline.scenario_layer
    - pipeline.publication_layer
    - storage.sqlite.document_table
    - storage.sqlite.snapshot_table
    - storage.sqlite.claim_table
    - storage.sqlite.dossier_table
    - storage.sqlite.scenario_table
    - storage.markdown.document_hub
    - storage.markdown.dossier
    - storage.markdown.scenario
  out:
    - storage.r2.bytes              # bytes 저장 정책은 ADR-0004
    - pipeline.extraction_layer.routing # LLM routing은 ADR-0006
    - storage.sqlite.edge_table     # edge ledger는 ADR-0007

invariants:
  - id: INV-0003-1
    statement: 객체 모델은 정확히 7-stage이며 순서는 Document → Snapshot → Claim → Dossier → Scenario → ContentDraft → Publication이다 (역방향 / skip 금지)
    status: active
  - id: INV-0003-2
    statement: source layer는 Document(메타) / Snapshot(immutable bytes) / Claim(추출 사실) 3-tier로 분리된다. SourceNote=URL 1:1 모델은 폐기됐다
    status: active
  - id: INV-0003-3
    statement: Claim lifecycle은 draft / confirmed / disputed / stale / retracted 5-state이며 frontmatter ledger 변경으로만 전이된다 (body-only 변경 금지)
    status: active
  - id: INV-0003-4
    statement: Scenario는 Dossier를 거쳐 합성된다. Source → Claim → Scenario 직행 금지
    status: active
  - id: INV-0003-5
    statement: Scenario는 promoted claim만 인용한다 (candidate claim 직접 인용 금지)
    status: active
  - id: INV-0003-6
    statement: ContentDraft는 cite_check pass 없이 Publication으로 승격되지 않는다
    status: active
  - id: INV-0003-7
    statement: Publication은 인용된 promoted claim id, dossier id, scenario id, scenario revision id를 ledger로 보존한다 (NFR-003 5-step trace anchor)
    status: active

preconditions:
  - id: PRE-0003-1
    statement: SQLite + FTS5 canonical bulk store가 도입돼 있다 (ADR-0004 의존)
  - id: PRE-0003-2
    statement: R2 원문 저장이 도입돼 있다 (ADR-0004 의존)

defines:
  - term: document
    role: primary
  - term: snapshot
    role: primary
  - term: claim
    role: primary
  - term: dossier
    role: primary
  - term: scenario
    role: primary
  - term: content_draft
    role: primary
  - term: publication
    role: primary

invariant_review:
  status: pending
  reviewed_at: null
  fingerprint: null
unresolved_warnings: []
reviewed_terms:
  - document
  - snapshot
  - claim
  - dossier
  - scenario
  - content_draft
  - publication
reviewed_scopes:
  - pipeline.source_layer
  - pipeline.aggregation_layer
  - pipeline.scenario_layer
  - pipeline.publication_layer
  - storage.sqlite.document_table
  - storage.sqlite.snapshot_table
  - storage.sqlite.claim_table
  - storage.sqlite.dossier_table
  - storage.sqlite.scenario_table
  - storage.markdown.document_hub
  - storage.markdown.dossier
  - storage.markdown.scenario
  - storage.r2.bytes
  - pipeline.extraction_layer.routing
  - storage.sqlite.edge_table

provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true
---

# ADR-0003: 7-stage pipeline object model with 3-tier source layer

## Status

accepted — 2026-05-11

## Context

second-brain ideation `research-content-pipeline-architecture` Round 1에서 Claude
가 제안한 모델은 SourceNote = URL 1:1 + scenario를 drivers/assumptions/branches/
falsifiers로 모델링하는 안이었다. Round 2 GPT 비판 R1이 다음 약점을 정확히
지적했다.

- 동일 문서가 PDF + HTML 두 URL로 존재할 수 있다.
- 통계 페이지는 시간에 따라 갱신된다.
- "원본"이라는 단일 객체로 묶지 않으면 인용 검증과 cite cascade가 깨진다.

또한 Round 2 비판 R4가 `Source → Claim → Scenario` 직행은 비약이며 주제별
중간 계층(Dossier/Brief)이 reusability를 위해 필요하다고 지적했다.

Round 3 Claude 메타 리뷰는 GPT의 5-tier(Source/Document/Snapshot/Chunk/Claim)
제안을 3-tier(Document/Snapshot/Claim)로 축소했다 — Chunk는 인덱스 내부 객체로
숨기고 publisher는 Document 필드로 흡수.

## Decision

객체 모델은 7-stage로 lock한다.

```
Document → Snapshot → Claim → Dossier → Scenario → ContentDraft → Publication
└─────── source layer (3-tier) ───────┘  └─────── publication layer ───────┘
```

source layer 3-tier 책임:

| Tier | 책임 |
|---|---|
| Document | publisher 메타 + 동일 실체로 묶이는 URL 그룹 + reliability_tier |
| Snapshot | fetch 시점 immutable bytes (R2 r2_key + sha256 + mime) |
| Claim | snapshot에서 추출한 단일 사실, evidence_quote + extraction_confidence + claim_status (draft/confirmed/disputed/stale/retracted) |

publication layer 4-stage 책임:

| Stage | 책임 |
|---|---|
| Dossier | 주제별 promoted claim + counterclaim + monitoring signal 합성 |
| Scenario | drivers/assumptions(weight)/branches/falsifiers/counterclaim/monitoring + scenario_revisions ledger |
| ContentDraft | Dossier+Scenario → 초고. cite_check 통과 시 Publication 승격 |
| Publication | live/corrected/retracted state + 인용 ledger (5-step trace anchor) |

ID 체계: `doc_/snap_/clm_/dos_/scn_/drf_/pub_/edge_/run_` 접두 + 단조 증가
식별자.

## Alternatives Considered

- **A** (chosen): 7-stage with 3-tier source layer
  - pros: NFR-003 5-step trace 보장, 동일 문서 다중 URL 표현 가능, Dossier로
    reusability anchor, scenario에 counterclaim/falsifier 강제 가능, Claim
    lifecycle 5-state로 stale cascade 표현 가능
  - cons: 객체 종류 7개 + edge edge ledger로 학습 비용 증가, 초기 구현 부담
- **B** (discarded — Round 1): SourceNote = URL 1:1 + scenario 단순화
  - pros: 객체 적음
  - cons: 동일 문서 다중 URL / 시간 변동 / PDF+HTML 짝 표현 불가능, Dossier
    부재로 매번 같은 주제 재합성, scenario cherry-picking 위험
- **C** (discarded — Round 2 GPT 5-tier 안): Source/Document/Snapshot/Chunk/Claim 5-tier
  - pros: 가장 명시적
  - cons: Chunk는 검색 인덱스 내부 객체로 충분, publisher는 Document 필드로
    흡수 가능 — 5-tier는 초기에 과함 (Round 3 Claude 메타 리뷰 결정)

## Consequences

- 긍정:
  - NFR-003 5-step trace(Publication → ContentDraft → Claim → Snapshot → R2
    bytes)가 객체 모델 자체로 표현됨
  - Document/Snapshot 분리로 cite cascade가 sha256 변경 검출에 의존 가능
  - Dossier가 reusability anchor로 작동, scenario 재합성 비용 감소
  - Scenario에 counterclaim/falsifier/monitoring signal 강제로 cherry-picking
    방지

- 부정 / trade-off:
  - 7개 객체 + edge ledger로 초기 구현 표면적 증가
  - 모든 인용 경로(Publication ← ContentDraft ← Scenario ← Dossier ← Claim
    ← Snapshot ← Document)에 ID propagation 책임
  - 7-stage에 새 stage 추가는 새 ADR 필요 (rigidity)

- 후속 작업:
  - ADR-0004: storage 분담 (Markdown / SQLite / R2)
  - ADR-0005: confidence 분해
  - ADR-0006: LLM routing + auto-accept threshold
  - ADR-0007: edge ledger
  - ADR-0008: evidence quote 정책
  - ADR-0009: scenario_revisions ledger
  - ADR-0010: stale 트리거 + review throttling

## References

- ideation 출처: `~/ws/second-brain/02. Ideation/research-content-pipeline-architecture.md` Round 1~3
- ideation discovery copy: `docs/discovery/research-content-pipeline-ideation.md`
- 관련 ADR: ADR-0004, ADR-0005, ADR-0006, ADR-0007, ADR-0008, ADR-0009, ADR-0010
