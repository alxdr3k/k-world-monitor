# 05 Runbook

운영 절차 모음. "장애/배포/데이터 작업을 어떻게 처리하는가"를 담는다.

> **Coverage status (2026-05-14)**: P0-M1 / P0-M2 운영 절차는 본 문서에 채워져
> 있다 (Doppler integration / Data Operations 백업·R2 lifecycle / pre-deploy
> schema migration contract / discovery 운영 etc). P0-M3 (Extraction / Review
> queue / cost throttling worker) ~ P0-M6 (Publishing pipeline) milestone 의
> 일부 절차는 해당 슬라이스 landing 시점에 추가. 새 운영 절차는 해당 슬라이스
> 의 PR 안에서 본 문서에 함께 commit.

### Defined sections

- How to Deploy / Doppler integration (DEC-020 Q-047, 이번 milestone 활성)
- Publishing Site Deployment (ADR-0022 / Cloudflare Pages — P0-M6 진입 직전)
- Data Operations (백업 / R2 lifecycle / retention batch / soft-delete /
  RETENTION_PROTECTED_KINDS — INFRA-1A.8 landed)
- Pre-deploy schema migration contract (DEC-019 Q-040 — P1-MVP-prep entry)

### Pending sections (slice landing 시 채움)

- Publish pipeline runbook (PUB-1A.1 ~ PUB-1A.5 진입 시)
- Extraction / Review queue runbook (EXTR-1A.1 ~ EXTR-1A.6 진입 시)
- Cost throttling worker runbook (OPS-1A.2 진입 시)
- Metrics framework + evaluation harness runbook (OPS-1A.3 ~ 1A.4 진입 시)
- Stale worker runbook (OPS-1B.1 진입 시)

## How to Deploy

이 프로젝트는 단일 운영자 환경의 CLI 우선 도구 + **자체 사이트(Astro 5.0
+ Cloudflare Pages, ADR-0022)** 의 hybrid 배포다.

- CLI: `bun build` → 단일 실행 파일 (로컬 설치 + cron / launchd worker
  등록 — Discovery, Fetcher, Extractor, Stale Worker, retention batch 3
  cadence)
- 인프라 키 보관 (P0-M2 milestone 진입 시점 정의, ADR-0023 / DEC-010
  multi-vendor 라우팅에 따른 발급 의무):
  - **OpenAI API key** (default LLM vendor, GPT-5 nano/mini/standard/
    extended thinking — Tier 0~3 default) — **required**
  - **Anthropic API key** (Claude Haiku 4.5 / Sonnet 4.6 / Opus 4.7 xhigh
    — cross-vendor reviewer + 도메인 override) — **required**
  - **Google AI Studio API key** (Gemini 2.5 Flash — 탐색 grounding +
    Tier 3 비용효율 fallback) — optional (v0 진입 시 발급 권고)
  - Cloudflare R2 (S3 compatible, permitted artifact 저장) — required
  - Cloudflare Pages project (자체 사이트 호스팅) — required
  - Neo4j credential (Community Edition self-host) — required
  - **Secret store: Doppler** (DEC-020 Q-047 resolution, 2026-05-13) — 4종
    API key (OpenAI / Anthropic / Google / R2) 일괄 관리. 운영 절차는 본
    문서 "Doppler integration" 섹션 참조.
  - 2026-05-11 status: OpenAI / Anthropic / Google AI Studio 모두 발급
    완료 (current-state.md "External services / credentials" 섹션).
    Doppler 등록은 PUB-1A.5 entry condition.

### Doppler integration (DEC-020 Q-047 resolution)

운영 환경: Doppler CLI / SDK 가 4종 API key + R2 credential 을 단일 secret
store 에서 관리. local dev / GitHub Actions cron / production cron host
모두 동일 setup.

**Project setup** (1회):

1. Doppler 가입 + project 생성 (`k-world-monitor` 이름 권장)
2. config branch: `dev` (local) / `stg` (staging — 본 repo 는 v0 미사용) /
   `prd` (production cron host).
