# 04 Implementation Plan

제품 gate, 기술 흐름, 구현 slice 상태를 한 곳에서 시퀀싱한다.

세부 tracking은 issue tracker가 맡고, 이 문서는 roadmap / status ledger의
canonical view만 유지한다. 구현 단계의 얇은 문서 레이어
(`docs/context/current-state.md`, `docs/current/`)에는 전체 roadmap inventory를
복제하지 않는다.

## Taxonomy

| Term | Meaning | Example ID | Notes |
|---|---|---|---|
| Milestone | 제품 / 사용자 관점의 delivery gate | `P0-M5` | "사용자가 어떤 상태를 얻는가"를 기준으로 정의 |
| Track | 기술 영역 또는 큰 구현 흐름 | `TRK` | api, data, runtime, ops 같은 영역 |
| Phase | track 안의 구현 단계 | `TRK-1B` | 같은 track 안에서 순서가 있는 단계 |
| Slice | 커밋 가능한 구현/검증 단위 | `TRK-1B.5` | PR / commit / issue와 연결 가능한 크기 |
| Gate | 검증 / acceptance 기준 | `AC-012` / `TEST-018` | `06_ACCEPTANCE_TESTS.md` 또는 테스트 위치로 연결 |
| Evidence | 완료를 뒷받침하는 근거 | PR, code, tests, current docs | 본문 복제 대신 링크 / ID로 남김 |

## Thin-doc boundary

- `docs/04_IMPLEMENTATION_PLAN.md`가 roadmap / status ledger의 canonical 위치다.
- `docs/context/current-state.md`는 현재 milestone / track / phase / slice만 짧게 요약한다.
- `docs/current/`는 구현된 상태를 빠르게 찾는 navigation layer다. 미래 roadmap,
  phase inventory, 상세 backlog를 복제하지 않는다.
- Slice는 하나의 검증 가능한 목표로 작게 유지한다. 인접 cleanup은 별도 slice로 나눈다.
- 알려진 범위는 `planned`, `deferred`, `blocked`로 기록할 수 있다. 단 dev-cycle
  실행 후보는 명시 승인 없이는 `ready`이고 blocker가 없어야 한다.
- Evidence는 code / test / PR / current doc 링크로 남기고, 구현 상세를 이 문서에
  길게 복사하지 않는다.
- 완료된 slice라도 runtime, schema, operation, test command가 바뀌면 해당
  `docs/current/` 문서를 함께 갱신한다.

## Unplanned feedback

User feedback from real usage is triaged before it enters the roadmap.

- Clear defects, UX regressions, or acceptance failures may become small hotfix slices.
- Broader product or architecture changes go through Q / DEC / PRD / roadmap updates.
- Keep detailed feedback threads in the issue tracker. Record only the actionable
  slice, gate, evidence, and next step here.
- Bug fixes should leave regression evidence when practical.

## Status vocabulary

Implementation status:

| Status | Meaning |
|---|---|
| `planned` | 계획됨. 아직 시작 조건이 충족되지 않음 |
| `ready` | 시작 가능. dependency와 scope가 충분히 정리됨 |
| `in_progress` | 구현 또는 문서 작업 진행 중 |
| `landed` | 코드 / 문서 변경이 반영됨 |
| `accepted` | gate를 통과했고 milestone 기준으로 수용됨 |
| `blocked` | blocker 때문에 진행 불가 |
| `deferred` | 의도적으로 뒤로 미룸 |
| `dropped` | 하지 않기로 함 |

Gate status:

| Status | Meaning |
|---|---|
| `defined` | 기준은 정의됐지만 아직 실행하지 않음 |
| `not_run` | 실행 대상이지만 아직 실행하지 않음 |
| `passing` | 통과 |
| `failing` | 실패 |
| `waived` | 명시적 사유로 면제 |

## Milestones

MVP milestone rule: 대상 사용자가 현실적인 환경에서 core workflow를 end-to-end로
직접 써볼 수 있는 milestone을 최소 하나 포함한다. 필요한 환경 준비는 숨은
전제조건이 아니라 ops / implementation slice로 추적한다.

| Milestone | Product / user gate | Target date | Status | Gate | Evidence | Notes |
|---|---|---|---|---|---|---|
| `P0-M1` |  |  | `planned` | `AC-###` |  |  |

## Tracks

| Track | Purpose | Active phase | Status | Notes |
|---|---|---|---|---|
| `<TRACK>` |  | `<TRACK-1A>` | `planned` |  |

## Phases / Slices

| Slice | Milestone | Track | Phase | Goal | Depends | Gate | Gate status | Status | Evidence | Next |
|---|---|---|---|---|---|---|---|---|---|---|
| `<TRACK-1A.1>` | `P0-M1` | `<TRACK>` | `<TRACK-1A>` |  |  | `AC-###` / `TEST-###` | `defined` | `planned` |  |  |

## Gates / Acceptance

- Gate definitions live in `06_ACCEPTANCE_TESTS.md`.
- Automated checks are listed in `docs/current/TESTING.md` once they exist.
- CI/CD guidance lives in `docs/11_CI_CD.md`; workflow examples live under
  `.github/workflows/*.yml.example`.
- A slice can be `landed` before its gate is `passing`.
- A milestone is `accepted` only when its required gates are passing or explicitly waived.

## Traceability

- Completed slices should have a row in `09_TRACEABILITY_MATRIX.md`.
- Link slices to the relevant Q / DEC / ADR, REQ / NFR, AC / TEST, and milestone.
- Do not use trace rows as a backlog. They are connection records for important paths.

## Dependencies

- 외부 팀 / 시스템:
- 라이브러리 / 벤더:

## Risks (open)

SPIKE로 옮길 만한 것, 또는 운영 리스크. 세부는 `03_RISK_SPIKES.md` 참고.

## Capacity / Timeline

- 인원:
- 주당 가용 시간:
- 예상 완료:

## Migrating existing projects

Use this checklist when applying the taxonomy to a project that already has
roadmap or status content scattered across documents.

1. Search existing docs for `milestone`, `phase`, `task`, `status`, `done`,
   `pending`, and project-specific roadmap words.
2. Map product / user-facing gates to Milestones.
3. Map technical streams to Tracks.
4. Map ordered implementation stages inside each track to Phases.
5. Map PR-sized or commit-sized units to Slices.
6. Map acceptance criteria, test scenarios, staging checks, or manual
   verification to Gates.
7. Inventory existing CI/CD behavior: workflow files, external CI systems,
   deploy platforms, release scripts, package registries, branch protection,
   required checks, environments, secrets ownership, smoke tests, rollback
   drills, and manual deployment paths.
8. Map CI/CD migration work to slices when needed: workflow adoption, command
   verification, branch protection, secret migration, deploy automation,
   smoke checks, rollback validation, and old-path decommissioning.
9. Create this ledger first, then trim duplicate roadmap/status inventories
   from `docs/context/current-state.md`, `docs/current/`, `AGENTS.md`, runtime
   docs, and architecture docs.
10. Split ambiguous `done` / `pending` states into implementation status and
   gate status. For example, a slice may be `landed` while its staging gate is
   `not_run`.
11. Preserve source anchors when moving information: path, commit, PR, ADR,
   DEC, Q, AC, TEST, CI run, workflow path, release, artifact digest, or issue
   ID. If unknown, write `anchor missing`.
12. Keep project-specific historical reasoning in ADR / DEC / discovery /
    archive docs, not in the active status ledger.
