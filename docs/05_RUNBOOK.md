# 05 Runbook

운영 절차 모음. "장애/배포/데이터 작업을 어떻게 처리하는가"를 담는다.

> 코드가 아직 없으므로 대부분의 절차는 "Not currently defined." 상태다.
> milestone P0-M2 ~ P0-M6 진입 시점마다 해당 절차를 채운다.

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
  - Doppler 또는 환경 변수 자체 보관 — 1인 운영자 선택
  - 2026-05-11 status: OpenAI / Anthropic / Google AI Studio 모두 발급
    완료 (current-state.md "External services / credentials" 섹션)

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
| Build gate | Astro Content Collection + Zod schema (status / cite_refs[] / correction_ledger[] / format) — dead-link cite_refs 또는 invalid status 는 **build fail** (ADR-0022 INV-0022-3, **AC-035**) |
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

- 백업: TBD (P0-M1 INFRA-1A.2 / INFRA-1A.3 slice에 SQLite + R2 백업 정책 commit)
  - SQLite: 일일 `research.db` 파일 dump → R2 backup bucket
  - R2 객체: versioning enable, lifecycle 30일 retention 검토
- 복구: TBD
- 마이그레이션 체크리스트: TBD (P0-M1 INFRA-1A.2 slice)
  - 마이그레이션 파일은 `migrations/<timestamp>_<title>.sql`
  - 적용 전 dry-run + 백업
  - down 스크립트 의무

## Rotations / On-call

- 담당: 단일 운영자(user)
- Escalation path: 없음 (1인 운영). 운영자가 부재 시 모든 worker는 정지 상태로
  진입 (cron disable).

## Change Log

| 날짜 | 변경 | By |
|---|---|---|
| 2026-05-11 | Initial runbook scaffold (대부분 TBD, P0-M1 진입 직전) | user / Claude |
| 2026-05-11 | Publishing Site Deployment 섹션 추가 (ADR-0022 + DEC-006 Build watch paths precondition) + Roll Back 섹션 publishing 우선 명시 (자체 사이트 + data backup) | user / Claude |
