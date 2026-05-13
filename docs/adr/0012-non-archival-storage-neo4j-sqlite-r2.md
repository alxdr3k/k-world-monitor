---
id: adr-0012
type: adr
title: Non-archival storage — Neo4j (graph) / SQLite (relational) / R2 (permitted artifacts only); raw cloud upload prohibited (supersedes ADR-0004)
status: accepted
created_at: 2026-05-11
updated_at: 2026-05-11
deciders: [user, claude-opus-4-7, gpt]
supersedes: [adr-0004]
superseded_by: []

scope:
  in:
    - storage.neo4j.graph_objects
    - storage.neo4j.fts
    - storage.sqlite.relational_metadata
    - storage.sqlite.fts5_metadata
    - storage.r2.permitted_artifacts
    - storage.r2.audit_export
    - storage.markdown.curated_view
    - storage.policy.raw_cloud_prohibition
    - storage.policy.snapshot_fingerprint
  out:
    - storage.neo4j.edges                      # edge ledger 자체는 ADR-0013
    - storage.neo4j.native_features            # APOC/GDS/native vector/native FTS는 ADR-0014
    - pipeline.extraction_layer                # extraction routing은 ADR-0006

invariants:
  - id: INV-0012-1
    statement: graph objects (Source, Document, Snapshot, Claim, Dossier, Scenario, Thesis, ContentDraft, Publication, Edge, ScenarioRevision, ManualClaimEntry, AccessIntervention)는 Neo4j Community Edition을 canonical store로 사용한다
    status: active
  - id: INV-0012-2
    statement: relational metadata (source_policy, policy_decisions, policy_learning_events, source_policy_rules, dataset_vintage, metrics_run/daily/alerts, evaluation_runs/cases, retrieval_pack_metrics, run_ledger, research_session, raw_cache_items)는 SQLite + FTS5를 canonical store로 사용한다
    status: active
  - id: INV-0012-3
    statement: Snapshot은 fingerprint record(URL, accessed_at, content_hash, locator)다. R2 binary 보관은 예외로만 허용한다 — open-license dataset, 공식 허용 API 응답, 자체 산출물(차트/export)만. 일반 article/report raw text의 R2 업로드는 영구 금지 (R8/Q3, R14/Q9-4)
    status: active
    enforcement:
      # INFRA-1B.3 snapshot-fingerprint 구현에서 cross-source dedup이 INV-0012-3을
      # 우회할 수 있는 두 TOCTOU window가 식별되어 다음 방어책을 적용한다 (PR #25).
      - layer: pre-r2Put policy gate
        check: createSnapshotFingerprint는 input.archivePolicy === full_snapshot_allowed && input.rawCloudPolicy === allowed_public_data_only를 만족할 때만 r2Put을 호출한다
      - layer: dedup back-fill cross-source guard
        check: allLinkedSourcesAllowRawCloud(snap_id) — Snapshot에 이미 linked된 모든 Source의 raw_cloud_policy가 allowed_public_data_only인 경우에만 r2Put + SET r2_key를 진행한다. 이 함수는 미등록 source / always_prohibited source를 모두 거부한다
      - layer: post-r2Put TOCTOU recheck
        check: r2Put 완료 후 SET r2_key 직전에 allLinkedSourcesAllowRawCloud를 다시 호출한다. 한 번이라도 prohibited source가 도착해 있으면 SET을 skip — r2_key=null로 남기고 r2 object는 orphan으로 둔다 (다음 retry에서 dedup-match → idempotent overwrite로 복구; r2Delete는 race window가 더 크기 때문에 미사용)
      - layer: recheck-failure fail-safe
        check: 위 recheck 호출 자체가 throw하면(transient Neo4j blip 등) 결과를 stillAllowed=false로 처리한다. 즉 검증 실패 시 보수적으로 SET을 skip하여 prohibited source가 절대 r2 reference를 관측하지 못하게 한다
      - layer: orphan recovery contract
        check: 위 fail-safe 또는 SET 실패로 r2_key=null이 남은 Snapshot은 다음 createSnapshotFingerprint 호출(같은 content_hash)에서 dedup-match → r2Put이 idempotent overwrite로 객체를 재생성하고 SET r2_key를 재시도한다. 이 retry 경로는 tests/unit/snapshot_fingerprint_test.ts "r2 orphan back-fill" describe 블록에서 검증된다
  - id: INV-0012-4
    statement: R2는 "permitted artifact store"다 (raw archive가 아님). raw_cloud_policy는 always_prohibited (default)이며 allowed_public_data_only는 source_material_policy 명시 후에만 적용 가능
    status: active
  - id: INV-0012-5
    statement: Markdown vault에는 Document hub, Dossier, Scenario, Thesis, ContentDraft, Publication, scenario에 인용된 promoted claim만 둔다. candidate claim 자동 markdown 생성은 금지 (ADR-0004 INV-0004-3 보존)
    status: active
  - id: INV-0012-6
    statement: JSONL은 (a) import/export 포맷, (b) human-readable audit export(월별 또는 발행 시점) 용도만 사용한다. canonical 저장소 아님
    status: active
  - id: INV-0012-7
    statement: 외부 LLM에 raw third-party text를 보낼 때는 source_policy.external_llm_policy ≠ prohibited를 명시적으로 만족해야 한다. policy_gate(ADR-0017)가 이 검사를 inline_block한다

