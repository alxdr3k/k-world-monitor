# Current State

This file is the first read for new AI/human sessions.

It is a compressed current operating view, not full history.

## Project mode

- mode: greenfield
- adopted on: n/a
- adoption notes: n/a

## Product / Project

`k-world-monitor`는 세계 경제·지정학·감염병 등 변동성 높은 주제에서 **세계
변화의 위험·기회·회복탄력성·비대칭 영향 4축을 병렬 추적하는 시나리오
인텔리전스 파이프라인**이다. 9-stage 객체 모델(Source → Document → Snapshot →
Claim → Dossier → Scenario → Thesis → ContentDraft → Publication)로 구조화하고,
출판 콘텐츠의 모든 주장을 source까지 5단계 이내로 역추적 가능하게 유지하며,
raw third-party text는 클라우드에 저장하지 않는 콘텐츠 생산 시스템이다.

이 repo는 second-brain ideation
[`research-content-pipeline-architecture`](../discovery/research-content-pipeline-ideation.md)
의 "Current Canonical Direction" 섹션(Round 1~25 누적 결론)을 구현하는 외부
코드 repo다. 부트스트랩 시 Round 3 lock만 반영했던 ADR-0003/0004/0007/0008은
2026-05-11 reset에서 R6/R8/R10/R14/R17/R18/R19/R23/R25의 후속 결정을 반영해
ADR-0011~0021로 supersede됐다.

## Current roadmap position

