---
id: adr-0014
type: adr
title: Neo4j-native feature adoption (APOC + GDS + native vector + native FTS) and intentional lock-in
status: accepted
created_at: 2026-05-11
updated_at: 2026-05-11
deciders: [user, claude-opus-4-7]
supersedes: []
superseded_by: []

scope:
  in:
    - storage.neo4j.native_features
    - storage.neo4j.apoc
    - storage.neo4j.gds
    - storage.neo4j.native_vector_index
    - storage.neo4j.native_fts
    - storage.neo4j.bloom_browser
    - storage.neo4j.constraints_indexes
    - operations.backup.neo4j_dump
    - operations.audit.jsonl_export
  out:
    - storage.neo4j.edges                # 관계 자체는 ADR-0013
    - storage.neo4j.graph_objects        # 객체 분담은 ADR-0012
    - pipeline.rag                       # RAG 단계화는 후속 ADR/ROADMAP

invariants:
  - id: INV-0014-1
    statement: v0부터 Neo4j Community Edition의 native 기능을 적극 활용한다 — APOC, GDS, native vector index(5.11+, v1), native FTS(Lucene), Bloom/Browser visualization, Cypher 5.x 고급 기능, CDC(5.13+)
    status: active
  - id: INV-0014-2
    statement: portable Cypher subset / vendor-neutral adapter pattern / 월별 migration smoke test 같은 vendor-neutral 제약은 도입하지 않는다 (R16 ADR-0015 폐기, R19 결정)
    status: active
  - id: INV-0014-3
    statement: graph object 검색은 Neo4j native FTS(Lucene)를 사용한다. SQLite FTS5는 relational metadata 검색만 (policy/metrics/audit log; ADR-0012 INV-0012-2)
    status: active
  - id: INV-0014-4
    statement: v1 embedding은 Neo4j native vector index(5.11+, HNSW)를 사용한다. pgvector 등 별도 vector store 도입은 v2+에서 specific 병목 확인 시에만 검토
    status: active
  - id: INV-0014-5
    statement: community detection (Louvain/Leiden) / centrality (PageRank/Betweenness) / node embedding (Node2Vec/FastRP)은 GDS native procedure를 사용한다. Python(networkx/igraph) 의존성 추가는 도입하지 않는다 (R14/Q9-2 권고 폐기, R19 결정)
    status: active
  - id: INV-0014-6
    statement: 백업은 (a) 일간 `neo4j-admin database dump` (retention 30d), (b) 일간 SQLite snapshot (retention 90d), (c) 월별 JSONL human-readable audit export (retention 1y)다. R2 derived artifact는 무기한, open-license dataset은 versioned (Q-027)
    status: active
  - id: INV-0014-7
    statement: 의도적 lock-in 수용 — future migration cost(며칠~몇 주)를 사전 productivity penalty로 갚지 않는다. JSONL audit export는 "vendor-neutral migration" 목적이 아닌 "human-readable audit trail" 목적으로만 유지

preconditions:
  - id: PRE-0014-1
    statement: Neo4j Community Edition 5.x가 설치돼 있다 (ADR-0012)
  - id: PRE-0014-2
    statement: APOC + GDS plugin 설치 권한이 운영자에게 있다 (Docker image / binary 둘 다 가능)
  - id: PRE-0014-3
    statement: GPL v3 boundary 검토가 완료됐다 (Q-020 — 1인 internal use는 contagion 없음)

defines: []

invariant_review:
  status: pending
  reviewed_at: null
  fingerprint: null
unresolved_warnings: []
reviewed_terms:
  - edge
  - claim
  - scenario
  - thesis
reviewed_scopes:
  - storage.neo4j.native_features
  - storage.neo4j.apoc
  - storage.neo4j.gds
  - storage.neo4j.native_vector_index
  - storage.neo4j.native_fts
  - storage.neo4j.bloom_browser
  - storage.neo4j.constraints_indexes
  - operations.backup.neo4j_dump
  - operations.audit.jsonl_export
  - storage.neo4j.edges
  - storage.neo4j.graph_objects
  - pipeline.rag

provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true
---

# ADR-0014: Neo4j-native feature adoption and intentional lock-in

## Status

accepted — 2026-05-11

## Context

ideation Round 16에서 ADR-0015(canonical export contract + adapter pattern +
portable Cypher subset + monthly migration smoke test)를 도입했다. 이 결정의
목적은 future migration 비용 최소화였다. 그러나 Round 18에서 Q18=Neo4j 단일
채택이 사용자 결정으로 lock되면서, vendor-neutral 제약은 productivity penalty만
남기고 가치가 거의 0이 됐다. Round 19에서 사용자 결정으로 ADR-0015 폐기 + Neo4j-
native 기능 최대 활용으로 전환했다.

또한 Round 14/Q9-2가 권고했던 "Louvain/Leiden 같은 community detection은
Python(networkx/igraph) 의존성으로 처리"도 GDS native procedure로 대체 가능해
폐기됐다.

## Decision

Neo4j Community Edition의 native 기능을 v0부터 적극 활용한다.

**활용 기능**:

