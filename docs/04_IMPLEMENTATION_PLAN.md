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
| `P0-M1` | Schema & Bulk Store Bootstrap — 9-stage ADR(0011-0021) lock + Neo4j Cypher schema + SQLite relational + R2 permitted-artifact 적용 | TBD | in_progress | AC-001, AC-002, AC-003, AC-005, AC-006, AC-008, AC-022, AC-023, AC-026, AC-032 | doc commits, SPIKE-001 결과 | 현재 milestone (Round 25 canonical) |
| `P0-M2` | Source Registry & Collection Queue — Tier A seed (size cap 없음, v0 entry 50 source proposed) + collectability_score + source policy gate + discovery → 큐 → fingerprint snapshot → chunk 1건 end-to-end | TBD | planned | AC-001, AC-009, AC-020, AC-022, AC-024 | TBD | M1 의존 |
| `P0-M3` | Extraction & Review — Haiku 1차 + Sonnet escalate + auto-confirm + reviewer queue + manual feedback CLI + access_intervention batch report | TBD | planned | AC-007, AC-010, AC-015, AC-019, AC-024, AC-025, SPIKE-002 | TBD | M2 의존 |
| `P0-M4` | Search & Dossier — Neo4j native FTS 검색 + Dossier 합성 1건 (counterclaim pool, source_perspective 분포) | TBD | planned | AC-002, AC-004, AC-027 | TBD | M3 의존 |
| `P0-M5` | Scenario Validate — assumptions/branches/falsifier/counterclaim(polarity-symmetric)/monitoring/impact_targets/transmission_channels + revisions ledger | TBD | planned | AC-012, AC-014, AC-017, AC-026 | TBD | M4 의존 |
| `P0-M6` | Thesis & Content & Cite Check — Thesis(stance + market_stance) → ContentDraft (v0 blog_long only, DEC-005) → Publication 1건 + cite check 5+1 + cascade + EvidencePack v0 4-section + **자체 사이트 Astro skeleton + 첫 발행** (ADR-0022, DEC-005, DEC-006) | **2주 목표 (DEC-005 lock)** | planned | AC-013, AC-016, AC-018, AC-026, AC-028, **AC-034**, **AC-035** | TBD | M5 의존 — **v0 turn-key MVP gate (2주 목표 lock, DEC-005)**. AC-034 = 외부 cross-post canonical cite anchor lint (NFR-010 / REQ-027). AC-035 = Astro Content Collection Zod schema build-time gate (REQ-027 build-fail 룰) |

## Tracks

| Track | Purpose | Active phase | Status | Notes |
|---|---|---|---|---|
| `INFRA` | Neo4j + SQLite + R2 스키마 / Source registry / policy gate / access_interventions / queue / store / ID / ledger | `INFRA-1A` | in_progress | M1 owner |
| `EXTR` | extractor (article/dataset/report) + LLM routing + review queue | `EXTR-1A` | planned | M3 owner |
| `AGG` | dossier / scenario(impact_targets) / scenario_revisions / validate / thesis(stance + market_stance) | `AGG-1A` | planned | M4-M5-M6 owner |
| `PUB` | content_draft 4-format(v0 blog_long only) / cite_check 5+1 / publication / cascade / **자체 사이트 Astro + Cloudflare Pages** / vault publications/ sync (git push trigger) | `PUB-1A` | planned | M6 owner — v0 turn-key |
| `OPS` | run ledger / cost throttling / stale worker / 백업 / metrics framework / policy learning | `OPS-1A` | planned | M3+ 횡단 |

## Phases / Slices

