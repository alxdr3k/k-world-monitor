# 06 Acceptance Tests

요구사항이 만족되었는지 검증하는 기준.

Implementation status는 `04_IMPLEMENTATION_PLAN.md`가 관리한다. 이 문서는
gate / acceptance 상태만 관리한다.

## AC Format

각 AC는 다음 형태를 권장:

```text
Given <초기 상태>
When  <행동>
Then  <기대 결과>
```

## Criteria

| ID | REQ/NFR | 시나리오 | 검증 방법 | Status |
|---|---|---|---|---|
| AC-001 | REQ-001 | Given … When … Then … | manual / automated TEST-001 | defined |

## Status vocabulary

| Status | Meaning |
|---|---|
| `defined` | 기준은 정의됐지만 아직 실행하지 않음 |
| `not_run` | 실행 대상이지만 아직 실행하지 않음 |
| `passing` | 통과 |
| `failing` | 실패 |
| `waived` | 명시적 사유로 면제 |

`pending`처럼 모호한 상태는 쓰지 않는다. 기능이 구현되지 않은 상태인지,
staging / manual acceptance가 아직 실행되지 않은 상태인지 분리한다.

## Tests (자동화된 경우)

| ID | 이름 | 위치 | 커버하는 AC |
|---|---|---|---|
| TEST-001 |  | `tests/...` | AC-001 |

## CI/CD gates

CI/CD checks count as acceptance evidence only when they verify a named
requirement, non-functional requirement, release gate, or operational gate.

| Gate | Environment | Verified by | Required? | Notes |
|---|---|---|---|---|
| PR validation | CI | TEST-### / workflow job | yes / no |  |
| MVP hands-on | realistic environment | target user / manual / TEST-### | yes / no | Core workflow end-to-end |
| Staging smoke | staging | TEST-### / manual | yes / no |  |
| Production smoke | production | TEST-### / manual | yes / no |  |
| Rollback validation | staging / production | TEST-### / runbook drill | yes / no |  |

## Definition of Done

프로젝트 level DoD:

- 모든 `must` REQ의 AC가 `passing`
- 모든 required gate가 `passing` 또는 명시적으로 `waived`
- 모든 NFR이 측정 가능한 방식으로 검증됨
- 주요 운영 시나리오가 Runbook에 문서화
- required CI/CD gates are passing or explicitly waived
- Traceability matrix가 최신

## Notes

- AC가 없는 REQ는 verify 불가 → PRD로 돌려보냄.
- 실패 시 회귀 방지를 위해 TEST로 승격.
