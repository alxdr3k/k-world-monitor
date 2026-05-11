---
id: adr-0013
type: adr
title: Edge ledger via Neo4j — supports / contradicts / qualifies / updates / supersedes (supersedes ADR-0007)
status: accepted
created_at: 2026-05-11
updated_at: 2026-05-11
deciders: [user, claude-opus-4-7, gpt]
supersedes: [adr-0007]
superseded_by: []

scope:
  in:
    - storage.neo4j.edges
    - pipeline.scenario_layer.edge_query
    - pipeline.cite_check_layer.cascade
    - pipeline.dossier_layer.counterclaim_query
  out:
    - storage.markdown.frontmatter.relations  # markdown frontmatter 배열은 INV-0013-2로 금지
    - pipeline.extraction_layer.routing       # routing은 ADR-0006
    - storage.neo4j.native_features           # APOC/GDS는 ADR-0014

invariants:
  - id: INV-0013-1
    statement: edge 관계는 Neo4j 관계(typed relationship)로만 표현한다. relation_type ∈ {SUPPORTS, CONTRADICTS, QUALIFIES, UPDATES, SUPERSEDES}; relation property로 (scope, rationale, provenance, run_id, created_at)를 보존한다
    status: active
  - id: INV-0013-2
    statement: claim / scenario / publication frontmatter에 supports[] / contradicts[] / qualifies[] 등 관계 배열을 두는 것은 금지한다 (query / dedupe / provenance 추적 불가; ADR-0007 INV-0007-2 보존)
    status: active
  - id: INV-0013-3
    statement: scenario 진화는 SUPERSEDES 또는 UPDATES edge로 추적한다 (ADR-0009 scenario_revisions ledger와 결합)
    status: active
  - id: INV-0013-4
    statement: v0 relation type은 5종만 허용한다 — SUPPORTS / CONTRADICTS / QUALIFIES / UPDATES / SUPERSEDES. v1+에서 WEAKENS / STRENGTHENS / MITIGATES / AMPLIFIES (counterclaim multi-relation, R25/Q30) 추가 검토. 인과 추론 edge(CAUSES / INCREASES_RISK_OF)는 LLM hallucinate 위험으로 v2+에서도 신중 검토
    status: active
  - id: INV-0013-5
    statement: dedupe 정책 — (from_id, to_id, relation_type, scope)는 unique. Neo4j UNIQUE constraint로 강제
    status: active
  - id: INV-0013-6
    statement: SQLite에 edges 테이블을 두지 않는다 (ADR-0007 INV-0007-1 supersede). Neo4j가 canonical store. SQLite relational metadata(policy_decisions/policy_learning_events/run_ledger 등)에 edge_id를 참조 외래키로 보존하는 것은 허용

preconditions:
  - id: PRE-0013-1
    statement: Neo4j Community Edition canonical store가 도입돼 있다 (ADR-0012)
  - id: PRE-0013-2
    statement: Cypher 5.x 사용 가능 (UNIQUE constraint, CALL subqueries)

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
  - thesis
reviewed_scopes:
  - storage.neo4j.edges
  - pipeline.scenario_layer.edge_query
  - pipeline.cite_check_layer.cascade
  - pipeline.dossier_layer.counterclaim_query
  - storage.markdown.frontmatter.relations
  - pipeline.extraction_layer.routing
  - storage.neo4j.native_features

provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true
---

# ADR-0013: Edge ledger via Neo4j

## Status

accepted — 2026-05-11. Supersedes ADR-0007.

## Context

ADR-0007(Round 3 lock)은 edge ledger를 SQLite `edges` 테이블로 정의하고, "그래프
DB 별도 도입(e.g., Neo4j)"을 Alternative D로 명시 거부했다("외부 의존성 최소화
위반"). 그러나 ideation은 Round 14~18에서 graph DB 도입을 재평가했다:

- Round 14/Q9-1: graph-shaped schema는 v0부터 강제, graph DB 도입은 deferred
- Round 15/Q10-1: 조건부 v0 도입 가능 (SQLite truth + embedded + ledger 설계)
- Round 16/Q11-1: self-host + EOL critical 조건 추가 — Neo4j Community vs
  Apache AGE 동등 후보
- Round 17/Q12-3: 1인 scale에서 성능 차이 무의미; AI/LLM Cypher 코드 품질에서
  Neo4j 우위
- Round 18: 사용자 결정 — **Neo4j Community Edition 채택** (Q18 finalize)

같은 시점에 edge ledger의 실제 사용 패턴이 SQLite recursive CTE의 자연스러운
범위를 넘어가는 것이 명확해졌다:
- claim-graph RAG(R13)의 evidence pack 생성
- scenario cascade(claim retracted → Publication corrected)
- dossier counterclaim pool query
- scenario revision lineage(supersedes chain)
- (v1+) community detection / centrality(R19 GDS)

## Decision

edge ledger의 canonical store를 SQLite `edges` 테이블에서 Neo4j typed
relationships로 이동한다.

Neo4j 관계 스키마:

