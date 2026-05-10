# 05 Runbook

운영 절차 모음. "장애/배포/데이터 작업을 어떻게 처리하는가"를 담는다.

> 코드가 아직 없으므로 대부분의 절차는 "Not currently defined." 상태다.
> milestone P0-M2 ~ P0-M6 진입 시점마다 해당 절차를 채운다.

## How to Deploy

No deployment pipeline currently defined.

이 프로젝트는 단일 운영자 환경의 CLI 우선 도구다. "deploy"는 다음을 의미하게
될 가능성:

- CLI 빌드 후 로컬 설치 (`bun build` → 단일 실행 파일)
- cron / launchd worker 등록 (Discovery, Fetcher, Stale Worker)
- Cloudflare R2 버킷 + Anthropic API key의 Doppler 등록

P0-M2 milestone 진입 시 위 항목 정의 + 적용.

- Deployment owner: 운영자(user)
- Target environments: local (개발 + 운영 동일)
- Release source: commit SHA on main
- Required pre-deploy gates: invariant-check (warning), tests (P0-M3 이후)
- Approval path: 단일 운영자 self-approve

## How to Roll Back

Rollback procedure not currently defined.

코드 없으므로 현재 rollback 대상은 doc 변경뿐이다. 코드 도입 후 정의할 항목:

- SQLite 백업 정책 (R2 snapshot 백업)
- R2 버킷 versioning + lifecycle 정책
- 마이그레이션 down 스크립트 정책

P0-M1 INFRA-1A.2 slice에 SQLite 백업 정책 commit, INFRA-1A.3 slice에 R2 버킷
정책 commit 예정.

- Trigger: TBD
- Owner: 운영자(user)
- Last-known-good artifact: TBD
- Command / platform action: TBD
- Data rollback / forward-fix rule: TBD
- Verification after rollback: TBD

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