| Slice | Milestone | Track | Phase | Goal | Depends | Gate | Gate status | Status | Evidence | Next |
|---|---|---|---|---|---|---|---|---|---|---|
| `INFRA-1A.1` | P0-M1 | INFRA | INFRA-1A | **재작성 (Round 25 canonical)** — 9-stage 글로서리 + ADR-0011~0021 신규 + ADR-0003/0004/0007/0008 supersede + PRD/HLD/current-state 갱신 | — | AC-001, AC-005, AC-006, AC-008, AC-022, AC-026, AC-032 | defined | landed | docs/glossary/, docs/adr/0011-0021, supersede markers on 0003/0004/0007/0008 | INFRA-1A.2 |
| `INFRA-1A.2` | P0-M1 | INFRA | INFRA-1A | Neo4j Cypher schema v1 + SQLite relational schema v1 + 마이그레이션 commit (Source/Document/Snapshot/Claim/Edge/Run/AccessIntervention/ManualClaimEntry/Thesis 노드 + source_policy/policy_decisions/dataset_vintage/metrics_*/evaluation_*/policy_learning_*/research_session/raw_cache_items 테이블) | INFRA-1A.1, SPIKE-001 | AC-002, AC-005 | defined | planned | TBD | INFRA-1A.3 |
| `INFRA-1A.3` | P0-M1 | INFRA | INFRA-1A | R2 버킷 + permitted_artifact prefix 정책 + raw_cloud_policy=always_prohibited 강제 + sha256 round-trip 테스트 (open license dataset only) | INFRA-1A.1 | AC-003, AC-020, AC-032 | defined | planned | TBD | INFRA-1A.4 |
| `INFRA-1A.4` | P0-M1 | INFRA | INFRA-1A | Neo4j edge UNIQUE constraint (5 relation type) + frontmatter 관계 배열 lint (배열 발견 시 CI fail) | INFRA-1A.2 | AC-008 | defined | planned | TBD | INFRA-1A.5 |
| `INFRA-1A.5` | P0-M1 | INFRA | INFRA-1A | text normalization util + sha256 helper + quote_reason enum / storage_level enum migration | INFRA-1A.2 | AC-007 | defined | planned | TBD | INFRA-1A.6 |
| `INFRA-1A.6` | P0-M1 | INFRA | INFRA-1A | Source registry seed Q21 — Tier A seed (size cap 없음, v0 entry `docs/research/source-seed-list-2026-05.md` 50 source) + source_perspective 분포 균형 (전체 seed 기준 risk ≤50% / opportunity ≥25% / neutral ≥15%) + collectability_score 초기치. canonical 위치 = 이 repo `data/sources_seed.yaml` (외부 repo 의존 X) | INFRA-1A.2, Q-021 resolution | AC-022, AC-027 | defined | planned | TBD | INFRA-1A.7 |
| `INFRA-1A.7` | P0-M1 | INFRA | INFRA-1A | Scenario / Thesis / Source schema에 v0 즉시 bidirectional 필드 추가 (impact_targets, impact_direction_by_target, transmission_channels, stance, market_stance optional, source_perspective) | INFRA-1A.2 | AC-026, AC-027 | defined | planned | TBD | INFRA-1A.8 |
| `INFRA-1A.8` | P0-M1 | INFRA | INFRA-1A | Backup runbook — Neo4j dump 일간 + SQLite snapshot 일간 + JSONL audit export 월별. `docs/05_RUNBOOK.md` 갱신 | INFRA-1A.2, Q-027 resolution | AC-032 | defined | planned | TBD | INFRA-1B.1 |
| `INFRA-1B.1` | P0-M2 | INFRA | INFRA-1B | Source Registry + Collection Queue + manual_intake CLI + source_policy 3 필드(archive/raw_cloud/external_llm) + 8 위험 행동 트리거 inline_block | INFRA-1A.2, INFRA-1A.6 | AC-001, AC-022, AC-023 | defined | planned | TBD | INFRA-1B.2 |
| `INFRA-1B.2` | P0-M2 | INFRA | INFRA-1B | Discovery worker (RSS/sitemap 1종 + API 1종, Tier A 한정) → 큐 적재 | INFRA-1B.1 | AC-001 | defined | planned | TBD | INFRA-1B.3 |
| `INFRA-1B.3` | P0-M2 | INFRA | INFRA-1B | Fetcher → Snapshot fingerprint row + content_hash dedupe (R2 binary는 permitted artifact만) | INFRA-1B.1, INFRA-1A.3 | AC-003, AC-020 | defined | planned | TBD | INFRA-1B.4 |
| `INFRA-1B.4` | P0-M2 | INFRA | INFRA-1B | Chunker / Neo4j native FTS 인덱서 — snapshot 텍스트 → chunk + Neo4j FTS 인덱스 | INFRA-1B.3, INFRA-1A.2 | AC-002 | defined | planned | TBD | INFRA-1B.5 |
| `INFRA-1B.5` | P0-M2 | INFRA | INFRA-1B | access_interventions Neo4j 노드 + severity deterministic 산정 + batch_report mode 구현 | INFRA-1A.2, INFRA-1B.1 | AC-024 | defined | planned | TBD | INFRA-1B.6 |
| `INFRA-1B.6` | P0-M3 | INFRA | INFRA-1B | Manual feedback CLI — `pipeline feedback add|bulk|link|from-report` + `pipeline intervention review <id>` 3-option | INFRA-1B.5 | AC-025 | defined | planned | TBD | EXTR-1A.1 |
| `EXTR-1A.1` | P0-M3 | EXTR | EXTR-1A | Extractor router (article/dataset/report 분기) | INFRA-1B.4 | AC-009 | defined | planned | TBD | EXTR-1A.2 |
| `EXTR-1A.2` | P0-M3 | EXTR | EXTR-1A | Article extractor (Haiku 4.5 1차) + run ledger | EXTR-1A.1, OPS-1A.1 | AC-007, AC-010, SPIKE-003 | defined | planned | TBD | EXTR-1A.3 |
| `EXTR-1A.3` | P0-M3 | EXTR | EXTR-1A | Sonnet 4.6 escalate + prompt caching + batch API | EXTR-1A.2 | AC-010, AC-019 | defined | planned | TBD | EXTR-1A.4 |
| `EXTR-1A.4` | P0-M3 | EXTR | EXTR-1A | Review queue + auto-confirm threshold(SPIKE-002 결과 반영) | EXTR-1A.3, SPIKE-002 | AC-010, AC-015 | defined | planned | TBD | EXTR-1A.5 |
| `EXTR-1A.5` | P0-M3 | EXTR | EXTR-1A | Dataset parser + report extractor (LLM with structure prompt) | EXTR-1A.1 | AC-009 | defined | planned | TBD | OPS-1A.2 |
| `OPS-1A.1` | P0-M3 | OPS | OPS-1A | Run ledger 테이블 + cost 집계 | INFRA-1A.2 | AC-019 | defined | planned | TBD | OPS-1A.2 |
| `OPS-1A.2` | P0-M3 | OPS | OPS-1A | 일별 cost 상한 throttling worker | OPS-1A.1 | AC-019 | defined | planned | TBD | OPS-1A.3 |
| `OPS-1A.3` | P0-M3 | OPS | OPS-1A | Metrics framework v0 — metrics_run hook (publication preflight, scenario_validate, build_evidence_pack 부산물) + CLI `pipeline metrics report` markdown/CSV | INFRA-1A.2, OPS-1A.1 | AC-029 | defined | planned | TBD | OPS-1A.4 |
| `OPS-1A.4` | P0-M3 | OPS | OPS-1A | Policy learning Pattern 1 (source policy refinement) + policy_learning_events / source_policy_rules + raw_cache_items TTL worker | INFRA-1B.5 | AC-030 | defined | planned | TBD | INFRA-1B.7 |
| `INFRA-1B.7` | P0-M4 | INFRA | INFRA-1B | Search/Query 인터페이스 (Neo4j native FTS wrapper + Cypher query API for claim/snapshot/edge) — REQ-011의 "search/query" 단계 | INFRA-1B.4 | AC-002 | defined | planned | TBD | AGG-1A.1 |
| `AGG-1A.1` | P0-M4 | AGG | AGG-1A | Dossier 합성 (promoted claim 정책 + counterclaim pool + source_perspective 분포) | EXTR-1A.4, INFRA-1B.7 | AC-004, AC-027 | defined | planned | TBD | AGG-1A.2 |
| `AGG-1A.2` | P0-M5 | AGG | AGG-1A | Scenario composer + scenario_revisions ledger (append only) + impact_targets / impact_direction_by_target / transmission_channels v0 | AGG-1A.1, INFRA-1A.7 | AC-014, AC-017, AC-026 | defined | planned | TBD | AGG-1A.3 |
| `AGG-1A.3` | P0-M5 | AGG | AGG-1A | Scenario Validator 5종 검사 + counterclaim polarity-symmetric direction tag | AGG-1A.2 | AC-012 | defined | planned | TBD | AGG-1A.4 |
| `AGG-1A.4` | P0-M6 | AGG | AGG-1A | Thesis Composer — Scenario revision → Thesis with stance + market_stance(optional) | AGG-1A.3, INFRA-1A.7 | AC-026 | defined | planned | TBD | OPS-1B.1 |
| `OPS-1B.1` | P0-M5 | OPS | OPS-1B | Stale worker (time / snapshot_diff / counterclaim 트리거 3종) | INFRA-1A.4, EXTR-1A.4 | AC-016 | defined | planned | TBD | PUB-1A.1 |
| `PUB-1A.1` | P0-M6 | PUB | PUB-1A | ContentDraft composer — **v0 blog_long only** (DEC-005). 4-format schema-level lock 유지(ADR-0011), 나머지 3 format composer는 v1+ phasing (Q-032). 인용 ledger + Thesis 재사용. ContentDraft 산출물은 `vault/publications/blog_long/<slug>.mdx` 로 emit (ADR-0022) | AGG-1A.4 | AC-018 | defined | planned | TBD | PUB-1A.2 |
| `PUB-1A.2` | P0-M6 | PUB | PUB-1A | Cite Check 5+1 (stale / retracted / horizon / unit / overclaim + unresolved HIGH/CRITICAL access_intervention + v1+ one-sided thesis warning) + EvidencePack v0 4-section. 일부는 Astro Zod schema build-time enforce (ADR-0022 INV-0022-3) | PUB-1A.1, OPS-1B.1, INFRA-1B.5 | AC-013, AC-028 | defined | planned | TBD | PUB-1A.3 |
| `PUB-1A.3` | P0-M6 | PUB | PUB-1A | Publication ledger + cascade alert (Q-003 결정 반영) + vault sync trigger — **DEC-006로 git push 단일화** (별도 `pipeline vault-sync` CLI v0 제거, v1+ Q-033 외부 플랫폼 auto cross-post 시 재도입). v0 manual correction approve (DEC-005 + ADR-0018) | PUB-1A.2, Q-003 resolution | AC-013 | defined | planned | TBD | PUB-1A.4 |
| `PUB-1A.4` | P0-M6 | PUB | PUB-1A | **자체 사이트 Astro skeleton** — Astro 5.0 + Content Collection(`glob('vault/publications/**/*.{md,mdx}')`) + Zod schema mirror (status / cite_refs[] / correction_ledger[] / format) + `<Cite/>` / `<RetractionBanner/>` / `<CorrectionLedger/>` 컴포넌트 + pagefind + vega-lite/mermaid + `@astrojs/rss` 4 format feed + **Cloudflare Pages 배포** (git push trigger) (ADR-0022) | PUB-1A.3 | AC-018, AC-035 | defined | planned | TBD | PUB-1A.5 |
| `PUB-1A.5` | P0-M6 | PUB | PUB-1A | **첫 publication (blog_long 1건)** — **1 카테고리 = 경제 (DEC-009 lock, DEC-004 4 메타 중)** × 1 Thesis × 1 blog_long ContentDraft → vault/publications/blog_long/ commit → git push → Cloudflare Pages build → 자체 사이트 publish. Substack / YouTube / X manual cross-post (cite footnote는 자체 사이트 URL anchor — AC-034 lint). **v0 turn-key MVP gate** | PUB-1A.4, AGG-1A.4, DEC-009 | AC-013, AC-018, AC-026, AC-028, AC-034, AC-035 | defined | planned | TBD | MVP gate accepted |

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
  - Cloudflare Pages (자체 사이트 호스팅 — git push trigger, ADR-0022)
  - v1+ Substack / YouTube Data / X API (auto cross-post — Q-033)
  - v1+ TTS provider API (외주 또는 self-host — Q-031)
