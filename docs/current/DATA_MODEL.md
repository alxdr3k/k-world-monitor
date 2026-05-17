# Data Model

> Last verified against code: 79d1e5b (2026-05-15) — AI-P1-2 / `INFRA-1B.1.h1-source-bootstrap-neo4j` landed (Neo4j Source node bootstrap + 3-way preflight alignment + null/duplicate source_id detection + `BootstrapPreflightError` fail-fast; minimal Source node properties = `source_id` / `slug` / `name` / `bootstrap_at` / `updated_at`; full SQLite slug_map coverage incl. historical rows). Previous code baseline = 75706c4 (2026-05-14, INFRA-1B.3.x-audit landed — R2 upload audit ledger, v7 migration ADD COLUMN intended_action, AC-032 / NFR-008 evidence, Q-044 → DEC-020 / TRACE-040). Earlier baseline = 0a76d31 (2026-05-13). Pre-merge SHA references are refreshed as the branch evolves — canonical post-squash-merge SHA settles in the next slice's baseline header.

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
| v7 | `migrations/sqlite/v7_policy_decisions_intended_action.sql` | policy_decisions ADD COLUMN intended_action — R2 upload audit (INFRA-1B.3.x-audit, AC-032 / NFR-008, Q-044 → DEC-020 / TRACE-040) |
| v8 | `migrations/sqlite/v8_audit_hardening.sql` | policy_decisions ADD COLUMN upload_attempt_id (BEFORE/AFTER correlation key) + 3 BEFORE INSERT triggers (intended_action enum / r2_upload decision enum / r2_upload upload_attempt_id required) — DB-level defense-in-depth for AC-032 / NFR-008 audit invariants (INFRA-1B.3.h3-audit-hardening, AI-P1-7) |
| v9 | `migrations/sqlite/v9_policy_decisions_snap_id.sql` | policy_decisions ADD COLUMN snap_id (TEXT, nullable for v8- legacy rows) + partial INDEX `policy_decisions_snap_id_idx WHERE snap_id IS NOT NULL`. First-class structured handle replacing rationale-prefix regex dependency; `recordR2UploadDecision` dual-writes column + rationale prefix; scanner column-preferred via `validSnapIdOrNull` shape guard + rationale fallback for legacy rows (INFRA-1B.3.h5-policy-decisions-snap-id-column-v9, AI-P1-15). Cycle 7 (INFRA-1B.3.h6-schema-hardening) added writer-boundary `assertValidSnapId` fail-fast at `recordR2UploadDecision` entry + v8→v9 migration integration test covering column / index / schema_migrations / duplicate-column recovery |

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
| `policy_decisions` | ADR-0017 + ADR-0012 INV-0012-3 | 운영자 policy gate 결정 기록 + **v7 ALTER (INFRA-1B.3.x-audit): `intended_action` 컬럼 추가** + **v8 ALTER + 3 BEFORE INSERT triggers (INFRA-1B.3.h3-audit-hardening, AI-P1-7): `upload_attempt_id` 컬럼 + intended_action enum / r2_upload decision enum / r2_upload upload_attempt_id required triggers** + **v9 ALTER (INFRA-1B.3.h5-policy-decisions-snap-id-column-v9, AI-P1-15): `snap_id TEXT` first-class column + partial INDEX `WHERE snap_id IS NOT NULL`**. `intended_action='r2_upload'` row 는 `src/storage/audit/policy-decisions.ts.recordR2UploadDecision()` 가 snapshot-fingerprint r2Put 전후 INSERT (AC-032 / NFR-008 audit log). `upload_attempt_id` (`uatt_<ULID>`) 가 BEFORE/AFTER row pair 의 canonical correlation key — operator audit query `WHERE upload_attempt_id = '...'` 가 concurrent r2Put 사이에서 단일 attempt 의 BEFORE/AFTER 정확 추출 (snap_id 만으로는 dedup back-fill race 시 부정확). v9 `snap_id` column 은 scanner 의 free-form rationale regex 의존을 종결한 first-class structured handle — `recordR2UploadDecision` 이 Cycle 7 `assertValidSnapId` writer-boundary fail-fast 후 column + rationale prefix 양쪽 dual-write; scanner (`fetchR2UploadOutcomeAuditRows`) 는 column-preferred + `validSnapIdOrNull` shape guard + rationale parsing fallback (v8- 레거시 row). v8- legacy row 는 column NULL 인 채로 scanner read-time fallback 만으로 호환 (backfill 별도 ops slice) |
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
| Policy gate decision audit (immutable) | SQLite | `policy_decisions` (`decision_id` PK = `pdec_<ULID>`, `source_id` nullable, `session_id` nullable, `url`, `trigger_type` NOT NULL, `policy_gate_mode` NOT NULL CHECK (inline_block / inline_warn / batch_report), `decision`, `rationale`, `created_at`, **`intended_action`** nullable — v7 ALTER (INFRA-1B.3.x-audit), **`upload_attempt_id`** nullable — v8 ALTER (INFRA-1B.3.h3-audit-hardening, AI-P1-7), **`snap_id`** nullable — v9 ALTER (INFRA-1B.3.h5-policy-decisions-snap-id-column-v9, AI-P1-15)) + **v8 BEFORE INSERT triggers** enforcing intended_action enum / r2_upload decision enum / r2_upload upload_attempt_id required + **v9 partial INDEX** `policy_decisions_snap_id_idx WHERE snap_id IS NOT NULL`. ADR-0017 INV-0017-3 + ADR-0012 INV-0012-3. operator-facing 결정 row 는 `intended_action` NULL (모든 v8 trigger constraint 우회); R2 upload audit row 는 `intended_action='r2_upload'` + `trigger_type='r2_upload'` + `policy_gate_mode='batch_report'` + `upload_attempt_id='uatt_<ULID>'` + `snap_id='snap_<ULID>'` (Cycle 7 INFRA-1B.3.h6 `assertValidSnapId` writer-boundary shape guard, fail-fast on malformed) 로 `src/storage/audit/policy-decisions.ts.recordR2UploadDecision()` 가 INSERT. v9 column 은 v8- legacy row 에 NULL 로 남고 scanner 가 rationale parsing 으로 read-time fallback. **HLD §Data Model** 가 추가로 계획 중인 `risk_level` / `intervention_id` 컬럼은 아직 v1+v7+v8+v9 schema 미반영 — landed 시점에 본 row 갱신 의무 |

