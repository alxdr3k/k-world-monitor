# 10 Project Retrospective

프로젝트 중/후의 회고. Milestone마다 갱신하고, 종료 시 외부 knowledge base
승격을 위한 extraction packet을 준비한다.

회고는 "무엇을 배웠는가"를 기록하고, extraction packet은 "그 중 무엇을 외부
knowledge base로 승격할 후보인가"를 기록한다. 두 단계를 분리한다.

## Cadence

- Milestone 회고 (milestone 종료 시): 아래 사본 추가. lesson 후보를 식별만 하고 자동 승격은 하지 않는다.
- Final 회고 (프로젝트 종료 시): extraction packet 준비
  ([`templates/EXTRACTION_TEMPLATE.md`](templates/EXTRACTION_TEMPLATE.md)).

승격 자체는 외부 knowledge base의 자체 review / ingestion 프로세스를 통해
이뤄진다. 회고에서 candidate로 표시했다고 해서 자동 승격되는 것은 아니다.


## First Publication Retrospective Lock (DEC-013 follow-up)

아래 블록은 **PUB-1A.5 첫 발행 직후 반드시 채워야 하는 placeholder**다.
새 ADR/DEC/Q 도입은 이 회고 블록 작성/검토 이후로 미룬다(DEC-013 운영 원칙 1).

```markdown
## First Publication Retrospective — PUB-1A.5

- Publication date:
- Retrospective date:
- Scope: 한국 부동산 시장/정책 risk 시나리오 첫 발행
- Participants:

### 1) Delivery outcome
- 발행 여부 (yes/no):
- 발행 채널: 자체 사이트 / Substack / YouTube / X
- 발행 cadence 목표(weekly 1) 충족 여부:

### 2) DEC-013 cap 운영 결과
| Metric | Target cap | Actual | Status | Note |
|---|---|---|---|---|
| daily_candidate_item_count | <= 20 |  |  |  |
| daily_promoted_claim_count | 5~10 |  |  |  |
| weekly_dossier_count | 1 |  |  |  |
| weekly_publication_count | 1 |  |  |  |

### 3) Quality / evidence review
- Editorial Quality Rubric (AC-036~042) 수동 검증 결과:
- Dossier evidence_role coverage (AC-044) 점검 결과:
- 주요 cite/correction 이슈:

### 4) What worked
-

### 5) What failed or slowed us down
-

### 6) Decision follow-up candidates
- [ ] 신규 ADR 필요
- [ ] 신규 DEC 필요
- [ ] Q 등록 필요
- [ ] 없음 (현재 결정 체계 유지)

> 주의: 이 섹션은 "후보 식별"만 한다. 실제 ADR/DEC/Q 신규 도입은
> retrospective 확정 후 별도 PR에서 수행한다.
```

## Comprehensive Review — 2026-05-13 (P0-M2 게이트 검증 직전)

> 본 entry 는 milestone 종료 회고가 아니라, P0-M2 (Source Registry & Collection
> Queue) 게이트 검증 직전 시점의 **전수조사형 적대적 리뷰** 결과를 기록한다.
> 리뷰 범위: 기획(PRD/HLD/ADR/DEC) + 설계(객체 모델 / storage seam / LLM
> routing) + 구현(src/, scripts/, migrations/, tests/) + thin docs 정합성 +
> CI/CD 상태. 발견 자체는 사실 기록이고, 사용자 결정이 필요한 항목은
> 별도 `docs/questions/Q-042 ~ Q-048` 로 등록한다. 결정이 필요 없는 정합성
> fix 는 본 PR (`claude/comprehensive-code-review-FE0w3` 브랜치) 에서 직접
> 처리한다.

### Scope

- 코드: `src/**/*.ts` 35 파일, `scripts/**/*.ts` 3 파일, `migrations/**/*` 7
  파일, `tests/**/*.ts` 18 파일.
- 문서: PRD/HLD/Implementation Plan/Acceptance Tests/Traceability Matrix +
  `docs/adr/0001~0030` (30 ADR) + `docs/decisions/DEC-001~DEC-019` (19 DEC) +
  `docs/questions/Q-001~Q-041` (27 Q) + `docs/current/` 5 파일 +
  `docs/context/current-state.md`.
- 적대적 관점: security (SSRF, injection, race), resource leak, idempotency,
  타입 안전성, doc-code drift, supersede chain 정합성, scope creep, 운영 부담
  vs "1인 운영자" 제약, P0-M6 "2주 목표" 의 일정 risk surface.