- 라이브러리 / 벤더:
  - SQLite + FTS5 (system)
  - `@anthropic-ai/sdk` (Anthropic 공식)
  - HTTP/parsing libs는 EXTR-1A.5 단계에서 결정 (PDF parser, dataset parser)
  - Astro 5.0 + `@astrojs/mdx` + `@astrojs/rss` + Zod (자체 사이트, ADR-0022)
  - pagefind (client-side full-text)
  - vega-lite + mermaid (chart / diagram)

## Risks (open)

- SPIKE-001: **Neo4j Community + native FTS** NFR-001 (검색 < 1초 p95) —
  INFRA-1A.2 진입 직전 결과 필요 (대상 SQLite+FTS5에서 Neo4j로 갱신)
- SPIKE-002: auto-confirm threshold 0.85 fp율 — EXTR-1A.4 진입 직전 결과 필요
- SPIKE-003: prompt caching cache hit rate ≥ 70% — EXTR-1A.3 진입 직전 결과 필요
- Q-001: scenario horizon enum — AGG-1A.3 진입 전 lock
- Q-002: Dossier `stale_after` default — OPS-1B.1 진입 전 lock
- Q-003: Publication 정정 ledger 트리거 — PUB-1A.3 진입 전 lock
- Q-004: SQLite relational metadata vs vault jsonl 책임 분담 — INFRA-1A.2
  commit 전 lock 권고
