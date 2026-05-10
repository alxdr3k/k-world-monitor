# 09 Traceability Matrix

Question ↔ Decision ↔ Requirement ↔ Gate/Test ↔ Milestone/Track/Phase/Slice 연결.

## How to use

- 한 줄 = 하나의 trace path.
- 새 결정이 무엇에 영향을 주는지 명확히 남기는 용도.
- 완료 slice와 gate evidence를 연결해 "landed"와 "accepted"의 근거를 남기는 용도.
- Weekly로 누락 없이 채워졌는지 점검.

## Matrix

| TRACE-ID | Question | Decision / ADR | Requirement | Gate / Test | Milestone | Track | Phase | Slice | Notes |
|---|---|---|---|---|---|---|---|---|---|
| TRACE-### | Q-### | DEC-### | REQ-### | AC-### / TEST-### | P#-M# | TRK | TRK-#A | TRK-#A.# |  |
| TRACE-002 |  |  |  |  |  |  |  |  |  |

## Invariants

- 모든 `must` REQ는 최소 한 개의 AC를 가져야 한다.
- 모든 accepted DEC/ADR은 영향받는 REQ/HLD/Runbook을 갖는다.
- 모든 완료 Slice는 적어도 하나의 TRACE row와 연결된다.
- 모든 `accepted` milestone은 gate / test evidence를 갖는다.

## Gaps

현재 누락/불완전한 연결이 있으면 여기에 기록.

- ...