### 1) Code 발견 (P-grade)

| 등급 | 위치 | 발견 | 처리 |
|---|---|---|---|
| P0 | — | 차단(보안/데이터 손실) 수준 결함 없음 | — |
| P1 | `src/discovery/worker/run-discovery.ts` main finally | `closeDb()` / `closeDriver()` 호출 누락. graceful shutdown 시 WAL bloat + Neo4j driver leak 가능. OS 종료 시는 cleanup 되지만 cron 환경에서는 누적 위험 | **본 PR fix** |
| P1 | `.github/workflows/` | `doc-governance.yml` 만 active. `ci.yml.example` / `invariant-check.yml.example` / `cd.yml.example` / `doc-freshness.yml.example` 가 `.example` 확장자 그대로 — `bun test` (18 test files, 200+ cases) + `bun run typecheck` + invariant validator 가 PR 마다 자동 실행 안 됨 | **본 PR fix (advisory 만 활성)** |
| P1 | `docs/_generated/` | `AGENTS.policy.md` Cross-document invariant tracking 의무 read 대상 (scope_tree / term_usage / effective_invariant_policy) 인데 디렉토리 자체 부재 | **본 PR fix (`bun run invariant:regen`)** |
| P1 | invariant validator (`scripts/validate_invariants.ts`) | ADR INV → 코드 grep cross-ref 검증 부재. INV-0012-3 (raw_cloud_policy=always_prohibited) / INV-0028-1~6 (safe-fetch 8단 방어) 가 코드에서 강제되는지 정적 검증 없음 | **Q-045 (사용자 결정 필요)** |
| P2 | `src/discovery/fetch/safe-fetch.ts:215-220` | DNS rebinding TOCTOU — scope-out 인정 + 주석화. ADR-0028 scope.out 명시 | by design |
| P2 | `src/discovery/worker/snapshot-fingerprint.ts:466-527` | R2 back-fill TOCTOU — dedup path 에서 prohibited source link race 가능. r2Delete 안 함으로 완화 | by design |
| P2 | `src/discovery/worker/run-discovery.ts:229-245` | TextDecoder charset `as any` cast. 런타임 try-catch 보완 | code smell, deferred |
| P2 | `src/storage/r2/client.ts:33,42` | Bun.S3Client 운영 검증 부재 — CI/local test 에서 실행 흔적 없음. R2 secret 등록 이후만 검증 가능 | M2 gate 검증 시점 |
| P3 | `src/ops/run-ledger.ts:76-107` | startRun 매번 new ULID. **completeRun CAS gate (`WHERE status='running'`)** 가 있어 double-complete 차단. 호출자 멱등성 책임 | by design |

### 2) Doc-code drift — 8 건

| # | 분류 | 위치 | 사실 | 처리 |
|---|---|---|---|---|
| D1 | Hard drift | `docs/current/CODE_MAP.md:3` | "Last verified against code: 101719c" — `git cat-file -t 101719c` → fatal: Not a valid object name. **phantom SHA** | **본 PR fix** |
| D2 | Hard drift | `docs/current/DATA_MODEL.md:3`, `docs/current/TESTING.md:3` | "a581e72" 는 boilerplate sync commit. v2~v6 schema migration 도입 이전 시점 | **본 PR fix** |
| D3 | Missing update | `docs/current/CODE_MAP.md` Source/Tests 표 | src 12 파일 + test 8 파일 누락 (`src/discovery/scheduler/*`, `src/discovery/worker/*`, `src/ops/run-ledger.ts`, `src/pipeline/feedback/*` + 대응 tests) | **본 PR fix** |
| D4 | Hard drift | `docs/current/DATA_MODEL.md` migrations 표 | v2 (enum_constraints) / v3 (slug_map) / v4 (run_ledger_idx) / v5 (crawl_state) / v6 (discovery_queue) 누락 | **본 PR fix** |
| D5 | Stale evidence | `docs/06_ACCEPTANCE_TESTS.md` TEST-019/020/024/025 row | `(planned)` 표시인데 실제 `tests/unit/run_ledger_test.ts` (29 tests), `tests/unit/snapshot_fingerprint_test.ts`, `tests/unit/access_intervention_test.ts` (26 tests), `tests/unit/feedback_test.ts` 가 main 에 landed | **본 PR fix** |
| D6 | Process violation | git log `13d61af`~`4dfa94f` | "When changing code" 규칙 (AGENTS.md L46-60) — code 변경 commit 7건이 thin docs 동반 갱신 0회 | 본 PR 로 backfill, future 는 PR template 또는 hook 검토 |
| D7 | Stale status | `docs/04_IMPLEMENTATION_PLAN.md` slices 표 6 rows | INFRA-1B.2a/2b/2/3/4/6, OPS-1A.1 = `in_progress` 인데 git history 상 main 에 merge 됨 (`ed09aa5`, `0eec962`, `896ddf2` 등) | **본 PR fix** |
| D8 | Inconsistent supersede | `docs/02_HLD.md:6` | "9-stage 파이프라인" — ADR-0025 (10-stage EditorialIntent) supersede 후 overview 문장 미갱신 | **본 PR fix** |

