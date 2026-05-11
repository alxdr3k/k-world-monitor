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
| TRACE-001 | — | ADR-0011 (supersedes 0003) | REQ-001 | AC-001 / TEST-001 | P0-M1 | INFRA | INFRA-1A | INFRA-1A.1 | 9-stage object model lock (Source + Thesis 추가) |
| TRACE-002 | Q-004 | ADR-0012 (supersedes 0004) | REQ-002, REQ-004 | AC-002, AC-004 / TEST-002, TEST-004 | P0-M1 | INFRA | INFRA-1A | INFRA-1A.2 | Neo4j canonical (graph) + SQLite (relational) + Markdown promoted only |
| TRACE-003 | — | ADR-0012 (supersedes 0004) | REQ-003 | AC-003, AC-020 / TEST-003, TEST-020 | P0-M1 | INFRA | INFRA-1A | INFRA-1A.3 | R2 permitted artifact only + raw_cloud_policy=always_prohibited + content_hash |
| TRACE-004 | — | ADR-0011 (supersedes 0003) | REQ-005 | AC-005 / TEST-005 | P0-M1 | INFRA | INFRA-1A | INFRA-1A.1 | ID 체계 (`src_/doc_/snap_/clm_/dos_/scn_/ths_/drf_/pub_/edge_/run_/aci_/mcl_`) |
| TRACE-005 | — | ADR-0005, ADR-0011, ADR-0016 | REQ-006 | AC-006 / TEST-006 | P0-M1 | INFRA | INFRA-1A | INFRA-1A.1 | confidence 분해 + collectability_score + claim_status 8-state |
| TRACE-006 | — | ADR-0015 (supersedes 0008) | REQ-007, NFR-005 | AC-007 / TEST-007 | P0-M3 | EXTR | EXTR-1A | EXTR-1A.2 | evidence nullable quote + quote_reason + storage_level |
| TRACE-007 | — | ADR-0013 (supersedes 0007) | REQ-008 | AC-008 / TEST-008 | P0-M1 | INFRA | INFRA-1A | INFRA-1A.4 | Neo4j typed edges (v0 5종) + frontmatter 배열 lint |
| TRACE-008 | — | ADR-0006 | REQ-009 | AC-009 / TEST-009 | P0-M3 | EXTR | EXTR-1A | EXTR-1A.1 / EXTR-1A.5 | extractor router |
| TRACE-009 | SPIKE-002, SPIKE-003, Q-028 | ADR-0006 (+ Q-028 결정 후 신규 ADR 예정) | REQ-010, REQ-015 | AC-010, AC-015 / TEST-010, TEST-015 | P0-M3 | EXTR | EXTR-1A | EXTR-1A.2 / EXTR-1A.3 / EXTR-1A.4 | LLM routing + auto-accept threshold + cost ceiling |
| TRACE-010 | — | (roadmap) | REQ-011 | AC-011 / manual review | P0-M1~M6 | (전 트랙) | (전 phase) | (전 slice) | 구현 순서 강제 |
| TRACE-011 | Q-001 | ADR-0009, ADR-0019 | REQ-012 | AC-012 / TEST-012 | P0-M5 | AGG | AGG-1A | AGG-1A.3 | scenario validate 5종 + counterclaim polarity-symmetric |
| TRACE-012 | Q-001, Q-003 | ADR-0015 (supersedes 0008) | REQ-013 | AC-013 / TEST-013 | P0-M6 | PUB | PUB-1A | PUB-1A.2 | cite check 5+1 block + v1+ warning |
| TRACE-013 | — | ADR-0009, ADR-0013 | REQ-014 | AC-014 / TEST-014 | P0-M5 | AGG | AGG-1A | AGG-1A.2 | scenario_revisions append-only + SUPERSEDES edge |
| TRACE-013b | — | ADR-0009 | NFR-002 | AC-017 / manual reproducibility | P0-M5 | AGG | AGG-1A | AGG-1A.2 / AGG-1A.3 | reproducibility는 manual gate (AC-017) — 자동 TEST 미정의 |
| TRACE-014 | Q-002 | ADR-0010 | REQ-016 | AC-016 / TEST-016 | P0-M5 | OPS | OPS-1B | OPS-1B.1 | stale 트리거 3종 |
| TRACE-015 | SPIKE-001 | ADR-0012, ADR-0014 | NFR-001 | AC-002 / TEST-002 | P0-M1 | INFRA | INFRA-1A | INFRA-1A.2 | Neo4j Community + native FTS 검색 p95 < 1s |
| TRACE-016 | — | ADR-0011 (supersedes 0003) | NFR-003 | AC-018 / TEST-018 | P0-M6 | PUB | PUB-1A | PUB-1A.1 | 5-step trace (9-stage 안에서 5단계 이내) |
| TRACE-017 | Q-028 | ADR-0006 | NFR-004 | AC-019 / TEST-019 | P0-M3 | OPS | OPS-1A | OPS-1A.1 / OPS-1A.2 | run ledger + cost throttling |
| TRACE-018 | — | ADR-0006 | NFR-007 | AC-021 / TEST-021 | P0-M3 | EXTR | EXTR-1A | EXTR-1A.1 | extractor interface 확장 |
| TRACE-019 | Q-003 | ADR-0015 (supersedes 0008) | REQ-013 | AC-013 / TEST-013 | P0-M6 | PUB | PUB-1A | PUB-1A.3 | publication cascade — Q-003 결정 후 활성 |
| TRACE-020 | — | ADR-0012 (supersedes 0004) | NFR-006 | AC-020 / TEST-020 | P0-M1 | INFRA | INFRA-1A | INFRA-1A.3 | Snapshot fingerprint + content_hash + R2 permitted artifact durability |
| TRACE-021 | Q-021 | ADR-0016 | REQ-017 | AC-022 / TEST-022 | P0-M2 | INFRA | INFRA-1B | INFRA-1A.6 / INFRA-1B.1 | Tier A-D + collectability_score + access_method |
| TRACE-022 | — | ADR-0017 | REQ-018 | AC-023 / TEST-023 | P0-M2 | INFRA | INFRA-1B | INFRA-1B.1 | source_policy 3 필드 + mode-aware policy gate + 8 위험 행동 트리거 |
| TRACE-023 | — | ADR-0017, ADR-0015 | REQ-019 | AC-024 / TEST-024 | P0-M2 | INFRA | INFRA-1B | INFRA-1B.5 | access_intervention Neo4j 노드 + severity 자동 산정 + batch report |
| TRACE-024 | — | ADR-0018 | REQ-020 | AC-025 / TEST-025 | P0-M3 | INFRA | INFRA-1B | INFRA-1B.6 | Manual feedback CLI + 3-way 분리 + 3-option intervention review |
| TRACE-025 | Q-029, Q-030 | ADR-0019 | REQ-021 | AC-026 / TEST-026 | P0-M5 ~ M6 | AGG | AGG-1A | AGG-1A.2 / AGG-1A.4 / INFRA-1A.7 | Scenario impact_targets + Thesis stance/market_stance |
| TRACE-026 | Q-021 | ADR-0019 | REQ-022 | AC-027 / TEST-027 | P0-M1 | INFRA | INFRA-1A | INFRA-1A.6 | source_perspective tag + Q21 분포 균형 |
| TRACE-027 | — | ADR-0019 | REQ-023 | AC-028 / TEST-028 | P0-M6 | PUB | PUB-1A | PUB-1A.2 | EvidencePack v0 4-section + LLM synthesis mode 분리 |
| TRACE-028 | — | ADR-0020 | REQ-024 | AC-029 / TEST-029 | P0-M3+ | OPS | OPS-1A | OPS-1A.3 | metrics 6 카테고리 + v0 9+ metrics + evaluation harness |
| TRACE-029 | — | ADR-0021 | REQ-025 | AC-030 / TEST-030 | P0-M3 | OPS | OPS-1A | OPS-1A.4 | Policy learning rule-based Pattern 1 v0 + auto-tighten/auto-relax 분리 |
| TRACE-030 | Q-022 | (Q-022 결정 후 ADR) | REQ-026 | AC-031 / TEST-031 | P0-M1 | INFRA | INFRA-1A | INFRA-1A.6 | 카테고리 8개 (core 7 + digital_assets) + tag 5개 |
| TRACE-031 | — | ADR-0012, ADR-0017 | NFR-008 | AC-032 / TEST-032 | P0-M1 ~ M3 | INFRA | INFRA-1A / INFRA-1B | INFRA-1A.3 / INFRA-1B.1 | raw_cloud_policy=always_prohibited 강제 + 0건 audit |
| TRACE-032 | — | ADR-0019, ADR-0020 | NFR-009 | AC-033 (v1+) / TEST-033 (v1+) | P0-M6+ (v1+) | OPS | OPS-1A | OPS-1A.3 (v1+) | thesis_polarity_distribution v1+ |
| TRACE-033 | — | DEC-003 | (reset 메타) | doc-governance lint 통과 | P0-M1 | INFRA | INFRA-1A | INFRA-1A.1 | INFRA-1A.1 재작성 결정 (Round 25 canonical) |

