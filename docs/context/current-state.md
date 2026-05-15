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
인텔리전스 파이프라인**이다. **10-stage 객체 모델** (Source → Document →
Snapshot → Claim → Dossier → Scenario → **EditorialIntent** → Thesis →
ContentDraft → Publication, ADR-0025 supersedes ADR-0011) 로 구조화하고,
출판 콘텐츠의 한 문장을 Snapshot 까지 **5-hop 이내로 역추적** 가능하게
유지 (NFR-003, DEC-020 Q-042 resolution — EditorialIntent / Source / Document
는 metadata anchor 로 trace 계산에서 선택적 skip 허용) 하며, raw third-party
text 는 클라우드에 저장하지 않는 콘텐츠 생산 시스템이다.

이 repo는 second-brain ideation
[`research-content-pipeline-architecture`](../discovery/research-content-pipeline-ideation.md)
의 "Current Canonical Direction" 섹션(Round 1~25 누적 결론)을 구현하는 외부
코드 repo다. 부트스트랩 시 Round 3 lock만 반영했던 ADR-0003/0004/0007/0008은
2026-05-11 reset에서 R6/R8/R10/R14/R17/R18/R19/R23/R25의 후속 결정을 반영해
ADR-0011~0021로 supersede됐고, 2026-05-11 이후 추가로 ADR-0022~0025 (publishing
stack / LLM routing v2 / Data Science Module / EditorialIntent 10-stage),
ADR-0026~0031 (active source subset / evidence_role / safe-fetch / prompt
injection containment / discovery worker concurrency / research app stack)
이 누적됐다.

## Current roadmap position

