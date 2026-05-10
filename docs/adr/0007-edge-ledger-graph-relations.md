---
id: adr-0007
type: adr
title: Edge ledger — supports / contradicts / qualifies / updates / supersedes
status: accepted
created_at: 2026-05-11
updated_at: 2026-05-11
deciders: [user, claude-opus-4-7, gpt]
supersedes: []
superseded_by: []

scope:
  in:
    - storage.sqlite.edge_table
    - pipeline.scenario_layer.edge_query
    - pipeline.cite_check_layer.cascade
  out:
    - storage.markdown.frontmatter.relations  # markdown frontmatter 배열은 INV-0007-2로 금지
    - pipeline.extraction_layer.routing       # routing은 ADR-0006

invariants:
  - id: INV-0007-1
    statement: edge 관계는 edge record(SQLite edges 테이블)로만 표현한다. relation_type ∈ {supports, contradicts, qualifies, updates, supersedes}; (from_id, to_id, relation_type, scope, rationale, provenance, created_at, run_id) 필드를 가진다
    status: active
  - id: INV-0007-2
    statement: claim / scenario / publication frontmatter에 supports[] / contradicts[] / qualifies[] 등 관계 배열을 두는 것은 금지한다 (query / dedupe / provenance 추적 불가)
    status: active
  - id: INV-0007-3
    statement: scenario 진화는 supersedes 또는 updates edge로 추적한다 (ADR-0009 scenario_revisions ledger와 결합)
    status: active

preconditions:
  - id: PRE-0007-1
    statement: SQLite + FTS5 canonical store가 도입돼 있다 (ADR-0004)

defines:
  - term: edge
    role: primary

invariant_review:
  status: pending
  reviewed_at: null
  fingerprint: null
unresolved_warnings: []
reviewed_terms:
  - edge
  - claim
  - scenario
reviewed_scopes:
  - storage.sqlite.edge_table
  - pipeline.scenario_layer.edge_query
  - pipeline.cite_check_layer.cascade
  - storage.markdown.frontmatter.relations
  - pipeline.extraction_layer.routing

provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true
---

# ADR-0007: Edge ledger

## Status

accepted — 2026-05-11

## Context

ideation Round 2 비판 R7 — `supports[] / contradicts[]` frontmatter 배열은
양방향 query / dedupe / 변경 시점 추적이 불가능하다. cite cascade(인용된 claim
이 retracted로 바뀔 때 Publication 자동 corrected) 같은 운영 기능은 edge query
없이 불가능하다.

또한 scenario 시간 진화(`scenario_revisions`)는 ADR-0009에서 edge 기반으로
추적되도록 결정됐다. 두 결정은 같은 edge ledger 인프라에 의존한다.

## Decision

SQLite `edges` 테이블 스키마(초안):

| 컬럼 | 타입 | 비고 |
|---|---|---|
| edge_id | TEXT PK | `edge_<ULID>` |
| from_id | TEXT NOT NULL | 발신 객체 id (`clm_/scn_/pub_/dos_/...`) |
| to_id | TEXT NOT NULL | 수신 객체 id |
| relation_type | TEXT NOT NULL | enum {supports, contradicts, qualifies, updates, supersedes} |
| scope | TEXT | 관계가 성립하는 컨텍스트 (예: "동일 분기 시점 지표") |
| rationale | TEXT | 관계 근거 (≤ 500자) |
| provenance | TEXT NOT NULL | enum {user_confirmed, llm_inferred, derived} |
| run_id | TEXT | 추출/추론 run ledger 참조 |
| created_at | TEXT NOT NULL | ISO8601 |

unique constraint: `(from_id, to_id, relation_type, scope)` — 중복 edge 방지.

frontmatter 관계 배열은 영구 금지(INV-0007-2).

## Alternatives Considered

- **A** (chosen): SQLite edge ledger
  - pros: 양방향 query, dedupe, provenance, scenario 진화 추적 가능
  - cons: 새 테이블 + 운영 책임
- **B** (discarded — Round 1): frontmatter `supports[] / contradicts[]` 배열
  - pros: 단순
  - cons: query 불가, dedupe 불가, provenance 손실 (Round 2 비판 R7)
- **C** (discarded): JSONL append-only edge log
  - pros: append만 하면 됨
  - cons: 양방향 query에 매번 파일 스캔, dedupe 어려움
- **D** (discarded): 그래프 DB 별도 도입 (e.g., Neo4j)
  - pros: 그래프 query 강력
  - cons: 1인 운영 환경 + SQLite 이미 도입 → 외부 의존성 최소화 위반

## Consequences

- 긍정:
  - cite cascade(claim retracted → Publication corrected) 자동화 가능
  - scenario 진화 lineage(`supersedes` chain) query 가능
  - edge별 reviewer trail / provenance 추적

- 부정 / trade-off:
  - SQLite single-writer 제약 (1인 운영 환경에서는 수용)
  - edge dedup 정책의 정확한 normalization (scope 정규화 등) 필요

- 후속 작업:
  - INFRA-1A.4 slice: edges 테이블 스키마 commit
  - INFRA-1B 단계: cite cascade rule 코드
  - ADR-0009: scenario_revisions와 edge ledger 결합

## References

- ideation: Round 2 비판 R7 / Round 3 결정 (10)
- 관련 ADR: ADR-0003, ADR-0004, ADR-0008, ADR-0009