```cypher
(:Claim|:Scenario|:Thesis|:Publication|:Dossier|:ScenarioRevision)
  -[:SUPPORTS|:CONTRADICTS|:QUALIFIES|:UPDATES|:SUPERSEDES {
     edge_id: string,         // `edge_<ULID>`
     scope: string,           // 관계가 성립하는 컨텍스트
     rationale: string,       // ≤ 500자
     provenance: enum,        // {user_confirmed, llm_inferred, derived}
     run_id: string,          // 추출/추론 run ledger 참조
     created_at: datetime     // ISO8601
   }]->(:Claim|:Scenario|:Thesis|:Publication|:Dossier|:ScenarioRevision)
```

Cypher constraint:
```cypher
CREATE CONSTRAINT edge_unique IF NOT EXISTS
FOR ()-[r:SUPPORTS|CONTRADICTS|QUALIFIES|UPDATES|SUPERSEDES]-()
REQUIRE (r.from_id, r.to_id, type(r), r.scope) IS UNIQUE;
```

v0 relation type 5종 lock (ADR-0007 결정 보존):
- SUPPORTS — A는 B를 뒷받침한다
- CONTRADICTS — A는 B에 반박한다 (counterclaim의 핵심 trigger)
- QUALIFIES — A는 B의 조건/범위를 한정한다
- UPDATES — A는 B의 최신 갱신이다
- SUPERSEDES — A는 B를 대체한다 (scenario revision lineage)

v1+ 추가 후보 (R25/Q30): WEAKENS / STRENGTHENS / MITIGATES / AMPLIFIES
(bidirectional framing 검증용). 인과 추론 edge(CAUSES / INCREASES_RISK_OF /
DECREASES_RISK_OF)는 LLM hallucinate 위험으로 v2+에서도 신중 도입.

frontmatter `supports[] / contradicts[] / qualifies[]` 배열은 영구 금지
(INV-0013-2, ADR-0007 INV-0007-2 보존).

## Alternatives Considered

- **A** (chosen): Neo4j typed relationships as canonical edge ledger
  - pros: graph traversal/centrality/community detection native, Cypher
    pattern matching이 cascade query에 자연스러움, GDS(ADR-0014)로 v1+ analytics
  - cons: ADR-0007이 명시 거부한 의존성 — supersede 필수, R18 사용자 결정으로
    정당화
- **B** (discarded — ADR-0007): SQLite `edges` 테이블 with recursive CTE
  - pros: 단일 SQLite, 외부 의존성 0
  - cons: 깊은 traversal 부담, community detection을 SQLite로 구현 비현실적
    (R14/Q9-2)
- **C** (discarded — Round 19에서 폐기): SQLite truth + Neo4j read-only
  projection (R14/R15 절충)
  - pros: SQLite를 truth로 유지, graph DB는 derivative
  - cons: dual sync 부담; Neo4j를 canonical로 채택한 R18 결정 이후 dual store는
    productivity penalty만 남음 — ADR-0015 폐기와 같은 논리
- **D** (discarded — Round 1): frontmatter `supports[] / contradicts[]` 배열
  - cons: query 불가, dedupe 불가, provenance 손실 (ADR-0007 본문 보존)

## Consequences

- 긍정:
  - cite cascade(claim retracted → Publication corrected)를 단순 Cypher pattern
    match로 표현
  - scenario revision lineage(`SUPERSEDES` chain)이 path query로 자연스러움
  - dossier counterclaim pool은 `MATCH (c:Claim)-[:CONTRADICTS]->(target)`로
    O(degree) query
  - GDS Louvain/Leiden community detection 가능 (ADR-0014)

- 부정 / trade-off:
  - Neo4j single-writer (Community Edition 단일 DB 인스턴스) — 1인 운영
    환경에서 수용
  - edge dedup 정규화(scope 정규화) 정책 유지 — Neo4j constraint로 강제 가능
  - ADR-0007의 Alternative D "그래프 DB는 외부 의존성 최소화 위반" 입장은
    사용자 결정(R18)으로 의도적 lock-in 수용

- 후속 작업:
  - INFRA-1A.4 slice: Neo4j edge constraint + frontmatter 관계 배열 lint (배열
    발견 시 CI fail)
  - INFRA-1B 단계: cite cascade Cypher pattern + scenario revision lineage path
    query
  - ADR-0014: Neo4j-native 기능 활용(APOC/GDS)으로 v1+ analytics 진입
  - ADR-0019: bidirectional framing — v1+에서 WEAKENS/STRENGTHENS/MITIGATES/
    AMPLIFIES 추가 도입 시점

## References

- ideation 출처: Round 14/Q9-1 (graph DB 도입 트리거), Round 15~17 (DB 후보
  평가), Round 18 (Q18=Neo4j), Round 19 (vendor-neutral 폐기), Round 25 (v0
  5-edge / v1 4 추가 / v2+ 검토 — counterclaim multi-relation Q30)
- Supersedes: ADR-0007
- 관련 ADR: ADR-0011, ADR-0012, ADR-0014, ADR-0019