## Invariants

- 모든 `must` REQ는 최소 한 개의 AC를 가져야 한다. ✓ (REQ-001~REQ-026 모두
  AC-001~AC-031 매핑; NFR-008 → AC-032, NFR-009 → AC-033)
- 모든 accepted DEC/ADR은 영향받는 REQ/HLD/Runbook을 갖는다. ✓ (ADR-0003~0021
  전부 REQ + HLD 컴포넌트 매핑; 0003/0004/0007/0008은 superseded, 0011~0021로
  대체)
- 모든 완료 Slice는 적어도 하나의 TRACE row와 연결된다. (현재 INFRA-1A.1만
  landed — Round 25 reset 후 TRACE-001/004/005/007/021/022/023/024/025/026/
  030/033 매핑)
- 모든 `accepted` milestone은 gate / test evidence를 갖는다. (현재 accepted
  milestone 없음 — DoD 충족 시 갱신)

## Gaps

- Q-001 (horizon enum) 미해결 → AC-012(scenario validate), AC-013(cite check
  horizon mismatch) 부분 검증만 가능
- Q-002 (stale_after) 미해결 → AC-016 시간 트리거 placeholder 30일 사용 중
- Q-003 (publication 정정 트리거) 미해결 → AC-013 cascade 완전 구현 차단
- Q-008 (Thesis ID 체계) 미해결 → AGG-1A.4 / PUB-1A.1 진입 전 lock
- Q-012 (Neo4j ↔ SQLite sync 정책) 미해결 → INFRA-1A.2 commit 전 lock 권고
- Q-020 (Neo4j GPL v3 boundary) 미해결 → INFRA-1A.2 commit 전 lock 권고
- Q-021 (Tier A seed) 미해결 → INFRA-1A.6 진입 전 lock 필수
- Q-022 (카테고리 8개 finalize) 미해결 → INFRA-1A.6 진입 전 lock 필수
- Q-024 ~ Q-028 + Q-029/Q-030 미해결 → 의존 slice 진입 전 lock (TRACE 비고
  참조)
- 모든 TEST 위치는 `(planned)` 상태 — 코드 도입 시 실제 위치로 갱신
- staging/production 환경 미정의 → AC-017 reproducibility는 local manual로만
  실행 가능 (P1 검토)
- LLM cost ADR / 카테고리 enum ADR 미작성 — Q-022 / Q-028 결정 시점에 신설
  예정 (다음 ADR 번호는 `docs/adr/` 디렉토리 scan + 1)
