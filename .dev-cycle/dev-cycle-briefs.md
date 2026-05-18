# Dev Cycle Briefs 20260518T103918Z-2108

사이클 1 브리핑

- 결과: 반영 완료 (landed)
- 이번에 한 일:
  - INFRA-1A.x-shared-snapshot-id-constants — 4 site magic-string duplication (snap_id shape regex / rationale prefix regex / snapshot-stage R2 key prefix) 을 신규 src/domain/snapshot-id.ts single source 로 종결. 4 consumer site (policy-decisions writer-boundary / r2-invariant-scanner reader-boundary / snapshot-fingerprint r2Put key / r2/policy PERMITTED_PREFIXES) refactor. legacy single-arg signature + byte-compatible error message + reader-boundary helper re-export 로 외부 surface 보존.
  - tests/unit/snapshot_id_test.ts 신규 18 unit tests — shape regex / R2 prefix / snapshotR2Key / validSnapIdOrNull / assertValidSnapId context 4 variants / parseSnapIdFromRationale Cycle 10 delimiter strictness 6 cases / RATIONALE prefix capture. 798 → 816 tests.
  - Opus sub-agent adversarial review (codex CLI 부재 환경 fallback) — NO ACTIONABLE FINDINGS. 7 obligation 모두 pass: behavior drift / layering / drift-surface scan / re-export pattern / stale comment scan / test coverage / import path. P3 informational defer 1건 (writer-side formatRationale literal, scope 외).
  - AGENTS.md engineering-slice 의무 doc sync — CODE_MAP (snapshot-id.ts row 신규) / TESTING (Cycle 12 entry prepend, 408cf2e baseline, 798 → 816 tests) / IMPL_PLAN (slice 표 row 신규 등록 status=landed NOT gate-blocking) / current-state (P0-M2-hardening hardening list Cycle 12 entry 추가, NOT gate-blocking refactor 별도 표기). 4 thin docs 본 PR 안 포함, defer 금지 규칙 준수.
- 결론: PR #69 merged (c996775) — shared snapshot ID + R2 prefix constants module 신설로 4 site duplication 종결, PR #66 Cycle 10 Finding 6 anchor land. NOT gate-blocking refactor 라 P0-M2 gate evidence 와 별도. drift surface single source 확정 — PR #66 Cycle 10 Finding 1 (delimiter strictness) class 의 silent failure risk 차단.
- 변경 범위: code_or_runtime (12 files), contract surface
- 검증 계획: full, full CI 필요
- 다음 검토 후보:
  - INFRA-1B.5.h3-robots-disallow-ledger-coupling: safe-fetch RobotsDisallowedError 이벤트를 policy_decisions / access_intervention 에 기록 (PR #68 옵션 E-1 등록 anchor) (planned) 시작 조건: 운영자 design 결정 필요 — (a) policy_decisions row vs (b) Neo4j access_intervention node + decision_id / source_id / url / rationale schema
  - INFRA-1B.1.h2-source-profile: Source profile canonical store + data/categories.yaml 신설 + 4-축 persist (AI-P1-4 / Q-054 D3 + Q-058 D7) (planned) 시작 조건: 큰 scope, Q-054/Q-058 lock 재확인 후 진입 — INFRA-1B.1.h4-category-enum-validation 의 precondition
  - writer-side snap_id rationale prefix helper: Opus review 가 P3 informational 로 지적한 5번째 consolidation 후보 — formatRationale 의 `snap_id=${input.snapId}` literal 을 formatSnapIdRationalePrefix() helper 로 추출 (terminator structure 차이 처리 포함) (planned) 시작 조건: 후속 cycle (NOT urgent — terminator 구조 분석 후 결정)
- 자동 승격 검토: 후보 없음
- 자동 승격: 없음
- 검증:
  - bun run typecheck pass
  - bun test 816 pass / 0 fail (798 baseline + 18 신규)
  - Opus adversarial review NO ACTIONABLE FINDINGS (7 obligation pass)
- 리뷰/반영: PR #69 squash merged to main (c996775). main 동기화 + 작업 branch 삭제 완료. cycle 의 codex-loop 미사용은 후속 글로벌 규칙 (~/.claude/CLAUDE.md) 로 차단.; 리스크 이슈 생성 실패
- 리스크:
  - PR open 후 codex-loop 미사용 패턴이 2회 연속 발생 (PR #68, #69) — 운영자가 직접 review + merge 처리해야 했음 (이슈 생성 실패: /home/user/k-world-monitor/.agents/scripts/dev-cycle-helper/brief-render.sh: line 206: gh: command not found) 다음 조치: 글로벌 규칙 ~/.claude/CLAUDE.md 신설로 차단. 다음 PR 부터 codex-loop skill invoke 의무 + skill 부재 환경 fallback 명시.