| 기능 | 목적 | 도입 시점 |
|---|---|---|
| APOC standard procedures | FTS procedures, JSON/CSV import/export, periodic iterate, path expander, date/time/text helpers | v0 |
| GDS (Graph Data Science) — Community Edition 알고리즘 | Louvain/Leiden, PageRank/Betweenness/Closeness, Node2Vec/FastRP, K-NN similarity | v1 분석 슬라이스 진입 시 |
| Native vector index (HNSW) | v1 embedding (derived object 한정 — claim/scenario/thesis/dossier) | v1 |
| Native FTS (Lucene) | graph object 검색 (Cypher 안에서 hybrid query 가능) | v0 |
| Bloom / Browser visualization | 디버깅·탐색·운영자 검토 | v0 (Community Edition 무료) |
| Cypher 5.x 고급 | EXISTS / COLLECT / CALL {} subqueries, PERIODIC COMMIT, SHOW INDEXES | v0 |
| CDC (5.13+) | 외부 sync 필요 시 (현재 미사용 — SQLite ↔ Neo4j sync는 batch 권장) | v2+ 검토 |
| Constraints / Indexes | UNIQUE constraint(claim_id/source_id/edge_id), COMPOSITE index | v0 |

**의도적 lock-in 수용**:
- 백업: `neo4j-admin database dump` 표준 (일간, retention 30d)
- 비상 마이그레이션: JSONL audit export로 schema 재구축 + APOC `export.cypher`
  으로 Cypher statement export
- 마이그레이션 cost(며칠~몇 주)는 사후 부담으로 수용. 이 비용을 미리 갚느라
  productivity 떨어뜨리지 않음.

**폐기된 vendor-neutral 제약** (R19 결정):
- ~~portable Cypher subset 원칙~~: Neo4j 5.x 모든 기능 + APOC + GDS 허용
- ~~Adapter pattern (`src/graph/adapters/{neo4j,memgraph,arcadedb,age}.ts`)~~:
  단일 Neo4j 구현
- ~~Monthly migration smoke test~~: migration target 없음
- ~~nodes/edges JSONL canonical export contract~~ 일부 유지: 목적 재정의 —
  "human-readable audit trail" (월별 또는 발행 시점 export), vendor-neutral
  migration이 아님

**폐기된 Python 의존성 권고** (R19 결정):
- ~~v1에서 Python(networkx/igraph) 의존성 추가로 community detection~~ → GDS
  native (Louvain/Leiden)로 대체

## Alternatives Considered

- **A** (chosen): Neo4j-native 기능 최대 활용 + 의도적 lock-in 수용
  - pros: productivity ↑, GDS native로 분석 비용 ↓, future migration cost는
    사후 수용
  - cons: Neo4j EOL/라이선스 변경 시 며칠~몇 주의 마이그레이션 cost (수용)
- **B** (discarded — ADR-0015 / R19에서 폐기): portable Cypher subset + adapter
  pattern + monthly smoke test
  - pros: 마이그레이션 cost 최소화
  - cons: Neo4j 단일 채택 후 productivity penalty만 남음
- **C** (discarded — R14/Q9-2 / R19에서 폐기): Python(networkx/igraph) 의존성
  으로 community detection
  - cons: 외부 의존성 추가, export-analyze-import 왕복 비용
- **D** (discarded — R18 후): SQLite truth + Neo4j read-only projection (R14/
  R15 절충안)
  - cons: dual sync 부담; Neo4j canonical store 결정 후 dual store는 가치 없음

## Consequences

- 긍정:
  - claim-graph RAG(R13) v0 graph object FTS를 Neo4j FTS로 처리 (검색 < 1초
    p95 NFR-001 검증 대상이 SQLite FTS5 → Neo4j FTS로 이동, SPIKE-001 갱신)
  - v1 embedding을 Neo4j 안에서 hybrid query (graph + vector) 가능
  - v2 community detection / centrality를 GDS native로 — 외부 도구 0
  - 운영 단순성 — 단일 graph engine 운영

- 부정 / trade-off:
  - intentional vendor lock-in — Neo4j 미래 라이선스 변경 시 비상 마이그레이션
    필요
  - GPL v3 boundary(Q-020) 1인 internal use에서는 contagion 없으나, 향후 DB를
    제품에 embed하거나 procedure를 공개 fork하는 경우 재검토 필요
  - APOC / GDS plugin 설치는 Docker image 또는 binary 단계에서 수행

- 후속 작업:
  - INFRA-1A.2 slice: Neo4j 부트스트랩 (Docker image + APOC + GDS) + Cypher
    schema/constraint v1 + SQLite relational schema v1
  - SPIKE-001 갱신: Neo4j + native FTS / 1만 graph object 검색 < 1초 p95
    (NFR-001) 검증 — SQLite + FTS5에서 Neo4j로 spike 대상 갱신
  - INFRA-1A.5 (신설): backup runbook — `neo4j-admin database dump` 일간 +
    JSONL audit export 월별 + SQLite snapshot 일간 (`docs/05_RUNBOOK.md` 갱신)
  - Q-020 결정: GPL v3 boundary 명문화

## References

- ideation 출처: Round 14/Q9-2 (Louvain/Leiden Python 권고 → 본 ADR로 폐기),
  Round 16/Q11-2 (ADR-0015 vendor-neutral 안), Round 18 (Q18=Neo4j 확정),
  Round 19 (vendor-neutral 폐기 + Neo4j-native 활용 결정)
- 관련 ADR: ADR-0012, ADR-0013, ADR-0020 (metrics), ADR-0021 (policy learning)
- 폐기/미도입: ADR-0015 candidate (canonical export contract + adapter — 본
  ADR로 대체)
