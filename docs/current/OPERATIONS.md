# Operations

> Last verified against code: n/a (no implementation yet — 2026-05-11)

## Local run

코드가 아직 없다. INFRA-1A.2 slice 진입 시 다음을 commit 예정:

- `bun install` (package.json 도입)
- `bun run migrate` (SQLite 마이그레이션 실행)
- `bun run cli -- <command>` (CLI entrypoint)

## Environment variables

| 변수 | 용도 | 도입 slice |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic SDK | EXTR-1A.2 |
| `R2_ACCESS_KEY_ID` | Cloudflare R2 | INFRA-1A.3 |
| `R2_SECRET_ACCESS_KEY` | Cloudflare R2 | INFRA-1A.3 |
| `R2_BUCKET` | Snapshot bytes 저장 버킷 | INFRA-1A.3 |
| `R2_ENDPOINT` | R2 endpoint URL | INFRA-1A.3 |
| `RESEARCH_DB_PATH` | SQLite 파일 경로 (default `./research.db`) | INFRA-1A.2 |
| `LLM_DAILY_COST_LIMIT_USD` | NFR-004 일별 상한 | OPS-1A.2 |

비밀은 Doppler / OS keychain로 관리 (정책은 INFRA-1A.3 slice에서 RUNBOOK에 추가).

## Database

- Engine: SQLite + FTS5 (system / OS provided)
- File: `./research.db` (single file, 단일 운영자 — single writer)
- Backup: 일일 dump → R2 backup bucket (INFRA-1A.2 slice 도입)
- Migrations: `migrations/<timestamp>_<title>.sql` (INFRA-1A.2 slice 도입)

## Logs / observability

- 현재: stdout만 (코드 없음)
- 계획:
  - 모든 LLM/parser run은 `runs` 테이블 (cost / token / latency)
  - 일일 cost 요약 = `runs` 그룹 by date / model
  - cron worker는 stdout + 일일 요약 (OPS-1A.2 slice)

## Background jobs

- 현재: 없음
- 계획 (INFRA-1B+ 단계):
  - Discovery worker: cron (예: 매일 UTC 00:00)
  - Fetcher: queue 기반, on-demand 또는 cron
  - Extractor batch: cron (예: 매일 UTC 06:00, batch API 호출)
  - Stale Worker: cron (예: 매일 UTC 12:00)

## Deployment

### Environments

| Environment | Purpose | Trigger | Owner | Gate | Rollback / recovery |
|---|---|---|---|---|---|
| local | 단일 운영자 개발 + 운영 동일 | manual | user | invariant-check (warning) | git revert + SQLite 백업 복원 |

> staging / production 환경은 정의되지 않음 (단일 운영자 환경). publish는 외부
> publisher (블로그 / 유튜브)가 책임지며, 이 시스템 자체에는 별도 production
> 환경이 없다. P1 이후 multi-host 운영 검토 시점에 환경 정의 추가.

### CD / release pipeline

No deployment pipeline currently defined.

- CD owner: n/a
- Workflow / platform: n/a (local CLI)
- Release source: main commit SHA (git)
- Artifact identity: commit SHA (코드 도입 후 bun build 산출물 추가)
- Production approval: n/a (단일 운영자 self-approve)
- Post-deploy smoke check: n/a

### Secrets / configuration

- Secret storage: Doppler (계획) 또는 OS keychain
- Rotation owner: 운영자(user)
- Build-time config: n/a (코드 미존재)
- Deploy-time config: 환경 변수 (위 표 참조)

### Rollback / recovery

- Rollback owner: 운영자(user)
- Rollback trigger: 데이터 corruption / 잘못된 마이그레이션 적용
- Rollback command or platform action: 마이그레이션 down 스크립트 + SQLite 백업
  복원 + R2 객체 versioning 활용 (INFRA-1A.2 / INFRA-1A.3 slice에서 정의)
- Data recovery assumptions: R2 객체는 versioning enabled (NFR-006), SQLite는
  일일 백업

## Troubleshooting

- SQLite busy: 단일 worker 직렬 실행 (cron 시퀀스). WAL 모드 + busy_timeout 조정
- R2 4xx: API key / bucket 권한 확인
- Anthropic 5xx: SDK 재시도 + run ledger status=failed 기록
- 일일 cost 상한 초과: OPS-1A.2 throttling worker가 자동 backoff (설계)

---

Rules:

- Include only verified operations.
- If deployment is owned by CI/CD, say so.
- Remove environment rows that do not exist.
- If no deployment pipeline exists, write "No deployment pipeline currently defined."
- Do not invent manual deployment steps.
- Do not document secret values.
- Link detailed step-by-step procedures to `docs/05_RUNBOOK.md`.