- Q-020: Neo4j Community GPL v3 boundary — INFRA-1A.2 commit 전 lock 권고
- Q-021: Tier A source seed (size cap 없음 — DEC-009 reflow 후 v0 entry
  50 source `docs/research/source-seed-list-2026-05.md`) + source_perspective
  분포 균형 (전체 seed 기준 risk ≤50% / opportunity ≥25% / neutral ≥15%
  충족 — 50 source 에서 9/15/23 = 18%/30%/46% 충족). 사용자 list review
  + accept 후 이 repo `data/sources_seed.yaml` 또는 SQLite migration INSERT
  commit 시 resolved — INFRA-1A.6 진입 전 lock
- ~~Q-022~~: **resolved by DEC-004** (v0 4 메타 카테고리: 정책 / 경제 / 사회
  / 대중문화. 기존 8 enum + tag 5개는 subtopic_tags[] 로 강등 보존)
- Q-024: Neo4j-specific 기능 활용 boundary — INFRA-1A.2 commit 전 lock 권고
- Q-025: 이 repo (= second-brain vault 기준 "외부 repo") 부트스트랩 cadence
  — INFRA-1A.1 완료 후 재평가
- ~~Q-026~~: **resolved by DEC-006** (vault sync trigger = git push 단일화,
  ADR-0022 자체 사이트 stack 후 단순화)