- current milestone: `P0-M2` (Source Registry & Collection Queue) — M2 슬라이스 일괄 landed, 게이트 검증 단계 진입. P0-M2-hardening sub-phase 도 진행 중 (`INFRA-1B.3.x-audit` PR #39 landed [R2 upload audit ledger, AC-032 / NFR-008] + `INFRA-1B.3.h1-policy-fix` PR #41 landed [R2 cross-source archive_policy guard, AI-P0-1 legal-safety P0] + `INFRA-1B.1.h1-source-bootstrap-neo4j` PR #44 landed [Neo4j Source node bootstrap + 3-way preflight, AI-P1-2] + `INFRA-1B.3.h2-queue-cli` PR #45 landed [`bun run discovery:process-queue` CLI + new-path `source_not_found_in_graph` TypedQueueError unification + `parseArgs` allowlist fail-fast, AI-P1-3]). P0-M1 게이트도 별도 통과 필요 (SPIKE-001 미실시 — AC-032 audit ledger 코드 enforcement 는 INFRA-1B.3.x-audit 로 landed, Q-044 는 DEC-020 으로 resolved, TRACE-040 anchor → landed).
- active tracks: `INFRA` (primary — INFRA-1B collection pipeline 슬라이스 일괄 landed), `OPS` (cross-cutting — OPS-1A.1 run ledger landed)
- active phase: `INFRA-1B` (게이트 검증 단계); `OPS-1A` (게이트 검증 단계)
- active slice: **M2 own slices INFRA-1B.1 ~ INFRA-1B.5 landed** (P0-M2 gate accept evidence 대상) + **cross-milestone early landed** (P0-M3 slices, M2 phase 안에서 흡수): INFRA-1B.6 (feedback CLI) + OPS-1A.1 (run ledger). Landed PR 목록: #15 (INFRA-1B.1 source registry seed + 1B.1.x hotfix, c51b2ce — busy_timeout / slug-map migration / URL 파싱 / Neo4j pool env), #16 (INFRA-1B.2a safe-fetch, ed09aa5), #17 (INFRA-1B.2b scheduler, 0eec962), #18 (INFRA-1B.2 discovery worker, 896ddf2), #19 (INFRA-1B.3 snapshot fingerprint, 4dfa94f), #20 (INFRA-1B.4 chunker, 06c49d7), #21 (INFRA-1B.5 access-intervention, c3b19c4), #22 (INFRA-1B.6 feedback CLI early-land, 7f4e980), #23 (OPS-1A.1 run ledger early-land, 23de14c). M2 게이트 검증 미실시 evidence: SPIKE-001 (NFR-001 1만 graph object < 1s p95), AC-022/023/024 evidence 확정. 2026-05-13 comprehensive review 가 식별한 doc-code drift 일괄 backfill 됨 (본 retro entry 참조).
  `INFRA-1A.3` landed (PR #14 merged 2026-05-12): R2 permitted-artifact prefix policy + sha256 round-trip tests.
  `INFRA-1A.6` landed (PR #12 merged 2026-05-12): Tier A source seed 72 sources + TEST-027.
  `INFRA-1A.8` landed (PR #10 merged 2026-05-12): Backup runbook docs-only (AC-032).
  `INFRA-1A.7` landed (PR #9 merged 2026-05-12): Scenario/Thesis/Source bidirectional
  schema fields + enum validators + indexes (AC-026, AC-027).
  `INFRA-1A.5` landed (PR #8 merged 2026-05-12): text normalization + sha256 + enum validators.
- last accepted gate: none yet
- next gate (P0-M1 portion): `AC-001` (도메인 객체 **10-stage** 모델 +
  4-tier source layer + Neo4j graph store — ADR-0025 supersedes ADR-0011
  object model + ADR-0012 + ADR-0013); `AC-002` (Neo4j FTS p95 <1s,
  SPIKE-001 미실시 — INFRA-1A.2 소스 코드 위에서 검증 대기); `AC-005`
  (ID prefix lint, TEST-005 통과 ✓); `AC-032` (R2 upload audit ledger
  **code enforcement landed** — INFRA-1B.3.x-audit PR #39 + cross-source
  archive_policy guard INFRA-1B.3.h1-policy-fix PR #41; TRACE-040 anchor →
  landed; Q-044 는 DEC-020 으로 resolved. 잔여 hardening = OPS-1B.h1
  runtime invariant scanner + INFRA-1B.3.h3-audit-hardening v8 trigger
  (planned). Implementation Plan 의 Risks Q-042~Q-048 entry 와 일치)
- next gate (P0-M2 portion): `AC-001`, `AC-020` (P0 fallback only —
  raw_body_hash diff; canonical_text_hash primary 는 P1+), `AC-022`,
  `AC-023`, `AC-024` (P0-M2 게이트 — INFRA-1B 슬라이스 일괄 landed 후
  evidence 확정 대기). **AC-009 (extractor 분기) 는 P0-M3 gate** (EXTR-1A.*
  미진입)
- canonical ledger: `docs/04_IMPLEMENTATION_PLAN.md` (gate set source of
  truth; current-state 는 mirror)

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

1. **P0-M2 게이트 검증** — **M2 own slices = INFRA-1B.1 ~ INFRA-1B.5**
   landed 상태. AC-001 / AC-020 (P0 fallback only) / AC-022 / AC-023 /
   AC-024 evidence 확정 (Tier 분류 / policy gate / access_intervention
   batch report 실 데이터 검증) 후 milestone accept. **참고**: INFRA-1B.6
   (manual feedback CLI) + OPS-1A.1 (run ledger) 은 P0-M3 slice 이나
   M2 phase 안에서 early-landed — **P0-M2 gate acceptance evidence 에는
   포함하지 않음** (각 slice 의 milestone row 에서 별도 평가).
2. **SPIKE-001 실행** — Neo4j Community + native FTS, 1만 graph object 시점
   p95 < 1초 (NFR-001 / AC-002). M1 gate accept 차단 risk.
3. ~~**Q-044 R2 upload audit code enforcement**~~ — **landed (PR #39
   `INFRA-1B.3.x-audit` + PR #41 `INFRA-1B.3.h1-policy-fix`)**. 두 slice 모두
   TRACE-040 anchor 갱신 완료. `src/storage/audit/policy-decisions.ts` +
   `INTENDED_ACTION` + `R2_UPLOAD_DECISION` 4 lifecycle values + snapshot-
   fingerprint r2Put 2 call site 전후 INSERT + cross-source archive_policy
   guard (AI-P0-1, 6 regression tests). 잔여 P0-M2-hardening = (a) OPS-1B.h1
   runtime invariant scanner (`Snapshot.r2_key ↔ policy ↔ audit ledger`
   consistency scan) + (b) INFRA-1B.3.h3-audit-hardening (v8 trigger
   `policy_decisions.intended_action` enum + `upload_attempt_id` correlation)
   — 둘 다 planned. AC-032 / NFR-008 evidence 는 두 hardening slice 완료
   후 accept.
4. **Q-050 운영자 결정 7 항목** (open) — AI search + repo 통합 architecture
   resolution 의 사용자 결정 잔여 (parent_round_id branching semantics /
   mode='mixed' validation profile / termination defaults / migration v8 ALTER
   범위 / ScenarioRevision FK 위치 / EditorialIntent.purpose lock 시점 / 신규
   ADR 발급 시점). resolution 후 INFRA-1B.7b ~ 1B.7e + AGG-1A.6 + DISCOVERY-
   EXT.1 + EXTR-1A.7 slice ready 가능.
5. **CI required check 등록** (DEC-020 Q-048 partial — admin task) —
   `.github/workflows/ci.yml` 가 main branch protection required check 으로
   등록. workflow 자체는 활성, branch protection admin 등록만 남음.

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
- ~~Q-037~~ **resolved by DEC-019** — apoc.lock.nodes 채택, INFRA-1B.6.x 슬라이스에서 implement
- ~~Q-038~~ **resolved by DEC-019** — worker_id CAS 채택, INFRA-1B.3.x 슬라이스에서 implement
- ~~Q-039~~ **resolved by DEC-019** — chunked allSettled 채택, INFRA-1B.2.x 슬라이스에서 implement
- ~~Q-040~~ **resolved by DEC-019** — v0 pre-deploy contract 명문화(docs/05_RUNBOOK.md) + P1-MVP-prep milestone + backfill 위치 lock; framework implement는 DEPLOY-1A.1
- ~~Q-041~~ **resolved by DEC-019** — millis-bearing 일관 통일 채택, DEPLOY-1A.2 슬라이스에서 implement
- ~~Q-042~Q-048~~ **resolved by DEC-020** — NFR-003 5-hop trace path / evidence_role /
  NFR-008 R2 audit code enforcement / invariant validator coverage extension / quota
  module / Doppler secret store / CI required check + branch protection. Implement
  slices: AGG-1A.1 (evidence_role 자동 검증) + **INFRA-1B.3.x-audit landed (PR #39)**
  + OPS-1A.2 (quota module, planned) + INFRA-1A.9-validator-extension (TRACE-041
  anchor, planned) + CI admin task (운영자, pending).
- ~~Q-049~~ **resolved by DEC-021** — revisit policy = TTL + event-driven hybrid;
  snapshot_diff = canonical_text_hash primary + raw_body_hash fallback. Implement
  slices: INFRA-1B.8/9/10.
- Q-050 AI 검색 + repo 통합 architecture — 7 운영자 결정 항목 pending
  (parent_round_id branching / mode='mixed' validation / termination defaults /
  v8 ALTER 범위 / ScenarioRevision FK 위치 / EditorialIntent.purpose lock /
  신규 ADR 발급). Implement slices: INFRA-1B.7a~e + AGG-1A.6 + DISCOVERY-EXT.1
  + EXTR-1A.7 (대부분 P1+; INFRA-1B.7a 만 P0-M6 흡수).
- ~~Q-051~~ **resolved by DEC-022 + DEC-023** — UI stack lock (Astro shell +
  React island + shadcn/Radix + Tailwind + TanStack + SSE) + Round 1 routing
  default 5 항목 lock. Implement slices: RESEARCH-1A.0/API0 (P0-M6) +
  RESEARCH-1A.1~5 (P1+). ADR-0031 accepted.
- ~~Q-052~Q-059~~ **resolved (6) + deferred (2) by DEC-024** — 2026-05-15 12-layer
  adversarial review + GPT cross-review 종합. Resolved: Q-052 (main branch protection
  3중 충돌) / Q-053 (chunker archive_policy gate) / Q-054 (Source profile canonical
  store) / Q-056 (첫 publishable format) / Q-058 (source_role multi-dim) / Q-059
  (attention budget). Deferred (re-entry gate 명시): Q-055 (dataset MVP timing,
  PUB-1A.5 retro) / Q-057 (claim promotion ADR, EXTR-1A.1 entry). Engineering
  AI-P0-1 + AI-P1-8 landed (PR #41 + #42).
- SPIKE-001 Neo4j Community + native FTS가 1만 graph object 시점 검색 < 1초
  NFR-001을 만족하는지 (SQLite+FTS5에서 대상 갱신)

## Current validation

- 문서 invariant validator (`bun run invariant:check`) — warning level only
  (ADR-0002 INV-0002-1)
- 코드 acceptance gate는 아직 없음 — `06_ACCEPTANCE_TESTS.md` AC 정의는 Round
  25 canonical(AC-022~AC-033 포함) 반영 완료, 코드 도입 후 자동화 단계 진입

## Needs audit

- `docs/05_RUNBOOK.md`: Pre-deploy schema migration contract 섹션 (DEC-019) +
  Backup/Retention 섹션 (INFRA-1A.8) + Doppler integration (DEC-020 Q-047) 모두
  landed. publish pipeline (PUB-1A.*) 은 P0-M6 진입 시 추가.
- `docs/current/{CODE_MAP,DATA_MODEL}.md`: 2026-05-13 comprehensive review
  backfill 로 13d61af 기준 갱신 완료. RUNTIME.md, OPERATIONS.md 는 다음
  thin-doc 갱신 사이클 (P0-M2 게이트 검증 후) 에 대상.
- `docs/current/TESTING.md`: 2026-05-15 갱신 완료 — test count 515 → 521
  (post-AI-P0-1 PR #41), Last verified SHA 75706c4 → 327f4b2 (AI-P1-9
  DOC-SYNC-2026-05-15 안에서 갱신).
- `docs/06_ACCEPTANCE_TESTS.md`: AC-001/018/020 본문이 Round 1~25 reflow
  이후 일부 stale 표현 (9-stage anchor / content_hash sha256 단일 hash)
  잔존 — 본 PR (claude/fix-doc-drift-5UskX) 에서 일괄 갱신.
- `docs/09_TRACEABILITY_MATRIX.md`: TRACE-001/004/005/016 등 초기 row 가
  9-stage / ADR-0011 표현 유지. Gaps 섹션이 Q-020/021/024 등 이미
  resolved 된 Q 를 미해결로 설명 — 본 PR 에서 일괄 갱신.
- AC-043 (ADR-0027 evidence_role schema) row 는 `06_ACCEPTANCE_TESTS.md`
  line 65 에 존재 — **acceptance criterion `defined` 상태** (ADR-0027 +
  DEC-020 Q-043 resolution 으로 schema lock 완료). 자동 검증 (TEST-043)
  은 AGG-1A.1 슬라이스 안에서 구현 예정 — 현재 AGG-1A.1 / TEST-043 /
  evidence_role enforcement 는 **planned, not landed**. AC-044 (minimum
  coverage) row 도 동일 — defined / planned (PUB-1A.5 운영자 manual
  verify + AGG-1A.1 자동 검증 의존).

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
