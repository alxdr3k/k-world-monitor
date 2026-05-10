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
| Track | 기술 영역 또는 큰 구현 흐름 | `INFRA` | infra / extraction / pub 같은 영역 |
| Phase | track 안의 구현 단계 | `INFRA-1A` | 같은 track 안에서 순서가 있는 단계 |
| Slice | 커밋 가능한 구현/검증 단위 | `INFRA-1A.2` | PR / commit / issue와 연결 가능한 크기 |
| Gate | 검증 / acceptance 기준 | `AC-###` / `TEST-###` | `06_ACCEPTANCE_TESTS.md` 또는 테스트 위치로 연결 |
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
| `P0-M1` | Schema & Bulk Store Bootstrap — 도메인 ADR(0003-0010) lock + SQLite 스키마 + R2 버킷 적용 | TBD | in_progress | AC-001, AC-002, AC-003, AC-005, AC-006, AC-008 | doc commits, SPIKE-001 결과 | 현재 milestone |
| `P0-M2` | Source Registry & Collection Queue — discovery → 큐 → fetch → snapshot → chunk 1건 end-to-end | TBD | planned | AC-001, AC-009, AC-020 | TBD | M1 의존 |
| `P0-M3` | Extraction & Review — Haiku 1차 + Sonnet escalate + auto-confirm + reviewer queue | TBD | planned | AC-007, AC-010, AC-015, AC-019, SPIKE-002 | TBD | M2 의존 |
| `P0-M4` | Search & Dossier — FTS5 검색 + Dossier 합성 1건 | TBD | planned | AC-002, AC-004 | TBD | M3 의존 |
| `P0-M5` | Scenario Validate — assumptions/branches/falsifier/counterclaim/monitoring + revisions ledger | TBD | planned | AC-012, AC-014, AC-017 | TBD | M4 의존 |
| `P0-M6` | Content & Cite Check — ContentDraft → Publication 1건 + cite check 5종 + cascade | TBD | planned | AC-013, AC-016, AC-018 | TBD | M5 의존 — MVP hands-on gate |

## Tracks

| Track | Purpose | Active phase | Status | Notes |
|---|---|---|---|---|
| `INFRA` | 스키마 / registry / queue / store / ID / ledger | `INFRA-1A` | in_progress | M1 owner |
| `EXTR` | extractor (article/dataset/report) + LLM routing + review queue | `EXTR-1A` | planned | M3 owner |
| `AGG` | dossier / scenario / scenario_revisions / validate | `AGG-1A` | planned | M4-M5 owner |
| `PUB` | content_draft / cite_check / publication / cascade | `PUB-1A` | planned | M6 owner |
| `OPS` | run ledger / cost throttling / stale worker / 백업 | `OPS-1A` | planned | M3+ 횡단 |

## Phases / Slices