### Bootstrap order

1. `data/sources_seed.yaml` (72 Tier A sources, INFRA-1A.6) 가 seed input.
2. `bun run seed-sources` (= `scripts/seed-sources.ts` → `src/storage/source-registry/seed.ts` `seedSources()`) 는 **SQLite 만** 채운다: `source_registry_slug_map` 에 slug 마다 `src_<ULID>` INSERT + `source_material_policy` UPSERT (INFRA-1B.1).
3. **Neo4j `Source` 노드 bootstrap** — `bun run seed-sources:neo4j` (`scripts/seed-sources.ts --neo4j` → `src/storage/source-registry/neo4j-bootstrap.ts`) 가 SQLite seed 후 **모든 `source_registry_slug_map` row** (현재 YAML rows + historical rows whose slugs are no longer in YAML — Codex PR #44 P1 fix) 를 단일 UNWIND MERGE 로 Neo4j Source nodes 로 bootstrap. Source node properties 의도적 최소: `source_id` (UNIQUE, v1 `source_unique` constraint), `slug`, `name` (YAML name 우선, historical rows 는 slug fallback), `bootstrap_at` (ON CREATE), `updated_at` (ON CREATE + ON MATCH). 전체 source profile metadata (`publisher_name` / `urls_root[]` / `reliability_tier` / `collectability_score{}` / `access_method` / `source_perspective` / `meta_category` / `subtopic_tags[]`) 는 **AI-P1-4** (`INFRA-1B.1.h2-source-profile`, Q-054 D3 + Q-058 D7 — SQLite `source_profile` canonical store + Neo4j projection) slice 영역 — 본 slice 에서 pre-empt 금지. 슬라이스 = `INFRA-1B.1.h1-source-bootstrap-neo4j` (AI-P1-2, PR #44 landed 2026-05-15).
   - `bun run seed-sources:preflight` — SQLite policy / SQLite slug_map / Neo4j Source 3-way 집합 alignment 검증. `missingInNeo4j` / `orphanInNeo4j` / `policyVsSlugMap.{onlyInPolicy, onlyInSlugMap}` 4 axis + `neo4jNodesMissingSourceId` (null source_id 노드 카운트, Codex PR #44 P2) + `neo4jDuplicateSourceIds[]` (pre-constraint historical duplicates, Codex PR #44 P2) 검출. fail 시 `BootstrapPreflightError` throw → CLI exit 1 + actionable repair hint.
   - **runtime guard 잔존 의의**: bootstrap 단계 누락 시 `src/discovery/worker/snapshot-fingerprint.ts` 의 `createDocumentAndSnapshot()` P1-3 guard 가 `MATCH (src:Source {source_id: $sourceId})` 결과 0건이면 plain `Error("Source not found in graph: <source_id>")` throw, `processOneRow()` 가 비-typed exception 을 받아 큐 row 를 `error_code='runtime_error'` 로 마크한다. 단 dedup link path 의 `ensureSourceLinkage()` 는 `TypedQueueError('source_not_found_in_graph')` 를 던져 `error_code='source_not_found_in_graph'` 로 마크. **두 경로 의 error_code 통일은 별도 slice** `INFRA-1B.3.h2-queue-cli` (AI-P1-3) 영역.
   - `seedSources()` default (no `--neo4j` flag) 는 SQLite seed only — backward compat 유지 (idempotent dry-run / migration 적용 전 plan-print 용). Neo4j bootstrap 은 명시 flag 의무.
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
- ~~Q-044 — recordR2UploadDecision() 도입~~ — **closed by INFRA-1B.3.x-audit
  / PR #39** (R2 upload audit ledger landed: `src/storage/audit/policy-
  decisions.ts` + v7 ALTER intended_action + snapshot-fingerprint 2 call
  site hooks + 16 unit tests + 8 integration tests + audit hard gate
  policy via auditR2UploadOrThrow).
- ~~INFRA-1B.2-source-bootstrap (planned)~~ — **closed by
  `INFRA-1B.1.h1-source-bootstrap-neo4j` / PR #44** (AI-P1-2, 2026-05-15).
  Neo4j `Source` 노드 bootstrap CLI (`bun run seed-sources:neo4j`) +
  3-way preflight (`bun run seed-sources:preflight` / auto-after-bootstrap)
  + `BootstrapPreflightError` fail-fast all landed. `src/storage/source-
  registry/neo4j-bootstrap.ts` + `tests/unit/neo4j_bootstrap_test.ts`
  (23 tests). canonical slice 등록 (slice ID rename `INFRA-1B.2-source-
  bootstrap` → `INFRA-1B.1.h1-source-bootstrap-neo4j`, IMPL_PLAN slice
  표 row) 는 별도 PR `PR-canonical-register-2026-05-15` 가칭 영역.
- `set_r2_key_failed_neo4j` repair job (planned) — INFRA-1B.3.x-audit
  의 후속. audit ledger 의 `set_r2_key_failed_neo4j` row 를 스캔해 r2
  object 가 존재하지만 Snapshot.r2_key=null 인 케이스에 대해 SET
  back-patch 를 재시도하는 CLI (`pipeline repair r2-orphan` 류).
- INFRA-1B.3.x-audit-invariant-scan (planned) — Neo4j `Snapshot.r2_key
  IS NOT NULL` 노드 × SQLite `source_material_policy.raw_cloud_policy`
  cross-check CLI. prohibited source 의 r2-backed Snapshot 검출 시
  alert. NFR-008 audit-by-absence 패턴의 보강 안전장치 (운영자 검토 항목
  2 — GPT reviewer 권고).
- INFRA-1A.3.x-r2-inventory (planned) — R2 bucket 안 모든 object 의
  sha256/위치를 Snapshot.content_hash + Snapshot.r2_key 와 cross-
  reference, orphan/부합 안 되는 object 검출. NFR-008 의 R2-side
  evidence (운영자 검토 항목 2).
- INFRA-1B.3.x-audit-correlation-key (planned, v1+) — `policy_decisions`
  에 `upload_attempt_id TEXT` (`rup_<ULID>`) 컬럼 추가 (v8 ALTER + idx).
  multi-worker hardening 시 동일 snap_id 의 attempted N → outcome N
  mapping 을 second-precision tie 없이 명시적으로 (운영자 검토 항목 3
  — GPT reviewer 권고). v0 single-operator 환경에서는 rationale prefix
  로 충분.