### 3) Planning / scope 위험 surface

- **NFR-003 5-hop trace 의무 vs 10-stage**: ADR-0025 가 ADR-0011 의 object model 만 supersede 하지만, NFR-003 (PRD `01_PRD.md:156`) 의 trace path 가 5-hop 으로 명시되는데 ADR-0025 의 EditorialIntent 추가 시 정합성 불명 → **Q-042 → DEC-020 resolved**: 원본 기준 조사 결과 ADR-0011 의 5-hop = Publication → ContentDraft → Thesis → Scenario → Claim → Snapshot (6 노드 / 5 edge). Source / Document 는 trace 종점이 아니라 Snapshot 의 metadata anchor. ADR-0025 INV-0025-5 가 이미 "단축 path 보존" 의무 lock — EditorialIntent 는 선택적 skip 단계. NFR-003 본문 reflow 로 의도 surface.
- **AC-044 (evidence_role minimum coverage, ADR-0027)** 가 `04_IMPLEMENTATION_PLAN.md:83` P0-M6 게이트 안에 들어가 있는데 **`06_ACCEPTANCE_TESTS.md` 에 정의 row 가 있는지 미검증** → **Q-043 → DEC-020 resolved (a 옵션)**: AC-043 / TEST-043 / REQ-028 정식 row 추가. AGG-1A.1 슬라이스 안에서 자동 검증. TRACE-038 신규.
- **PRD REQ-009/010 ADR ref 가 ADR-0006 인용** (이미 ADR-0023 으로 superseded). PRD §"Related Requirements" L309-321 에서 ADR-0023 / ADR-0024 / DEC-010 으로 reflow 필요 → **본 PR fix (이전 commit bbdd1c0)**.
- **HLD `02_HLD.md:226` "GDS plugin"** 이 v0 의무처럼 적혀 있는데 Q-024 resolved 결과는 "v0 APOC standard + Cypher 5.x core; v1+ GDS Community" → **본 PR fix (이전 commit bbdd1c0)**.
- **PRD `01_PRD.md:218` Q-004 status** 가 "open" 으로 적혀 있는데 `current-state.md:175` 는 resolved (INFRA-1A.2) → **본 PR fix (이전 commit bbdd1c0)**.

### 4) Operating risk surface (사용자 결정 필요 → 모두 DEC-020 resolved 2026-05-13)

- **NFR-008 "raw 0건 cloud 저장" audit 위치**: 코드에서 `policy_decisions` ledger row 가 R2 upload 시점에 어디서 INSERT 되는가? `src/storage/r2/policy.ts` 는 prefix check 만, `src/discovery/worker/snapshot-fingerprint.ts` 는 raw_cloud_policy check 만 — **audit ledger 명시적 INSERT 누락 위험** → **Q-044 → DEC-020 resolved**: caller-side hybrid 채택, `src/storage/audit/policy-decisions.ts` 신규, INFRA-1B.3.x-audit 슬라이스 등록.
- **Tier 0 호출 quota auditor**: DEC-010 cap "Tier 0 일일 5회" 가 코드에서 enforce 되는가? `src/ops/run-ledger.ts` 의 `startRun` 은 tier 0~3 record 만 하고 cap check 없음 — 호출자 책임 그대로 두면 silent drift 위험 → **Q-046 → DEC-020 resolved**: 일반화 quota module 채택 (4-layer Tier 0/soft/hard/weekly 일괄), OPS-1A.2 entry condition.
- **Secret management — Doppler vs `.env`**: API key 4종 (OpenAI / Anthropic / Google / R2) 의 운영 방법 결정 부재 → **Q-047 → DEC-020 resolved**: Doppler 채택 (사용자 다른 프로젝트 사용 중). `.env.example` reference + RUNBOOK Doppler integration 섹션 추가. PUB-1A.5 entry condition.
- **CI branch protection**: 본 PR 이 `ci.yml` / `invariant-check.yml` 을 advisory (warning-level) 로 활성화. **required check 로 등록할지는 사용자 결정** → **Q-048 → DEC-020 resolved**: `ci.yml` required + doc-freshness.yml 활성 + main push 정책 해제 (PR-only).

