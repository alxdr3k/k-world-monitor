# Data Model

> Last verified against code: a581e72 (2026-05-12) — INFRA-1A.2 schema commit

## Source of truth

`migrations/neo4j/v1_schema.cypher` 와 `migrations/sqlite/v1_schema.sql` 이
canonical 스키마다. 이 문서는 얇은 navigation layer다.

ADR-0011(superseded by ADR-0025), ADR-0012, ADR-0013, ADR-0017, ADR-0018,
ADR-0020, ADR-0021, ADR-0023, ADR-0024, ADR-0025 가 의도된 모델의 canonical 설계다.

## Graph objects — Neo4j (`migrations/neo4j/v1_schema.cypher`)

10-stage 객체 모델 (ADR-0025, supersedes ADR-0011 9-stage):

| Node label | ID prefix | Purpose |
|---|---|---|
| `Source` | `src_` | publisher/registry entity, Tier 0 컨테이너 (ADR-0011 INV-0011-2) |
| `Document` | `doc_` | URL 그룹 + publisher FK + reliability_tier |
| `Snapshot` | `snap_` | fingerprint record: url/accessed_at/content_hash/locator (ADR-0012) |
| `Claim` | `clm_` | atomic 사실 + 8-state lifecycle (ADR-0011 INV-0011-5) |
| `Dossier` | `dos_` | 주제별 promoted claim 합성 |
| `Scenario` | `scn_` | drivers/assumptions/branches/falsifiers/counterclaims |
| `ScenarioRevision` | `scn_<id>_r<n>` | append-only revision ledger (ADR-0009) |
| `EditorialIntent` | `eit_` | 운영자 명시 lock 필수 (ADR-0025 INV-0025-4) |
| `Thesis` | `ths_` | 재사용 가능한 핵심 주장 (ADR-0025) |
| `ContentDraft` | `drf_` | v0=blog_long only (DEC-005), eit_id FK 필수 |
| `Publication` | `pub_` | cite_check 5+1 gate 통과 후 승격, NFR-003 trace anchor |
| `AccessIntervention` | `aci_` | source policy 위반 intercept 기록 (ADR-0017) |
| `ManualClaimEntry` | `mcl_` | 운영자 수동 claim 입력, raw_text_stored=false 강제 (ADR-0018) |

### Edge relations (ADR-0013, ADR-0025)

| Relation | v0 | Purpose |
|---|---|---|
| `SUPPORTS` | ✓ | A가 B를 뒷받침 |
| `CONTRADICTS` | ✓ | counterclaim trigger |
| `QUALIFIES` | ✓ | A가 B의 조건/범위 한정 |
| `UPDATES` | ✓ | 최신 갱신 |
| `SUPERSEDES` | ✓ | scenario revision lineage |
| `HAS_INTENT` | ✓ | Thesis → EditorialIntent (ADR-0025) |
| `USES_INTENT` | ✓ | ContentDraft → EditorialIntent (ADR-0025) |
| `RESOLVES` | ✓ | ManualClaimEntry → AccessIntervention (ADR-0018) |
| `DERIVED_FROM_MANUAL_REVIEW_OF` | ✓ | ManualClaimEntry → Source (ADR-0018) |

FTS indexes (Lucene): claim_fts, source_fts, document_fts, scenario_fts, thesis_fts

## Relational tables — SQLite (`migrations/sqlite/v1_schema.sql`)

| Table | ADR | Purpose |
|---|---|---|
| `run_ledger` | ADR-0023 INV-0023-7 | 모든 LLM call + cost + vendor + tier + batch_id |
| `cross_vendor_review_ledger` | ADR-0023 INV-0023-4 | 3종 mandatory cross-vendor review |
| `source_material_policy` | ADR-0017 | source별 archive/raw_cloud/external_llm policy |
| `policy_decisions` | ADR-0017 | 운영자 policy gate 결정 기록 |
| `policy_learning_events` | ADR-0021 | pattern 1–5 학습 이벤트 |
| `source_policy_rules` | ADR-0021 | propose/confirm 규칙 (auto-tighten only) |
| `dataset_vintage` | ADR-0024 PRE-0024-2 | dataset fetch 시점 vintage + checksum |
| `derived_metric_ledger` | ADR-0024 PRE-0024-3 | reproducibility 3-tuple (vintage+spec+lib sha256) |
| `metrics_run` | ADR-0020 | per-run metric 집계 |
| `metrics_daily` | ADR-0020 | 일별 집계 |
| `metric_alerts` | ADR-0020 | threshold 초과 알림 |
| `evaluation_runs` | ADR-0020 | gold query set 기반 평가 실행 |
| `evaluation_cases` | ADR-0020 | 개별 평가 케이스 |
| `retrieval_pack_metrics` | ADR-0020 | recall@k / diversity / bidirectional_balance |
| `research_session` | ADR-0021 | interactive session scoping |
| `raw_cache_items` | ADR-0021 | ephemeral URL 참조 (raw text 미저장, DEC-007 lifecycle) |
| `schema_migrations` | — | applied migration version tracking |

## Lifecycle states

| Entity | States | Notes |
|---|---|---|
| Claim | draft → confirmed → disputed → stale → retracted → source_changed → source_unavailable → needs_recorroboration | ADR-0011 INV-0011-5 (8-state) |
| ContentDraft | draft → reviewing → ready → published → dropped | ADR-0025 |
| Publication | live → corrected → retracted | ADR-0011 INV-0011-7 + ADR-0015 cite check gate |
| AccessIntervention | pending_user_review → resolved → ignored | ADR-0017 |
| PolicyRule | proposed (active=0) → confirmed (active=1) → demoted | ADR-0021 auto-tighten only |

## ID prefix table (AC-005)

See `src/domain/ids.ts` for the full `ID_PREFIXES` map and `validateIdPrefix()`.
All prefixes enforced at Neo4j (UNIQUE constraint) and in TEST-005 (`tests/lint/id_prefix_test.ts`).

## Pending

- `docs/_generated/schema.md` — 마이그레이션 파일에서 자동 생성 (INFRA-1A.2 이후 단계)
- SPIKE-001 결과 입력 후 Neo4j FTS 인덱스 tuning (AC-002 검증)
