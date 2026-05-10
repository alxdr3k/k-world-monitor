# 05 Runbook

운영 절차 모음. "장애/배포/데이터 작업을 어떻게 처리하는가"를 담는다.

## How to Deploy

If no deployment path exists, write "No deployment pipeline currently defined."

- Deployment owner:
- Target environments:
- Release source: commit SHA / tag / image digest / package version / other
- Required pre-deploy gates:
- Approval path:

```bash
# 단계별 커맨드
```

- 사전 조건:
- Smoke test:
- Monitoring check:
- 롤백 방법:
- Release record / annotation:

## How to Roll Back

If rollback is not defined yet, write "Rollback procedure not currently defined."

- Trigger:
- Owner:
- Last-known-good artifact:
- Command / platform action:
- Data rollback / forward-fix rule:
- Verification after rollback:

## CI/CD Failures

### CI required check failure

- Detection:
- Triage:
- Fix / waiver policy:
- Related: TEST-### / AC-###

### Deployment failure before traffic change

- Detection:
- Mitigation:
- Retry rule:
- Related: AC-### / NFR-###

### Smoke failure after deployment

- Detection:
- Mitigation:
- Rollback / roll-forward:
- Related: AC-### / NFR-###

## How to Monitor

- 대시보드:
- 주요 알림:
- SLO/SLA:

## Common Incidents

### Incident: <이름>

- Symptom:
- Detection:
- Mitigation:
- Root-cause investigation:
- Related: AC-### / NFR-###

### Incident: ...

## Data Operations

- 백업:
- 복구:
- 마이그레이션 체크리스트:

## Rotations / On-call

- 담당:
- Escalation path:

## Change Log

| 날짜 | 변경 | By |
|---|---|---|
|  |  |  |