### 5) "2주 목표" lock 확인

P0-M6 "2주 목표 lock (DEC-005)" 는 **사용자 명시 지시로 fixed**. 일정 reflow 권고는 reject. 즉, M1~M5 게이트 dependency chain 을 2주 안에 통과시키는 작업 계획을 별도로 구성한다 (본 retro 와 별도 work item — 본 PR 범위 밖).

### 6) 본 review 의 outcome 작업 (본 PR `claude/comprehensive-code-review-FE0w3`)

- 사용자 결정 불필요 fix 일괄 처리 (commit bbdd1c0 + 93d368c): thin docs SHA + 누락 파일 + AC TEST 위치 + IMPLEMENTATION_PLAN status + HLD/PRD supersede drift + closeDb/closeDriver finally hook + CI workflow rename (advisory) + `docs/_generated/` regen.
- 사용자 결정 필요 항목: `docs/questions/Q-042 ~ Q-048` 신규 등록 (commit bbdd1c0).
- **2026-05-13 사용자 응답**: 7개 Q 일괄 결정 + Q-049 신규 (재방문 / 캐싱 / 변경 감지) — DEC-020 일괄 resolution 으로 lock. AC-043 / TEST-043 / REQ-028 proposed → defined/planned/must promote, NFR-003 본문 reflow, main push 정책 해제 (PR-only), Doppler secret store, doc-freshness 활성, 후속 슬라이스 4개 등록 (INFRA-1A.9 / INFRA-1B.3.x-audit / OPS-1A.2 refined / PUB-1A.5 entry).
- **2026-05-13 사용자 후속 메타 의문**: "GPT/Claude 도 web search 가능한데 본 repo 의 수집 기능이 뭐가 다른가?" → Q-050 신규 등록 (AI 검색 + repo crawler 통합 architecture, 시나리오 1/2 + a/b/c/d 분류 + 다중 라운드 context propagation). Q-049 와 cross-cutting (article-level conditional fetch + force-revalidate option). resolution 은 별도 PR 에서 처리.
- **2026-05-14 사용자 추가 round**: CLI ask → Web pivot (mobile-first) → Q-051 신규 (UI surface 결정). PR #33 (Q-049/050/051 combined) 진행. UI-spec 초안 작성 (`docs/design/ui-spec-research-app.md`). 사용자 결정 (Q-A ~ Q-K) lock: **same repo / shared schema / shared design system, separate deployment artifact** (Topology B, GPT 31 리뷰 lock) — anchor blog = CF Pages public only / `/ops` + `/api` = Hetzner same-origin + Tailscale-only v0 + 폰 Ask/round/cite-check 가능 + draft 편집 데스크탑 + Scenario graph **모바일 zoom/pan 가능** + AccessIntervention 모바일 1-tap + 발행 단계 운영자 수동 마킹 + fork_session enum (operator 명시) + exploratory → directed transition 운영자 명시 promote. P0-M6 안에는 **RESEARCH-1A.0** minimum scope 만 흡수 (mobile read-only), full ask/round/orchestration 은 P1+ phasing.
- **2026-05-14 사용자 후속 결정**: Q-049 + Q-050 GPT 추가 답변 + 본 메타 리뷰의 보강 항목 *모두 채택*. ResearchSession 의 multi-round 지원 의문 → ExplorationRound 1:N child 추가 lock. Q-049/050/051 통합 PR (`claude/q-049-q-050-resolution`) 으로 본문 reflect + 슬라이스 등록.
- **2026-05-14 Q-051 신규 (CLI ask + routing) + round 2 pivot (web mobile-first)**: 사용자 "폰으로도 작업 가능해야 함" → UI surface 가 CLI 가 아닌 **web (mobile-first)** 로 reframe. UI-spec 초안 `docs/design/ui-spec-research-app.md` 작성. **스택 권고 (Q-051 사용자 결정 #6 미응답 — GPT 31 리뷰 기반 권고)** = bun + Hono + Astro + React island + Tailwind. **Hosting = Topology B lock** (Public CF Pages + Private Hetzner same-origin, GPT 31 리뷰 후 Cloudflare Workers default reject). Auth = Tailscale-only v0, v1+ Cloudflare Tunnel + Access. **CLI phasing**: P0-M6 까지 CLI 가 critical path (PUB-1A.5 publish), P1+ 부터 web /ops 가 primary, CLI 는 secondary 자동화 용도.

### 7) Lesson candidates (외부 KB 승격 후보 식별만)

| Candidate | 간단 설명 | Cross-project 가치? | Promote later? |
|---|---|---|---|
| "thin docs SHA pinning 은 commit hook 또는 PR template 없이는 100% drift" | doc-heavy repo 에서 `Last verified against code: <SHA>` 류 contract 는 자동화 없이 유지 불가능. PR template 의 checkbox 또는 pre-push hook 필요 | yes | later |
| "in-flight 표기 + landed status 분리 의무" | PR open 시점과 main merge 시점의 status reflow 가 분리되어 있으면 둘 다 stale. PR merge event hook 으로 자동 reflow 검토 | yes | later |
| "CI `.example` 확장자는 silent disable 함정" | boilerplate 가 workflow file 을 `.example` 로 배포하면 rename 안 하는 한 활성화 안 됨. boilerplate sync 시점에 active workflow inventory check 필요 | yes | later |

### 8) Actions (본 PR 처리 / 후속 PR)

| Action | Owner | 위치 | 상태 |
|---|---|---|---|
| 본 retro entry 작성 | claude | `docs/10_PROJECT_RETROSPECTIVE.md` | **landed (본 PR)** |
| Q-042 ~ Q-048 등록 | claude | `docs/questions/` | **landed (본 PR)** |
| thin doc drift fix | claude | `docs/current/{CODE_MAP,DATA_MODEL,TESTING}.md`, `docs/06_ACCEPTANCE_TESTS.md`, `docs/04_IMPLEMENTATION_PLAN.md`, `docs/context/current-state.md`, `docs/02_HLD.md`, `docs/01_PRD.md` | **landed (본 PR)** |
| closeDb/closeDriver finally hook | claude | `src/discovery/worker/run-discovery.ts` | **landed (본 PR)** |
| CI workflow rename (advisory) | claude | `.github/workflows/` | **landed (본 PR)** |
| `docs/_generated/` regen | claude | `docs/_generated/` | **landed (본 PR)** |
| Q-042~Q-048 resolution → 후속 PR | user 결정 후 claude | TBD | pending |

---

## Research App `/ops` UI stack lock (DEC-022 / Q-051 #6, 2026-05-14)

### Context

Q-051 (Research App UI surface) round 2 에서 CLI → Web (mobile-first)
pivot + GPT 31 review 로 Topology B (CF Pages public + Hetzner private
same-origin) lock 후, 구체 frontend stack 만 미결정 상태로 round 14/15
까지 §14 #1 pending. round 16 P1 finding 처리 후 사용자가 GPT 32 review
(2026-05-14) 를 전달하며 stack lock 의무 진행.

### GPT 32 review 권고 요약

- A' lock — Astro + React island + shadcn/ui + Radix + Tailwind + TanStack
  Query + SSE.
- 이유 6점: (1) Astro anchor 일관성 (ADR-0022) / (2) `/ops` = AI research
  console (SPA-grade interaction 필요) / (3) LLM coding 안전성 (React 패턴
  /예제 압도적) / (4) shadcn+Radix mobile drawer/sheet 표준 / (5) TanStack
  Query 의 cache invalidation 표준 / (6) Solid/Svelte/Vue/HTMX reject.

### Claude critical review (DEC-022 안에 흡수)

GPT 권고 안에 명시되지 않은 6 개 critique 를 DEC-022 본문에 직접 추가:

| Critique | 핵심 | DEC-022 lock |
|----------|------|--------------|
| 1. React island hydration cost | 모바일 LTE LCP 영향 ≈ 70KB gzip | `client:visible` directive 우선, scenario graph 만 `client:load` |
| 2. shadcn/ui copy-paste 위치 | npm dep 가 아니라 CLI copy-paste | `src/shared/ui/` 디렉토리 lock — public + ops 공유 |
| 3. TanStack Query phasing | P0 의무 여부 | **P0-M6 = Astro SSR + Tailwind only**, P1+ 부터 도입 |
| 4. ADR-0029 발급 시점 | 본 PR 안 vs 후속 | RESEARCH-1A.1 슬라이스 시작 직전 (별도 PR) — DEC-022 anchor |
| 5. PWA 호환성 (RESEARCH-1A.4) | service worker + IndexedDB + React island | Workbox + Astro adapter, TanStack Query optimistic update 와 sync |
| 6. Voice input 통합 (RESEARCH-1A.5) | shadcn Button + MediaRecorder | 자연스럽게 동작 |

### Decision

DEC-022 lock — 6 layer stack (Astro shell + React 18 island + Tailwind +
shadcn/ui + Radix + TanStack Query v5 + SSE) + phasing (P0-M6 = SSR only,
P1+ = full stack) + 신규 ADR-0029 발급 의무.

### Outcome 작업 (본 PR 안)

| Action | 위치 | 상태 |
|--------|------|------|
| DEC-022 발급 | `docs/decisions/DEC-022.md` | **landed (본 PR)** |
| Q-051 status: open → resolved + 결정 결과 표 | `docs/questions/Q-051.md` | **landed (본 PR)** |
| UI-spec §14 #1 stack pending → lock | `docs/design/ui-spec-research-app.md` | **landed (본 PR)** |
| UI-spec §13 Topology B 본문에 shadcn+Radix+TanStack Query 추가 | 동상 | **landed (본 PR)** |
| 04 PLAN RESEARCH-1A.1/.2/.3/.4 artifacts 에 stack 명시 | `docs/04_IMPLEMENTATION_PLAN.md` | **landed (본 PR)** |
| 신규 ADR-0029 (가칭 Research App /ops Stack) 발급 | `docs/adr/0029-*.md` | deferred — RESEARCH-1A.1 슬라이스 직전 (별도 PR) |

---

## Milestone Retrospective — (none yet)

> P0-M1 (Schema & Bulk Store Bootstrap) 종료 시점에 첫 milestone 회고를 추가
> 한다. 현재는 INFRA-1A.1 (도메인 ADR + 글로서리 lock)만 landed 상태로,
> milestone 종료에 도달하지 않음.

milestone 회고를 추가할 때 사용할 사본:

```markdown
## Milestone Retrospective — <Milestone name>

- Date:
- Attendees:

### What went well

- ...

### What didn't

- ...

### What confused us

- ...

### Lesson candidates

| Candidate | 간단 설명 | Cross-project 가치? | Promote later? |
|---|---|---|---|
|  |  | yes / no | yes / no / later |

### Actions

| Action | Owner | Due |
|---|---|---|
|  |  |  |
```

> Milestone 회고는 lesson candidate를 식별만 한다. 외부 knowledge base로의 정식
> 승격은 Final Retrospective의 extraction packet에서 일괄 처리한다.
>
> 즉시 승격이 필요한 reusable cross-project 지식 또는 major decision
> candidate가 있을 때만 milestone 시점에서
> [`templates/EXTRACTION_TEMPLATE.md`](templates/EXTRACTION_TEMPLATE.md)을
> 적용한다.

---

## Final Retrospective

프로젝트 종료 시 작성. 현재는 P0-M1도 완료되지 않은 시작 단계이므로 비어 있다.

### Outcomes vs Goals

- PRD 목표 대비 달성도: TBD
- 주요 성공/실패: TBD

### Durable Lessons

이 프로젝트에서 지속 가치가 있다고 판단된 교훈. 각 항목은 한 줄 제목과 한 줄
요약으로 짧게 유지한다. 정식 외부 knowledge base 승격 후보 정의는 아래
extraction packet에서 구조적으로 다룬다.

| Lesson 제목 | 한 줄 요약 | Extraction packet 연결 (EX-###) |
|---|---|---|

### Extraction packet

프로젝트 종료 시
[`templates/EXTRACTION_TEMPLATE.md`](templates/EXTRACTION_TEMPLATE.md)을 채워
외부 knowledge base 승격 범위를 명시한다. Template이 canonical이며, 본 문서는
template 사본을 인라인으로 복제하지 않는다.

핵심 약속: 모든 row는 candidate이고, `Do not promote`를 비우지 않으며, raw
Q&A/draft는 그대로 승격하지 않고, source anchor는 추측하지 않는다.

### Numbers

- Elapsed time: TBD
- Scope changes: TBD
- Incidents: Runbook 참고.
