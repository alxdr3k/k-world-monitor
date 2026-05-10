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
| TRACE-001 | — | ADR-0003 | REQ-001 | AC-001 / TEST-001 | P0-M1 | INFRA | INFRA-1A | INFRA-1A.1 | 7-stage object model lock |
| TRACE-002 | Q-004 | ADR-0004 | REQ-002, REQ-004 | AC-002, AC-004 / TEST-002, TEST-004 | P0-M1 | INFRA | INFRA-1A | INFRA-1A.2 | SQLite canonical + Markdown promoted only |
| TRACE-003 | — | ADR-0004 | REQ-003 | AC-003, AC-020 / TEST-003, TEST-020 | P0-M1 | INFRA | INFRA-1A | INFRA-1A.3 | R2 bytes + sha256 |
| TRACE-004 | — | ADR-0003 | REQ-005 | AC-005 / TEST-005 | P0-M1 | INFRA | INFRA-1A | INFRA-1A.1 | ID 체계 |
| TRACE-005 | — | ADR-0005 | REQ-006 | AC-006 / TEST-006 | P0-M1 | INFRA | INFRA-1A | INFRA-1A.1 | confidence 분해 |
| TRACE-006 | — | ADR-0008 | REQ-007, NFR-005 | AC-007 / TEST-007 | P0-M3 | EXTR | EXTR-1A | EXTR-1A.2 | evidence quote ≤ 200자 |
| TRACE-007 | — | ADR-0007 | REQ-008 | AC-008 / TEST-008 | P0-M1 | INFRA | INFRA-1A | INFRA-1A.4 | edge ledger / frontmatter 배열 lint |
| TRACE-008 | — | ADR-0006 | REQ-009 | AC-009 / TEST-009 | P0-M3 | EXTR | EXTR-1A | EXTR-1A.1 / EXTR-1A.5 | extractor router |
| TRACE-009 | SPIKE-002, SPIKE-003 | ADR-0006 | REQ-010, REQ-015 | AC-010, AC-015 / TEST-010, TEST-015 | P0-M3 | EXTR | EXTR-1A | EXTR-1A.2 / EXTR-1A.3 / EXTR-1A.4 | LLM routing + auto-accept threshold |
| TRACE-010 | — | (roadmap) | REQ-011 | AC-011 / manual review | P0-M1~M6 | (전 트랙) | (전 phase) | (전 slice) | 구현 순서 강제 |
| TRACE-011 | Q-001 | ADR-0009 | REQ-012 | AC-012 / TEST-012 | P0-M5 | AGG | AGG-1A | AGG-1A.3 | scenario validate 5종 |
| TRACE-012 | Q-001, Q-003 | ADR-0008 | REQ-013 | AC-013 / TEST-013 | P0-M6 | PUB | PUB-1A | PUB-1A.2 | cite check 5종 |
| TRACE-013 | — | ADR-0009 | REQ-014 | AC-014 / TEST-014 | P0-M5 | AGG | AGG-1A | AGG-1A.2 | scenario_revisions append-only |
| TRACE-013b | — | ADR-0009 | NFR-002 | AC-017 / manual reproducibility | P0-M5 | AGG | AGG-1A | AGG-1A.2 / AGG-1A.3 | reproducibility는 manual gate (AC-017) — 자동 TEST 미정의 |
| TRACE-014 | Q-002 | ADR-0010 | REQ-016 | AC-016 / TEST-016 | P0-M5 | OPS | OPS-1B | OPS-1B.1 | stale 트리거 3종 |
| TRACE-015 | SPIKE-001 | ADR-0004 | NFR-001 | AC-002 / TEST-002 | P0-M1 | INFRA | INFRA-1A | INFRA-1A.2 | FTS5 검색 p95 < 1s |
| TRACE-016 | — | ADR-0003 | NFR-003 | AC-018 / TEST-018 | P0-M6 | PUB | PUB-1A | PUB-1A.1 | 5-step trace |
| TRACE-017 | — | ADR-0006 | NFR-004 | AC-019 / TEST-019 | P0-M3 | OPS | OPS-1A | OPS-1A.1 / OPS-1A.2 | run ledger + cost throttling |
| TRACE-018 | — | ADR-0006 | NFR-007 | AC-021 / TEST-021 | P0-M3 | EXTR | EXTR-1A | EXTR-1A.1 | extractor interface 확장 |
| TRACE-019 | Q-003 | ADR-0008 | REQ-013 | AC-013 / TEST-013 | P0-M6 | PUB | PUB-1A | PUB-1A.3 | publication cascade — Q-003 결정 후 활성 |
| TRACE-020 | — | ADR-0004 | NFR-006 | AC-020 / TEST-020 | P0-M1 | INFRA | INFRA-1A | INFRA-1A.3 | R2 durability + sha256 round-trip |

## Invariants

- 모든 `must` REQ는 최소 한 개의 AC를 가져야 한다. ✓ (REQ-001~REQ-016 모두
  AC-001~AC-016 매핑)
- 모든 accepted DEC/ADR은 영향받는 REQ/HLD/Runbook을 갖는다. ✓ (ADR-0003~0010
  전부 REQ + HLD 컴포넌트 매핑)
- 모든 완료 Slice는 적어도 하나의 TRACE row와 연결된다. (현재 INFRA-1A.1만
  landed, TRACE-001/004/005/007 매핑)
- 모든 `accepted` milestone은 gate / test evidence를 갖는다. (현재 accepted
  milestone 없음 — DoD 충족 시 갱신)

## Gaps

- Q-001 (horizon enum) 미해결 → AC-012(scenario validate), AC-013(cite check
  horizon mismatch) 부분 검증만 가능
- Q-002 (stale_after) 미해결 → AC-016 시간 트리거 placeholder 30일 사용 중
- Q-003 (publication 정정 트리거) 미해결 → AC-013 cascade 완전 구현 차단
- 모든 TEST 위치는 `(planned)` 상태 — 코드 도입 시 실제 위치로 갱신
- staging/production 환경 미정의 → AC-017 reproducibility는 local manual로만
  실행 가능 (P1 검토)