preconditions:
  - id: PRE-0012-1
    statement: 운영자가 self-host Neo4j Community Edition(Docker 또는 binary) 운영 가능 (GPL v3 single-user, license 모니터링 의무)
  - id: PRE-0012-2
    statement: 운영자가 Cloudflare R2 운영 가능 (PRD ASM-001 보존)
  - id: PRE-0012-3
    statement: SQLite + FTS5 binary가 로컬 / CI runtime에 설치돼 있다

defines:
  - term: raw_cloud_policy
    role: primary
  - term: snapshot
    role: secondary    # ADR-0011/ADR-0003에서 primary로 정의, 본 ADR은 fingerprint 의미 변경 명시

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
  - thesis
  - dossier
  - scenario
  - content_draft
  - publication
  - raw_cloud_policy
reviewed_scopes:
  - storage.neo4j.graph_objects
  - storage.neo4j.fts
  - storage.sqlite.relational_metadata
  - storage.sqlite.fts5_metadata
  - storage.r2.permitted_artifacts
  - storage.r2.audit_export
  - storage.markdown.curated_view
  - storage.policy.raw_cloud_prohibition
  - storage.policy.snapshot_fingerprint
  - storage.neo4j.edges
  - storage.neo4j.native_features
  - pipeline.extraction_layer

provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true
---

# ADR-0012: Non-archival storage — Neo4j / SQLite / R2 with raw cloud prohibition

## Status

accepted — 2026-05-11. Supersedes ADR-0004.

## Context

ADR-0004(Round 3 lock)는 SQLite + FTS5를 canonical bulk store로, R2를
"Snapshot 원본 bytes(HTML / PDF) + 추출 텍스트 캐시의 canonical 저장소"로
정의했다. ideation은 이 결정을 두 번 supersede했다:

1. **Round 8/Q3 — Snapshot 의미 변경**: "원문 archive"는 시스템 정체성이
   아님("출처 추적 콘텐츠 생산 시스템"). Snapshot은 fingerprint record(URL +
   accessed_at + content_hash + locator)이며 R2 binary 보관은 예외(open
   license / 공식 허용 API 응답 / 자체 산출물)로만 허용한다.
2. **Round 14/Q9-4 — 클라우드 raw upload 절대 금지**: `raw_cloud_policy:
   always_prohibited`가 default. 일반 article / report raw text의 R2 업로드는
   영구 금지.
3. **Round 18 — Q18 Neo4j 채택**: graph objects(Claim, Edge, Scenario, Thesis,
   Dossier, Publication)의 canonical store를 SQLite에서 Neo4j Community Edition
   으로 이동. SQLite는 relational metadata(policy, metrics, ledger) 전담.

ADR-0007 Alternative D는 "그래프 DB 별도 도입(e.g., Neo4j) — discarded ...
외부 의존성 최소화 위반"이라고 명시했지만, R15~R17의 추가 조건(self-host only,
EOL critical, AI 코드 품질, GraphRAG 정렬, license 단순성)을 반영해 R18에서
Neo4j 채택이 사용자 결정으로 lock됨. R19에서 vendor-neutral 원칙 폐기 + Neo4j-
native 기능 최대 활용(ADR-0014)로 이어짐.

## Decision

세 canonical store + 두 view + 한 export 포맷으로 분담한다.

| Store | 책임 | 형식 |
|---|---|---|
| Neo4j Community Edition | graph objects: Source, Document, Snapshot, Claim, Dossier, Scenario, Thesis, ContentDraft, Publication, Edge, ScenarioRevision, ManualClaimEntry, AccessIntervention. native FTS for graph object 검색, native vector index(5.11+, v1)로 embedding | Cypher + property graph (self-host Docker / binary) |
| SQLite + FTS5 | relational metadata: source_policy, policy_decisions, policy_learning_events, source_policy_rules, dataset_vintage, metrics_run/daily/alerts, evaluation_runs/cases, retrieval_pack_metrics, run_ledger, research_session, raw_cache_items | `*.db` (research.db) |
| R2 | **permitted artifact store**: open-license dataset, 공식 허용 API 응답, 자체 산출물(차트/export), 월별 JSONL audit export | object storage with `r2_key` |
| Markdown vault | Document hub, Dossier, Scenario, Thesis, ContentDraft, Publication, scenario에 인용된 promoted Claim만 (curated view) | `.md` with frontmatter |
| JSONL | import / export only + human-readable audit trail (ADR-0014 native dump와 병행) | not canonical |