- ~~Q-027~~: **resolved by DEC-007** (retention / R2 lifecycle 3 expire
  rule + 의미적 GC batch 3개 + soft-delete tombstone 14d grace + RETENTION_
  PROTECTED_KINDS 상수 + raw_cache 24h~7d ceiling)
- ~~Q-028~~: **resolved by DEC-008** (3계층 LLM 라우팅 + prompt caching
  layering + 이중 TTL + batch API + cost ceiling soft $5/hard $7.5/weekly
  $25 + backfill bucket + KPI 5개)
- Q-029: ImpactAssessment v0 embedded vs v1 노드 — AGG-1A.2 진입 전 lock
- Q-030: counterclaim multi-relation v1 도입 우선순위 — v1 진입 시점에 lock
- Q-031: TTS v1 timing + provider — v1 PUB-1B 트랙 진입 시점에 lock (DEC-005
  v0 TTS deferred 연장)
- Q-032: ContentDraft 4-format auto-generate phasing (newsletter →
  youtube_long → shorts 권고) — v1 PUB-1B 트랙 진입 시점에 lock (DEC-005
  v0 blog_long only 연장)
- Q-033: 외부 플랫폼 auto cross-post timing (Substack → YouTube → X 권고)
  — v1 PUB-1B 트랙 진입 + Q-032 진입 시점에 lock (DEC-005 v0 manual 연장)
- Q-034: Auto retraction trigger 정책 v1+ (live → corrected 일부 자동,
  retracted 는 v2까지 manual) — v1 OPS-1B 트랙 진입 시점에 lock (DEC-005
  v0 manual approve 연장)

## Capacity / Timeline

- 인원: 1명 (운영자 + LLM 에이전트 보조)
- 주당 가용 시간: TBD
- 예상 완료: P0-M1 ~ P0-M6 milestones은 시간 박싱 없이 진행. 첫 milestone
  (P0-M1) lock 이후 capacity 재평가. Q-025에서 cadence 가이드 (week 1-9
  reference) 결정.
