# Data Model

> Last verified against code: 0a76d31 (code baseline, 2026-05-13 — last code-touching commit on branch: `src/discovery/worker/run-discovery.ts`, `src/storage/r2/client.ts`, `.github/workflows/{ci,doc-freshness,invariant-check}.yml`). Thin-doc edits since: 5aa70ac → ceaa17c → 38b846d → c7b9088 (PR #37 squash-merged to main as 18abf8f) → fa90659 (PR #38 round 0) → 2c629dc (PR #38 Codex round 1 fix) → c61a752 (PR #38 Codex round 2 fix) → 0d92b3c (PR #38 Codex round 3 P2 fix) → this commit (2026-05-14, PR #38 Codex round 4 P2 fix: HLD diagram 의 Neo4j Source 박스에서 `access_method` 제거 — v0 landed schema 미반영. DATA_MODEL.md composition row 의 \"sources_seed.yaml multi-URL / collectability 4-tuple 이 INFRA-1B.1 시 단일 필드로 평탄화 후 SQLite policy 표만 저장됨\" 표현은 부정확 — 실제 seedSources() 는 (a) slug→source_id 매핑 + (b) policy enum 3개 만 SQLite 로 옮기고, multi-URL / collectability / access_method / meta_category / subtopic_tags / notes 는 어디에도 persist 되지 않고 drop 된다고 정정). **코드 baseline (0a76d31) 이후 본 branch 의 모든 commit 은 docs-only** (verified via `git log --name-only 0a76d31..HEAD -- 'src/**' 'migrations/**' 'scripts/**' 'tests/**' '.github/**' 'package.json' 'tsconfig.json'` 빈 결과). 다음 코드 변경 시점에 baseline SHA 갱신.

## Source of truth

`migrations/neo4j/v1_schema.cypher` (graph) + `migrations/sqlite/v{1..6}_*.sql`
(relational) 가 canonical 스키마다. 이 문서는 얇은 navigation layer다.

마이그레이션 순서 (모두 idempotent, `bun run migrate:sqlite` / `:neo4j`):

| Version | File | Purpose |
|---|---|---|
| v1 | `migrations/sqlite/v1_schema.sql` | 17 tables core schema (INFRA-1A.2) |
| v2 | `migrations/sqlite/v2_enum_constraints.sql` | enum-validating triggers (run_ledger, cross_vendor_review_ledger, INFRA-1A.5) |
| v3 | `migrations/sqlite/v3_source_registry_slug_map.sql` | slug→source_id 안정 매핑 (INFRA-1B.1, DEC-015) |
| v4 | `migrations/sqlite/v4_run_ledger_completed_at_idx.sql` | run_ledger(completed_at, vendor) composite index (OPS-1A.1) |
| v5 | `migrations/sqlite/v5_crawl_state.sql` | crawl_state — etag/Last-Modified + backoff (INFRA-1B.2b, ADR-0030 INV-0030-5) |
| v6 | `migrations/sqlite/v6_discovery_queue.sql` | discovery_queue — 발견 URL pending fingerprint (INFRA-1B.2) |

Neo4j 단일 마이그레이션 v1 은 INFRA-1A.2 + INFRA-1A.7 갱신 포함 (13 node UNIQUE
+ 5 edge UNIQUE + 5 FTS + Scenario property schema + Thesis stance + Source
perspective).

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
| `source_registry_slug_map` | DEC-015 | slug↔source_id 안정 매핑 (v3, INFRA-1B.1) |
| `crawl_state` | ADR-0030 INV-0030-5 | discovery scheduler per-source state — last_polled_at / last_etag / last_modified_header / consecutive_failures / next_eligible_at (v5, INFRA-1B.2b) |
| `discovery_queue` | INFRA-1B.2 / INFRA-1B.3 | 발견 URL pending Snapshot fingerprint. **Current columns (v6 landed)**: source_id / url / status / discovered_at / updated_at + partial unique index `(source_id, url) WHERE status IN ('pending','processing')`. **Planned columns (P1-M2-hardening, INFRA-1B.3.x)**: worker_id (Q-038 / DEC-019, CAS pattern for multi-worker concurrency). worker_id 는 현재 schema 미포함 — INFRA-1B.3.x 슬라이스 안 ALTER 로 추가 (DEPLOY-1A.1 ALTER-only contract) |

## Source Registry — 2-store logical seam

The **logical Source Registry** spans two stores. GPT round 1 review on PR #37 (Issue 7, **deferred** to this micro-PR) flagged that the earlier HLD wording put the entire registry inside Neo4j, hiding the SQLite-side policy / audit / slug-map tables.

| Concern | Store | Tables / nodes |
|---|---|---|
| Source identity + graph relationships | Neo4j | `Source` node (`source_id` PK with `src_<ULID>` value, `name`, `url`, `reliability_tier`, `collectability_score` scalar 0-1 — ADR-0016, `source_perspective`, `archive_policy` / `raw_cloud_policy` / `external_llm_policy` denormalized from SQLite `source_material_policy` for query convenience — **SQLite 가 canonical**, `created_at`) — Tier 0~D 컨테이너 (ADR-0011 INV-0011-2). landed schema = `migrations/neo4j/v1_schema.cypher` + `src/domain/nodes.ts` `SourceNode` interface. `publisher_name` / `urls_root[]` / structured `collectability_score{...}` / `access_method` 등 HLD 계획안 속성은 v0 schema 미반영 (Codex round 3/4 P2 review). **`seedSources()` (INFRA-1B.1) 가 YAML 에서 실제로 SQLite 로 옮기는 데이터는 (a) `source_registry_slug_map(slug, source_id)` + (b) `source_material_policy` 의 정책 enum 3개 (`archive_policy` / `raw_cloud_policy` / `external_llm_policy`) 뿐**. YAML 의 multi-URL (`url` / `rss_url` / `api_base`), collectability 4-tuple, `access_method`, `meta_category`, `subtopic_tags`, `notes` 는 현재 어디에도 persist 되지 않고 **drop 된다** (Codex round 4 P2 review) — 후속 슬라이스에서 별도 schema migration 으로 추가 필요 |
| Per-source material policy | SQLite | `source_material_policy` (`source_id` FK, `archive_policy`, `raw_cloud_policy`, `external_llm_policy`, `checked_at`, `updated_at`) — ADR-0017 |
| Slug → src_id stable mapping | SQLite | `source_registry_slug_map` (`slug` PK, `source_id`) — idempotent seed re-run anchor (DEC-015, v3 migration) |
| Auto-tighten rule propose / confirm | SQLite | `source_policy_rules` (`rule_id`, `pattern`, `applies_to_field`, `match_pattern`, `rule_value`, `active`) — ADR-0021 (auto-tighten only, no auto-relax) |
| Policy gate decision audit (immutable) | SQLite | `policy_decisions` (`decision_id` PK = `pdec_<ULID>`, `source_id` nullable, `session_id` nullable, `url`, `trigger_type` NOT NULL, `policy_gate_mode` NOT NULL CHECK (inline_block / inline_warn / batch_report), `decision`, `rationale`, `created_at`) — ADR-0017 INV-0017-3. **HLD §Data Model** 가 추가로 계획 중인 컬럼 (`intended_action` / `risk_level` / `intervention_id`) 은 v1 schema 미반영 — landed 시점에 본 row 갱신 의무 (Q-044 / TRACE-040 anchor `src/storage/audit/policy-decisions.ts` 의 INFRA-1B.3.x-audit 슬라이스에서 `intended_action` ALTER 예정) |

### Bootstrap order

1. `data/sources_seed.yaml` (72 Tier A sources, INFRA-1A.6) 가 seed input.
2. `bun run seed-sources` (= `scripts/seed-sources.ts` → `src/storage/source-registry/seed.ts` `seedSources()`) 는 **SQLite 만** 채운다: `source_registry_slug_map` 에 slug 마다 `src_<ULID>` INSERT + `source_material_policy` UPSERT (INFRA-1B.1).
3. Neo4j `Source` 노드 생성은 **현재 코드 미구현** — `src/discovery/worker/snapshot-fingerprint.ts` 의 `createDocumentAndSnapshot()` 안 P1-3 guard 가 `MATCH (src:Source {source_id: $sourceId})` 결과 0건이면 plain `Error("Source not found in graph: <source_id>")` 로 throw, `processOneRow()` 가 비-typed exception 을 받아 큐 row 를 `error_code='runtime_error'` 로 마크한다 (`createDocumentAndSnapshot` 은 `TypedQueueError` 를 던지지 않음). 단 dedup link path 의 `ensureSourceLinkage()` 가 missing Source 를 발견했을 때만 `TypedQueueError('source_not_found_in_graph')` 를 던져 `error_code='source_not_found_in_graph'` 로 마크된다 (Codex round 2 P2 review). 따라서 두 경로 가 서로 다른 error_code 로 관찰되며, 운영자 alert 설정 시 두 코드 모두 cover 의무. 디스커버리 실행 전 Neo4j Source 노드는 별도 path 로 bootstrap 되어 있어야 한다 — 후속 슬라이스 (INFRA-1B.2+ 안에서 추가 예정, 현재 slice 표 미등록) 또는 운영자 manual Cypher 가 필요. `seedSources()` 가 SQLite 쪽 슬러그 매핑만 채우고 Neo4j 측 노드는 채우지 않는다는 사실은 idempotent dry-run 운용 의도이지 design oversight 가 아님 (DEC-015).
4. `data/sources_seed.yaml` 은 의도적으로 Neo4j fixture loader 가 **아니다**. YAML 은 2-store seam 의 bootstrap input 이지 canonical store 자체가 아니다.

### FK seam contract

- **logical Source FK** 가 있는 컬럼: `source_material_policy.source_id` (NOT NULL, ADR-0017) / `source_registry_slug_map.source_id` (NOT NULL value column — slug→source_id mapping 의 결과값으로, constraint-level FK 가 아닌 lookup index, DEC-015 v3 migration) / `policy_decisions.source_id` (nullable — v1 schema line 89, 등록되지 않은 URL 에 대해서도 결정 기록 가능하도록 nullable). 모두 Neo4j `Source.source_id` property (PK, `src_<ULID>` 값 형식) 를 reference 한다 — canonical 컬럼/property 이름은 항상 `source_id`, `src_<ULID>` 는 그 컬럼이 담는 ID 값의 prefix 형식 (Codex round 2 P2 review). **DB-level FK constraint 로 enforce 되지 않음** (SQLite 안에서 cross-store FK 불가) — 정합성은 `seedSources()` 가 slug map 에서 `src_<ULID>` 값을 받은 slug 에 대해서만 policy row 를 INSERT 한다는 idempotency contract (DEC-015) 로 유지.
- **`source_policy_rules` 는 source-id 컬럼이 없다** (pattern-based 규칙 — ADR-0021 INV-0021-1): `rule_id` PK / `pattern` / `applies_to_field` (= `archive_policy` | `raw_cloud_policy` | `external_llm_policy` 중 하나의 policy 필드 이름 enum, NOT a source identifier) / `match_pattern` / `rule_value`. 즉 `source_policy_rules` 는 본 FK seam 의 직접 참여자가 아니라 source-agnostic rule template store 이며, rule 적용 결과만 `source_material_policy` 의 정책 필드에 propagate 된다.
- `policy_decisions` row 는 Neo4j Source 노드보다 먼저 존재할 수 있음 (등록되지 않은 URL 에 대해서도 결정이 기록될 수 있도록 v1 schema line 89 의 `source_id` 가 nullable).

### Why split

2-store seam 이 존재하는 이유:
- Graph relationships (Source → Document → Snapshot, ADR-0012) 는 Neo4j 의 graph query 가 필요.
- Policy + audit + learning rules (ADR-0017, ADR-0021) 는 SQLite 의 transactional integrity + `checked_at` / `updated_at` row-level UPDATE 가 필요.
- Stable slug→ULID mapping (DEC-015) 는 Neo4j 의존 없이 seed loader 가 동작해야 함 — `seed-sources --dry-run` 이 graph DB 가 꺼진 상태에서도 YAML validation 을 완료할 수 있도록 SQLite 에 둠.

코드 anchor: `src/storage/source-registry/seed.ts` (`seedSources()`), `scripts/seed-sources.ts` (CLI). HLD 의 동치 컴포넌트 row 는 `docs/02_HLD.md` Components 표 "Source Registry (Neo4j ↔ SQLite 2-store seam)" 참조.

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

- `docs/_generated/schema.md` — 마이그레이션 파일에서 자동 생성 (`bun run invariant:regen` 안으로 흡수 검토)
- SPIKE-001 결과 입력 후 Neo4j FTS 인덱스 tuning (AC-002 검증)
- Q-041 / DEPLOY-1A.2 — millis-bearing ISO timestamp 통일 + CHECK constraint
  적용 (현재 discovery_queue 는 strftime no-millis, crawl_state 는
  millis-bearing — 통일 전 단계)
- Q-044 — policy_decisions 의 R2 upload audit row INSERT 위치 결정 후
  recordR2UploadDecision() 도입 시 본 표 갱신