| Slice | Milestone | Track | Phase | Goal | Depends | Gate | Gate status | Status | Evidence | Next |
|---|---|---|---|---|---|---|---|---|---|---|
| `INFRA-1A.1` | P0-M1 | INFRA | INFRA-1A | 도메인 글로서리 + ADR-0003~0010 lock | — | AC-001, AC-005, AC-006, AC-008 | defined | landed | docs/glossary/, docs/adr/0003-0010 | INFRA-1A.2 |
| `INFRA-1A.2` | P0-M1 | INFRA | INFRA-1A | SQLite + FTS5 스키마 v1 + 마이그레이션 commit (Document/Snapshot/Claim/Edge/Run) | INFRA-1A.1, SPIKE-001 | AC-002, AC-005 | defined | planned | TBD | INFRA-1A.3 |
| `INFRA-1A.3` | P0-M1 | INFRA | INFRA-1A | R2 버킷 + r2_key prefix 정책 + sha256 round-trip 테스트 | INFRA-1A.1 | AC-003, AC-020 | defined | planned | TBD | INFRA-1A.4 |
| `INFRA-1A.4` | P0-M1 | INFRA | INFRA-1A | edges 테이블 스키마 + frontmatter 관계 배열 lint | INFRA-1A.2 | AC-008 | defined | planned | TBD | INFRA-1B.1 |
| `INFRA-1B.1` | P0-M2 | INFRA | INFRA-1B | Source Registry + Collection Queue + manual_intake CLI | INFRA-1A.2 | AC-001 | defined | planned | TBD | INFRA-1B.2 |
| `INFRA-1B.2` | P0-M2 | INFRA | INFRA-1B | Discovery worker (RSS/sitemap 1종 + API 1종) → 큐 적재 | INFRA-1B.1 | AC-001 | defined | planned | TBD | INFRA-1B.3 |
| `INFRA-1B.3` | P0-M2 | INFRA | INFRA-1B | Fetcher → Snapshot row + R2 upload + sha256 dedupe | INFRA-1B.1, INFRA-1A.3 | AC-003, AC-020 | defined | planned | TBD | INFRA-1B.4 |
| `INFRA-1B.4` | P0-M2 | INFRA | INFRA-1B | Chunker / FTS5 인덱서 — snapshot 텍스트 → chunk + 인덱스 | INFRA-1B.3, INFRA-1A.2 | AC-002 | defined | planned | TBD | EXTR-1A.1 |
| `EXTR-1A.1` | P0-M3 | EXTR | EXTR-1A | Extractor router (article/dataset/report 분기) | INFRA-1B.4 | AC-009 | defined | planned | TBD | EXTR-1A.2 |
| `EXTR-1A.2` | P0-M3 | EXTR | EXTR-1A | Article extractor (Haiku 4.5 1차) + run ledger | EXTR-1A.1, OPS-1A.1 | AC-007, AC-010, SPIKE-003 | defined | planned | TBD | EXTR-1A.3 |
| `EXTR-1A.3` | P0-M3 | EXTR | EXTR-1A | Sonnet 4.6 escalate + prompt caching + batch API | EXTR-1A.2 | AC-010, AC-019 | defined | planned | TBD | EXTR-1A.4 |
| `EXTR-1A.4` | P0-M3 | EXTR | EXTR-1A | Review queue + auto-confirm threshold(SPIKE-002 결과 반영) | EXTR-1A.3, SPIKE-002 | AC-010, AC-015 | defined | planned | TBD | EXTR-1A.5 |
| `EXTR-1A.5` | P0-M3 | EXTR | EXTR-1A | Dataset parser + report extractor (LLM with structure prompt) | EXTR-1A.1 | AC-009 | defined | planned | TBD | OPS-1A.2 |
| `OPS-1A.1` | P0-M3 | OPS | OPS-1A | Run ledger 테이블 + cost 집계 | INFRA-1A.2 | AC-019 | defined | planned | TBD | OPS-1A.2 |
| `OPS-1A.2` | P0-M3 | OPS | OPS-1A | 일별 cost 상한 throttling worker | OPS-1A.1 | AC-019 | defined | planned | TBD | INFRA-1B.5 |
| `INFRA-1B.5` | P0-M4 | INFRA | INFRA-1B | Search/Query 인터페이스 (FTS5 wrapper + claim/snapshot/edge query API) — REQ-011의 "search/query" 단계 | INFRA-1B.4 | AC-002 | defined | planned | TBD | AGG-1A.1 |
| `AGG-1A.1` | P0-M4 | AGG | AGG-1A | Dossier 합성 (promoted claim 정책 + counterclaim pool) | EXTR-1A.4, INFRA-1B.5 | AC-004 | defined | planned | TBD | AGG-1A.2 |
| `AGG-1A.2` | P0-M5 | AGG | AGG-1A | Scenario composer + scenario_revisions ledger (append only) | AGG-1A.1, INFRA-1A.4 | AC-014, AC-017 | defined | planned | TBD | AGG-1A.3 |
| `AGG-1A.3` | P0-M5 | AGG | AGG-1A | Scenario Validator 5종 검사 | AGG-1A.2 | AC-012 | defined | planned | TBD | OPS-1B.1 |
| `OPS-1B.1` | P0-M5 | OPS | OPS-1B | Stale worker (time / snapshot_diff / counterclaim 트리거 3종) | INFRA-1A.4, EXTR-1A.4 | AC-016 | defined | planned | TBD | PUB-1A.1 |
| `PUB-1A.1` | P0-M6 | PUB | PUB-1A | ContentDraft composer + 인용 ledger | AGG-1A.3 | AC-018 | defined | planned | TBD | PUB-1A.2 |
| `PUB-1A.2` | P0-M6 | PUB | PUB-1A | Cite Check 5종 (stale / retracted / horizon / unit / overclaim) | PUB-1A.1, OPS-1B.1 | AC-013 | defined | planned | TBD | PUB-1A.3 |
| `PUB-1A.3` | P0-M6 | PUB | PUB-1A | Publication ledger + cascade alert (Q-003 결정 반영) | PUB-1A.2, Q-003 resolution | AC-013 | defined | planned | TBD | MVP gate |

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
  - Anthropic API (Haiku 4.5 + Sonnet 4.6 + prompt caching + batch)
  - Cloudflare R2 (S3 compatible)
- 라이브러리 / 벤더:
  - SQLite + FTS5 (system)
  - `@anthropic-ai/sdk` (Anthropic 공식)
  - HTTP/parsing libs는 EXTR-1A.5 단계에서 결정 (PDF parser, dataset parser)

## Risks (open)

- SPIKE-001: SQLite + FTS5 NFR-001 (검색 < 1초 p95) — INFRA-1A.2 진입 직전 결과
  필요
- SPIKE-002: auto-confirm threshold 0.85 fp율 — EXTR-1A.4 진입 직전 결과 필요
- SPIKE-003: prompt caching cache hit rate ≥ 70% — EXTR-1A.3 진입 직전 결과 필요
- Q-001: scenario horizon enum — AGG-1A.3 진입 전 lock
- Q-002: Dossier `stale_after` default — OPS-1B.1 진입 전 lock
- Q-003: Publication 정정 ledger 트리거 — PUB-1A.3 진입 전 lock
- Q-004: SQLite vs vault jsonl 책임 분담 — INFRA-1A.2 commit 전 lock 권고

## Capacity / Timeline

- 인원: 1명 (운영자 + LLM 에이전트 보조)
- 주당 가용 시간: TBD
- 예상 완료: P0-M1 ~ P0-M6 milestones은 시간 박싱 없이 진행. 첫 milestone
  (P0-M1) lock 이후 capacity 재평가.