3. secret 등록 (`dev` config 기준 — `prd` 도 동일 key 명).
   변수명은 runtime 코드 (`src/storage/r2/client.ts`,
   `src/storage/neo4j/connection.ts`) 가 읽는 이름과 정확히 일치해야 함
   — mismatch 시 runtime 초기화 실패 (PR #32 Codex P1 review,
   2026-05-13):
   - `OPENAI_API_KEY`
   - `ANTHROPIC_API_KEY`
   - `GOOGLE_AI_API_KEY`
   - `S3_ENDPOINT` (full S3 endpoint URL. 예: https://<accountid>.r2.cloudflarestorage.com, custom domain, 또는 S3-compatible mock)
   - `S3_ACCESS_KEY` (R2 access key ID)
   - `S3_SECRET_KEY` (R2 secret access key)
   - `S3_BUCKET` (R2 bucket name)
   - `NEO4J_URI` (예: bolt://localhost:7687)
   - `NEO4J_USER` (driver username — code reads `NEO4J_USER`, not `NEO4J_USERNAME`)
   - `NEO4J_PASSWORD` (self-host bolt)
   - 선택: `NEO4J_DATABASE` / `NEO4J_MAX_POOL_SIZE` / `NEO4J_ACQ_TIMEOUT_MS`
4. service token 발급 (`prd` 용 → cron host 에 등록).

**Local dev**:

```bash
doppler login                          # one-time auth
doppler setup --project k-world-monitor --config dev
doppler run -- bun run discovery:run   # secret 자동 주입
doppler run -- bun test
```

**GitHub Actions cron**:

`DOPPLER_TOKEN` 을 repository secret 으로 등록 (Doppler `prd` config 의
service token). Workflow 안에서:

```yaml
- name: Setup Doppler
  uses: dopplerhq/cli-action@v3
- name: Run discovery
  run: doppler run -- bun run discovery:run
  env:
    DOPPLER_TOKEN: ${{ secrets.DOPPLER_TOKEN }}
```

**Token rotation**:

- API key rotation: vendor console (OpenAI / Anthropic / Google / Cloudflare)
  에서 새 key 발급 → Doppler `prd` config 에서 갱신 → cron host /
  GitHub Actions 자동 picked up (next run).
- Doppler service token rotation: 분기별 / leak 의심 시 rotate. repository
  secret + cron host 모두 갱신.

**`.env` fallback** (Doppler 미사용 환경 — debugging 또는 신규 운영자):

`.env.example` 파일이 6개 변수명 reference. Doppler 가 없으면 `.env` 직접
작성 후 `bun --env-file=.env run ...`. `.gitignore` 에 `.env` 포함 의무.

- Deployment owner: 운영자(user)
- Target environments: local (CLI + Neo4j self-host) + Cloudflare Pages
  (자체 사이트)
- Release source: commit SHA on main / publishing branch
- Required pre-deploy gates: invariant-check (warning), tests (P0-M3 이후),
  Astro Content Collection + Zod schema build (PUB-1A.4 이후, ADR-0022
  INV-0022-3)
- Approval path: 단일 운영자 self-approve

### Publishing Site Deployment (자체 사이트, ADR-0022)

| 항목 | 값 |
|---|---|
| Trigger | git push to main / publishing branch (DEC-006) |
| Platform | Cloudflare Pages (free tier — 월 500 build, 100GB bandwidth) |
| Build source | `vault/publications/**` (single source, ADR-0022 INV-0022-1) + Astro site files (`site/**`, `astro.config.*`, `src/content.config.*`, `package.json`) |
| Build watch paths (precondition) | **include**: `site/**`, `vault/publications/**`, `package.json`, `astro.config.*`, `src/content.config.*`. **exclude**: `vault/dossiers/**`, `vault/scenarios/**`, `vault/theses/**`, `vault/content_drafts/**`, `vault/promoted_claims/**`, `vault/documents/**`, `docs/**`. 미설정 시 모든 push가 build trigger (DEC-006 precondition) |
| Build gate | Astro Content Collection + Zod schema (status / cite_refs[] / correction_ledger[] / format / **editorial_intent_id (ADR-0025) / editorial_quality_rubric_passed (DEC-012)**) — invalid status / dead-link cite_refs / dead-link editorial_intent_id / editorial_quality_rubric_passed = false 또는 missing 시 **build fail** (ADR-0022 INV-0022-3 + ADR-0025 + DEC-012, **AC-035**) |
| Build failure behavior | 이전 successful deploy 가 live 유지 (Cloudflare Pages 기본). 운영자가 Pages build log 확인 |
| Correction / retraction update | ContentDraft frontmatter `status` (live → corrected → retracted) + `correction_ledger[]` append → git commit → push → Pages auto build → `<RetractionBanner/>` + `<CorrectionLedger/>` 컴포넌트가 visible 렌더 (ADR-0022 INV-0022-7) |
| Cross-post lint (NFR-010 / AC-034) | 외부 플랫폼(Substack / YouTube / X) 게시물의 cite footnote 가 자체 사이트 canonical URL 만 가리키도록 검증. v0 manual, v1+ auto (Q-033) |
| Approval path | 단일 운영자 self-approve (자동 publish 자동화는 PRD Out-of-scope) |

## How to Roll Back

코드 도입 단계에 따라 단계별 정의:

### Publishing site rollback (자체 사이트, PUB-1A.4 이후)

- **Trigger**: 잘못 발행된 publication 또는 build fail 후 이전 상태 복원
  필요 시
- **Method 1 — git revert**: 잘못된 publication commit revert (예 `git
  revert <bad_sha>` → push → Cloudflare Pages 가 이전 상태로 자동 재배포)
- **Method 2 — Cloudflare Pages Rollback UI**: Pages dashboard에서 이전
  successful deploy 를 production으로 promote (수 초 내 적용)
- **Method 3 — correction approach (preferred for soft fix)**: 잘못된
  ContentDraft frontmatter `status: live → corrected` + `correction_
  ledger[]` append → push (retraction이 아닌 visible 정정)
- **Verification after rollback**: 자체 사이트 publication URL 접근 +
  cite footnote anchor 유효성 확인 + cross-post 외부 플랫폼 URL anchor
  정합성 확인 (AC-034)
- **Owner**: 운영자(user)
- **Last-known-good artifact**: 이전 successful Cloudflare Pages deploy
  (Pages history UI)

### Data rollback (DEC-007, OPS-1A.4 이후)

- SQLite snapshot 일간 R2 backup (90d retention) + Neo4j dump 일간 R2
  backup (30d retention) — 의도하지 않은 batch GC 또는 mutation 발생 시
  복원
- 마이그레이션 down 스크립트 의무 (INFRA-1A.2 slice)
- soft-delete → tombstone(14d grace) → hard-delete 2단계 — 14d 안에서는
  tombstone 복구 가능

P0-M1 INFRA-1A.2 slice에 SQLite 백업 commit, INFRA-1A.3 slice에 R2 버킷
정책 commit, INFRA-1A.8 slice에 backup runbook + RETENTION_PROTECTED_KINDS
상수 commit 예정.

- Trigger: 잘못된 batch GC 발생, 의도하지 않은 schema migration, 자체
  사이트 잘못 발행
- Owner: 운영자(user)
- Last-known-good artifact: R2 backup (Neo4j dump 30d / SQLite snapshot
  90d / JSONL audit 1y), Cloudflare Pages 이전 deploy
- Data rollback rule: tombstone 14d grace 안에서 복원 우선, grace 초과 시
  Neo4j/SQLite backup 복원

## CI/CD Failures

### CI required check failure

- Detection: GitHub Actions invariant-check job (warning level only)
- Triage: 워닝은 머지 차단 안 함 (ADR-0002 INV-0002-1). 그러나 `unresolved_warnings`
  가 누적되면 다음 작업 시작 전 정리.
- Fix / waiver policy: 워닝은 frontmatter `unresolved_warnings`에 누적, 다음
  foreground 작업에서 `bun run invariant:write`로 처리. waiver는 invariant 자체를
  challenge하는 ADR로만 가능.
- Related: TEST-### / AC-### (코드 도입 후 매핑)

### Deployment failure before traffic change

- Detection: Not currently defined.
- Mitigation: 단일 운영자, local CLI — 배포 실패는 단순 재실행
- Retry rule: TBD
- Related: TBD

### Smoke failure after deployment

- Detection: Not currently defined.
- Mitigation: TBD
- Rollback / roll-forward: TBD
- Related: TBD

## How to Monitor

코드 도입 후 정의. 현재는 doc invariant validator만 실행 가능.

- 대시보드: TBD (Run Ledger 기반 일일 cost / token / latency 요약 — OPS-1A.1
  slice)
- 주요 알림: TBD
- SLO/SLA: NFR-001 (검색 < 1s p95), NFR-004 (cost 일별 상한) — 코드 도입 후
  측정 시작

## Common Incidents

### Incident: cite cascade가 잘못 트리거됨

- Symptom: Publication state가 corrected로 잘못 전이
- Detection: publication_table.correction_ledger의 entry가 의도되지 않음
- Mitigation: 잘못된 cascade 트리거 트레이스 (edge_id + run_id로 역추적), 잘못
  된 edge가 있으면 무효화 entry 추가
- Root-cause investigation: cite check 5종 중 어느 것이 false positive 냈는지
  특정. ADR-0008 spec 위반 여부 확인.
- Related: AC-013, AC-016, ADR-0008, ADR-0010

### Incident: LLM cost 일별 상한 초과

- Symptom: NFR-004 위반, 일일 비용 알람
- Detection: Run Ledger 일일 합산이 상한 초과 (OPS-1A.2 throttling worker)
- Mitigation: throttling worker가 큐에 backoff. 새 batch 등록 일시 중단.
- Root-cause investigation: 어느 model / batch_id / source type 이 spike를
  냈는지 run ledger group by
- Related: AC-019, ADR-0006

### Incident: SQLite single-writer lock contention

- Symptom: extractor / fetcher / stale worker 동시 실행 시 lock 대기
- Detection: 비정상적 latency 증가, sqlite busy 에러
- Mitigation: 단일 운영자 환경에서는 worker를 직렬 실행 (cron 시퀀스). 동시
  실행 필요 시 ADR-0004 supersede로 alternative 검토.
- Root-cause investigation: SQLite WAL 모드 설정 확인, busy_timeout 조정 검토
- Related: ADR-0004 ("부정 / trade-off" 항목)

## Data Operations

> 이 섹션의 backup schedule, R2 lifecycle rule, retention 정책은
> **DEC-007** (2026-05-11 accepted) + `docs/research/retention-policy-2026-05.md` 로 lock됨.
> 실제 backup/GC job 구현은 OPS-1A.1 (daily/weekly/monthly retention batch) + OPS-1A.4 (raw_cache TTL worker) slice.

### Backup Schedule

| 항목 | 주기 | 대상 | R2 prefix | 보존 |
|---|---|---|---|---|
| Neo4j full dump | 일간 | graph store 전체 (`neo4j-admin dump`) | `backups/neo4j/YYYY-MM-DD.dump` | **30일** (R2 expire rule) |
| SQLite snapshot | 일간 | `research.db` 파일 copy | `backups/sqlite/YYYY-MM-DD.db` | **90일** (R2 expire rule) |
| JSONL audit export | 월간 (월말) | `jsonl_audit_export_r2` — 당월 전체 | `audit/jsonl/YYYY-MM.jsonl.gz` | IA transition 365일 후 → **무기한** (expire 절대 없음) |

### R2 Lifecycle Rules

**Expire rule (3개만, 나이 기반 자동 삭제):**

| prefix | rule | 기간 |
|---|---|---|
| `backups/neo4j/` | expire | 30일 |
| `backups/sqlite/` | expire | 90일 |
| `tmp/multipart/` | abort incomplete multipart | 7일 |

**Transition rule (6개, expire 절대 없음 — cold-ish storage only):**

| prefix | rule | 기간 |
|---|---|---|
| `audit/jsonl/` | → IA | 365일 |
| `permitted_artifact/dataset/` | → IA | 30일 (EOL 시 batch가 archive prefix로 copy 후 delete) |
| `permitted_artifact/derived/snapshot/` | → IA | 365일 |
| `permitted_artifact/derived/dossier/` | → IA | 365일 |
| `permitted_artifact/derived/publication/` | → IA | 730일 (**expire 없음 — 항상 보존**) |
| `permitted_artifact/evidence-pack/` | → IA | 365일 |

### Retention Batch Jobs (application-layer semantic GC)

R2 native lifecycle은 나이 기반 expire/transition 9개만 처리. 의미적 GC(retraction/supersede/dedupe/EOL/cited-lock)는 모두 application batch:

| cadence | job | 주요 대상 |
|---|---|---|
| 일간 `retention_daily` | raw_cache_items TTL evict, research_session GC (30일 after closed_at), tmp computation purge | raw_cache_items, research_session |
| 주간 `retention_weekly` | Snapshot supersede collapse (1년 grace + cited 보호), content_hash dedupe canonical, Scenario/Thesis revision collapse (head + recent 5 보존) | Snapshot, revision ledger |
| 월간 `retention_monthly` | dataset_vintage EOL (12개월 grace), metrics rollup, **JSONL audit export**, publication 정정 cascade integrity check, tombstone GC report | dataset_vintage, derived metrics, JSONL audit |

### RETENTION_PROTECTED_KINDS 상수

GC batch job이 절대 삭제해서는 안 되는 항목 (DEC-007 term_effects lock):

```
publication_node               — Publication 노드
derived_publication_r2         — permitted_artifact/derived/publication/{id}/ R2 객체
access_intervention_ledger     — AccessIntervention ledger 전체
policy_decisions_sqlite        — policy_decisions SQLite rows 전체
jsonl_audit_export_r2          — audit/jsonl/ R2 객체 전체
claim_retracted_tombstone      — retracted Claim의 Tombstone 노드
cited_snapshot_locked          — Publication에 cited된 Snapshot (cited flag)
dataset_vintage_metadata       — dataset_vintage row metadata
tombstone_node                 — Tombstone 노드 전체 (14일 grace 대기 중)
```

### Soft-Delete → Tombstone → Hard-Delete 2단계 패턴

모든 delete 연산은 2단계로 처리:

1. **soft-delete**: 대상 노드/row에 `deleted_at`, `delete_reason` 마킹
2. **tombstone (14일 grace)**: `:Tombstone` 노드 생성 (Neo4j) 또는 tombstone row insert (SQLite). `policy_decisions` row 1개 발행 (reason + evidence-pointer)
3. **hard-delete**: 14일 경과 후 다음 `retention_daily` 실행 시 실제 삭제. `policy_decisions` row에 `completed_at` 기록

RETENTION_PROTECTED_KINDS 항목은 tombstone 생성 단계에서 batch job이 reject하고 경고를 남긴다.

### 마이그레이션 체크리스트

- 마이그레이션 파일: `migrations/sqlite/v{N}_<title>.sql` (SQLite), `migrations/neo4j/v{N}_<title>.cypher` (Neo4j)
- 적용 전: `bun run migrate:sqlite --dry-run` / `bun run migrate:neo4j --dry-run` 으로 pending 확인
- 적용 중: `bun run migrate` (양쪽 동시), 오류 시 SQLite → WAL checkpoint 후 파일 복구, Neo4j → dump 복구
- 적용 후: `bun test` 통과 확인

### 복구 절차

**Neo4j 복구:**
1. `neo4j stop`
2. R2에서 `backups/neo4j/YYYY-MM-DD.dump` 다운로드
3. `neo4j-admin load --from=<dump> --database=neo4j --force`
4. `neo4j start`
5. `bun run migrate:neo4j` (최신 schema 재적용, idempotent)

**SQLite 복구:**
1. `cp research.db research.db.bak` (현재 파일 보존)
2. R2에서 `backups/sqlite/YYYY-MM-DD.db` 다운로드
3. `bun run migrate:sqlite` (최신 schema 재적용, idempotent)

### 연간 Retention Drill (AC-032)

연 1회, 임의 Publication 1건 선택 후 5+1 trace (Claim × N → Snapshot → Source; Dossier; Scenario × revision; Thesis; EditorialIntent) 전부 reachable 검증. fail → retention batch 정책 재검토 + DEC-007 supersede 검토.

## Pre-deploy schema migration contract (v0)

본 repo 는 P0-M6 turn-key MVP gate 이전 까지 다음 운영 contract 를 따른다
(DEC-019 / Q-040 lock, 2026-05-13):

### Scope

- 적용 시점: P0-M6(MVP gate) accept 이전, 또는 P1-MVP-prep milestone
  (DEPLOY-1A.1 슬라이스) 안정화 이전 — 즉 production deploy 직전 까지.
- 적용 대상: SQLite (`migrations/sqlite/`), Neo4j (`migrations/neo4j/`)
  모든 schema 파일.

### Contract

- **base schema 파일 (v1, v2, ... v6) 은 in-place 재작성 가능**. forward
  ALTER migration 추가 의무 없음.
- **`research.db` 는 schema 변경마다 wipe 후 재생성 가정**. 운영자가
  `bun run migrate:sqlite` 전 `rm research.db` 실행하는 것이 default
  upgrade path.
- **production data 가 존재하지 않는다는 전제**: 회고 / 검토 단계에서 모든
  `discovery_queue`, `crawl_state`, `raw_cache_items` row 는 drop
  acceptable.
- **Codex 등 자동 리뷰어가 "preexisting v6 DB 업그레이드", "in-place ALTER",
  "backfill scripts", "ADD COLUMN migration 누락" 등을 지적할 경우** — 본
  contract 를 인용한 PR comment 로 응답하고 코드 수정 없이 진행한다 (PR
  #26 / #28 / #30 의 실제 사례 참조).

### Trigger to switch contracts

다음 중 하나라도 만족하면 본 contract 종료, `P1-MVP-prep` /
`DEPLOY-1A.1` 슬라이스로 전환:

1. P0-M6 (PUB-1A.5) turn-key MVP gate accept
2. 첫 production deploy candidate 빌드
3. 운영자가 명시적으로 contract 종료 선언 (예: 본 RUNBOOK 의 Change Log
   에 "schema freeze date" 기록)

### Post-deploy contract (참고 — DEPLOY-1A.1 슬라이스에서 implement)

- 마지막 wipe-and-reseed 시점 stamp (`schema_migrations` 에 freeze 마커
  row 추가)
- 이후 모든 schema 변경은 forward ALTER migration 으로만
- backfill scripts 위치: `migrations/sqlite/backfill/<NN>_<purpose>.sql`
  네이밍 컨벤션 (DEC-019)
- migration runner rollback 지원 (BEGIN/ROLLBACK envelope 은 이미 적용됨)
- schema drift CI check

### Reference

- DEC-019 — 본 contract 채택 결정
- Q-040 — 후속 framework 슬라이스 trigger
- PR #25 retro / PR #26 codex review — 본 contract 가 정당화한 변경 이력

## Rotations / On-call

- 담당: 단일 운영자(user)
- Escalation path: 없음 (1인 운영). 운영자가 부재 시 모든 worker는 정지 상태로
  진입 (cron disable).

## Change Log

| 날짜 | 변경 | By |
|---|---|---|
| 2026-05-11 | Initial runbook scaffold (대부분 TBD, P0-M1 진입 직전) | user / Claude |
| 2026-05-12 | Data Operations 섹션 전면 업데이트 — backup schedule (Neo4j 30d / SQLite 90d / JSONL audit monthly), R2 lifecycle rules (expire 3 + transition 6), retention batch jobs (daily/weekly/monthly), RETENTION_PROTECTED_KINDS 상수, soft-delete 2단계 패턴, 복구 절차, 연간 retention drill (INFRA-1A.8 / DEC-007 / AC-032) | Claude |
| 2026-05-13 | "Pre-deploy schema migration contract" 섹션 추가 — v0 단계 base-schema in-place 재작성 + wipe-and-reseed default upgrade path 명문화. Codex auto-review 가 반복 지적해 온 in-place ALTER / forward migration 요구를 본 contract 로 일괄 처리 (DEC-019 / Q-040 lock) | Claude |
| 2026-05-11 | Publishing Site Deployment 섹션 추가 (ADR-0022 + DEC-006 Build watch paths precondition) + Roll Back 섹션 publishing 우선 명시 (자체 사이트 + data backup) | user / Claude |