- current milestone: `P0-M2` (Source Registry & Collection Queue) — INFRA-1B.1 시작으로 M2 진입. P0-M1 게이트는 별도로 통과 필요.
- active tracks: `INFRA` (Source registry bootstrap + policy gate)
- active phase: `INFRA-1B`
- active slice: **`INFRA-1B.1.x` landed** — Hotfix: PRAGMA busy_timeout, v3 slug map migration, URL validation, Neo4j pool env vars. All shipped in c51b2ce (PR #15). Open PRs (slices still `planned` in canonical ledger): #16 (INFRA-1B.2a safe-fetch), #17 (INFRA-1B.2b scheduler), #18-#20 (INFRA-1B.3/4 fingerprint/chunker), #21 (INFRA-1B.5 access-interventions), #22 (INFRA-1B.6 feedback CLI), #23 (OPS-1A.1 run ledger).
  `INFRA-1A.3` landed (PR #14 merged 2026-05-12): R2 permitted-artifact prefix policy + sha256 round-trip tests.
  `INFRA-1A.6` landed (PR #12 merged 2026-05-12): Tier A source seed 72 sources + TEST-027.
  `INFRA-1A.8` landed (PR #10 merged 2026-05-12): Backup runbook docs-only (AC-032).
  `INFRA-1A.7` landed (PR #9 merged 2026-05-12): Scenario/Thesis/Source bidirectional
  schema fields + enum validators + indexes (AC-026, AC-027).
  `INFRA-1A.5` landed (PR #8 merged 2026-05-12): text normalization + sha256 + enum validators.
- last accepted gate: none yet
- next gate: `AC-001` (도메인 객체 9-stage 모델 + 4-tier source layer + Neo4j
  graph store가 ADR로 lock — ADR-0011 + ADR-0012 + ADR-0013); `AC-005`
  (ID prefix lint, TEST-005 통과)
- canonical ledger: `docs/04_IMPLEMENTATION_PLAN.md`

## External services / credentials

- **API key 발급 완료** (2026-05-11): OpenAI / Anthropic / Google AI Studio
  (Gemini) — v0 turn-key 진입 직전 Doppler 또는 환경 변수 등록 의무
  (`docs/05_RUNBOOK.md` Publishing Site Deployment 섹션).
- Cloudflare R2 + Cloudflare Pages: 발급 상태 확인 (P0-M2 ~ P0-M6 진입 직전).

## Implemented

### 코드 (INFRA-1A.2 landed 2026-05-12 via PR #4)
- `migrations/neo4j/v1_schema.cypher` — 13 node UNIQUE + 5 edge UNIQUE + 5 FTS index + lookup index
- `migrations/sqlite/v1_schema.sql` — 17 tables (run_ledger, cross_vendor_review_ledger, source_material_policy, policy_decisions, policy_learning_events, source_policy_rules, dataset_vintage, derived_metric_ledger, metrics_*, evaluation_*, research_session, raw_cache_items, schema_migrations)
- `scripts/migrate.ts` — idempotent migration CLI (--neo4j / --sqlite / --dry-run)
- `scripts/validate_invariants.ts` — ADR-0002 invariant validator (exit 0, warning-level)
- `src/domain/ids.ts` — ID_PREFIXES map + validateIdPrefix() / assertIdPrefix() (AC-005)
- `src/storage/neo4j/connection.ts`, `src/storage/sqlite/connection.ts` — driver singletons (bun:sqlite native)
- `tests/lint/id_prefix_test.ts` — 28 tests (TEST-005/AC-005) ✓
- `tests/bench/neo4j_fts_search_bench.ts` — SPIKE-001 bench scaffold (runs when NEO4J_PASSWORD set)

### 코드 (INFRA-1A.4 landed — PR #5)
- `tests/lint/no_frontmatter_relation_array_test.ts` — 9 tests (TEST-008/AC-008) ✓

### 코드 (INFRA-1A.5 landed — PR #8)
- `src/utils/text.ts` — normalizeText(), truncateCodePoints(), isWithinLimit() ✓
- `src/utils/hash.ts` — sha256Hex(), sha256Prefix() ✓
- `src/utils/enums.ts` — RunStatus/RunStage/LlmVendor/QuoteReason/ArchivePolicy + 8 validators ✓
- `migrations/sqlite/v2_enum_constraints.sql` — enum-validating triggers (run_ledger, cross_vendor_review_ledger) ✓
- `tests/unit/text_hash_test.ts` — 49 tests ✓

### 코드 (INFRA-1A.7 landed — PR #9)
- `migrations/neo4j/v1_schema.cypher` — Scenario property schema extended (impact_targets, impact_direction_by_target, transmission_channels); thesis_stance_idx + source_perspective_idx added ✓
- `src/utils/enums.ts` — THESIS_STANCE (6), THESIS_MARKET_STANCE (6), SOURCE_PERSPECTIVE (4: risk_observer/opportunity_observer/neutral/mixed) + validators ✓
- `src/domain/nodes.ts` — SourceNode, ScenarioNode, ThesisNode TypeScript interfaces ✓
- `tests/unit/bidirectional_schema_test.ts` — 27 tests (AC-026, AC-027) ✓

### 문서 기반 architecture 합의
- ADR 0001~0010 (boilerplate placeholder 1개 + 0002 invariant tracking +
  Round 3 lock 시점 0003~0010 8개. 0003/0004/0007/0008은 0011~0015로
  superseded)
- ADR 0011~0021 (Round 4~25 canonical) 11개 신규 작성
- **ADR 0022** (자체 사이트 publishing stack — Astro 5.0 + Cloudflare Pages
  + vault publications/ single source — v0 turn-key 결정)
- **DEC-004 / DEC-005 / DEC-006** (v0 4 메타 카테고리 / v0 turn-key publish
  scope / vault sync trigger 단일화)
- **DEC-007 / ~~DEC-008~~ (superseded by DEC-010) / DEC-009 / DEC-010**
  (retention/R2 lifecycle policy lock / v0 첫 발행 카테고리 = 경제 / LLM
  routing v2 multi-vendor + Data Science Module lock)
- **ADR-0023 (supersedes ADR-0006)** — LLM routing v2 GPT default +
  Anthropic dual-vendor + Google exploration-only + minimal cross-vendor
  review
- **ADR-0024** — Data Science Module (deterministic dataset processing,
  Polars + DuckDB + statsmodels + scipy, reproducibility 3-tuple, 1000
  rows / 50KB raw → LLM 직접 입력 금지). Stack lock close (2026-05-11).
- **ADR-0025 (supersedes ADR-0011 object model)** — Editorial Intent layer
  10-stage object model (Scenario → EditorialIntent → Thesis anchor 신설).
  운영자 명시 lock 의무, 4-format draft 재사용 anchor, NFR-002
  reproducibility 강화. ID prefix `eit_` 신규.
- **AC-031 갱신 + AC-034 + AC-035 신규 (TEST-034/035 포함)** (4 메타 카테고리
  validation + cross-post canonical cite anchor lint + Astro Content
  Collection Zod schema build-time gate)
- **09_TRACEABILITY_MATRIX TRACE-030/034/035/036/037 갱신 / 신규**
- **`docs/research/source-seed-list-2026-05.md`** (Tier A 72 source list
  proposed — Q-021 reflow, size cap 폐기, 한국 소스 24개 보강 + 글로벌
  보강. 분포 risk 19% / opportunity 29% / neutral 42% / mixed 10%.
  Tier B-C 강등 v0 비포함: a16z / Stratechery / McKinsey / GS·JPM
  Research. paywall abstract 정책: IEA WEO / IISS / MIT TR / Gates 본문은
  abstract 만 Tier A 유지)
- project delivery artifacts(PRD/HLD/Implementation Plan/Acceptance Tests/
  Glossary/Questions/Decisions/Traceability)

## Planned

- Schema & Bulk Store Bootstrap (`P0-M1`): Neo4j Community Edition + SQLite
  스키마, R2 permitted-artifact 정책 lock, Source policy gate + access_intervention
  스키마 lock
- Source Registry & Collection Queue (`P0-M2`): Tier A seed (size cap 폐기
  — DEC-009 reflow, v0 entry 72 source `docs/research/source-seed-list-
  2026-05.md`) +
  collectability_score (Q21), Discovery → 큐 적재 → fetch / fingerprint
  snapshot / chunk
- Extraction & Review (`P0-M3`): Haiku 1차 + Sonnet escalate, auto-accept
  threshold, review queue throttling, run ledger, metrics_run
- Search & Dossier (`P0-M4`): Neo4j native FTS 검색 + Dossier 합성 (counterclaim
  pool)
- Scenario Validate (`P0-M5`): assumptions / branches / falsifiers /
  counterclaim(polarity-symmetric) / impact_targets / transmission_channels
  검증 + scenario_revisions ledger
- Thesis & Content (`P0-M6`): Thesis(stance + market_stance) → ContentDraft
  **v0 blog_long only** (DEC-005, 나머지 3 format은 v1+ phasing Q-032) →
  Publication + cite check 5+1 + **자체 사이트 Astro skeleton(ADR-0022) +
  첫 publication = 경제 카테고리(DEC-009) v0 turn-key MVP gate**.
  Substack/YouTube/X manual cross-post (cite footnote는 자체 사이트
  canonical URL anchor — AC-034)
- Manual Feedback & Policy Learning (cross-cutting): `pipeline feedback` CLI,
  access_interventions batch report, policy_learning Pattern 1

## Explicit non-goals

- 실시간 뉴스 피드 / 대시보드
- 일반 PKM 영역(Inbox / SlipBox 등) 재구조화
- 마크다운 본문에 모든 candidate claim을 자동 생성 (vault 무너뜨림)
- 단일 LLM extractor로 article + dataset + report 통합 처리
- 봇 감지 우회를 production dependency로 (ADR-0016)
- Raw third-party text의 클라우드 업로드 (ADR-0012, raw_cloud_policy=always_prohibited)
- 다양한 graph DB 동시 지원 / vendor-neutral 마이그레이션 자동화 (ADR-0014
  intentional lock-in)
- ML fine-tuning 기반 policy 학습 (ADR-0021 rule-based 한정)

## Current priorities

1. INFRA-1A.1 재작성 후 9-stage 글로서리 + 신규 용어(source, thesis,
   access_intervention, manual_claim_entry, collectability_score, policy_gate,
   raw_cloud_policy, impact_target, transmission_channel, source_perspective)
   glossary entry 추가
2. Q-020 (Neo4j GPL v3 boundary) + Q-021 (Tier A seed — size cap 폐기,
   v0 entry 72 source 분포 균형) 결정
3. **INFRA-1A.2 in_progress**: Neo4j Cypher schema v1 (`migrations/neo4j/v1_schema.cypher`) +
   SQLite relational schema v1 (`migrations/sqlite/v1_schema.sql`) + migration runner +
   bun runtime + validate_invariants.ts + TEST-005 (id_prefix_test). Q-004/Q-020/Q-024 resolved.
4. SPIKE-001 재정의: Neo4j Community + native FTS 1만 graph object < 1초 p95
   (NFR-001)
5. post-merge cleanup: commit `99b0993` 이후 stale codex review 재확인 + main latest commit 신규 review 도착 시 cleanup branch에서 thread resolve/outdated 정리

## Current risks / unknowns

- Q-001 scenario horizon enum 정의
- Q-002 Dossier `stale_after` 기본값
- Q-003 Publication 정정 ledger 트리거
- ~~Q-004~~ **resolved (INFRA-1A.2)** — SQLite는 k-world-monitor repo, vault jsonl은 second-brain vault 책임
- Q-008 Thesis ID 체계
- Q-012 Neo4j ↔ SQLite sync (CDC vs batch)
- ~~Q-020~~ **resolved (INFRA-1A.2)** — 1인 internal use 범위 lock; (a)(b)(c) 발생 시 별도 ADR
- ~~Q-021~~ **resolved (INFRA-1A.6, 2026-05-12)** — 72 source data/sources_seed.yaml commit. 분포 risk 19% / opportunity 29% / neutral 42% / mixed 10% (AC-027 통과). RSS endpoint 검증은 INFRA-1B.1에서.
- ~~Q-022~~ **resolved by DEC-004** (v0 4 메타 카테고리: 정책 / 경제 / 사회
  / 대중문화)
- ~~Q-024~~ **resolved (INFRA-1A.2)** — v0: APOC standard + Cypher 5.x core; v1+: GDS Community; Enterprise-only 별도 ADR
- Q-025 외부 repo 부트스트랩 cadence
- ~~Q-026~~ **resolved by DEC-006** (vault sync trigger = git push 단일,
  Cloudflare Pages git integration)
- ~~Q-027~~ **resolved by DEC-007** (retention / R2 lifecycle / backup
  schedule)
- ~~Q-028~~ **resolved by DEC-008 → re-resolved by DEC-010** (LLM routing v2
  multi-vendor + Data Science Module + cost ceiling 재산정. DEC-008 의
  Anthropic-only 라우팅은 supersede 됨 — DEC-010 의 GPT default + Anthropic
  dual-vendor + Google exploration-only + minimal cross-vendor review 가
  canonical)
- Q-029 ImpactAssessment v0 embedded vs v1 노드
- Q-030 counterclaim multi-relation v1 도입 우선순위
- Q-031 TTS v1 timing + provider (DEC-005 v0 TTS deferred 연장)
- Q-032 ContentDraft 4-format auto-generate phasing (v1+ newsletter →
  youtube_long → shorts)
- Q-033 외부 플랫폼 auto cross-post timing (Substack / YouTube / X)
- Q-034 Auto retraction trigger 정책 v1+
- SPIKE-001 Neo4j Community + native FTS가 1만 graph object 시점 검색 < 1초
  NFR-001을 만족하는지 (SQLite+FTS5에서 대상 갱신)

## Current validation

- 문서 invariant validator (`bun run invariant:check`) — warning level only
  (ADR-0002 INV-0002-1)
- 코드 acceptance gate는 아직 없음 — `06_ACCEPTANCE_TESTS.md` AC 정의는 Round
  25 canonical(AC-022~AC-033 포함) 반영 완료, 코드 도입 후 자동화 단계 진입

## Needs audit

- `docs/05_RUNBOOK.md`: 배포 파이프라인이 아직 정의되지 않음 — "No deployment
  pipeline currently defined." 상태로 유지
- `docs/current/CODE_MAP.md`, `DATA_MODEL.md`, `RUNTIME.md`, `OPERATIONS.md`,
  `TESTING.md`: 코드 미존재. Neo4j Cypher schema + SQLite relational schema 합의
  후 갱신 필요
- `docs/06_ACCEPTANCE_TESTS.md`: Round 25 canonical 반영 완료 (AC-022~AC-033 +
  TEST-022~TEST-033 신규, DEC-003). 코드 도입 시 TEST 위치 `(planned)` →
  실제 경로 갱신 필요
- `docs/09_TRACEABILITY_MATRIX.md`: Round 25 canonical 반영 완료 (TRACE-001~020
  supersede 표시 + TRACE-021~033 신규). gate evidence는 코드 / SPIKE 결과
  누적 후 갱신

## Links

- PRD: [`../01_PRD.md`](../01_PRD.md)
- HLD: [`../02_HLD.md`](../02_HLD.md)
- Roadmap / status ledger: [`../04_IMPLEMENTATION_PLAN.md`](../04_IMPLEMENTATION_PLAN.md)
- Acceptance tests: [`../06_ACCEPTANCE_TESTS.md`](../06_ACCEPTANCE_TESTS.md)
- Questions: [`../07_QUESTIONS_REGISTER.md`](../07_QUESTIONS_REGISTER.md) (per-file under `../questions/`)
- Decisions: [`../08_DECISION_REGISTER.md`](../08_DECISION_REGISTER.md) (per-file under `../decisions/`)
- ADRs: [`../adr/`](../adr/)
- Ideation source: [`../discovery/research-content-pipeline-ideation.md`](../discovery/research-content-pipeline-ideation.md) — "Current Canonical Direction" 섹션이 canonical view (Round 1~25 누적)

---

Rules:

- Keep this file short.
- Do not append full history.
- Do not copy the full roadmap / phase / slice ledger here.
- If historical reasoning matters, link to ADR/discovery/archive.
- If this file becomes long, compress it.
