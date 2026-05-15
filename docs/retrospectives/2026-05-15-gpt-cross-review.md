# 2026-05-15 — GPT cross-review of Claude Opus 4.7 adversarial review

본 문서는 2026-05-15 Claude Opus 4.7 의 12-layer 적대적 리뷰 ([docs/10_PROJECT_RETROSPECTIVE.md](../10_PROJECT_RETROSPECTIVE.md#adversarial-review--2026-05-15-multi-layer--multi-perspective--multi-stage) 의 `## Adversarial Review — 2026-05-15` 섹션) 직후 GPT (운영자 cross-reviewer) 에 동일 repo (HEAD `43c8178` 직후 main = `4a45ce2`) 를 review 요청해 받은 외부 검토 + Claude 의 비판적 평가 + 두 review 의 합리적 종합을 정리한다.

상태: `Status: CURRENT — curated cross-review summary.`

본 파일은 **raw GPT transcript 가 아니다**. GPT 의 4 부 review 본문 중:
- **1부 (전체 verdict + P0/P1)** — 핵심 텍스트 그대로 보존 (편집 최소)
- **2부 (모듈별 P2/P3 ≈35 finding)** — finding inventory **표** 로 압축 (raw body 미보존)
- **3부 (다층 관점 7 영역)** — 핵심 포인트 표 + 5 failure scenarios 표 + 5 product invariants 그대로
- **4부 (gate verdict + PR 순서)** — verdict 표 + PR-1~PR-5 권고 표 + 결론 그대로. PR-1~PR-5 의 Claude 작업 prompt 본문 ≈3000 줄 부분은 **미포함** (필요 시 별도 raw artifact 로 promotion 권고)

목적:
1. GPT review 의 **synthesized finding inventory** + 핵심 표현 보존 (audit anchor — "왜 그 결정이 P0 였는가" trace 가능)
2. Claude 의 자체 review 와 GPT review 사이 **일치 / 보강 / miss** 명시 (Section B commensurability table)
3. 두 review 의 종합 결과를 Action Items (Q 신규 + slice 신규) 로 promote — 같은 디렉토리 `2026-05-15-action-items.md` 에 등록

## Finding index (cross-reference quick lookup)

| GPT finding ID | Claude finding ID | Action Item ID | Slice ID (candidate) |
|---|---|---|---|
| GPT P0-1 (R2 archive_policy gap) | (Claude L4-F miss) | AI-P0-1 | `INFRA-1B.3.h1-policy-fix` |
| GPT Latent P1 (chunker policy) | (Claude L3/L5/L6 partial) | AI-P1-1 | `INFRA-1B.4.h1-chunker-policy-gate` |
| GPT P1-1 (Source bootstrap Neo4j 부재) | Claude L4-G partial | AI-P1-2 | `INFRA-1B.1.h1-source-bootstrap-neo4j` |
| GPT P1-2 (Source Registry 필드 persist 부재) + P1-3 (categories.yaml) + Claude L3-M | — | AI-P1-4 | `INFRA-1B.1.h2-source-profile` |
| GPT P1-4 (migrate dry-run 착시) | Claude L7-F partial | AI-P1-5 | `DEPLOY-1A.0-migration-validation` |
| GPT P1-5 (audit outcome correlation) | Claude L4-D / L4-K | AI-P1-6 + AI-P1-7 | `OPS-1B.h1-runtime-invariant-scanner` + `INFRA-1B.3.h3-audit-hardening` |
| GPT P1-6 (policy_decisions DB enum) | Claude L3-I / L7-H partial | AI-P1-7 | `INFRA-1B.3.h3-audit-hardening` (v8 migration) |
| GPT P1-7 (TESTING test count) | Claude L8-A | AI-P1-5 (안 흡수) / AI-P2-1 | `DEPLOY-1A.0-migration-validation` |
| GPT P1-8 (current-state stale) | Claude L1-A | AI-P1-9 | `DOC-SYNC-2026-05-15` |
| GPT P1-9 (HLD Data Model) | (Claude HLD 본격 read 안 함) | AI-P2-1 | `DOC-SYNC-2026-05-15` |
| GPT P1-10 (CI doc-freshness advisory) | Claude L9-C | (AI-P2-4 안 흡수) | — |
| GPT 2부 P2-1 (fingerprint queue CLI) | — | AI-P1-3 | `INFRA-1B.3.h2-queue-cli` |
| GPT 2부 P2-4~11 batch (scheduler/queue 8 finding) | Claude L5-I partial | AI-P2-2 + AI-P2-8 | `INFRA-1B.2.h1-discovery-hardening` |
| GPT 2부 P2-22~24 (ManualClaimEntry validation) | — | AI-P2-3 | `INFRA-1B.6.h1-feedback-hardening` |
| GPT 2부 P2-25~27 (Run Ledger 3 finding) | Claude L6-B / L6-C | AI-P2-4 | OPS-1A.2 (existing) |
| GPT 2부 P2-30~31 (e2e + invariant scanner) | Claude L8-D partial | AI-P1-6 + AI-P2-9 | `OPS-1B.h1-runtime-invariant-scanner` + `INFRA-1B.2.h2-end-to-end-test` |
| GPT 2부 P2-32 (policy-aware boundary) + Claude L9-O | — | AI-P2-6 | (doc + architectural cleanup) |
| GPT 2부 P2-34 (operator observability) | Claude L12 partial | AI-P2-7 | `OPS-1A.5-unified-cli` |
| GPT 3부 5 failure scenarios | Claude L12 partial | (informational) | — |
| GPT 3부 첫 publishable format 권고 | (Claude 본격 분석 안 함) | Q-056 | PUB-1A.5 scope |
| GPT 3부 dataset MVP 권고 | — | Q-055 | EXTR-1A.5 timing |
| GPT 3부 source_role multi-dim | (Claude 본격 분석 안 함) | Q-058 | `INFRA-1B.1.h2-source-profile` 안 흡수 |
| Claude L9-A (main protection 3중 mismatch) | (GPT 미커버) | AI-P0-2 | Q-052 + admin task |
| Claude L2-A (frontmatter parse fail 6 file) | (GPT 미커버) | AI-P1-8 | doc fix |
| Claude L2 batch (validator integrity 14 finding) | (GPT 미커버) | AI-P2-5 | `INFRA-1A.9-validator-extension` + `INFRA-1A.10-glossary-backfill` |
| Claude L11 batch (DEC-019 5 hardening) | (GPT 일부 reverse-engineer) | (existing slices) | INFRA-1B.6.x + 1B.3.x + 1B.2.x + DEPLOY-1A.1/1A.2 |

---

## A. GPT review — curated excerpts + finding inventory

아래는 GPT 4부 review 의 **curated excerpt + synthesized finding inventory** 다. 1부 (전체 verdict + P0/P1) 는 핵심 텍스트를 비교적 원문에 가깝게 보존했고, 2~4 부는 표와 요약으로 압축됐다. 실제 raw GPT transcript 가 필요하면 별도 raw artifact 로 promotion 권고 (현재 본 파일 안에 미포함).

### 1부 — 전체 verdict + P0/P1 blocker 리뷰

#### 한 줄 결론

이 repo 는 설계 철학과 문서화 수준은 높다. 특히 "raw third-party text 를 클라우드에 저장하지 않고, Snapshot 은 fingerprint/locator/hash 중심으로 관리한다" 는 방향은 프로젝트의 법적·운영적 리스크를 정확히 보고 있다.

하지만 현재 구현은 아직 운영 가능한 end-to-end 콘텐츠 파이프라인이라기보다, Source Registry / Discovery / Snapshot / Chunk / Audit / Run Ledger 일부가 붙은 pre-MVP infra skeleton 이다.

가장 큰 문제는 네 가지:
1. R2 업로드 정책 guard 가 cross-source dedup 상황에서 archive_policy 를 보지 않고 raw_cloud_policy 만 봄. NFR-008/AC-032 의 핵심 legal-safety invariant 위반 가능.
2. `seedSources()` 는 SQLite 만 채우고 Neo4j Source node 를 만들지 않는데, fingerprint worker 는 Neo4j Source 가 없으면 실패. seed → discovery → queue → fingerprint 가 문서상으로는 landed 처럼 보이지만, 일반 운영자가 그대로 실행하면 막힐 가능성 큼.
3. Source Registry 의 핵심 필드 중 상당수가 seed YAML 에만 있고 canonical store 에 persist 되지 않음. PRD/AC 가 요구하는 collectability, access_method, source_perspective, category/tag validation 이 DB 에 없음.
4. current-state, implementation plan, TESTING, CI 주석, HLD 일부가 PR #39 이후 상태와 어긋남. doc drift = 다음 LLM 세션의 control plane 손상.

#### P0 — Production blocker

**P0-1. R2 cross-source policy guard 가 archive_policy 를 보지 않음**

Severity: P0 / Confidence: High / 영향 계층: legal safety / R2 policy / cross-source dedup / audit

현재 R2 upload guard 는 현재 input 에 대해서는 다음 조건을 본다:
- `input.archivePolicy === "full_snapshot_allowed"`
- `input.rawCloudPolicy === "allowed_public_data_only"`

하지만 cross-source dedup recheck 인 `allLinkedSourcesAllowRawCloud()` 는 linked Source 들의 `raw_cloud_policy` 만 조회한다. 함수명 그대로 "raw cloud 허용 여부" 만 보고, `archive_policy` 는 조회하지 않는다.

Snapshot 은 `content_hash` 기준으로 source 를 넘어 dedup 된다. 즉 같은 body bytes 가 여러 Source 에서 발견되면 하나의 Snapshot 에 여러 Document/Source 가 연결될 수 있다.

**깨지는 시나리오 A**:
1. Source A 가 `full_snapshot_allowed + allowed_public_data_only`.
2. Source A 가 Snapshot 을 만들고 R2 에 업로드.
3. 나중에 Source B 가 같은 content hash 보유.
4. Source B 는 `archive_policy=metadata_only, raw_cloud_policy=allowed_public_data_only`.
5. dedup path 는 `existing.r2Key !== null && input.rawCloudPolicy === "always_prohibited"` 만 막음.
6. Source B 의 `archive_policy=metadata_only` 는 막지 않음.
7. 결과적으로 Source B 가 R2-backed Snapshot 에 연결됨.

**깨지는 시나리오 B**:
1. Source B 가 먼저 r2_key 없는 Snapshot 에 연결됨.
2. Source B 는 `metadata_only + allowed_public_data_only`.
3. 나중에 Source A 가 같은 Snapshot 에 대해 R2 back-fill 시도.
4. `allLinkedSourcesAllowRawCloud()` 는 Source B 의 raw cloud 만 보고 통과시킬 수 있음.
5. 결과적으로 metadata-only source 가 이미 linked 된 Snapshot 에 r2_key 생김.

**권고 수정**:
- `allLinkedSourcesAllowRawCloud()` 를 `allLinkedSourcesAllowR2SnapshotUpload()` 로 rename + 모든 linked source 에 대해 동시에 `archive_policy = 'full_snapshot_allowed' AND raw_cloud_policy = 'allowed_public_data_only'` 검사.

**필요한 regression tests**:
1. `existing r2_key !== null` Snapshot 에 `metadata_only + allowed_public_data_only` source 가 dedup-link 하려 하면 reject.
2. `existing r2_key = null` Snapshot 에 `metadata_only + allowed_public_data_only` source 가 이미 linked 되어 있을 때, later back-fill 은 skip.
3. `excerpt_only + allowed_public_data_only` 도 동일하게 reject.
4. audit rationale 에 `archive_policy mismatch` 가 남아야 함.
5. invariant scan: `Snapshot.r2_key IS NOT NULL` 인 모든 Snapshot 의 모든 linked Source 가 `full_snapshot_allowed + allowed_public_data_only` 인지 검사.

#### P1 — Merge / gate blocker

**P1-1. Source Registry seed 와 Neo4j Source bootstrap 분리로 end-to-end discovery 막힘**

`seedSources()` 는 SQLite 의 `source_material_policy` + `source_registry_slug_map` 만 채움. 코드 주석도 명확: "Does NOT write to Neo4j — that layer is INFRA-1B.2+."

반면 `snapshot-fingerprint.ts` 의 `createDocumentAndSnapshot()` 은 Neo4j 에서 Source node 를 찾고, 없으면 transaction rollback + `Source not found in graph` 에러.

dedup path 는 `TypedQueueError("source_not_found_in_graph")` 를 던지지만, new path 는 plain Error 라서 `processOneRow()` 에서 `runtime_error` 로 뭉개질 수 있음.

→ 별도 slice `INFRA-1B.2-source-bootstrap` (또는 `seed-sources --neo4j`) 신설. preflight 검사 (source_material_policy count / source_registry_slug_map count / Neo4j Source count / mismatch) 동시 도입. discovery/fingerprint 시작 시 fail-fast.

> **Mapping note**: GPT 원문이 권고한 slice ID `INFRA-1B.2-source-bootstrap` 가 본 review 종합 단계 (Claude 자체 review 와 합산) 에서 `INFRA-1B.1.h1-source-bootstrap-neo4j` 로 canonical normalize 됨 — INFRA-1B.1 (Source Registry Bootstrap, landed) 의 hardening suffix 정합. 위 raw body 의 ID 는 GPT 원문 보존, action-items + Finding index 의 canonical mapping 은 후자.

**P1-2. Source Registry 가 PRD/HLD 가 요구한 핵심 필드를 persist 하지 않음**

PRD REQ-017 = Tier A-D / collectability_score / access_method / source_perspective. REQ-022/AC-027 도 source_perspective 분포를 bidirectional framing 의 핵심 invariant 로 봄.

하지만 실제 `seedSources()` 가 DB 에 쓰는 것은 slug map + 3 policy 필드. YAML 의 name/publisher/url/rss_url/api_base/access_method/reliability_tier/source_perspective/meta_category/subtopic_tags/collectability/notes 는 validate 일부만 되고 canonical store 에 저장되지 않음.

`source_registry_test.ts` 도 AC-022 커버 주장하지만 실제로는 row 삽입, src_ prefix, raw_cloud_policy default 중심. collectability/access_method/source_perspective persistence 검증 없음.

→ 옵션 A (Neo4j Source node 가 source profile canonical) 또는 옵션 B (SQLite `source_profile` table 추가). GPT 추천 = 옵션 B + Neo4j projection.

**P1-3. source seed validation 이 AC-031 보다 약하고 `data/categories.yaml` 권위 파일 없음**

`validateSource()` 는 access_method 와 meta_category 를 non-empty string 만 검사. subtopic_tags 는 enum validation 없음. collectability score range 없음.

AC-031 = topic 은 4 meta enum 외 reject / subtopic_tags[] 는 기존 8 enum + 5 tag 외 reject / 8 enum + 5 tag 가 4 meta category 안에서 매핑 / `data/categories.yaml` 의 mapping table 이 권위. 그러나 `data/categories.yaml` 부재.

→ `data/categories.yaml` 추가 + `validateSource()` 강제 + negative tests.

**P1-4. `migrate --dry-run` 이 실제 parse 검증 안 함**

`docs/current/TESTING.md` + CI workflow 가 "v1~v7 schema files parse and idempotent" 검증한다고 명시. 그러나 `scripts/migrate.ts` 의 SQLite dry-run = pending migration list 출력만, SQL parse/apply 안 함. Neo4j dry-run = statement count 출력만.

CI green 이어도 SQLite syntax error / trigger syntax / migration runtime error / table/column reference error / v8/v9 idempotency 문제 안 잡힘.

→ 옵션 A: `SQLITE_PATH=:memory:` 또는 temp DB 에 실제 apply. Neo4j 는 CI service container 또는 최소한 `--parse-only` 로 rename.
→ 옵션 B: 문서/CI 주석을 "pending preview only" 로 낮춤.

**P1-5. R2 upload outcome audit failure 가 후속 invariant gap 남길 수 있음**

PR #39 의 audit hard gate 방향 정확. attempted row commit → r2Put 진입 차단 ✓. 그러나 successful path: attempted insert → r2Put → recheck → Neo4j SET s.r2_key → uploaded/skipped audit insert.

문제: Neo4j SET 성공 후 outcome audit insert 실패 시 — graph 에는 r2_key 있지만 uploaded outcome row 없음. retry 가 existing.r2Key !== null branch 로 가면 back-fill 실행 안 됨, outcome audit row 복구 안 됨.

→ `Snapshot.r2_key IS NOT NULL` 인 모든 Snapshot 이 `decision='uploaded'` row 가지는지 invariant scan + `upload_attempt_id` column 도입 (attempted/outcome 같은 ID 공유).

**P1-6. policy_decisions audit-critical enum 이 DB 레벨로 보호 안 됨**

`policy_decisions` v1 schema = `decision TEXT NOT NULL`, `trigger_type` free text, `policy_gate_mode` CHECK 만. v7 = `intended_action TEXT` 추가하지만 CHECK 없음.

TypeScript enum (`INTENDED_ACTION`, `R2_UPLOAD_DECISION`) 있지만 raw SQL / future script / test setup / manual repair 가 잘못된 값 넣어도 DB 가 막지 못함.

v2 trigger 는 `run_ledger` + `cross_vendor_review_ledger` 에 적용 — 같은 패턴이 `policy_decisions` 에도 필요.

→ v8 trigger (intended_action enum + r2_upload decision enum) 추가.

**P1-7. TESTING / CI / commit narrative 의 test count 가 서로 안 맞음**

`docs/current/TESTING.md` 가 PR #39 이후 "490 → 515 tests total" 명시. PR #39 final commit narrative 는 "514 tests pass". 산술적으로 490 + 16 audit + 8 integration = 514. TESTING 의 515 안 맞음. CI workflow 주석도 "18 file / 200+ cases as of 13d61af" stale.

→ generated test summary 사용 또는 숫자 박지 말 것.

**P1-8. current-state.md 가 PR #39 이후 상태 잘못 안내**

current-state 는 다음 세션 첫 read 대상. AGENTS.md read order 1 번. 그러나 Q-044/R2 audit code enforcement 를 "신규 slice 미진입", "AC-032 audit ledger 미구현" 처럼 안내. CODE_MAP / DATA_MODEL 은 landed 반영.

→ "audit hook landed" 와 "AC-032 accepted" 를 분리. remaining blocker (linked-source archive_policy invariant scan / R2 inventory cross-check / upload_attempt_id / set_r2_key_failed_neo4j repair / Source bootstrap) 명시.

**P1-9. HLD Data Model summary 가 현재 구현 상태와 target design 을 섞음**

HLD Components table 은 Source Registry seam 현재 상태 정확. Data Model summary 는 Source 가 publisher_name / urls_root[] / structured collectability_score{...} / access_method / source_policy_fk 등 갖는 것처럼 요약 + "마이그레이션 파일은 INFRA-1A.2 slice 에서 commit 예정" 과거 문구 잔존.

→ HLD Data Model 을 "Current implemented subset" + "Target design / planned fields" 로 분리.

**P1-10. CI/doc-freshness 가 advisory 라서 현재 drift 를 실제로 막지 못함**

CI workflow 는 typecheck, bun test, migration dry-run 실행. branch protection required 등록 아직 admin pending. doc-freshness workflow 는 PR comment soft warning + `Never blocks merges`.

current-state / IMPL_PLAN 이 실제 landed slice 와 어긋나는 경우 soft warning 만으로는 부족.

→ 4 문서 (current-state / IMPL_PLAN / DATA_MODEL / TESTING) drift 시 doc-freshness fail (ack 없으면).

#### 1부 결론

처리 순서:
1. R2 linked-source policy guard 에 archive_policy 포함
2. Source Registry Neo4j bootstrap command + discovery/fingerprint preflight
3. migrate --dry-run 검증 착시 제거 또는 실제 parse/apply validation
4. current-state / IMPL_PLAN / TESTING / CI 주석 동기화
5. policy_decisions DB-level enum trigger + upload_attempt_id 도입
6. AC-032 invariant scan: r2_key ↔ policy/audit/R2 inventory cross-check

### 2부 — 모듈별 P2/P3 적대적 코드 리뷰

본 섹션은 분량이 크기 때문에 raw body 전체 보존 — 별첨처럼 처리한다. 핵심 finding 만 발췌해 표로 정리.

#### 2부 발견 inventory (≈35건)

| Module | ID | Severity | 요약 |
|---|---|---|---|
| Entry point | P2-1 | P2 | fingerprint/queue processing/chunker CLI entrypoint 부재 — operator 가 M2 e2e 못 실행 |
| Entry point | P3-1 | P3 | `lint = typecheck alias` — naming 부정확 |
| Source Registry | P2-2 | P2 | `active_v0` 가 discovery 에는 쓰이지만 seed validator 에 없음 — `"false"` 문자열 silent pass |
| Source Registry | P2-3 | P2 | `access_method` / `meta_category` / collectability validation 너무 약함 |
| Source Registry | P3-2 | P3 | `--dry-run` 이 실제 idempotency preview 가 아님 (fresh DB 가정) |
| Discovery scheduler | P2-4 | P2 | `DAILY_CANDIDATE_CAP=20` 이 "실행 1회당 cap" — 운영자 재실행 시 깨짐 |
| Discovery scheduler | P2-5 | P2 | cap 에 도달해도 모든 source fetch 이미 끝난 뒤 — network 낭비 |
| Discovery scheduler | P2-6 | P2 | scheduler 의 `runWithPool` reject 를 silent 무시 |
| Discovery scheduler | P2-7 | P2 | backoff 가 고정 24h — outcome 별 분리 필요 |
| Discovery scheduler | P3-3 | P3 | `getEligibleSources()` 있지만 scheduler 가 자체 eligible query 재구현 — drift risk |
| Discovery scheduler | P3-4 | P3 | `Promise.allSettled(targets.map(...))` 가 source 수 커지면 task 한꺼번에 생성 |
| Discovery queue | P2-8 | P2 | done URL 이 다음 run 에서 다시 enqueue 가능 — same URL 매일 fetch |
| Discovery queue | P2-9 | P2 | URL canonicalization 부재 — utm_source 등 변형이 다른 queue row |
| Discovery queue | P2-10 | P2 | `content_hash` 컬럼 의미가 phase 별로 다름 (URL hash vs body hash) |
| Discovery queue | P2-11 | P2 | feed content-type rejection 너무 좁음 — application/pdf, application/zip 통과 가능 |
| Discovery queue | P3-5 | P3 | RSS parser 가 content:encoded / summary / author 등 downstream hint 버림 |
| safe-fetch | P2-12 | P2 | User-Agent 에 contact 정보 없음 — crawler etiquette 약함 |
| safe-fetch | P2-13 | P2 | robots cache 가 process-local — cron run 마다 robots.txt 다시 fetch |
| safe-fetch | P3-6 | P3 | DNS rebinding TOCTOU 를 주석으로만 인정 |
| Chunker | **Latent P1** | **P1** | **chunker 가 policy 없이 raw text 를 Neo4j 에 저장 가능 — `metadata_only` source 의 full body 가 chunker 로 넘어가면 raw text slices 가 graph 에 저장됨** |
| Chunker | P2-18 | P2 | empty text 입력이 stale chunk 삭제로 이어짐 — transient extraction failure 시 위험 |
| Chunker | P2-19 | P2 | `char_start` / `char_end` 가 JS UTF-16 index 인데 "문자 offset" 으로 오해 가능 |
| Chunker | P3-8 | P3 | no-whitespace fallback 이 surrogate pair 쪼갤 수 있음 |
| Chunker | P3-9 | P3 | chunk hash 없음 — extraction/citation verification 어려움 |
| AccessIntervention | P2-20 | P2 | enum 들이 local type 으로 흩어짐 — DB trigger/docs/UI option 과 drift |
| AccessIntervention | P2-21 | P2 | AccessIntervention 이 Scenario/Thesis 에 edge 로 연결 안 됨 — graph query 약함 |
| AccessIntervention | P3-10 | P3 | Markdown batch report 가 operator action command 까지 연결 안 됨 |
| AccessIntervention | P3-11 | P3 | Markdown escaping 없음 |
| Manual feedback | P2-22 | P2 | whitespace-only claim 허용 (`" "` 가 valid) |
| Manual feedback | P2-23 | P2 | `attribution.url` / `sourceAccessedAt` validation 약함 |
| Manual feedback | P2-24 | P2 | manual_claim action 의 retry idempotency 약함 — duplicate ManualClaimEntry 가능 |
| Manual feedback | P3-12 | P3 | `temp_text` 의 raw_cache row compensation 실패를 조용히 삼킴 |
| Manual feedback | P3-13 | P3 | `ignore` action 이 policy learning 과 연결 안 됨 |
| Run Ledger | P2-25 | P2 | failed run 에 failure reason 없음 |
| Run Ledger | P2-26 | P2 | stale running run reaper 없음 |
| Run Ledger | P2-27 | P2 | cost ledger 있지만 cost throttle 아직 없음 (OPS-1A.2 planned) |
| Migrations | P2-28 | P2 | Neo4j migration 의 duplicate cleanup 이 populated DB 에서 파괴적일 수 있음 |
| Migrations | P2-29 | P2 | SQLite migration runner 의 duplicate-column fallback 너무 일반적 |
| Migrations | P3-14 | P3 | Neo4j statement splitting 이 semicolon 단순 split |
| Tests / CI | P2-30 | P2 | end-to-end operator flow test 부족 (seed → bootstrap → discovery → queue → snapshot → chunk) |
| Tests / CI | P2-31 | P2 | tests 가 "legal invariant scanner" 를 대체하지 못함 — runtime invariant scan 부재 |
| Tests / CI | P3-15 | P3 | mock 이 Neo4j transaction failure semantics 충분히 재현하는지 불명 |
| Cross-cutting | P2-32 | P2 | "policy-aware" 와 "pure transform" 의 경계 애매 |
| Cross-cutting | P2-33 | P2 | repair job 설계가 TODO 만 |
| Cross-cutting | P2-34 | P2 | operator-facing observability 약함 |

#### 2부의 우선순위 (먼저 고칠 것)

1. chunker policy gate 추가 (Latent P1)
2. fingerprint queue CLI 추가
3. done URL re-enqueue 정책 정리
4. new path missing Source 를 typed error 로
5. URL hash 와 snapshot content hash 컬럼 분리
6. scheduler rejected path 를 error 로 기록
7. ManualClaimEntry whitespace/date/url validation 강화
8. runtime invariant scanner / repair report 추가

### 3부 — 다층 관점 리뷰

3부는 코드 line-by-line 보다 상위 layer — 제품/데이터/콘텐츠/운영/법적/테스트/문서 7 영역.

#### 3부 핵심 포인트

| 영역 | 핵심 |
|---|---|
| **제품 방향성** | core thesis 맞음 (claim/scenario/thesis graph, cite-check, run ledger). 그러나 현재 구현 = "insight engine" 이 아니라 **"evidence substrate"**. 사용자 테스트는 (M2 infra / M3-M5 claim-scenario-thesis / M6 publication) 3 단계 분리 필요. 경쟁력은 "예측 정확도" 가 아니라 **"불확실성 관리 UX"** — confidence 가 medium 인 이유를 publication 안에서 disclose. |
| **데이터 품질** | Source Registry 가 canonical data model 약함 (P1-2 영역). **RSS source 만으로는 세계경제 관측 부족** — macro dataset (FRED/World Bank/IMF/OECD/BIS/central bank) + market data + policy docs + epidemic data + non-RSS official 누락. `dataset_vintage` / `derived_metric_ledger` 가 ADR-0024 에 있지만 implementation 미land. **M3 이전에 최소 dataset ingestion MVP 권고**. body-only `content_hash` dedup 은 storage 에는 좋지만 **knowledge dedup 에는 부족** — semantic dedup 필요. reliability_tier 단일 축 부족 — primary_data / official_policy / wire_news / expert_analysis / market_commentary / local_observer / opposition_view / think_tank / academic 같은 `source_role` 추가 권고. |
| **콘텐츠 성공 가능성** | 성공 가능성은 **"claim extraction 정확도" 가 아니라 "editorial loop"** 에 달림. extractor 붙이기 전에 "promotion policy" (source reliability / diversity / novelty / market relevance / assumption impact / contradiction strength / time sensitivity / evidence quality / operator interest) 설계 필요. **첫 publishable format 좁히기 권고 — "Weekly Scenario Watch"** (이번 주 새 signal 5 + 강화된 thesis 3 + 약화된 thesis 3 + 새 branch + cite-check blockers + next watch items). 완성형 장문 리포트는 M6 이후. |
| **운영 UX** | 현재 operator UX 는 "개발자 도구" — `kwm status / sources validate / discovery run / queue process / snapshot inspect / interventions report / intervention review / runtime-invariants check / repair r2` 같은 unified CLI namespace 권고. "무엇을 해야 하는지" next-action UX 부족 — 모든 report 에 recommended action + exact command + expected impact + due priority. failed/error 상태 설명 부족 — `errors_by_code` + blocking_next_milestone 출력. **"single operator" 전제 ≠ "operationally casual"** — production-like discipline (migration backup, runtime invariant scan, R2/Neo4j/SQLite consistency check, source policy diff review, failed run reaper, repair dry-run/apply 분리). |
| **법적/정책 리스크** | R2 가드는 강함 (P0-1 fix 후 더). 그러나 **"raw text stored in Neo4j" 리스크가 R2 보다 조용히 클 수 있음** — chunker 가 archive_policy 안 보고 raw text 저장 (Latent P1). `cloud_storage_policy` + `local_storage_policy` + `external_llm_policy` 3 층 분리 권고. **"audit-by-absence" 가 운영자 에게 설명 어려움** — `blocked_by_policy` 를 audit table 에 row 로 넣지 않더라도 별도 runtime invariant report 에 표시 권고. **source policy relaxation** (예 `metadata_only → full_snapshot_allowed`) 은 PR 에서 자동 경고 + terms_url + license_url + operator rationale 요구. |
| **테스트 / CI** | 단위 테스트 좋음. 그러나 실제 위험은 **multi-store invariant drift** — unit / integration / e2e / runtime invariant 4 layer coverage 필요. CI advisory 면 테스트 많아도 gate 아님. **migrate --dry-run 착시 위험** (P1-4 영역). |
| **문서 체계** | 문서 철학 좋음 (AGENTS read order / source-of-truth / thin docs). 그러나 **문서가 너무 "잘 쓰여서" stale 도 authoritative 하게 보임** — `Status: CURRENT / PARTIAL / STALE / TARGET` freshness level marker 권고. **current-state 가 control plane 이면 stale 허용치 낮아야** — 다음 세션 첫 read 대상이라 일반 문서보다 엄격. IMPL_PLAN 을 long-term roadmap 과 active-work-queue 둘로 분리 권고 (`docs/context/active-work-queue.md`). |

#### 3부의 숨겨진 잠재력

| 잠재력 | 의미 |
|---|---|
| **개인/조직용 thesis memory** | 처음엔 "세계경제 콘텐츠 자동화" 같지만, 더 큰 잠재력은 **"내 thesis 의 버전 관리 시스템"** — 내가 어떤 thesis 를 언제 왜 믿었는가 / evidence 강화·약화 / 무엇이 바뀌면 생각을 바꿔야 하는가 / 과거 예측이 어떤 source/assumption 에 의존했는가. Publication 보다 먼저 **Thesis Dashboard** (active theses / confidence trend / supporting claims / contradicting claims / stale claims / last updated / "what would change my mind" / unresolved access interventions) 권고. |
| **AccessIntervention 자산** | 많은 리서치 도구는 "못 본 자료" 를 무시. 본 repo 는 못 본 자료를 명시 기록 — "이 thesis 는 FT/WSJ paywalled source 를 아직 못 봤기 때문에 confidence medium" 같은 disclosure 가 콘텐츠 신뢰도 크게 올림. |
| **ManualClaimEntry lock-in** | 사용자가 수동으로 claim/opinion/quote 넣을수록 시스템이 사용자 사고 방식 반영한 thesis graph. generic LLM 뉴스 요약기가 따라오기 어려움. **"에러 처리" 가 아니라 "제품 학습 루프"** 로 다뤄야. |

#### 3부의 5 failure scenarios

| Scenario | 증상 | 방지책 |
|---|---|---|
| **A. claim bloat** | 뉴스 많이 가져오고 claim 많이 만들지만 promote/merge/rank 안 됨 → graph 쓰레기장 | semantic claim dedup / promotion score / claim lifecycle / operator review queue cap |
| **B. source bias** | 영어권/서구권/하방 risk 중심 source → output 늘 비슷한 위기론 | source coverage dashboard / perspective distribution / regional-language balance / counter-source requirement |
| **C. legal/policy fear 로 pipeline 너무 보수적** | raw text 저장/LLM 전송 너무 조심 → metadata-only 수준 머묾 | policy 별 허용 operation 명확화 / short quote excerpt policy / manual review flow / source-specific permission / dataset-first ingestion |
| **D. 문서 drift 로 agent 잘못된 작업 반복** | 이미 일부 발생 — current-state / IMPL_PLAN / RUNTIME-OPS / TESTING / CI 가 서로 다르게 말함 | current-state hard freshness / doc update required-ack gate / generated status summary |
| **E. output UX 너무 무거움** | 시스템 정교하지만 사용자가 매일 긴 report 읽기 어려움 | daily short digest / weekly scenario watch / only changed theses / only high-impact claim deltas |

#### 5 product invariants (가장 먼저 굳혀야 할)

1. No evidence without source trace.
2. No thesis update without changed claim/assumption.
3. No publication without cite-check.
4. No hidden blocked source: access failures are visible.
5. No raw text persistence without explicit source policy.

### 4부 — Gate 판단 + 다음 PR 순서

#### 최종 gate verdict

| Gate | 판단 | 이유 |
|---|---|---|
| 설계 방향성 | **Go** | Source → Snapshot → Chunk → Claim → Scenario/Thesis/Publication 구조는 목표와 잘 맞음 |
| **P0-M2 infra MVP** | **No-Go** | Source bootstrap 부재 / R2 linked-source policy gap / chunker raw text policy gap / queue processing CLI 부재 / runtime invariant scanner 부재 |
| PR #39 계열 audit 방향 | Partial Go | audit hook landed 단 AC-032 전체 수용에는 runtime invariant / correlation / DB enum trigger / repair path 부족 |
| Content MVP | No-Go | Extractor / claim promotion / semantic dedup / scenario composer / cite-check / publication workflow 모두 planned |
| 운영자 사용성 | No-Go | fingerprint queue / chunker / repair / status command 부재 |
| 법적/정책 안전성 | **No-Go until P0 fix** | R2 cross-source dedup guard archive_policy gap + chunker raw text policy 부재 |

#### 다음 PR 순서 (GPT 권고)

| PR | 제목 | 핵심 |
|---|---|---|
| **PR-1** | **P0 legal-safety fix: R2 linked-source policy guard** | `allLinkedSourcesAllowRawCloud()` → `allLinkedSourcesAllowR2SnapshotUpload()` rename + archive_policy 추가 검사. 6 regression tests. |
| **PR-2** | **Source bootstrap + preflight** | `seed-sources` 후 Neo4j Source node bootstrap. preflight check (mismatch fail-fast). |
| **PR-3** | **Fingerprint queue CLI + M2 e2e smoke** | `bun run discovery:process-queue` 명령. typed missing Source error 통일. |
| **PR-4** | **Chunker policy gate** | `chunkSnapshot(input)` 에 `sourceId` + `archivePolicy` 의무. `metadata_only` / `do_not_collect` reject, `excerpt_only` reject (limit 까지), `full_snapshot_allowed` allow. empty text 가 chunk 삭제 안 하게. |
| **PR-5** | **Runtime invariant scanner** | `bun run audit:r2-invariants` — R2-backed Snapshot source policy / uploaded audit outcome / attempted-outcome correlation / skipped_toctou / set_r2_key_failed_neo4j repair candidate. read-only by default. |
| **PR-6** | **policy_decisions DB enum + upload_attempt_id** | v8 migration — `intended_action` enum trigger + `r2_upload` decision enum trigger + `upload_attempt_id` column + attempted/outcome correlation. |
| **PR-7** | **Migration validation + docs/CI sync** | `migrate:plan` / `migrate:sqlite:validate` 분리. CI 에 temp SQLite apply. TESTING test count fix. RUNTIME/OPERATIONS 갱신. |
| **PR-8** | **Source profile canonicalization + AC-031 categories** | `data/categories.yaml` 추가. `source_profile` SQLite table 또는 Neo4j projection 확장. category validation + coverage report. |

#### 가장 먼저 할 것

지금 당장 하나만 한다면 **PR-1**. 그 다음 PR-2 / PR-3 / PR-4 / PR-5 순서.

#### 하지 말아야 할 다음 작업

- Extractor / LLM router 부터 붙이지 말 것 (Source bootstrap 미land + Chunker policy gate 미land + Snapshot/R2/audit invariant 불완전)
- Scenario composer 부터 붙이지 말 것 (claim quality 받쳐주지 못함)
- UI/Publication 부터 붙이지 말 것 (cite-check 미land)
- 더 많은 source 추가하지 말 것 (Source canonicalization 부재)

#### Claude 에게 줄 작업 프롬프트 — PR-1

GPT body 안 PR-1 ~ PR-5 의 Claude prompt 5건. 각 prompt 는 `Required changes / Tests / Docs / Non-goals / Acceptance criteria` 명시 포함. 별첨 (raw body 보존, repo root `docs/retrospectives/2026-05-15-gpt-cross-review-prompts.md` 로 후속 분리 가능).

#### 4부 최종 결론

가장 중요한 판단:
> "콘텐츠 기능을 빨리 붙이는 것보다, evidence/policy substrate 를 한 번 단단히 닫는 게 장기적으로 더 빠르다."

이 repo 는 이미 문서/방어 코드가 꽤 좋아서 PR-1~PR-5 만 잘 닫으면 이후 extractor/scenario 단계 실패 확률 크게 내려감.

---

## B. Claude 의 비판적 평가

GPT review 를 Claude 의 자체 12-layer review (`## Adversarial Review — 2026-05-15` 섹션, 208 finding) 와 비교 평가.

### B.1. GPT 가 정확히 발견했고 Claude 가 miss 한 항목

#### **B.1.1 (P0). R2 cross-source policy guard 의 archive_policy gap**

Claude L4-F 는 cross-store seam (Neo4j Source ↔ SQLite source_material_policy) 의 4 inconsistency 시나리오를 분석하고 **"정합 robust ✓"** 결론. **이것이 Claude review 의 가장 큰 single miss**.

Claude 가 본 것:
- snapshot-fingerprint:112-133 `allLinkedSourcesAllowRawCloud` 가 SQLite `source_material_policy.raw_cloud_policy` 만 SELECT 후 모든 row 가 `allowed_public_data_only` 인지 검사
- `rows.length !== sourceIds.length` 시 false → "unmapped source default prohibited"
- BEFORE/AFTER r2Put 양쪽 recheck (line 498, 537) 이 cross-source TOCTOU close

Claude 가 놓친 것:
- **`archive_policy` 가 검사 대상 자체가 아님**. 함수명 `allLinkedSourcesAllowRawCloud` 그대로 raw_cloud 만 본 것. archive_policy 가 `metadata_only` / `excerpt_only` 인 source 가 raw_cloud 만 `allowed_public_data_only` 면 그 source 가 R2-backed Snapshot 에 dedup-link 가능.
- 즉 invariant "R2-backed Snapshot 의 모든 linked source 는 `full_snapshot_allowed + allowed_public_data_only` 둘 다 만족" 의 **첫 번째 conjunct 만 검증되고 두 번째 conjunct 가 unchecked**.

**근거 (Claude 자체 cross-check)**:

`grep "raw_cloud_policy" src/discovery/worker/snapshot-fingerprint.ts` 결과 7건 — 모두 raw_cloud_policy 만 인용. `archive_policy` cross-store check 0건. 함수 의도가 "이름 그대로" 라 Claude 가 이름에 안주.

Claude L4-A 가 발견한 "100% always_prohibited seed 라 codepath dead" 가 **현재 한정 안전성** 의 false comfort 였음. seed 의 1 source 라도 `allowed_public_data_only` 로 완화되는 순간 (예 정부 공식 dataset / open license source) GPT 의 시나리오 A/B 가 fire.

**평가: GPT 의 P0 정확. Claude 의 L4-F "정합 robust" 결론 후퇴**.

#### B.1.2 (Latent P1). chunker raw text policy gate 부재

Claude L3 / L5 / L6 에서 chunker 코드 read 하고 finding 3건 도출 (L3-F chunk_id prefix / L5-K production 사용 vs ID_PREFIXES 미등록 / L5-S CHUNK_WORDS hardcoded). 그러나 **policy boundary 자체는 인식 못함**.

GPT 가 발견:
- `chunkSnapshot({ snapId, text })` 가 `sourceId` / `archivePolicy` 안 받음
- raw text 를 `Chunk.text` Neo4j property 에 저장
- ADR-0012 INV-0012-3 "raw third-party text 클라우드 업로드 금지" 가 R2 한정 — Neo4j 측 적용 안 됨
- 그러나 `archive_policy=metadata_only` source 의 full body 를 chunk 로 Neo4j 저장하는 것은 **policy 의 spirit 위반**

이건 Claude L10 (security 집중 패스) 에서 ADR-0029 prompt-injection 본격 read 하면서도 chunker 의 raw-text persistence 측면을 놓침. L4-A 의 "100% always_prohibited" false comfort 와 같은 패턴 — "R2 측만 정책 enforce, 다른 store 는 보지 않음" 의 blind spot.

**평가: GPT 정확. Claude 의 L3/L5/L6 chunker analysis 의 본질적 보강 필요**.

#### B.1.3 (P1). migrate --dry-run 검증 착시

Claude L7-F 는 "dry-run pending count 정확 ✓" 로 OK 마킹. L7-R 은 "dry-run file 존재 검증 부재 — operational risk" P3 만.

GPT 발견:
- `docs/current/TESTING.md` + CI workflow 가 **"v1~v7 schema files parse and idempotent verification"** 명시
- 실제 구현 = pending list 출력 + statement count 출력 만
- CI green 상태에서 SQL syntax error / trigger error / migration runtime error 안 잡힘

Claude review 가 이 doc-vs-impl mismatch 를 **underweight**. L9 (CI/CD) 에서도 ci.yml read 했지만 "Migration dry-run" step 의 comment "Verifies v1~v6 SQL + v1 Cypher migration files parse and are idempotent" 가 실제와 다르다는 점을 못 봤음.

**평가: GPT 의 P1-4 정확. Claude L7-F 후퇴 + L9-O (script 분담 명시) 의 확장 필요**.

#### B.1.4 (P1). HLD Data Model summary stale (current vs target 섞임)

Claude review 가 PRD/IMPL_PLAN/AC/Q/DEC 본격 read 했지만 `02_HLD.md` 본문 detail read 안 함. GPT 가 발견한 HLD section drift (Source 가 publisher_name / urls_root[] / structured collectability_score / access_method 갖는 것처럼 요약 + INFRA-1A.2 commit 예정 stale wording) 가 Claude review 에서 빠짐.

**평가: GPT 의 P1-9 정확. Claude review 의 doc inventory 가 HLD detail 미커버**.

#### B.1.5 (P2 multiple). 운영자 UX / observability / scheduler edge cases / RSS lifecycle

GPT 2부 의 P2 finding 다수가 Claude review 의 narrow technical lens 밖:
- P2-1 fingerprint queue CLI 부재 → operator 가 M2 e2e 못 실행
- P2-4 / P2-5 DAILY_CANDIDATE_CAP run당 cap + cap 도달 후 fetch 이미 완료
- P2-6 scheduler rejected silent skip
- P2-8 / P2-9 / P2-10 / P2-11 discovery_queue URL lifecycle 4 issue (done URL re-enqueue / URL canonicalization / content_hash 의미 phase 별 다름 / content-type rejection 너무 좁음)
- P2-12 User-Agent contact 정보 부재
- P2-22 / P2-23 / P2-24 ManualClaimEntry 검증 약함 + idempotency 약함
- P2-25 / P2-26 failure reason 부재 + stale running run reaper 부재
- P2-30 / P2-31 e2e operator flow test + runtime invariant scanner 부재
- P2-32 policy-aware vs pure transform 경계 애매 (architectural smell)
- P2-34 operator-facing observability 약함

Claude review L11 (concurrency) 에서 일부 영역 (L11-O stale-reclaim 60min / L11-K Doppler rotation race) 다뤘지만 GPT 의 systemic operator UX angle 이 더 강함.

**평가: GPT 의 2부 ≈20 finding 이 Claude review 의 보강. selective integration**.

### B.2. Claude 가 발견했고 GPT 가 miss 한 항목

GPT review 의 valuable 영역 외에서 Claude review 가 잡은 항목:

#### B.2.1 (P0). main branch protection 3중 policy mismatch (L9-A)

Claude L9-A:
- `gh api repos/alxdr3k/k-world-monitor/branches/main/protection` → "Branch not protected" (HTTP 404)
- DEC-020 Q-048 lock = "main branch protection PR-only + required check ci.yml"
- PRD line 208-212 / TRACE-044 가 정책 단언
- CLAUDE.md global "k-world-monitor — main 직접 push 허용" 와 **직접 충돌**
- 실제 GH state 는 CLAUDE.md 와 정합

이건 GPT P1-10 (CI/doc-freshness advisory) 의 일부 angle 만 cover. CLAUDE.md global ↔ DEC-020 충돌 자체는 GPT 가 본 적 없음. **Claude 가 GH API 실측 + 운영 정책 cross-reference 까지 한 것이 Claude review 의 P0 differentiator**.

#### B.2.2 (P1). ADR-0023/24/27 + DEC-009/10/11 frontmatter YAML parse 실패 (L2-A)

Claude L2-A 는 `bun run invariant:check` 실측 후 6 file 의 frontmatter YAML parse 실패 정확히 발견 + js-yaml 직접 진단으로 root cause (unquoted scalar 안 `:`) 정확 isolate. 결과: ADR-0023 INV-0023-1~8 + INV-0024-* + INV-0027-3/5 가 invariant validator 의 effective_invariant_policy.yaml 에 **0건 등록** 확인.

GPT review 는 이 영역 미커버. invariant validator 자체를 동작 검증하지 않음.

#### B.2.3 (P1). effective_invariant_policy.yaml superseded INV 살아남음 (L2-B)

Claude L2-B 는 validator regen 실측 후 ADR-0006 / ADR-0008 / ADR-0011 (모두 superseded) 의 INV 가 active 로 emit 됨 발견. GPT 미커버.

#### B.2.4 (P2 multiple). validator / glossary / cross-doc invariant tracking 영역

Claude L2 (14 finding) + L3-M (glossary 누락) 가 GPT 의 P1-3 (categories.yaml) 보다 systemic. relation_enum.yaml 의 20 invalid relation 사용 발견 (L2-C) / `--write-warnings` mode 미구현 (L2-D) / docs/_generated/ cold clone 부재 (L2-E) / supersede chain 양방향 미검증 (L2-F) / 50+ term glossary anchor 부재 (L2-H) / term_effects[] empty 가 정상 처럼 운영 (L2-I) — 모두 GPT review 미커버.

#### B.2.5 (P2). DEC-019 5 hardening lock cross-cutting (L11)

Claude L11 (concurrency) 의 19 finding 이 Q-037~Q-041 → DEC-019 lock 의 5 hardening item (apoc.lock multi-reviewer / worker_id CAS / chunked streaming / migration framework / millis-bearing CHECK) 을 systematic 분석. GPT review 는 DEC-019 specific lock 자체를 모르고 진행 — 일부 item (PR-3 typed missing Source / PR-6 audit DB enum) 만 reverse-engineered.

### B.3. 동일 finding 의 표현 차이

GPT 의 P1-2 (Source Registry 필드 persist 부재) ↔ Claude L4-L (seed enum runtime validation) + L3-M (glossary 누락) → **GPT 표현이 더 명확** (canonical store 측면).

GPT 의 P1-1 (Source bootstrap Neo4j 부재) ↔ Claude L4-G (Neo4j Source.raw_cloud_policy property comment vs SET) → **GPT 가 systemic workflow gap 으로 더 명확**.

GPT 의 P1-8 (current-state stale) ↔ Claude L1-A (current-state line 38/184-189/248 stale) → **동일, Claude 가 line 번호까지 명시**.

GPT 의 P2-30 (e2e operator flow test 부족) ↔ Claude L8-D (AC-023 test 부재 + P0-M2 게이트 검증 단계 진입 self-mismatch) → **angle 다름 — Claude 가 AC 매핑 angle, GPT 가 operator workflow angle**.

### B.4. 두 review 의 commensurability

| 영역 | Claude (12 layer, 208 finding) | GPT (4 부, ~80 finding) | 보강 관계 |
|---|---|---|---|
| Documentation governance | L1×16 강함 (line 번호까지) | P1-7~10 부분 cover | Claude superset |
| Cross-doc invariant validator | L2×14 systemic (실측 36 warnings + 81 infos) | 미커버 | Claude unique |
| Domain model & schema | L3×17 강함 | P1-9 (HLD) 보강 | GPT 가 HLD 측면 cover |
| Storage seam (R2 / audit / 2-store) | L4×15 표면 OK 단 **L4-F miss critical** | P0-1 (R2 archive_policy gap) | **GPT critical fix** |
| Discovery pipeline | L5×20 강함 | P2-4~12 추가 18 finding | GPT 가 운영 angle 보강 |
| Audit / ops / feedback | L6×19 강함 | P2-22~27 추가 | GPT 보강 |
| Migrations + idempotency | L7×18 강함 | P1-4 (dry-run 착시) 보강 | GPT P1 보강 |
| Test coverage | L8×18 강함 | P2-30~31 보강 | GPT 가 e2e angle |
| CI/CD + supply chain | L9×16 강함 + GH API 실측 | P1-10 부분 cover | Claude superset (단 P0 main protection 은 unique) |
| Security & adversarial surface | L10×17 (집중 패스) | 3부 법적/정책 보강 | 같은 영역 |
| Concurrency & failure modes | L11×19 systemic (DEC-019 5 hardening) | 일부 reverse-engineered | Claude superset |
| 1인 운영자 sustainability | L12×19 통합 권고 | 3부 다층 관점 + 4부 gate | **GPT 가 product/data/content angle 강함** |
| 제품 방향성 / 데이터 품질 / 콘텐츠 viability | (얕음) | 3부 systemic | **GPT unique** |
| 운영자 UX / operator-facing observability | L12 일부 | 3부 + 2부 systemic | **GPT superset** |

**결론**: 두 review 가 commensurable 하지 않음. Claude review = governance/invariant/code/test angle 의 systemic snapshot. GPT review = product viability / operator UX / data quality / cross-source policy semantic angle 의 systemic snapshot. **양쪽이 서로의 blind spot 을 cover**. 종합 필요.

### B.5. GPT review 의 한계 / 비판

#### B.5.1. GPT 의 일부 P2 가 v0 single-operator scope 에서는 over-engineering 의심

- P2-4 / P2-5 (daily cap run당 cap) — v0 단일 cron + 단일 운영자 manual 재실행 빈도 낮음
- P2-9 URL canonicalization — v0 source 72 + RSS 기반 + 일부 source 가 query param 을 article identity 로 사용 — 본격 도입은 Tier B/C/D 확장 시점
- P2-12 User-Agent contact 정보 — operator privacy 측 trade-off. v0 single-operator 가 public contact 노출 결정 보류 가능

이들은 P3 또는 Tier B/C/D 확장 시 P2 로 승격이 더 적절.

#### B.5.2. GPT 의 PR-5 (runtime invariant scanner) 의 scope 명확화 필요

GPT 의 PR-5 권고 = R2 / Snapshot / Audit consistency 5 check. 좋은 방향. 단:
- Claude L2-J (cross_ref_code[] validator extension, INFRA-1A.9-validator-extension) 의 doc-side invariant scanner 와 **별도 도구인지 통합 도구인지** 명확화 필요
- TS validator (governance) + Ruby check (doc lint) + 신규 Runtime scanner (R2/Snapshot/Audit consistency) = 3 도구 — 각 분담 명시 의무 (Claude L9-O 와 동일 영역)

#### B.5.3. GPT 의 PR-7 (migration validation + docs/CI sync) 가 너무 큼

PR-7 안에:
- migrate --dry-run 분리 (`migrate:plan` / `migrate:sqlite:validate` / `migrate:neo4j:validate`)
- CI temp SQLite apply
- TESTING test count fix
- RUNTIME / OPERATIONS 갱신
- L9-A main branch protection 결정 (Claude unique)
- L1-A current-state stale (Claude L1-A)
- ADR-0023/24/27 + DEC-009/10/11 frontmatter parse fix (Claude L2-A)

→ 3~4 sub-PR 로 분리 권고:
- PR-7a: ADR/DEC frontmatter parse fix + invariant validator hardening (L2-A + L2-B)
- PR-7b: migration validation (`migrate:plan` / `migrate:validate`)
- PR-7c: docs sync (current-state / IMPL_PLAN / DATA_MODEL / TESTING / HLD)
- PR-7d: main branch protection 결정 + admin task (Claude L9-A)

#### B.5.4. GPT 의 3부 "Weekly Scenario Watch" 권고가 DEC-005 / DEC-009 / DEC-011 lock 과 충돌

GPT 가 첫 publishable format 으로 "Weekly Scenario Watch" 추천. 그러나 본 repo 는 이미 **DEC-005 (v0 turn-key publish scope = blog_long only) + DEC-009 (v0 첫 발행 = 경제) + DEC-011 (sub-topic = 한국 부동산 폭락 시나리오)** lock 상태. PUB-1A.5 가 single publication MVP.

→ 두 가지 path:
- (a) DEC-005/009/011 유지 → GPT format 권고는 v1+ phase 로 deferred
- (b) DEC-005/009/011 reflow → 신규 DEC (Weekly Scenario Watch) 발급 후 PUB-1A.5 scope 변경

**운영자 결정 항목**. 본 종합에서는 (a) default 권고 (lock 유지 + format reflow 는 별도 의사결정).

#### B.5.5. GPT 의 3부 dataset ingestion MVP 권고 가 ADR-0024 timing 과 충돌

GPT "M3 이전에 dataset ingestion MVP 권고". 그러나 EXTR-1A.5 (Data Science Module, ADR-0024) 가 P0-M3 안에 lock. ADR-0024 stack lock (Polars + DuckDB + statsmodels + scipy) 도 lock 됨. GPT 권고 = 본질적으로 "EXTR-1A.5 우선순위 상향" — slice priority 결정 (slice 표 reorder 의무).

→ 운영자 결정 항목.

### B.6. Claude review 의 한계 / 비판 (self)

GPT review 와 비교해서 Claude review 의 본질적 weakness:

#### B.6.1. Cross-source policy semantic miss (L4-F → P0)

L4-F 가 raw_cloud_policy 만 검증하는 cross-store query 의 **archive_policy 누락** 못 본 것이 가장 큰 single miss. 함수명 "AllowRawCloud" 에 안주. 실제 invariant "R2-backed Snapshot 의 모든 linked source 가 둘 다 만족" 의 dual conjunct 분리 검토 필요했음.

#### B.6.2. Product / data quality / content viability angle 부재

L12 sustainability 는 attention budget 측면만 다룸. GPT 3부 의 "insight engine vs evidence substrate", "RSS only 부족", "claim bloat / source bias / legal fear / doc drift / output UX" 5 failure scenarios, "thesis memory 잠재력" 같은 angle 이 본질적으로 빠짐. Claude review 가 narrow technical/governance lens.

#### B.6.3. Operator UX angle 약함

Claude L12 가 일부 cover 하지만 GPT 의 unified CLI namespace 권고 + next-action UX + observability angle 이 더 systemic.

#### B.6.4. 12 layer × 7 perspective × 5 stage matrix 가 too granular

208 finding 누적이 **review 자체가 1인 운영자 capacity 초과** (Claude L12-H 의 self-recognition 그대로). GPT 의 4 부 80 finding + 8 PR 권고 가 더 actionable.

### B.7. 종합

**두 review 의 합리적 종합**:

1. **GPT P0 (R2 archive_policy guard) 즉시 수용** — Claude L4-F 자아비판.
2. **GPT Latent P1 (chunker policy gate) 즉시 수용** — Claude L3/L5/L6 chunker analysis 보강.
3. **GPT P1-1 (Source bootstrap), P1-4 (migrate dry-run 착시), P1-5 (upload_attempt_id), P1-6 (DB enum), P1-9 (HLD)** 모두 수용 + Claude L9-A main protection (Claude unique P0) 와 함께 fix queue.
4. **GPT 4부 PR-1 ~ PR-5 권고 sequence 수용** (PR-1 R2 archive_policy → PR-2 Source bootstrap → PR-3 queue CLI → PR-4 chunker policy → PR-5 runtime invariant scanner) — 단 PR-0 으로 **L9-A main branch protection 결정** 선행. PR-7 은 3~4 sub-PR 로 분리.
5. **GPT 3부 다층 관점** (제품 / 데이터 / 콘텐츠 / 운영 / 법적 / 테스트 / 문서 / failure scenarios) 가 Claude L12 보강 — 별도 action item 으로 promote:
   - 첫 publishable format 결정 (Weekly Scenario Watch vs blog_long 단일) → 신규 Q
   - Dataset ingestion MVP timing (M3 이전 vs ADR-0024 lock 유지) → 신규 Q
   - Source profile canonicalization 방향 (Neo4j projection vs SQLite source_profile table) → 신규 Q
6. **Claude L1~L11 의 systemic finding 중 GPT 미커버 영역** (ADR/DEC frontmatter parse fail / 50+ glossary term 누락 / DEC-019 5 hardening lock / validator integrity 14 finding / GH API main protection 실측) 은 별도 batch 로 P2 doc drift fix slice 안에 묶음.

Action items 본격 정리는 [`2026-05-15-action-items.md`](2026-05-15-action-items.md) 참조.