**raw_cloud_policy**:
- `always_prohibited` (default) — 일반 article / report raw text 등 모든
  third-party raw material에 적용. R2 / 외부 LLM / public bucket 어느 클라우드
  destination에도 업로드 금지.
- `allowed_public_data_only` — 예외. source_material_policy(ADR-0017)에 명시된
  open-license dataset / 공식 API 응답 / 자체 산출물만 R2 업로드 허용.

Snapshot 의미 (ADR-0004 INV-0004-2 supersede):
- ~~"R2 원본 bytes의 canonical 저장소"~~ → **fingerprint record**: `url`,
  `accessed_at`, `content_hash` (sha256), `locator` (페이지/섹션/라인), `mime`,
  `byte_size`
- R2 `r2_key`는 INV-0012-3 예외에 한해 보존. 일반 snapshot은 r2_key=NULL.

graph object FTS는 Neo4j native FTS(Lucene). SQLite FTS5는 relational metadata
검색만(policy/metrics/audit log). R13 RAG 단계화의 v0 "SQLite+FTS5 only"는 본
ADR과 ADR-0014로 분담 재정의.

## Alternatives Considered

- **A** (chosen): Neo4j (graph) + SQLite (relational) + R2 (permitted artifacts)
  + Markdown (curated) + JSONL (audit)
  - pros: graph traversal/centrality/community detection이 native, source 추적
    콘텐츠 생산 정체성과 일치 (raw archive 아님), 저작권/약관 리스크 최소화,
    EOL/AI 코드 품질에서 Neo4j 우위
  - cons: 두 canonical store 동기화 책임 (SQLite-Neo4j는 별 객체 종류로 분담돼
    충돌 가능성 낮음), self-host Neo4j 운영 부담
- **B** (discarded — Round 3 lock, ADR-0004): Markdown + SQLite+FTS5 + R2(raw
  archive)
  - pros: 단일 graph store 운영, 도구 단순
  - cons: graph traversal/community detection을 SQLite recursive CTE로 구현은
    >10만 edge에서 부담, R2 raw archive는 저작권/약관 위험 (Round 14/Q9-4 폐기)
- **C** (discarded — Round 16): Apache AGE + Postgres + pgvector
  - pros: Apache 2.0 permissive, relational+graph+vector 통합
  - cons: Postgres 추가 운영, AI/LLM Cypher 코드 품질이 Neo4j 대비 낮음, R18
    사용자 결정 Neo4j
- **D** (discarded — Round 15): Kuzu (embedded MIT)
  - cons: Apple 인수 + repository archive 우려(Q16). v0 결정 영향 없음 (R18
    Neo4j 확정 후 archived 후보).

## Consequences

- 긍정:
  - graph query(claim-graph RAG, scenario cascade, edge traversal)가 native
  - raw archive 위험 0 — 저작권/약관/평판 안전
  - SQLite는 단순 relational metadata 전담 — backup 단일 파일, 책임 명확
  - R2 비용 ↓ (permitted artifact만)

- 부정 / trade-off:
  - Neo4j Community GPL v3 — 1인 internal use에서는 contagion 없으나 boundary
    문서화 필요 (Q-020)
  - graph-relational sync: SQLite → Neo4j(예: source_policy.risk_level을
    Source 노드에 projection)는 CDC 또는 batch sync (Q-012)
  - Snapshot이 "fingerprint only"이므로 원문 변경 후 재검증 시 새 fetch 필요
    (content_hash 비교는 가능하나 원본 텍스트는 미보관)
  - self-host Neo4j 운영 (Docker / 백업 / 모니터링)

- 후속 작업:
  - ADR-0013: edge ledger via Neo4j (ADR-0007 supersede)
  - ADR-0014: Neo4j-native feature adoption + intentional lock-in
  - ADR-0016: collection realism (Tier A-D + collectability_score)
  - ADR-0017: source policy gate + manual_claim_entry fallback
  - INFRA-1A.2 slice: Neo4j 부트스트랩 + SQLite relational schema v1 + Cypher
    constraint/index 정의
  - INFRA-1A.3 slice: R2 bucket + permitted_artifact prefix + r2_key=NULL 정책
    + sha256 round-trip 테스트
  - SPIKE-001: Neo4j Community + native FTS + 1만 graph object 검색 < 1초 p95
    (NFR-001) 검증 (SQLite + FTS5에서 Neo4j로 spike 대상 갱신)

## References

- ideation 출처: `docs/discovery/research-content-pipeline-ideation.md`
  Round 8/Q3 (Snapshot=fingerprint), Round 14/Q9-4 (raw cloud upload 금지),
  Round 15~17 (graph DB 후보 평가), Round 18 (Q18 Neo4j 확정), Round 19
  (vendor-neutral 폐기), Round 25 (final canonical direction)
- Supersedes: ADR-0004
- 관련 ADR: ADR-0011, ADR-0013, ADR-0014, ADR-0015, ADR-0016, ADR-0017
