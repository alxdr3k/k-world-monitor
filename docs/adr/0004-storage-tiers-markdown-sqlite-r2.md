---
id: adr-0004
type: adr
title: Storage tiers — Markdown (curated) / SQLite+FTS5 (canonical) / R2 (bytes)
status: superseded
created_at: 2026-05-11
updated_at: 2026-05-11
deciders: [user, claude-opus-4-7, gpt]
supersedes: []
superseded_by: [adr-0012]

scope:
  in:
    - storage.markdown.document_hub
    - storage.markdown.dossier
    - storage.markdown.scenario
    - storage.markdown.content_draft
    - storage.markdown.publication
    - storage.markdown.promoted_claim
    - storage.sqlite.canonical
    - storage.sqlite.fts5
    - storage.r2.bytes
    - storage.r2.extracted_text_cache
  out:
    - storage.sqlite.edge_table       # edge ledger 자체는 ADR-0007
    - pipeline.extraction_layer       # extraction routing은 ADR-0006

invariants:
  - id: INV-0004-1
    statement: SQLite + FTS5는 모든 candidate claim, snapshot 메타, chunk 인덱스, edge의 canonical bulk store다
    status: active
  - id: INV-0004-2
    statement: R2는 Snapshot 원본 bytes(HTML / PDF) + 추출 텍스트 캐시의 canonical 저장소다. r2_key + sha256 + mime을 SQLite snapshot 테이블에 보존한다
    status: active
  - id: INV-0004-3
    statement: Markdown vault에는 Document hub, Dossier, Scenario, ContentDraft, Publication, scenario에 인용된 promoted claim만 둔다. candidate claim 자동 markdown 생성은 금지
    status: active
  - id: INV-0004-4
    statement: JSONL은 import / export 포맷일 뿐 canonical 저장소가 아니다
    status: active

preconditions:
  - id: PRE-0004-1
    statement: 운영자가 Cloudflare R2 운영 가능 (PRD ASM-001)
  - id: PRE-0004-2
    statement: SQLite + FTS5 binary가 로컬 / CI runtime에 설치돼 있다

defines: []

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
  - storage.markdown.document_hub
  - storage.markdown.dossier
  - storage.markdown.scenario
  - storage.markdown.content_draft
  - storage.markdown.publication
  - storage.markdown.promoted_claim
  - storage.sqlite.canonical
  - storage.sqlite.fts5
  - storage.r2.bytes
  - storage.r2.extracted_text_cache
  - storage.sqlite.edge_table
  - pipeline.extraction_layer

provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true
---

# ADR-0004: Storage tiers — Markdown / SQLite+FTS5 / R2

## Status

superseded by ADR-0012 (2026-05-11). 이 문서는 Round 3 lock 시점의 storage 결정을 기록한다. ideation Round 8/Q3에서 Snapshot 의미를 binary→fingerprint로, Round 14/Q9-4에서 raw cloud upload를 영구 금지로 변경했고, Round 18에서 graph store를 SQLite에서 Neo4j Community Edition으로 이동했다. 현 canonical은 ADR-0012.

## Context

ideation Round 2 비판 R2 — `ClaimNote` 같은 markdown 노트를 candidate claim마다
자동 생성하면 vault가 무너진다(수만 건 .md). 동시에 마크다운은 사람이 읽는
curated view로 가치가 크다. JSONL only를 제안하는 안도 있었으나 검색 성능과
chunk 인덱싱을 jsonl로 하기 어렵다. Round 3에서 사용자가 SQLite + FTS5를
처음부터 도입하기로 결정, JSONL은 import/export 포맷으로 격하.

원문 bytes는 git에 두면 비용/검증성 모두 깨지므로 R2에 두기로 한다.

## Decision

| Tier | 책임 | 형식 |
|---|---|---|
| Markdown vault | Document hub, Dossier, Scenario, ContentDraft, Publication, scenario에 인용된 **promoted** claim | `.md` with frontmatter |
| SQLite + FTS5 | 모든 candidate claim, snapshot 메타, chunk 인덱스, edge ledger, run ledger | `*.db` (research.db) |
| R2 | Snapshot 원본 bytes(HTML/PDF) + 추출 텍스트 캐시 | object storage with `r2_key` |
| JSONL | import / export only | not canonical |

세 store 사이의 책임은 invariant로 강제된다 (INV-0004-1, 2, 3).

## Alternatives Considered

- **A** (chosen): Markdown(curated) + SQLite+FTS5(canonical) + R2(bytes)
  - pros: vault 무너지지 않음, 검색 성능 보장, bytes 영속, 책임 명확
  - cons: 3-tier 동기화 책임 (특히 promotion: SQLite candidate → Markdown)
- **B** (discarded — Round 1 Claude 초안): markdown only
  - pros: 도구 단순
  - cons: 수만 건 자동 생성 시 vault 무너짐, 검색 성능 부족
- **C** (discarded — Round 2 GPT 초안): JSONL only bulk store
  - pros: import/export 단순
  - cons: 검색은 별도 인덱스 필요(중복), edge query 어려움 — 사용자가 SQLite
    처음부터 채택
- **D** (discarded): bytes를 git LFS
  - pros: 단일 도구
  - cons: 비용, history 검증성 부족, R2 직접이 더 단순

## Consequences

- 긍정:
  - vault는 사람이 읽기 좋은 promoted view, 검색은 FTS5, bytes는 영속
  - candidate claim 폭증해도 markdown 부하 없음
  - SQLite는 단일 파일 백업 단순

- 부정 / trade-off:
  - promotion(SQLite candidate → Markdown promoted) 책임이 명확해야 함
  - SQLite 단일 파일 → 동시쓰기 제한 (단일 운영자 환경에서는 수용)
  - R2 비용 / 키 관리 운영 부담

- 후속 작업:
  - SQLite 스키마 초안 (INFRA-1A.2 slice)
  - R2 bucket / key prefix 정책 (INFRA-1A.3 slice)
  - Markdown promotion 트리거 명세 (INFRA-1B 단계)

## References

- ideation: Round 2 비판 R2 / Round 3 결정 (2)(5)(6)
- 관련 ADR: ADR-0003, ADR-0007, ADR-0008
