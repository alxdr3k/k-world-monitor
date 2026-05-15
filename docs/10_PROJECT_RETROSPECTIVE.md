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
- **2026-05-14 Q-051 신규 (CLI ask + routing) + round 2 pivot (web mobile-first)**: 사용자 "폰으로도 작업 가능해야 함" → UI surface 가 CLI 가 아닌 **web (mobile-first)** 로 reframe. UI-spec 초안 `docs/design/ui-spec-research-app.md` 작성. **스택 lock (Q-051 #6 — DEC-022, 2026-05-14 GPT 32 review + 사용자 동의)** = A' (Astro 5.x shell + React 18 island + Tailwind + shadcn/ui + Radix UI + TanStack Query v5 + SSE) 6 layer. **Hosting = Topology B lock** (Public CF Pages + Private Hetzner same-origin, GPT 31 리뷰 후 Cloudflare Workers default reject). Auth = Tailscale-only v0, v1+ Cloudflare Tunnel + Access. **CLI phasing**: P0-M6 까지 CLI 가 critical path (PUB-1A.5 publish), P1+ 부터 web /ops 가 primary, CLI 는 secondary 자동화 용도. **Q-051 status: open 유지** — Round 1 routing default 5 항목 (line 460-480) 미해결 (round 17 Codex finding 후 resolved → open). #6 stack 만 partial lock by DEC-022.

### 7) Lesson candidates (외부 KB 승격 후보 식별만)

| Candidate | 간단 설명 | Cross-project 가치? | Promote later? |
|---|---|---|---|
| "thin docs SHA pinning 은 commit hook 또는 PR template 없이는 100% drift" | doc-heavy repo 에서 `Last verified against code: <SHA>` 류 contract 는 자동화 없이 유지 불가능. PR template 의 checkbox 또는 pre-push hook 필요 | yes | later |
| "in-flight 표기 + landed status 분리 의무" | PR open 시점과 main merge 시점의 status reflow 가 분리되어 있으면 둘 다 stale. PR merge event hook 으로 자동 reflow 검토 | yes | later |
| "CI `.example` 확장자는 silent disable 함정" | boilerplate 가 workflow file 을 `.example` 로 배포하면 rename 안 하는 한 활성화 안 됨. boilerplate sync 시점에 active workflow inventory check 필요 | yes | later |
| "Retrospective / 본문 heading 의 첫 token 이 ID-PATTERN (DEC-NNN / ADR-NNN / Q-NNN 등) 이면 doc-governance lint 가 두 번째 canonical definition 으로 탐지 → duplicate definition CI fail" | `scripts/check-doc-governance.rb` line 274 의 heading definition regex (`^\s{0,3}#+\s+\`?(ID-PATTERN)\`?(?::|\b)`) 가 ID 로 시작하는 heading 을 strong definition 으로 인식. 신규 DEC/ADR/Q 발급 후 retrospective / 다른 doc 에서 reference 시 heading 첫 token 을 일반 단어 ("Research App UI stack lock", "First Publication Retrospective Lock" 등) 로 두고 ID 는 괄호 안 reference 형태로 배치하면 우회 가능. **재발 방지 권고**: (1) 신규 DEC/ADR/Q 발급 직후 retrospective entry 작성 시 heading 첫 token = 일반 단어 패턴 의무. (2) 기존 안전 패턴 참조: line 19 "First Publication Retrospective Lock (DEC-013 follow-up)" — DEC ID 가 괄호 안. (3) Local pre-push hook 또는 PR template checkbox 로 "doc-governance lint 통과" 확인 추가 검토 | yes (doc-heavy repo 운영 일반 규칙) | later |

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
| 4. 신규 ADR 발급 시점 | 본 PR 안 vs 후속 | RESEARCH-1A.1 슬라이스 시작 직전 (별도 PR) — DEC-022 anchor. ADR-0029/0030 점유로 다음 번호 ADR-0031 사용 |
| 5. PWA 호환성 (RESEARCH-1A.4) | service worker + IndexedDB + React island | Workbox + Astro adapter, TanStack Query optimistic update 와 sync |
| 6. Voice input 통합 (RESEARCH-1A.5) | shadcn Button + MediaRecorder | 자연스럽게 동작 |

### Decision

DEC-022 lock — 6 layer stack (Astro shell + React 18 island + Tailwind +
shadcn/ui + Radix + TanStack Query v5 + SSE) + phasing (P0-M6 = SSR only,
P1+ = full stack) + 신규 ADR-0031 발급 의무 (ADR-0029/0030 점유로 다음 번호).

### Outcome 작업 (본 PR 안)

| Action | 위치 | 상태 |
|--------|------|------|
| DEC-022 발급 | `docs/decisions/DEC-022.md` | **landed (본 PR)** |
| Q-051 partial resolution (#6 UI stack lock) + 결정 결과 표 (Q-051 status 는 routing default 5 항목 미해결로 **open 유지** — round 17 Codex finding 후 resolved 에서 되돌림) | `docs/questions/Q-051.md` | **landed (본 PR)** |
| UI-spec §14 #1 stack pending → lock | `docs/design/ui-spec-research-app.md` | **landed (본 PR)** |
| UI-spec §13 Topology B 본문에 shadcn+Radix+TanStack Query 추가 | 동상 | **landed (본 PR)** |
| 04 PLAN RESEARCH-1A.1/.2/.3/.4 artifacts 에 stack 명시 | `docs/04_IMPLEMENTATION_PLAN.md` | **landed (본 PR)** |
| 신규 ADR-0031 (가칭 Research App /ops Stack) **placeholder stub** 발급 (status: proposed, ADR-0029/0030 점유 회피로 다음 번호) | `docs/adr/0031-research-app-ops-stack.md` | **stub landed (본 PR, round 18)** — body 본격 작성 (dep version / config / client:\* policy / 추가 INV / bundle budget) 은 RESEARCH-1A.1 슬라이스 시작 직전 별도 PR 로 deferred |

---

## Research App routing default lock (DEC-023 / Q-051 R1, 2026-05-15)

### Context

PR #33 (Q-049/050/051 combined resolution) merge 후 Q-051 status: open
유지. 미해결 5 항목 = Round 1 routing default (no-context behavior /
classifier 활성 시점 / non-sensitive threshold / fork inheritance /
`.kwm/` 위치). 본 5 항목은 product UX 와 기술 implementation 혼합 영역
이라 분리 원칙 따라 GPT 기술 검토 (GPT 33) 후 사용자 동의로 lock.

### GPT 33 review 권고 (2026-05-15, 사용자 채택)

| # | 항목 | 권고 default |
|---|------|--------------|
| 1 | flag 없고 active context 도 없음 | API/CLI = error, Web UI = explicit one-tap new_session 버튼 |
| 2 | AI intent classifier 활성 시점 | RESEARCH-1A.2 이후 advisory-only |
| 3 | non-sensitive auto-route | 표시만 자동변경 X, `KWM_AUTO_ROUTE_CONFIDENCE_MIN` reserved-inactive |
| 4 | fork metadata 승계 | side_exploration=α (fresh), derivative=β (soft inherit mode+editorial_intent_id), γ deep inherit disallowed |
| 5 | `.kwm/` 위치 | deferred 유지, 필요 시 XDG |

### 분리 원칙 follow-up

5 항목 모두 기술 / phasing / 운영 convention 영역 — 사용자가 UX 측면
별도 검토 없이 GPT 권고 그대로 채택. 단 #1 의 "API error + Web UI
one-tap" 분리 lock 은 GPT 권고가 UX 측면도 함께 다룬 결과 — 운영자
모바일 UX (Q-051 Q-H "1-tap 의무") 와 정합성 ↑.

### Decision

DEC-023 lock — 5 항목 일괄 + Q-051 status: open → **resolved** 복귀
(DEC-022 + DEC-023 합쳐 fully resolves).

### Outcome 작업 (본 PR 안)

| Action | 위치 | 상태 |
|--------|------|------|
| DEC-023 발급 | `docs/decisions/DEC-023.md` | **landed (본 PR)** |
| Q-051 frontmatter `partial_resolutions` 에 DEC-023 entry + `updated_at` 갱신 + status: resolved | `docs/questions/Q-051.md` | **landed (본 PR)** |
| Q-051 "사용자 결정 결과" 표에 R1-#1~#5 row 5건 추가 | 동상 | **landed (본 PR)** |
| PLAN RESEARCH-1A.1 row: DEC-023 #1 (no-context error) + #2 (classifier deferred) 명시 | `docs/04_IMPLEMENTATION_PLAN.md` | **landed (본 PR)** |
| PLAN RESEARCH-1A.2 row: DEC-023 #2 (classifier 활성 시점) + #3 (advisory-only + ENV reserved) 명시 | 동상 | **landed (본 PR)** |
| PLAN AGG-1A.6 row: DEC-023 #4 (fork inheritance α/β 분기 logic) 명시 | 동상 | **landed (본 PR)** |

### Lesson candidate (외부 KB 승격 후보)

| Candidate | 간단 설명 | Cross-project 가치 | Promote later? |
|---|---|---|---|
| "Q 안의 product 결정과 기술 default 분리 원칙" | doc-heavy repo 에서 운영자에게 묻는 product/UX 결정 과 GPT 에게 묻는 기술 default 가 한 Q 안에 섞이면 결정 흐름 둘 다 정체. Q 본문에 두 종류 명시 + 별도 round 로 처리 + 별도 DEC 발급 패턴 (Q-051 → DEC-022 stack + DEC-023 routing default 분리) 이 효과적 | yes (1인 운영 + LLM agent 협업 repo 일반) | later |

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

## Adversarial Review — 2026-05-15 (multi-layer × multi-perspective × multi-stage)

> 본 entry 는 milestone 종료 회고가 아니라, INFRA-1B.3.x-audit (43c8178)
> landed 직후 시점의 **전수조사형 다층 적대적 리뷰** 진행 기록이다.
> 2026-05-13 review 의 후속 — 그 사이 landed slice (#37 doc drift fix /
> #38 source registry seam / #39 R2 upload audit ledger) 까지 반영한 baseline.
>
> **방법론**: 12 layer × 7 perspective × 5 stage matrix. 각 layer 가 한 턴.
> 각 finding 에 `[L#·P#·S#]` anchor 부여. perspective 약어: P-A 누락 /
> P-B 모순 / P-C 회귀 risk / P-D bypass / P-E 운영 부담 / P-F 외부 적대자 /
> P-G 미래 자기. stage: S1 정적 / S2 교차검증 / S3 행위시뮬 / S4 실패모드 /
> S5 gap discovery. 발견은 사실 기록이고, 사용자 결정이 필요한 항목은
> 별도 list 로 정리. 결정 없는 정합성 fix 는 후속 PR 별도 처리.
>
> **레이어 순서**: L1 Documentation governance / L2 Cross-document invariant
> validator / L3 Domain model & schema / L4 Storage seam invariants /
> L5 Discovery pipeline code / L6 Audit/ops/feedback code / L7 Migrations
> + idempotency / L8 Test coverage gaps / L9 CI/CD & supply chain /
> L10 Security & adversarial surface / L11 Concurrency & failure modes /
> L12 1인 운영자 sustainability + 통합 권고.
>
> **진행 상태 (2026-05-15)**: L1~L12 전수 완료. 총 208 finding (L1×16 + L2×14 + L3×17 + L4×15 + L5×20 + L6×19 + L7×18 + L8×18 + L9×16 + L10×17 + L11×19 + L12×19).

### Repo baseline (리뷰 시점)

- HEAD: `43c8178 feat(audit): INFRA-1B.3.x-audit — R2 upload audit ledger enforcement (AC-032 / NFR-008, Q-044 → DEC-020) (#39)`
- mode: greenfield (`docs/context/current-state.md` Project mode block)
- counts: 159 docs / 31 ADR (0001~0031) / 23 DEC (DEC-001~023) / 37 Q (Q-001~051 gaps) / 44 AC (AC-001~044) / 28 REQ / 10 NFR / **7 SQLite migrations (v1~v7; v3 = source_registry_slug_map)** / 1 Neo4j migration / 27 src TS / 21 test files / 22 glossary terms.
- active milestone: P0-M2 게이트 검증 단계, INFRA-1B.1~.5 landed + 1B.6 + OPS-1A.1 + 1B.3.x-audit landed.

### L1 — Documentation governance & registers consistency

| ID | 위치 | 발견 | Severity | Perspective·Stage |
|---|---|---|---|---|
| L1-A | `docs/context/current-state.md` line 38, 184-189, 248 | INFRA-1B.3.x-audit landed (43c8178) 후에도 current-state 가 "AC-032 audit ledger 미구현 / 신규 slice 미진입" 으로 stale. P0-M1 게이트 차단 사유 잘못 안내. | P1 | P-B·S2 |
| L1-B | `docs/06_ACCEPTANCE_TESTS.md:53` AC-032 / line 113 TEST-032 | AC-032 status `defined` 그대로, TEST-032 위치 `tests/policy/raw_cloud_zero_test.ts` (planned) — 디렉토리 `tests/policy/` 부재. 실 land 된 audit 단위테스트 `tests/unit/audit_policy_decisions_test.ts` 16 tests 는 TEST-032 매핑 미정. partial state 표현 한계. | P1 | P-C·S2 |
| L1-C | `docs/06_ACCEPTANCE_TESTS.md:64-65 / 124-125` | AC-044 / AC-043 + TEST-044 / TEST-043 row 순서 역전 (오름차순 위반). | P3 | P-G·S1 |
| L1-D | `docs/01_PRD.md:219-262` | PRD Open Questions 섹션 14 vs Q register 12 — Q-035 / Q-050 누락. Q-021 unstruck 채로 history snapshot prose 유지. DOCUMENTATION.md "links over repetition" 위반. | P2 | P-B·S2 |
| L1-E | `docs/03_RISK_SPIKES.md:64-87, 91-116` | SPIKE-002/003 본문이 ADR-0006 (superseded by ADR-0023) reference + Anthropic-only prompt caching 표현 유지. follow-up slice `INFRA-1B.1` / `INFRA-1B.2` 는 source registry / discovery worker 로 의미 변경됨 — 실제 extractor 1차는 `EXTR-1A.2/3`. | P2 | P-C·S2 |
| L1-F | `docs/04_IMPLEMENTATION_PLAN.md:121, 144` | `INFRA-1B.3.x-audit` / `INFRA-1B.10` 의 milestone 컬럼 값 = "P0-M2 hardening" 인데 Milestones 표 (line 76-86) 에 해당 milestone row 부재. enum 외 값. | P2 | P-A·S1 |
| L1-G | `docs/_generated/` 부재 | AGENTS.policy.md "Cross-document invariant tracking" 의무 read 대상 (scope_tree / term_usage / effective_invariant_policy) 디렉토리 자체 미존재. 2026-05-13 retro 가 P1 으로 식별한 fix 가 효과 없음 — gitignored 라서 commit 안 됨 (L2-E 와 함께 분석). | P1 | P-D·S2 |
| L1-H | `docs/09_TRACEABILITY_MATRIX.md:32, 55` | TRACE-016 / TRACE-039 row 안에 "TRACE-039 와 동일 결정 (중복 row)" 명시. trace matrix invariant "한 줄 = 하나의 trace path" 위반. | P3 | P-G·S1 |
| L1-I | `docs/06_ACCEPTANCE_TESTS.md:41, 101` / `docs/04_IMPLEMENTATION_PLAN.md:79` | AC-020 / TEST-020 의 P0/P1 phasing 본문이 한 cell 안에 8줄 prose 로 압축. Status enum 5종 (defined/not_run/passing/failing/waived) 으로 partial 표현 불가 — phased AC 도입 필요. | P2 | P-G·S1 |
| L1-J | `docs/04_IMPLEMENTATION_PLAN.md:251-263` | Risks (open) 의 Q-042~Q-048 entry 가 "INFRA-1B.3.x-audit slice ID 미정 / 진입 직전 lock" stale — 같은 문서 line 121 이미 row 등록 + landed. TRACE-041 의 slice ID `INFRA-1A.9-validator-extension` 는 trace matrix 만, slice 표 row 부재. | P2 | P-C·S2 |
| L1-K | `docs/04_IMPLEMENTATION_PLAN.md:80` | P0-M3 row notes 안 "codex review 2026-05-14 P2" 회고 메타 inline. milestone row 와 회고 anchor 분리 필요. | P3 | P-G·S1 |
| L1-L | (확인 OK) | REQ-001~028 + NFR-001~010 모두 1개 이상 AC mapping. trace matrix invariant 충족. 단 REQ-027 단독 11 AC 매핑 (AC-013/018/028/034/035/036~042) — REQ inflation. | OK | P-A·S2 |
| L1-M | (L2 영역) | glossary 22 term vs PRD/AC 인용 50+ term cross-check — L2 에서 본격 분석. | flag | P-A·S5 |
| L1-N | `docs/DOCUMENTATION.md:67-68` / `docs/08_DECISION_REGISTER.md:23-27` | DOCUMENTATION.md change-type 표와 DEC register "When to escalate to ADR" 가 ADR/DEC 분기 rule 을 두 곳에 분산 정의. | P3 | P-B·S1 |
| L1-O | `docs/10_PROJECT_RETROSPECTIVE.md:19-64` | PUB-1A.5 회고 placeholder 가 fenced code block 안 markdown — 실제 채울 때 fence 빠져나와야 UX awkward. PUB-1A.5 entry 시 별도 file 로 promote 권고. | P3 | P-G·S1 |
| L1-P | `.github/workflows/` | `ci.yml` / `doc-freshness.yml` / `invariant-check.yml` active + 각각 `.example` 동행. 3쌍 duplicate. `cd.yml.example` 만 active 없음. | P3 | P-G·S1 |

### L2 — Cross-document invariant validator integrity

baseline: `bun run invariant:check` 실측 결과 = **0 errors, 36 warnings, 81 infos** (`bun run invariant:regen` 후 48 warnings, 81 infos). validator `scripts/validate_invariants.ts` 380줄 + `docs/templates/relation_enum.yaml` 63줄 + `glossary_term_schema.yaml` 59줄 전수 read.

| ID | 위치 | 발견 | Severity | Perspective·Stage |
|---|---|---|---|---|
| L2-A | ADR-0023 (line 36 col 55) / ADR-0024 (43:16) / ADR-0027 (22:93) / DEC-009 (45:515) / DEC-010 (36:157) / DEC-011 (3:57) | 6개 파일 frontmatter YAML parse 실패 — root cause: unquoted scalar 값 안 `: ` (colon-space) 가 mapping entry 로 잘못 해석. 결과: validator 가 6 파일을 완전 skip, INV-0023-1~8 + INV-0024-* + INV-0027-3/5 (operator_lock for evidence_role, AC-043/044 의무) 모두 `effective_invariant_policy.yaml` 에 미등록 (`grep -c "INV-0023\|INV-0024\|INV-0027" docs/_generated/effective_invariant_policy.yaml` = 0). 가장 canonical 한 6 결정이 invariant tracking 에서 invisible. fix: block scalar `>-` 또는 quoted style 변환. | P1 | P-D·S2 |
| L2-B | `scripts/validate_invariants.ts:319-330 generateArtifacts()` | ADR 의 `status` 필드 검사 없이 모든 ADR 의 invariants[] emit. 결과: superseded ADR (ADR-0006/-0008/-0011 + 0003/0004/0007) 의 INV-* 가 `effective_invariant_policy.yaml` 안에 active 로 그대로 남음. INV-0008-1~4 / INV-0011-1~6 / INV-0006-1~5 가 canonical artifact 안에 active 표기 — L2-A 와 합쳐서 정책 surface 가 정반대로 뒤집힘. fix: ADR `status === 'superseded'` skip 1줄 추가. | P1 | P-C·S3 |
| L2-C | `scripts/validate_invariants.ts` (relation_enum.yaml 0회 import) | `relation_enum.yaml` closed enum 5종 (complies/extends_scope/challenges_invariant/depends_on/supersedes) 이 코드에서 검증 안 됨. 실측 inventory: `extends` 10건 (Q-045/049/050/051, DEC-020/021/022 — 가장 최근 결정) / `implements` 6건 (DEC-014~018, ADR-0028) / `superseded_by` 1 file (DEC-003) = **20 invalid relation 사용 detect 안 됨**. payload required schema 도 미검증. | P1 | P-D·S2 |
| L2-D | `scripts/validate_invariants.ts:32` (`MODE_WRITE` 선언만, 사용 0회) | AGENTS.policy.md 가 의무화한 `bun run scripts/validate_invariants.ts --write-warnings` 가 noop. `MODE_WRITE` 변수가 선언 후 어디서도 reference 안 됨. invariant_review lifecycle (pending → resolved) 의 코드 support 부재. | P1 | P-D·S2 |
| L2-E | `.gitignore` line "**/docs/_generated/*.yaml" / AGENTS.policy.md | docs/_generated/ 가 gitignored — fresh clone 에서 부재 보장. AGENTS.policy.md 는 의무 read. sequencing 강제 메커니즘 없음 (regen 자동 hook 부재). L1-G 의 retro fix 가 효과 없는 이유. | P2 | P-D·S5 |
| L2-F | validator 코드 | supersede chain 양방향 정합성 미검증 (`checkSupersedeBidirectional` 부재). A.supersedes=[B] 갱신 후 B.superseded_by 미갱신 시 silent drift. | P2 | P-A·S2 |
| L2-G | validator 코드 | `defines[]` 권리 enforce 부재. "term defines 권리는 ADR 만" rule (DEC register line 27) 이 코드에 없음. ADR 가 도입한 term 이 glossary 에 존재하는지도 미검사. | P2 | P-D·S2 |
| L2-H | `docs/glossary/` 22 file vs reviewed_terms 50+ new term | DEC-019/020/021/022/023 + Q-050/051 + ADR-0031 합쳐서 40+ unique 신규 term 이 glossary anchor 없이 in-flight. body-only term proliferation = Case 2 drift 의 정의. AGENTS.policy.md mandate 위반. 신규 slice `INFRA-1A.10-glossary-backfill` 권고. | P2 | P-A·S5 |
| L2-I | DEC-020/021/022/023 + Q-050/051 + ADR-0031 frontmatter | `term_effects: []` empty 가 정상 처럼 운영됨. reviewed_terms 에 신규 term 추가하면서 term_effects 미충족. validator 의 `checkTermEffects` 가 reviewed_terms ↔ glossary cross-check 만 — empty term_effects 와 신규 term 동시발생 unchecked. | P2 | P-D·S2 |
| L2-J | `scripts/validate_invariants.ts` 안 `cross_ref_code` 단어 0건 | Q-045 → DEC-020 resolution 의 일부 (invariant validator scope 확장 — frontmatter `cross_ref_code[]` + file:exportName / file:line 검증) 가 결정만 lock, 코드 land 0건. `INFRA-1A.9-validator-extension` slice 표 미등록. | P2 | P-A·S5 |
| L2-K | `scripts/validate_invariants.ts:115-117` | `decisions/README.md` / `questions/README.md` 도 validator 가 잡음 — ADR 처럼 README filter 없음. spurious "Missing frontmatter id" warning 4건 매 실행. one-line fix. | P3 | P-G·S1 |
| L2-L | `scripts/validate_invariants.ts:377` (always exit 0) | warning-only 의도 (ADR-0002 INV-0002-1) 그대로. 그러나 36+81 advisory 가 누적되어도 CI 가 action 없음. 운영자 attention budget 위에서 invisible. step summary visible 화 + baseline regression detection 권고. | P2 | P-D·S1 |
| L2-M | (L2-A 잔향) | ADR ID gap warning "22 → 25 / 26 → 28" 은 ADR-0023/24/27 parse 실패의 false positive. L2-A fix 시 자동 해결. | P3 | P-G·S1 |
| L2-N | `scripts/validate_invariants.ts:337-350 runFixture()` | fixture (scope-creep / glossary-drift) 가 합성 fixture 가 아닌 real docs 대상 check alias. 회귀 test 의미 약함. | P3 | P-G·S3 |

### L3 — Domain model & schema integrity

baseline: `migrations/neo4j/v1_schema.cypher` 419줄 + `migrations/sqlite/v1_schema.sql` 299줄 + v2~v7 (300줄) + `src/domain/nodes.ts` 58줄 + `src/domain/ids.ts` 58줄 + `src/utils/enums.ts` 198줄 + glossary 22 term + ADR-0025 (10-stage object model) cross-check.

#### 10-stage object model node coverage 확인

| Stage | Neo4j 노드 + UNIQUE | ID 접두 (ids.ts) | TS interface (nodes.ts) | comment block in v1 cypher |
|---|---|---|---|---|
| 1 Source | ✓ source_unique (line 12) + source_id_exists (101) | `src_` | ✓ SourceNode | ✓ |
| 2 Document | ✓ document_unique (15) + composite (url, source_id) (34) | `doc_` | — | ✓ |
| 3 Snapshot | ✓ snapshot_unique (37) + snapshot_content_hash_unique (57) | `snap_` | — | ✓ |
| 4 Claim | ✓ claim_unique (60) + claim_lifecycle_exists (104) | `clm_` | — | ✓ |
| 5 Dossier | ✓ dossier_unique (63) | `dos_` | — | ✓ |
| 6 Scenario | ✓ scenario_unique (66) | `scn_` | ✓ ScenarioNode | ✓ |
| 7 EditorialIntent | ✓ editorial_intent_unique (72) + decided_by_operator NOT NULL (107) | `eit_` | — | ✓ |
| 8 Thesis | ✓ thesis_unique (75) | `ths_` | ✓ ThesisNode | ✓ |
| 9 ContentDraft | ✓ content_draft_unique (78) | `drf_` | — | ✓ |
| 10 Publication | ✓ publication_unique (81) | `pub_` | — | ✓ |
| support: ScenarioRevision | ✓ scenario_revision_unique (69) | composite `scn_<id>_r<n>` (validateScenarioRevisionId) | — | ✓ |
| support: AccessIntervention | ✓ access_intervention_unique (84) | `aci_` | — | ✓ |
| support: ManualClaimEntry | ✓ manual_claim_entry_unique (87) | `mcl_` | — | ✓ |
| support: Chunk | ✓ chunk_unique (90) + composite (snap_id, chunk_index) (95) | (없음 — 별도 prefix 없음) | — | ✗ |
| support: Edge | 5 type UNIQUE (117-135) | `edge_` (ids.ts 등재) | — | ✓ |

→ 10-stage 노드 + supporting 5종 모두 UNIQUE constraint + comment block 보유. ID 접두는 src_domain/ids.ts ID_PREFIXES map 에 모두 등재.

#### L3 findings

| ID | 위치 | 발견 | Severity | Perspective·Stage |
|---|---|---|---|---|
| L3-A | `migrations/neo4j/v1_schema.cypher:3` header comment | "ADR-0011 (object model)" 라고 단언. 그러나 ADR-0011 은 ADR-0025 로 supersede. 같은 파일 line 5 가 "ADR-0025 (editorial_intent 10-stage)" 도 명시 — 두 ADR 병기로 첫 줄이 stale. canonical 은 ADR-0025. | P3 | P-C·S1 |
| L3-B | `migrations/neo4j/v1_schema.cypher:107-108` editorial_intent_operator_lock_exists | `REQUIRE n.decided_by_operator IS NOT NULL` — NOT NULL 만 enforce. ADR-0025 INV-0025-4 의 "decided_by_operator = true" 는 schema 가 false 도 허용. line 334 comment 가 "INV-0025-4: ContentDraft rejected if false" 라고 명시 — application code (PUB-1A.1 ContentDraft composer) 에 의존. 현재 schema-only 검증 시 silent bypass. | P2 | P-D·S2 |
| L3-C | `migrations/neo4j/v1_schema.cypher:117-135` (edge UNIQUE constraints) | 5종 semantic edge (SUPPORTS/CONTRADICTS/QUALIFIES/UPDATES/SUPERSEDES) 만 UNIQUE 적용. 그러나 code/AC 본문이 추가로 정의하는 edge: `:HAS_DOCUMENT` (Source→Document) / `:HAS_SNAPSHOT` (Document→Snapshot, line 25 pre-clean) / `:HAS_INTERVENTION` (Source→AccessIntervention, AC-024) / `:HAS_INTENT` (Thesis→EditorialIntent, AC-026 b) / `:USES_INTENT` (ContentDraft→EditorialIntent) / `:EVIDENCE_FOR` (Claim→Thesis, AC-043/044 ADR-0027) — **6 edge type 모두 schema-level UNIQUE 또는 property NOT NULL 없음**. 특히 `:EVIDENCE_FOR.evidence_role` (6 enum: supporting/opposing/mitigating/amplifying/monitoring/context) + `assigned_by = operator_lock` (INV-0027-5) 은 ADR-0027 (L2-A parse fail) 안에만 존재하고 schema enforce 부재. AGG-1A.1 진입 전 lock 필요. | P1 | P-A·S2 |
| L3-D | `migrations/neo4j/v1_schema.cypher:54-58` snapshot_content_hash_unique | 현재 schema 가 `content_hash` 컬럼 단일 UNIQUE. DEC-021 (Q-049) 가 명시한 migration sequence — `content_hash` → `raw_body_hash` rename + `canonical_text_hash` 별도 컬럼 추가 — INFRA-1B.9 P1+ 미진입. constraint 이름 `snapshot_content_hash_unique` 가 DEC-021 #3 의 migration sequence 안에서 DROP 대상으로 정확히 anchor 됨 ✓. 단 P0-M2 게이트 안에 들어가는 1B.10 (document_fetch_state v7) 가 canonical_text_hash 보다 먼저 land 예정 — 두 schema change 가 sequencing 이 명확히 lock 됐는지 확인 필요. AC-020-P0 / AC-020-P1 phasing 안 (L1-I) 에서 명시되어 있음 ✓. | flag | P-C·S2 |
| L3-E | `src/domain/nodes.ts` 58줄 | TypeScript interface 가 **3개만 export** (SourceNode / ScenarioNode / ThesisNode). 10-stage 중 7개 stage (Document / Snapshot / Claim / Dossier / EditorialIntent / ContentDraft / Publication) + 4 support (ScenarioRevision / AccessIntervention / ManualClaimEntry / Chunk) 의 TS interface 부재. v1 cypher comment block 안 prose 정의 vs TS code 정의 사이 gap. 새 코드가 Claim / Snapshot 등을 만들 때 type-safe하지 않음. (단 schema-optional Neo4j 라서 runtime 영향은 application code 에 위임.) | P2 | P-A·S2 |
| L3-F | `src/domain/ids.ts:6-35` ID_PREFIXES | 25 type 등록. 그러나 schema 가 정의한 Chunk node 에 `chunk_` 또는 별도 prefix 없음 — chunk_id 의 format 이 schema 안에서도 prose 정의 없음 (`chunk_unique` 만). Chunk identity 가 (snap_id + chunk_index) composite 으로 충분하다는 design 일 수도 있지만, AC-005 의 "신규 객체 생성 시 접두 + 단조 증가 식별자" 의무에 미달. AC-005 매핑 표에 chunk 미포함. | P2 | P-A·S2 |
| L3-G | `migrations/sqlite/v1_schema.sql:5` | header comment `ADR-0023 (LLM routing v2 + run_ledger + cross_vendor_review_ledger)` 명시 — schema 가 ADR-0023 의 `vendor`/`tier`/`cross_vendor_review_of`/`domain_override_reason` 컬럼 모두 land (line 25-39) ✓. 그러나 ADR-0023 frontmatter 가 L2-A parse 실패 → validator 가 ADR-0023 INV-0023-7 (run_ledger 확장 invariant) 를 인식 못 함. 즉 schema 는 invariant 를 만족하지만 invariant validator 는 그것을 검증 못 함. | flag | P-D·S2 |
| L3-H | `migrations/sqlite/v1_schema.sql:71-81` source_material_policy / `v6_discovery_queue.sql` discovery_queue | source_material_policy.source_id 가 PK + FK target. discovery_queue.source_id 가 FK to source_material_policy.source_id (line 7 v6). 그러나 schema 안 어디에도 `crawl_state.source_id` (v5) → source_material_policy FK 선언 없음 — v5 schema 가 standalone PK 만. policy 가 삭제된 source 의 crawl_state 가 dangling. | P2 | P-A·S2 |
| L3-I | `migrations/sqlite/v1_schema.sql:87-97` policy_decisions | v1 정의: 컬럼 8개 (decision_id / source_id / session_id / url / trigger_type / policy_gate_mode / decision / rationale). v7 (intended_action) ALTER 추가 — INFRA-1B.3.x-audit. 그러나 정작 `policy_decisions.decision` 컬럼의 CHECK constraint 없음 — comment 가 "ignore|manual_claim|temp_text|override|blocked" 라고 단언하지만 CHECK 부재. v7 의 audit ledger 가 사용하는 R2_UPLOAD_DECISION 4 값 (`attempted` / `uploaded` / `skipped_toctou` / `set_r2_key_failed_neo4j`) 도 enum trigger 없음. enum validator (`src/utils/enums.ts` line 180-189) 만 의존. | P2 | P-D·S2 |
| L3-J | `migrations/sqlite/v1_schema.sql:255-265` research_session | 컬럼 6개 (session_id / scenario_id / thesis_id / status / raw_cache_expires_at / created_at). 그러나 Q-050 / Q-051 / DEC-022 / DEC-023 / AGG-1A.6 가 명시한 multi-round research session 확장 (title / initial_intent / mode / editorial_intent_id / total_cost_usd / max_rounds / per_session_cost_cap_usd / forked_from_session_id / ready_for_thesis_compose / fork_kind) — INFRA-1B.7b 의 v8 migration 으로 deferred. P0-M6 의 RESEARCH-1A.0 read-only 가 본 v1 컬럼 안에서만 SELECT 의무 (IMPL_PLAN line 164 "P0 schema 안의 컬럼만") ✓ 명시. | flag | P-A·S2 |
| L3-K | `src/utils/enums.ts:39-43` REVIEW_TYPE | 3 enum (`preflight_cite_overclaim` / `scenario_adversarial` / `high_stakes_thesis`) — ADR-0023 INV-0023-4 의 3 강제 cross-vendor review 단계와 정확히 일치. v2 trigger 도 매핑 ✓. 단 ADR-0023 frontmatter parse 실패 (L2-A) 로 validator 가 INV-0023-4 ↔ enum 매핑을 cross-check 못 함. | flag | P-D·S2 |
| L3-L | `src/utils/enums.ts:113-129` AccessResult / InterventionSeverity | 각각 5 / 4 값. v1 cypher comment block (line 384-389) 와 매핑 ✓. 그러나 enum 본문 자체에 schema-level CHECK constraint 부재 (Neo4j schema-optional — application 검증). enum trigger 가 SQLite 쪽에 없는 이유 — AccessIntervention 은 Neo4j 노드라서 SQLite trigger 적용 불가. application 검증 (`src/pipeline/access-intervention/severity.ts` 등) 에 의존. | flag | P-D·S2 |
| L3-M | glossary 22 file inventory | 누락 term (schema 안 의무 사용): `lifecycle_state` (Claim 8-state) / `claim_status` (8-state) / `stance` (Thesis) / `market_stance` (Thesis) / `archive_policy` / `external_llm_policy` / `quote_reason` (ManualClaimEntry) / `source_accessed_via` (ManualClaimEntry) / `intervention_severity` (AccessIntervention) / `chunk` / `scenario-revision` / `evidence-role` (ADR-0027) / `evidence_role`. 또한 ADR-0027 의 6 evidence_role enum (supporting/opposing/mitigating/amplifying/monitoring/context) glossary 부재. L2-H 와 합쳐서 P0-M6 entry condition 차단 risk. | P2 | P-A·S5 |
| L3-N | `migrations/sqlite/v1_schema.sql:191-199` metrics_run | `category` 컬럼이 한국어 + 영어 enum 혼합: `데이터_품질|운영_성능|policy_safety|콘텐츠_production|추적성|시스템_건강|bidirectional`. CHECK constraint 없음 — comment 만. enum trigger v2 에도 미포함. AC-029 의 "6 카테고리" 요구 (PRD REQ-024) vs schema 의 7 값 (`bidirectional` 추가) — REQ-024 본문이 6 카테고리 외 NFR-009 bidirectional category 도 명시 → 7 값 정상. 그러나 category enum 자체가 한/영 혼합인 게 잠재적 typo / lint risk. | P3 | P-G·S1 |
| L3-O | `src/domain/ids.ts` Chunk prefix 부재 | L3-F 와 동일 issue. AC-005 의 "신규 객체 생성 시 접두 + 단조 증가 식별자" — Chunk 가 (snap_id + chunk_index) composite 으로 됐다는 가정. 그러나 schema 가 `chunk_id` 컬럼을 별도 정의 (line 90 `chunk_unique FOR n.chunk_id IS UNIQUE`). 즉 chunk_id 는 표면적으로 ID이지만 prefix 매핑 부재. 적어도 `chunk_` prefix 라도 추가하거나, chunk 를 AC-005 scope 에서 명시 제외해야. | P2 | P-A·S1 |
| L3-P | `migrations/sqlite/v1_schema.sql:274-287` raw_cache_items | DEC-007 (raw_cache TTL 24h~7d ceiling) + Q-027 resolution. schema 에 `expires_at TEXT NOT NULL` ✓. 그러나 TTL 24h~7d 의 ceiling enforcement 가 schema 외 (application code OPS-1A.4 raw_cache_items TTL worker, IMPL_PLAN line 135 — `planned`). 현재 시점 TTL worker 미land — raw_cache_items insert 시 expires_at 가 7d 이상이어도 schema 가 통과. application code 에 의존. | P2 | P-A·S2 |
| L3-Q | `migrations/sqlite/v1_schema.sql:223-252` evaluation_runs / evaluation_cases / retrieval_pack_metrics | ADR-0020 metrics framework. evaluation_runs 의 `total_cases / pass_rate` 등 컬럼 정의 ✓. 그러나 ADR-0020 자체가 P0-M4 (search & dossier) 까지 적용 예정 — schema 는 미리 land. dead schema risk (table 정의 land 했으나 implementation OPS-1A.3 + AGG-1A.* 까지 사용 없음). | P3 | P-E·S1 |

#### L3 진행 중 발견된 cross-cutting 정합성 (다음 layer 로 이관)

- **L4 (storage seam)** 으로 이관:
  - `raw_cloud_policy=always_prohibited` (ADR-0012 INV-0012-3) 가 `src/storage/r2/` 안에서 enforce 되는지 vs schema CHECK + application 분담
  - permitted_artifact prefix 정책 vs `data/sources_seed.yaml` 안 source 별 allowed_public_data_only enum 일관성
- **L5 (discovery pipeline)** 으로 이관:
  - `discovery_queue.error_code` 6 enum 의 inline CHECK ✓ (v6 line 27-35) — but enum 외 값 trigger 검증 없음 (CHECK 만 의존)
  - `crawl_state.last_status` CHECK 없음 vs enum 5종 prose 정의
- **L10 (security)** 으로 이관:
  - Neo4j `r.from_id / r.to_id` denormalized properties (cypher line 113-114 comment) — application code 가 항상 set 해야 idempotent. set 누락 시 silent dup.

### 사용자 결정 필요 항목 (L1 + L2 + L3 누적, P1 우선)

**P1 (즉시 fix 권고)**:

1. **L2-A** — ADR-0023/24/27 + DEC-009/10/11 frontmatter YAML parse fix (block scalar `>-`). 이 fix 1 commit 이면 L2-A 해소 + L2-M 자동 해소 + L2-B / L3-G / L3-K cross-check 가 enable. **즉시 진행 동의?** (Y/N)
2. **L2-B** — validator `generateArtifacts()` 에 ADR `status: superseded` skip 1줄. L2-A 와 같이 묶기.
3. **L2-C** — relation_enum.yaml enforce path 선택: (a) validator 에 enum 강제 + 기존 사용처 migrate, (b) relation_enum.yaml 자체 확장 (extends / implements / superseded_by 합법화). 어느 쪽?
4. **L2-D** — `--write-warnings` mode 구현 path: (a) `persistWarnings()` 추가, (b) AGENTS.policy.md 텍스트 변경. 어느 쪽?
5. **L1-A / L1-B** — current-state.md + AC-032 / TEST-032 stale 갱신. Y/N.
6. **L1-G / L2-E** — `docs/_generated/` regen hook path: (a) policy text 명시, (b) SessionStart hook, (c) validator default regen. 어느 쪽?
7. **L3-C** — `:EVIDENCE_FOR` / `:HAS_INTENT` / `:USES_INTENT` / `:HAS_DOCUMENT` / `:HAS_SNAPSHOT` / `:HAS_INTERVENTION` schema-level edge constraint 추가 priority 어느 정도? AGG-1A.1 진입 직전 lock 의무 vs 별도 schema slice.

**P2 (다음 PR 안에 fix)**:

8. **L1-D / L1-E / L1-F / L1-I / L1-J / L2-F~L / L3-B / L3-E / L3-F / L3-H / L3-I / L3-M / L3-O / L3-P** — 각 항목별 결정. 우선 묶음: doc drift batch (L1-D/E/F/J) + validator extension batch (L2-F/G/I/J/L) + schema hardening batch (L3-B/H/I/P) + glossary backfill (L2-H + L3-M).

**P3 (관찰)**: L1-C/H/K/N/O/P + L2-K/M/N + L3-A/L/N/Q.

### L4 — Storage seam invariants (Neo4j ↔ SQLite ↔ R2 + raw_cloud_policy + R2 audit ledger + permitted artifact prefix)

baseline: `src/storage/r2/policy.ts` 82줄 + `src/storage/r2/client.ts` 104줄 + `src/storage/audit/policy-decisions.ts` 71줄 + `src/storage/sqlite/connection.ts` 55줄 + `src/storage/neo4j/connection.ts` 49줄 + `src/storage/source-registry/seed.ts` 278줄 + `src/discovery/worker/snapshot-fingerprint.ts` 986줄 (audit hook + cross-store join 부분 집중) + `data/sources_seed.yaml` 1501줄 (72 source) 전수 read. `r2Put` / `r2Get` / `r2Delete` / `checkPermittedPrefix` / `source_material_policy` / `raw_cloud_policy` / `INV-0012-*` grep cross-check.

#### data 분포 실측

- 72 source 전수: `raw_cloud_policy=always_prohibited` **100%** (72/72) — 즉 R2 upload entry 조건 `archivePolicy=full_snapshot_allowed && rawCloudPolicy=allowed_public_data_only` 가 production 데이터 위에서 0% 매칭.
- archive_policy: excerpt_only 59 / full_snapshot_allowed 7 / metadata_only 6.
- external_llm_policy: allowed 66 / manual_review_required 6 / prohibited 0.
- r2Put call sites = 2 (snapshot-fingerprint.ts dedup back-fill + new-path), r2Get caller = 0, r2Delete caller = 0.

#### L4 findings

| ID | 위치 | 발견 | Severity | Perspective·Stage |
|---|---|---|---|---|
| L4-A | `data/sources_seed.yaml` 72/72 always_prohibited | R2 upload path 가 production seed 위에서 100% dead — AC-032 evidence 가 trivial-by-absence. INFRA-1B.3.x-audit 의 16 단위테스트가 codepath logic 만 검증. NFR-008 "raw third-party text 0건 cloud 저장" 가 design intent 와 정확히 일치 (✓) 이지만, R2 upload audit code 의 production exercise 가 영원히 0건. 정책 완화 (1개라도 allowed_public_data_only) 가 발생하기 전까지 audit ledger 가 empty. | P3 | P-E·S3 |
| L4-B | `src/storage/r2/client.ts:80-84 r2Get` + 모든 caller grep | production caller 0건. tests/unit/r2_policy_test.ts 32 tests 안에서만 round-trip 검증. AC-020 P0 의 "r2_key 가 NULL 아닌 permitted artifact 만 R2 round-trip 으로 회수 가능 — raw_body_hash + r2_key 무결성 verify" production code path 부재 — P0-M4 (AGG-1A.1 Dossier R2 fetch) 또는 PUB-1A.* (EvidencePack R2 fetch) 진입까지 dead. | P2 | P-A·S5 |
| L4-C | `src/storage/r2/client.ts:89-91 r2Delete` | `checkPermittedPrefix` 미호출 — 의도된 asymmetry (snapshot-fingerprint comment line 527-528: "asymmetric delete would wipe their legitimate object"). 현재 caller 0건이라 무해. 향후 retention GC / repair job 에서 r2Delete 도입 시 prefix typo 로 인한 mass delete risk. PERMITTED_PREFIXES (9 prefix) cross-check 옵션 도입 권고. | P2 | P-D·S4 |
| L4-D | `src/storage/audit/policy-decisions.ts:60-71 recordR2UploadDecision` + `snapshot-fingerprint:70-82 auditR2UploadOrThrow` | audit-by-absence invariant 의 정확한 강도: BEFORE-r2Put audit row (`decision='attempted'`) 가 r2Put 진입을 gate 하므로 "no audit row → no r2Put" ✓ enforce. 그러나 AFTER-r2Put audit row (`uploaded` / `skipped_toctou` / `set_r2_key_failed_neo4j`) 가 fail 시 r2Put 결과는 이미 R2 영구 저장 + audit outcome row 누락. 결과: "attempted but no outcome" 상태가 audit anomaly — operator 가 SQLite query 로 후속 manual reconciliation 의무. PR #39 codex review 가 정확히 이 trade-off 로 lock (line 60-69 comment). 의도된 design 이지만 operator 인지 의무. | P2 | P-D·S4 |
| L4-E | `src/storage/r2/policy.ts:11-21 PERMITTED_PREFIXES` 9개 vs 실제 caller | 9 prefix 중 `permitted_artifact/derived/snapshot/` 만 사용 (snapshot-fingerprint 2 call site). 나머지 8개 prefix 는 forward-looking schema — backups/neo4j/ + backups/sqlite/ (RUNBOOK backup, 외부 tool 의존) / audit/jsonl/ (DEC-007 audit export, 미구현) / tmp/multipart/ (미구현) / permitted_artifact/dataset/ (ADR-0024 EXTR-1A.5 미구현) / dossier/ (AGG-1A.1 미구현) / publication/ (PUB-1A.4 미구현) / evidence-pack/ (PUB-1A.2 미구현). dead schema 8/9. 새 caller 진입 시 prefix typo 가 lint catch 안 됨 — 단위 테스트 strict literal type 검증 권고. | P3 | P-E·S5 |
| L4-F | `src/discovery/worker/snapshot-fingerprint.ts:112-133 allLinkedSourcesAllowRawCloud` cross-store JOIN | Neo4j Source.source_id list → SQLite source_material_policy.raw_cloud_policy 조회 → `'allowed_public_data_only'` 인 경우만 true. 4 잠재 inconsistency 시나리오 검토: (a) SQLite policy 갱신 시 Neo4j 미staleness ✓ safe (Neo4j 가 raw_cloud_policy 미저장), (b) Neo4j Source 추가 + SQLite policy row 부재 → `rows.length !== sourceIds.length` → false → prohibited default ✓ safe, (c) slug 재할당 → source_registry_slug_map INSERT OR IGNORE 로 매핑 안정 ✓, (d) cross-store TOCTOU → snapshot-fingerprint 가 BEFORE/AFTER r2Put 양쪽 recheck 로 close ✓. 정합 robust. 단 향후 OPS-1A.4 (policy learning auto-relax) land 시 cross-store mutation transactional integrity 재검토 필수. | flag | P-D·S4 |
| L4-G | v1_schema.cypher:244 Source.raw_cloud_policy property comment vs 실제 SET | Neo4j Source 노드의 raw_cloud_policy property 가 comment 에 정의되지만 INFRA-1B.1 / 1B.2 가 SET 안 함 (`seed.ts` 가 Neo4j 미touch, snapshot-fingerprint 가 SQLite source_material_policy 만 SELECT). 즉 Neo4j Source.raw_cloud_policy = NULL 영구. v1 cypher comment 가 단일 진실 vs 실제 사용 사이 gap. 옵션: (a) Neo4j SET 추가 (cross-store sync 의무 추가), (b) cypher comment 에서 제거 (SQLite canonical). option (b) single source of truth 측면에서 깔끔. | P2 | P-B·S2 |
| L4-H | (L4-C 잔향) | retro 2026-05-13 line 99 P2 finding "R2 back-fill TOCTOU — dedup path 에서 prohibited source link race, r2Delete 안 함으로 완화, by design" — PR #39 의 BEFORE/AFTER recheck + 명시 audit attribution (`skipped_toctou`) 으로 close 완료. | OK | P-C·S1 |
| L4-I | `src/storage/audit/policy-decisions.ts:67` hardcoded `trigger_type='r2_upload'` | SQLite v1 policy_decisions:92 comment "trigger_type ... 1..8 from ADR-0017 danger-action list" — 숫자 enum 의도. 그러나 R2 upload audit 가 `'r2_upload'` string 사용. ADR-0017 본문 확인 필요. `intended_action='r2_upload'` (v7 컬럼) 이 audit row 의 namespace 분리 anchor 역할 — 정합 OK 추정. ADR-0017 trigger_type 8 enum vs intended_action 분리 sema 명시 권고. | P3 | P-G·S2 |
| L4-J | `src/discovery/worker/snapshot-fingerprint.ts:220` createDocumentAndSnapshot 의 Source 부재 error | 일반 `Error` throw (TypedQueueError 아님) → processOneRow catch 가 `runtime_error` bucket. dedup path 의 line 478-482 는 TypedQueueError(`source_not_found_in_graph`) → bucket 분리. 같은 sema 가 두 가지 error_code 로 분기 — dashboard 에서 root cause 분류 비대칭. | P3 | P-G·S1 |
| L4-K | `src/storage/audit/policy-decisions.ts` 의 row 1/2 + 2/2 atomic 보장 부재 | BEFORE row 와 AFTER row 가 별도 INSERT — 한 transaction 안에 묶이지 않음. SQLite default autocommit + WAL — 두 row 사이 다른 connection 의 audit insert 가 끼어들 수 있음. snap_id prefix 매칭 (`snap_id=<id>` rationale anchor) 으로 group-by 가능 ✓. 단 "한 r2Put 시도 = 정확히 1 attempted + 1 outcome row" invariant 가 violated 가능 — e.g. attempted commit 후 process kill 되면 outcome 없음 (L4-D 와 동일 risk). single-worker v0 에서는 sufficient. multi-worker 도입 시 transaction 검토 필요 (P1-M2-hardening). | P2 | P-D·S4 |
| L4-L | `src/storage/source-registry/seed.ts:91-98` validate enum | `isArchivePolicy` / `isRawCloudPolicy` / `isExternalLlmPolicy` / `isSourcePerspective` 4종 enum runtime 검증. SQLite schema CHECK + application validator 이중 line 73-75 v1 schema 의 inline CHECK constraint 매칭. 정합 ✓. 단 enum 변경 시 (예 ADR-0017 정책 enum 확장) 양쪽 sync 의무 — Q-045 / DEC-020 의 invariant validator cross_ref_code[] enforce 가 land 안 된 상황에서 silent drift risk. | flag | P-D·S2 |
| L4-M | `src/storage/sqlite/connection.ts:42-54 getMigrationVersion` numeric sort | 2026-05-13 retro 가 식별한 codex P1 fix (line 42-49 comment) 로 `ORDER BY CAST(SUBSTR(version, 2) AS INTEGER) DESC` 적용 — `applied_at` second-precision tie 회피. v10 시점에 v1 < v10 numeric 정렬 보장 ✓. fix 정합 OK. (L7 migrations + idempotency 에서 본격 분석.) | OK | P-C·S2 |
| L4-N | `src/storage/r2/client.ts:35-58` singleton client | `_client` 모듈 level singleton + `resetClient()` test hook ✓. 단 multi-worker / multi-process 환경에서 별도 process 의 client 가 같은 credential 으로 동시 접근 → R2 side concurrent write OK (idempotent overwrite key). resetClient 미호출 시 stale credential cache risk (e.g. Doppler secret rotation 후 process restart 의무). RUNBOOK 에 secret rotation procedure 명시되어 있는지 별도 확인 (L9 영역). | P3 | P-G·S4 |
| L4-O | `src/storage/audit/policy-decisions.ts` 의 ULID monotonic | `monotonicFactory()` 사용 — 같은 millisecond 내 ULID 단조 증가 ✓. decision_id 충돌 회피. INFO row 정렬이 created_at + decision_id 양쪽으로 가능. | OK | — |

#### L4 cross-cutting 정합성 (다음 layer 로 이관)

- **L5 (discovery pipeline)** 으로 이관:
  - `rss-worker.ts:207` 의 source_material_policy FK enforcement — 실제 enqueue 시 source 매핑 검증 path
  - Neo4j Source 노드 생성이 어디서 일어나는지 (INFRA-1B.2 worker 안) cross-check
- **L7 (migrations + idempotency)** 으로 이관:
  - v7 ALTER COLUMN intended_action 가 idempotent re-run 시 "duplicate column name" 회피 (`getMigrationVersion` numeric sort + IF NOT EXISTS 부재 시 fail)
  - v6 discovery_queue FK source_material_policy CASCADE behavior
- **L10 (security)** 으로 이관:
  - R2 credential surface (S3_ACCESS_KEY / S3_SECRET_KEY) 의 process.env 직접 read
  - Doppler integration 의 secret rotation procedure 적시성
- **L11 (concurrency)** 으로 이관:
  - audit row 1/2 + 2/2 atomic 보장 부재 (L4-K) 의 multi-worker risk 본격 분석
  - cross-store TOCTOU window 의 multi-worker race 확장 분석

### L5 — Discovery pipeline source code (adversarial input internalization, ADR-0028 / ADR-0030 / DEC-013~018)

baseline: `src/discovery/fetch/safe-fetch.ts` 848줄 (8-layer defense full read) + `src/discovery/parse/xml-safe.ts` 20줄 + `src/discovery/scheduler/{semaphore,pool,crawl-state,scheduler}.ts` 520줄 + `src/discovery/worker/{rss-worker,run-discovery,chunker}.ts` 816줄 = 약 2200줄 전수 read. ADR-0028 INV-0028-1~6 / ADR-0030 INV-0030-1~5 / DEC-013~018 cross-check.

#### L5 findings

| ID | 위치 | 발견 | Severity | Perspective·Stage |
|---|---|---|---|---|
| L5-A | `src/discovery/fetch/safe-fetch.ts` 전체 + xml-safe.ts | 8-layer defense ✓ (scheme allowlist / DNS pre-resolve + private IP / robots.txt fail-closed / redirect:manual + AbortSignal / per-hop SSRF+robots re-check / Content-Length preflight / streaming byte cap + zip bomb ratio / sniff magic + executable reject). ADR-0028 INV-0028-1~6 완전 매핑. xml-safe processEntities:false (DEC-018 XXE 방어). | OK | P-A·S1 |
| L5-B | `src/discovery/fetch/safe-fetch.ts:215-220 checkSsrf comment` | DNS rebinding TOCTOU 가 명시적 scope.out: "Eliminating this window requires a custom HTTP stack with socket-level IP pinning, which is out of scope for this layer (ADR-0028)". narrow window 가 적대자 입장에서 exploitable — DNS TTL 조작 + private IP 로 toggling 시 SSRF 가능. server-side Host header validation 의존. operator 인지 의무. | P2 | P-F·S4 |
| L5-C | `src/discovery/fetch/safe-fetch.ts:807-825 zip bomb ratio` | `zipBombCheckEnabled` 조건 = Content-Length 있고 Content-Encoding 있을 때만 (line 808). chunked transfer (Content-Length 없음) + gzip 인 경우 (실제 보편적) ratio check disabled. 그러나 `maxBytes` (rss=5MB, html=10MB) 가 sole fallback — 압축 풀린 후 5MB 도달 시 BodyTooLargeError. design 의도 ✓ (line 798-806 comment 가 정확히 explain). 단 적대자가 의도적으로 Content-Length 헤더 누락 + tiny compressed → 5MB 까지 정상 동작하다 abort. | P3 | P-F·S4 |
| L5-D | `src/discovery/fetch/safe-fetch.ts:344-353 decodeUnreserved` | RFC 9309 §2.2.2 conform — `/`, `?`, `#` 만 keep encoded. 그러나 `%5C` (backslash) 같은 OS-specific path separator 는 decode → 일부 Apache mod_rewrite server 에서 \ 를 / 로 normalize 하는 경우 rule mismatch 가능. RFC conform 이지만 server-specific behavior 와 어긋남. | P3 | P-F·S3 |
| L5-E | `src/discovery/fetch/safe-fetch.ts:513-523 robots fail-closed` | 네트워크 error 발생 시 disallow-all + ROBOTS_ERROR_TTL_MS=5분 cache. RFC 9309 §2.3.1.3 conform ✓. 단 robots.txt 서버 outage 5분~몇 시간 지속 시 모든 source backoff → 자체 monitoring 부재 시 silent 가용성 저하. operator 인지 의무. | P2 | P-E·S4 |
| L5-F | `src/discovery/fetch/safe-fetch.ts:184-198 checkSsrf DNS timeout` | `Math.min(timeoutMs, 10_000)` — DNS lookup 10초 hard cap. fetchTimeoutMs default 30s 와 별개. DNS lookup 자체 stall 보호 ✓. | OK | P-F·S4 |
| L5-G | `src/discovery/scheduler/pool.ts:87-103 runWithPool` | per-host first → global acquisition. host blocked task 가 global 점유 안 함 → starvation 방지 ✓. release 순서 = global first → per-host. line 93-96 try-catch wrap 가 future AbortSignal-aware Semaphore 대비 (현재 inactive). forward-looking ✓. PER_HOST_MAX_ENTRIES=10_000 + idle 우선 eviction policy ✓. | OK | P-D·S3 |
| L5-H | `src/discovery/scheduler/scheduler.ts:111 Promise.allSettled` | Q-039 / DEC-019 chunked streaming hardening (INFRA-1B.2.x P1-M2-hardening) 미적용. 모든 source 의 fetch result + body buffer 가 in-memory 누적 후 phase 2. source 수 증가 시 메모리 unbounded — 72 source × 5MB rss max = 360MB worst case. v0 single-worker 작은 pool 에서 OK 이지만 향후 Tier B/C/D 확장 시 risk. L11 본격. | flag | P-D·S4 |
| L5-I | `src/discovery/scheduler/crawl-state.ts:7-8 BACKOFF_MS=24h` | consecutive_failures >= 5 → 24h backoff. UX 측: source 1개 fix 후 24h 기다려야 다시 fetch. backoff override CLI 부재 — operator 가 SQLite 직접 manipulate 의무. RUNBOOK 절차 명시 권고. | P2 | P-E·S4 |
| L5-J | `src/discovery/scheduler/scheduler.ts:181 + run-discovery.ts:281` | phase 2 의 `recordFetchOutcome(ok)` deferred — parse 성공 후 호출 (codex P1 oscillation fix). 의도: parse 실패 시 ok 가 fail 로 transition 가능. 정합 ✓. | OK | P-C·S2 |
| L5-K | `src/discovery/worker/chunker.ts:169` chunk_id = `chk_${ulid()}` vs `src/domain/ids.ts` ID_PREFIXES | 코드는 `chk_` prefix 사용 중 — 그러나 ID_PREFIXES map (25 type 등록) 에 `Chunk: "chk_"` 미등록. L3-F / L3-O 보강: AC-005 lint 가 chunk 를 scope 에 포함시키면 fail 가능. ID_PREFIXES 에 `Chunk: "chk_"` 추가 또는 AC-005 명시 제외 필요. | P2 | P-A·S2 |
| L5-L | `src/discovery/parse/xml-safe.ts:19 allowBooleanAttributes:true` | fast-xml-parser default 확장 — RSS feed 의 boolean attribute (`<item isPaid />`) 도 parse. 적대자가 unusual attribute injection 시 downstream rss-worker `findLocalKey` 가 그것을 무시 (RSS 표준 field 만 사용). 위험 미미. design 정합. | OK | P-F·S3 |
| L5-M | `src/discovery/worker/rss-worker.ts:40-54 findLocalKey` | namespace 미존중 + case-insensitive fallback (`<RsS><cHaNnEl><iTeM>` 도 처리). robust parsing ✓ 단 RSS spec 위반 source 도 정상 진입 — 의도된 leniency. v0 OK. | OK | P-G·S3 |
| L5-N | `src/discovery/worker/rss-worker.ts:166-175 parseDate` | `new Date(raw)` JS default parser — RFC 2822 / ISO 8601 / etc. 자동. malicious feed 가 1970-01-01 또는 9999-12-31 극단값 publishedAt 보낼 수 있음. downstream `discovery_queue.published_at` / Document.published_at 가 그 값 그대로 저장. NaN check ✓ — 단 valid Date 으로 parsing 되는 극단 값은 통과. AGG-1A.2 (scenario validate) horizon enum (Q-001) lock 시점에 published_at sanitize 필요. | P2 | P-F·S4 |
| L5-O | `src/discovery/worker/rss-worker.ts:177-184 isValidHttpUrl` + `enqueueDiscoveredItems` | URL protocol 만 검증 (http/https). SSRF 방어는 safe-fetch 단계 (snapshot-fingerprint 가 다시 safe-fetch 통해 fetch). `discovery_queue.url` 자체는 SSRF-unvalidated. 운영자가 SQL query 로 그 URL 직접 사용 시 risk. operational hygiene only — production code path 는 safe ✓. | P3 | P-G·S3 |
| L5-P | `src/discovery/worker/rss-worker.ts:228-251 enqueueDiscoveredItems` | transaction batch INSERT OR IGNORE + partial unique index `(source_id, url) WHERE status IN ('pending','processing')` (v6 line 33-35). atomic ✓ idempotent ✓. design robust. | OK | P-D·S3 |
| L5-Q | `src/discovery/worker/run-discovery.ts:211-248 charset detection` | Content-Type charset → XML prolog encoding → UTF-8 fallback. unsupported charset 시 RangeError throw → parse error → backoff. BOM detection 부재 — UTF-8 BOM (`0xEF 0xBB 0xBF`) 있는 feed 가 ASCII decode 시 replacement char 로 변환되어 `<?xml` 매칭 영향 미미. design robust ✓. | OK | P-F·S3 |
| L5-R | `src/discovery/worker/run-discovery.ts:282-286 catch + recordFetchOutcome` | parse error 시 recordFetchOutcome throw (SQLite locked) 가능 — busy_timeout 5초 초과 시 process abort. v0 single-worker 거의 발생 안 함. multi-worker (L11) 본격 분석. | flag | P-D·S4 |
| L5-S | `src/discovery/worker/chunker.ts:29-30 CHUNK_WORDS=500 / OVERLAP_WORDS=50` | hardcoded. CJK fallback character window (line 37-39) ✓. 단 runtime override 불가 — source-specific tuning 시 코드 변경 필수. v0 OK. | P3 | P-G·S5 |
| L5-T | `src/discovery/fetch/safe-fetch.ts:807 compressedSize` + EXTR LLM payload limit | Content-Length 0 / missing 시 compressedSize=0 → zip bomb ratio disabled (L5-C). 적대자가 의도적으로 헤더 누락 + tiny compressed → 5MB rss / 10MB html 도달까지 정상. 그 후 maxBytes BodyTooLargeError. 단 5MB body 가 LLM extractor 진입 가능 양 — ADR-0023 INV-0023-6 "1000+ rows / 50KB+ raw 금지" 와 EXTR-1A.* land 후 매핑 필요. 현재는 LLM 진입 path 부재 (EXTR-1A 미land) — risk dormant. | flag | P-F·S4 |

#### L5 cross-cutting (다음 layer 로 이관)

- **L7 (migrations + idempotency)**: v6 discovery_queue 의 partial unique index 가 SQLite 5.x WHERE clause partial index 지원 정합 검증
- **L8 (test coverage)**: safe-fetch 117 tests + xml-safe + scheduler + worker 의 실제 coverage % cross-check
- **L10 (security)**: safe-fetch 의 DNS rebinding scope.out 의 적대자 모델 본격 분석 + LLM payload size enforcement
- **L11 (concurrency)**: pollEligibleSources Promise.allSettled 의 multi-worker memory bound + recordFetchOutcome race
- **L12 (sustainability)**: BACKOFF_MS=24h backoff override 의 운영자 UX (RUNBOOK 절차)

### L6 — Audit / ops / feedback code (state machine + idempotency + enum integrity)

baseline: `src/ops/run-ledger.ts` 240줄 + `src/pipeline/access-intervention/{severity,recorder,batch-report}.ts` 347줄 + `src/pipeline/feedback/{manual-claim-entry,intervention-review}.ts` 505줄 = 약 1100줄 전수 read.

#### L6 findings

| ID | 위치 | 발견 | Severity | Perspective·Stage |
|---|---|---|---|---|
| L6-A | `src/ops/run-ledger.ts:61-173` startRun/completeRun/failRun | state machine ✓ — startRun validate tier∈{0,1,2,3}+stage 7 enum+vendor 3 enum+modelId+non-openai시 domainOverrideReason 의무 (INV-0023-7 매핑) / completeRun+failRun WHERE status='running' idempotent (두번째 호출 → changes=0 → throw). 29 tests pass. | OK | P-D·S3 |
| L6-B | `src/ops/run-ledger.ts` startRun + OPS-1A.2 미land | AC-019 enforcement (soft $5/hard $7.5/Tier 0 5회 cap/주간 $25/backfill bucket) 가 **코드에 0건** — record + aggregation 만. quota check 미land. DEC-020 Q-046 `src/ops/quota-enforcement.ts` + QuotaKind enum planned (OPS-1A.2). 현재 startRun caller 0건 (EXTR-1A.* 미land) — risk dormant. EXTR-1A.* 진입 직전 lock 의무. | P2 | P-D·S5 |
| L6-C | `migrations/sqlite/v1_schema.sql:22` completed_at TEXT nullable | startRun 후 completeRun/failRun 미호출 시 row 가 `status='running' AND completed_at=NULL` 영구. cost aggregation 은 `status='completed'` 만 SUM → orphan 미포함 ✓. 단 DB size growth + AC-029 run_count metric 잘못된 값 가능. stale running row 회수 worker 부재 (24h 초과 자동 failRun). OPS-1A.2 에 묶기 권고. | P2 | P-A·S4 |
| L6-D | `src/ops/run-ledger.ts:175-188 validateDate` | round-trip `Date.UTC` → ISO string 비교. JS Date 의 invalid month/day wrap (예 2026-13-32 → 2027-02-01) detect ✓. semantic validation 강력. | OK | P-D·S2 |
| L6-E | `src/ops/run-ledger.ts:195-232 getDailyCostUsd/Breakdown` | half-open range `>= date AND < nextDay` 사용 — v4 migration composite index `run_ledger_completed_at_vendor_idx` 정확히 cover ✓. LIKE 사용 회피로 B-tree 인덱스 활용. | OK | P-D·S3 |
| L6-F | `src/ops/run-ledger.ts:35` crossVendorReviewOf input | FK to run_ledger(run_id) — application 단 검증 없이 INSERT. 잘못된 run_id 시 SQLite FK violation throw (cryptic). v0 OK. | P3 | P-D·S3 |
| L6-G | `src/pipeline/access-intervention/severity.ts` computeSeverity | pure deterministic function — gateMode × importanceScore bucket × related_assumption_ids. INV-0017-7 (deterministic default, LLM 의존 0) ✓. NaN/Infinity → lowest bucket (line 41-48) ✓. | OK | P-D·S2 |
| L6-H | `src/pipeline/access-intervention/severity.ts:26-31 BASE table` | inline_block 의 low importance bucket = HIGH (gateMode 가 이미 차단 의미라 최소 HIGH). 모든 inline_block 가 publication blocker 의미 ✓. assumption-link elevate → CRITICAL 상한 ✓. | OK | P-G·S2 |
| L6-I | `src/pipeline/access-intervention/recorder.ts:107-122` Source MATCH guard | CREATE 후 Source link MATCH 실패 → rollback + throw (orphan 회피). `rolledBack` + `commitAttempted` 두 flag 로 double-rollback 회피. 정합 robust. 26 tests pass. | OK | P-D·S3 |
| L6-J | `src/pipeline/access-intervention/batch-report.ts:81-88` unknown severity bucket | enum 외 severity → HIGH conservative bucket. 정합 ✓ 단 silent override — operator 가 enum 추가 시 알람 부재. | P3 | P-G·S4 |
| L6-K | `src/pipeline/access-intervention/batch-report.ts:115-148 renderMarkdown` | `${item.sourceName}` 등 직접 보간 — markdown escape 없음. sources_seed.yaml operator-controlled 라 external attacker injection 0 ✓. 단 향후 source name 이 external feed 에서 derived 시 risk. operational hygiene. | P3 | P-F·S4 |
| L6-L | `src/pipeline/feedback/intervention-review.ts:52-86 resolveIntervention` | Q-037 → DEC-019 lock (INFRA-1B.6.x P1-M3-hardening) — multi-reviewer race. 현재 코드는 `MATCH WHERE status='pending_user_review' SET ...` 단일 Cypher query — atomic 하지만 두 reviewer 동시 query 시 matched=1 양쪽 return 가능 (Neo4j MERGE-vs-SET race). v0 single-operator 라 race 발생 안 함 ✓. multi-reviewer / web UI 도입 직전 `apoc.lock.nodes` 또는 CAS 의무. | P1 | P-D·S4 |
| L6-M | `src/pipeline/feedback/intervention-review.ts:191-216 manual_claim compensation` | createManualClaimEntry commit → resolveIntervention 실패 시 DETACH DELETE manualClaim. compensation 자체 실패 시 `swallow cleanup error` — manualClaim Neo4j 남고 intervention pending 유지 → 다음 retry 시 같은 intervention 으로 두 ManualClaimEntry 생성 가능 (다른 mcl_<ULID>). 중복 detection schema/code 부재. operational risk. | P2 | P-D·S4 |
| L6-N | `src/pipeline/feedback/intervention-review.ts:235-245 temp_text compensation` | SQLite-first + Neo4j-second + 실패 시 DELETE raw_cache_items. 정합 ✓. cache cleanup 실패 시 orphan rcache_<ULID> 누적 — 운영 cleanup script 의무. | P2 | P-D·S4 |
| L6-O | `src/pipeline/feedback/intervention-review.ts:148-152` raw_cache_items.expires_at 7d hardcoded | DEC-007 ceiling 24h~7d 범위 안 max 선택. ADR-0021 INV-0021-6 변경 시 코드 변경 의무. config 외부화 권고. L3-P / L5-S 와 동일 패턴 (hardcoded TTL/limit). | P2 | P-G·S5 |
| L6-P | `src/pipeline/feedback/intervention-review.ts:62-65` importance_score CASE | clamp negative ✓ 그러나 upper bound (1.0) 미check — adjust > 0 시 (현재 -0.2 만 사용) infinite 가능. 향후 ignore 외 action 추가 시 upper clamp 의무. | P3 | P-G·S4 |
| L6-Q | `src/pipeline/feedback/manual-claim-entry.ts:204-237` :DERIVED_FROM_MANUAL_REVIEW_OF + :RESOLVES edges | L3-C 에서 발견한 schema-level UNIQUE constraint 부재 edge — 같은 manual_claim 의 transaction race 시 중복 edge 생성 가능. v0 single-worker OK. multi-worker 도입 시 INV-0013-1 의 5 edge UNIQUE 처럼 확장 의무. | P2 | P-A·S2 |
| L6-R | `src/pipeline/feedback/manual-claim-entry.ts:77-133 validateInput` | ADR-0018 INV-0018-1 3-way exactly one ✓ + INV-0018-2 referenced_quote → quote_reason + attribution.url 의무 ✓ + 200 chars code point count ✓ + empty string `""` 은 `isSet` absent 취급 ✓. 엄격 enforce. | OK | P-D·S2 |
| L6-S | `src/pipeline/feedback/manual-claim-entry.ts:169` policy_gate_passed: false hardcoded | manual_claim 의 raw_text_stored=false (INV-0018-3) 라서 policy_gate 통과 의무 X — hardcoded false ✓. 향후 policy gate 통과 path 도입 시 변경 의무. | P3 | P-G·S5 |

#### L6 cross-cutting (다음 layer 로 이관)

- **L7 (migrations + idempotency)**: run_ledger의 v4 composite index cardinality + raw_cache_items DEC-007 lifecycle 자동 expire
- **L8 (test coverage)**: run_ledger 29 tests + access_intervention 26 tests + feedback tests 의 multi-reviewer race 시뮬레이션 부재
- **L10 (security)**: batch-report markdown injection (L6-K) future-risk + manual_claim attribution.url SSRF validation 부재
- **L11 (concurrency)**: resolveIntervention race (L6-L) Q-037 lock 본격 분석 + manual_claim 중복 detection (L6-M)

### L7 — Migrations + idempotency

baseline: scripts/migrate.ts 191줄 + SQLite v1~v7 migration files + migrations/neo4j/v1_schema.cypher 419줄 + src/storage/sqlite/connection.ts getMigrationVersion cross-check.

#### L7 findings

| ID | 위치 | 발견 | Severity | Perspective·Stage |
|---|---|---|---|---|
| L7-A | scripts/migrate.ts:130-133 Neo4j split-on-semicolon | split(";") + comment 제거. 현재 cypher 의 multi-line statement 모두 단일 ; 종료 ✓. 향후 string literal 안 ; 또는 raw string 안 ; 도입 시 잘못 분할 가능. 현재 0건. | P3 | P-G·S3 |
| L7-B | scripts/migrate.ts:159-162 Neo4j catch 3 idempotent error codes | EquivalentSchemaRuleAlreadyExists / ConstraintAlreadyExists / IndexAlreadyExists treat as success. DROP INDEX 의 fail mode 는 IF EXISTS 절 처리. 정합 ✓. | OK | P-D·S3 |
| L7-C | migrations/neo4j/v1_schema.cypher:25-29, 50-52 pre-clean MATCH | 5개 DETACH DELETE — fresh DB no-op ✓. INFRA-1B.3 시점 production dedup. re-run 시 매번 MATCH 실행 (no dups → empty result) — 비용 미미. 의도된 duplicate (staging-replay) 매 migrate 시 삭제 risk. v0 single-worker 안전. | flag | P-D·S4 |
| L7-D | scripts/migrate.ts:84-114 v7 ALTER COLUMN duplicate handling | "duplicate column name" detect → ALTER TABLE statements strip → idempotent remainder re-run. Codex PR #39 P1 fix robust. 그러나 regex single-line ALTER TABLE 만 — multi-line ALTER (RENAME COLUMN 등) 도입 시 broken SQL 가능. 향후 v8+ 도입 시 regex 갱신 의무. | P2 | P-D·S4 |
| L7-E | scripts/migrate.ts:64-69 매 iteration version check | getMigrationVersion 매 iteration — atomic chain ✓. partial apply ROLLBACK 시 schema_migrations 미INSERT → 다음 run 재시도 ✓. 각 file 의 INSERT + migrate.ts BEGIN/COMMIT wrap = atomic ✓. | OK | P-C·S3 |
| L7-F | scripts/migrate.ts:49-60 dry-run pending count | 한 번만 version 조회 후 pending filter — 정확 ✓. | OK | P-G·S1 |
| L7-G | migrations/sqlite/v6_discovery_queue.sql:31-35 partial unique index | WHERE status IN ('pending','processing') — bun:sqlite native 지원 ✓. done/error row 의 (source_id, url) 중복 허용 — 같은 URL 재발견 시 fresh queue_id enqueue 가능. partial unique 가 동시 active enqueue 차단 ✓. | OK | P-D·S3 |
| L7-H | migrations/sqlite/v6_discovery_queue.sql:27-38 error_code CHECK | 6 enum inline CHECK — SQLite native ✓. enum 확장 시 CHECK 갱신 의무. L5 snapshot-fingerprint TypedQueueError 6 enum 과 정확히 일치 ✓. | OK | P-D·S2 |
| L7-I | migrations/sqlite/v7_policy_decisions_intended_action.sql:8-13 intended_action namespacing | comment 가 사용 명시 — operator-facing row (NULL) vs audit row ('r2_upload') 분리. INTENDED_ACTION enum 현재 1값 ✓. 확장 시 enum.ts + schema 양쪽 갱신 의무. | OK | P-D·S2 |
| L7-J | scripts/migrate.ts:40-44 versionNum vs connection.ts CAST | TS versionNum("v1a") → 0 (NaN fallback), SQLite CAST('1a' AS INTEGER) → 1 (leading digits). version 명명 위반 시 detection 불일치 가능. v1~v7 hardcoded 라 영향 0 ✓ 운영자 임의 naming 도입 시 risk. | P3 | P-G·S4 |
| L7-K | migrations/sqlite/v*_schema.sql description field | 각 migration file 의 INSERT description 안 long table list 가 향후 schema 변경 시 stale 가능. version 만 canonical ✓ description informational. | P3 | P-G·S1 |
| L7-L | scripts/seed-sources.ts 29줄 thin wrapper | 실제 logic 은 src/storage/source-registry/seed.ts (L4 검증 완료). thin wrapper OK ✓. | OK | — |
| L7-M | scripts/migrate.ts:80 BEGIN DEFERRED | SQLite default BEGIN DEFERRED — shared lock, actual WRITE 시 exclusive 승격. busy_timeout 5초 재시도. bun:sqlite singleton 라 race 일반적 없음 ✓. | OK | P-D·S4 |
| L7-N | migrations/neo4j/v1_schema.cypher Neo4j version tracking 부재 | SQLite 의 schema_migrations 같은 메커니즘 부재. 매번 전체 schema apply — IF NOT EXISTS + catch error codes 로 idempotent ✓. 향후 v2_neo4j (INFRA-1B.7b v8 / INFRA-1B.9 canonical_text_hash / INFRA-1B.10 document_fetch_state) 도입 시 versioning strategy 미결정. 다음 schema change 진입 직전 lock 의무. Q-040 DEC-019 pre-deploy migration framework → DEPLOY-1A.1 안에 묶을 가능성. | P1 | P-A·S5 |
| L7-O | migrations/sqlite/v2_enum_constraints.sql triggers | CREATE TRIGGER IF NOT EXISTS ✓ idempotent. v1 → v2 chain order migrate.ts 강제 — 직접 v2 manual apply 시 fail. migration runner 사용 의무 ✓. | OK | P-D·S3 |
| L7-P | v6_discovery_queue.sql:11 source_id FK ON DELETE 미지정 | REFERENCES source_material_policy(source_id) ✓. 그러나 ON DELETE / ON UPDATE 정책 미명시 → SQLite default NO ACTION. source 삭제 시 discovery_queue dangling row 가능 (L4-F 와 동일 패턴 — cleanup script 의무). | P2 | P-A·S2 |
| L7-Q | migrations/sqlite/v1_schema.sql:11 PRAGMA foreign_keys = ON | v1 schema 가 PRAGMA 명시 + src/storage/sqlite/connection.ts:12 도 별도 PRAGMA. connection-scope 라서 새 connection 마다 적용 필요 — bun:sqlite singleton ✓. | OK | P-D·S3 |
| L7-R | scripts/migrate.ts dry-run file 존재 검증 부재 | SQLITE_MIGRATIONS file path readFileSync 직전 check 없음. file 미존재 시 throw — fail-loud ✓. 그러나 dry-run 은 readFileSync 호출 안 함 (line 56 console.log만) — stale path 도 통과. operational risk. | P3 | P-G·S4 |

#### L7 cross-cutting (다음 layer 로 이관)

- L8 test coverage: migration re-run idempotency 회귀 test 부재 — bun run migrate:sqlite 두 번 실행 후 schema 동일성 test 없음
- L9 CI/CD: migrate:sqlite --dry-run 이 CI required check 인지 cross-check
- L11 concurrency: BEGIN DEFERRED + busy_timeout race 의 multi-worker 시나리오
- L12 sustainability: Q-040 DEC-019 pre-deploy migration framework — DEPLOY-1A.1 P1-MVP-prep 진입 시점 결정

### L8 — Test coverage gaps

baseline 실측:
- 21 test files 전수 inventory (19 unit + 2 lint + 1 bench + 1 helper)
- `bun test` 실행 결과: **515 pass / 0 fail / 19 files / 1786 expect() calls** (단 fresh worktree 에서 `bun install` 필요)
- 06_ACCEPTANCE_TESTS.md TEST table 44 AC 매핑 cross-check
- SPIKE-001 / SPIKE-002 / SPIKE-003 실행 여부 + bench file inspection

#### Test landed vs planned summary

44 AC 중:
- **landed test 보유 AC (10)**: AC-003 / AC-005 / AC-008 / AC-019 / AC-020 (P0 partial) / AC-022 / AC-024 / AC-025 / AC-026 / AC-027
- **planned AC (34, ~77%)**: AC-001 / AC-002 (SPIKE-001 미실행) / AC-004 / AC-006 / AC-007 / AC-009~018 / AC-021 / AC-023 / AC-028~035 / AC-036~044
- partial: AC-020 (P0 raw_body_hash only) / AC-032 (audit ledger logic only, raw cloud zero E2E 미실행)

19 test file 의 분포:
- AC 명시 매핑 보유: id_prefix (AC-005) / no_frontmatter_relation_array (AC-008) / r2_policy (AC-003/020) / run_ledger (AC-019) / source_registry (AC-022) / access_intervention (AC-024) / feedback (AC-025) / bidirectional_schema (AC-026) / perspective_distribution (AC-027) / snapshot_fingerprint (AC-020 partial) / audit_policy_decisions (AC-032 partial) — 11 file
- AC 명시 매핑 부재 (invariant only): safe_fetch (130 tests, ADR-0028) / xml_safe (7, DEC-018) / pool (10, ADR-0030) / semaphore (15) / crawl_state (22) / rss_worker (21) / chunker (24) / text_hash (46, utils) — 8 file

#### L8 findings

| ID | 위치 | 발견 | Severity | Perspective·Stage |
|---|---|---|---|---|
| L8-A | 06_ACCEPTANCE_TESTS.md TEST table "X tests" 표기 | file 마다 의미 다름 (test() count / describe block / expect() / assertions). 실측 vs claimed: TEST-003 claimed 32 vs 실측 19 test() / TEST-005 claimed 28 vs 13 / TEST-008 claimed 9 vs 10 / TEST-019 claimed 29 vs **42 (undercount 13)** / TEST-022 claimed 22 vs **27** / TEST-024 claimed 26 vs **41 (undercount 15)** / TEST-026 claimed 27 vs 15 / TEST-027 claimed 5 vs 9. file 변경 후 stale count — 다수 발생. | P2 | P-C·S2 |
| L8-B | TEST table 의 invariant ↔ test cross-ref 부재 | 8 test file (130+ tests) 가 invariant 만 cover — AC table row 부재. ADR-0028 INV-0028-1~6 각각이 safe_fetch_test 130 tests 의 어떤 sub-test 와 매핑되는지 명시 없음. trace matrix 의 invariant ↔ test 매핑 sparse. | P3 | P-A·S5 |
| L8-C | SPIKE-001 미실행 | docs/03_RISK_SPIKES.md:46 status = "(미실행)". tests/bench/neo4j_fts_search_bench.ts 0 test() — manual run only (NEO4J_PASSWORD set 시). NFR-001 / AC-002 = "graph object 1만 건 시점 검색 < 1초 p95" — P0-M1 gate 핵심 PERFORMANCE invariant 검증 부재. current-state line 38 "SPIKE-001 미실시" 그대로 fact. P0-M1 gate accept 차단 risk. | P1 | P-A·S5 |
| L8-D | 34 AC (77%) 코드 검증 없음 | 절반 AC 가 EXTR/AGG/PUB slice (M3-M6) 미land 라 자연스러움. **그러나 P0-M2 gate scope 안 AC-023 (REQ-018 source policy gate mode-aware + 8 위험 행동 트리거) test land 0건** — current-state "P0-M2 게이트 검증 단계 진입" 인데 핵심 검증 path 부재. AC-023 → TEST-023 = tests/policy/gate_test.ts (planned, 부재). M2 own slice 인 INFRA-1B.1 안에서 policy gate logic 일부 검증 하지만 8 위험 행동 trigger E2E test 0건. P0-M2 accept 차단. | P1 | P-A·S5 |
| L8-E | bench file 결과 commit 절차 부재 | package.json bench:neo4j script + docs/03_RISK_SPIKES.md 의 Result section "(미실행)" 만. bench 실행 후 결과 어디에 기록할지 / commit 형식 / pass criterion (p95 < 1s) 확인 절차 미명시. SPIKE-001 lock 시점 procedure 의무. | P2 | P-A·S5 |
| L8-F | tests/test-helpers/neo4j-mock.ts shared mock (158줄) | snapshot_fingerprint / chunker / feedback / audit_policy_decisions 4 file import. single source ✓. 단 mock contract 명시 부재 — mock 변경 시 영향 받는 test 수 많음. mock 의 Neo4j API surface (session.run / tx.commit / records.map) coverage 가 production driver 와 의도된 분리. shared mock design intent OK. | OK | P-G·S1 |
| L8-G | test() 수 vs expect() 수 | 1786 expect / 515 test = 평균 3.5 expect/test — dense ratio 합리적. file 별 weighted 분포 정상. | OK | P-G·S1 |
| L8-H | Fresh worktree 에서 `bun install` 의무 미명시 | 본 review 진행 중 발견 — fresh worktree 에서 `bun test` 실행 시 **9 file fail** (ulid package 미발견 — `Cannot find package 'ulid'`). `bun install --silent` 후 515 pass. RUNBOOK / README / CLAUDE.md / AGENTS.md 모두 first-time setup 절차 명시 없음. CI 도 동일 risk (L9 영역). 새 세션 / 새 worktree 진입 시 silent fail risk. | P1 | P-A·S5 |
| L8-I | Multi-reviewer race test 부재 (L6-L 회귀) | L6-L resolveIntervention Q-037 race + L4-K audit row 1/2+2/2 atomic — v0 single-operator 라 회귀 test 부재. INFRA-1B.6.x P1-M3-hardening 진입 직전 race 검증 test 추가 의무. | P2 | P-A·S4 |
| L8-J | DNS rebinding scope.out 명시 anchor 부재 | safe_fetch_test 130 tests 안에 "DNS rebinding 은 scope.out" test 또는 명시 anchor 별도 row 없음. ADR-0028 본문 scope.out 의도 ✓ — 단 test file 안에서도 명시 anchor (e.g. test.skip("DNS rebinding — scope.out per ADR-0028")) 권고. | P2 | P-A·S2 |
| L8-K | chunk_ ID prefix lint scope 부재 (L5-K 회귀) | tests/lint/id_prefix_test.ts 13 test() 가 ID_PREFIXES map 검증 — Chunk 미등록 (L3-F / L3-O / L5-K). chunker 가 `chk_${ulid()}` 사용. lint test 가 chunk ID 를 scope 안에 포함 안 함 → 실제 production 코드와 lint scope 사이 silent gap. ID_PREFIXES.Chunk 추가 시 lint 자동 cover. | P2 | P-D·S2 |
| L8-L | r2Get 사용 path test (L4-B 잔향) | r2_policy_test 32 tests 가 round-trip 검증 ✓ 단 production caller 0건. AC-020 P0 의 검증 surface 가 unit test 안에서만 — AGG-1A.1 / PUB-1A.* land 시 production caller 도입 후 integration test 추가. | P3 | P-A·S2 |
| L8-M | lint test 정합 | id_prefix_test (AC-005) + no_frontmatter_relation_array_test (AC-008) — AC 본문 직접 매핑 ✓. | OK | P-D·S2 |
| L8-N | TEST-019 cost throttling worker test 부재 (L6-B 잔향) | run_ledger_test 42 tests — record + aggregation API 만 검증. AC-019 의 throttling logic (soft $5 warn / hard $7.5 backoff / Tier 0 5회 cap / 주간 $25 / backfill bucket) 본문 검증 0건 — OPS-1A.2 quota-enforcement module 미land. AC-019 의 enforcement 검증 path 부재. EXTR-1A.* 진입 직전 OPS-1A.2 land 의무. | P1 | P-A·S5 |
| L8-O | snapshot_fingerprint_test 의 audit ledger fail propagation | 본 turn `bun test` 실행 중 console 에 "[snapshot] audit insert failed (decision=attempted, snap_id=...) — throwing to surface audit ledger failure (NFR-008 hard gate): no such table: policy_decisions". 즉 audit hard-gate 가 test scope 안에서 실제 fire — test setup 이 policy_decisions table 누락 시 expected behavior 검증. test pass ✓ (의도된 negative test). | OK | P-D·S3 |
| L8-P | tests/bench/neo4j_fts_search_bench.ts:82 line size | 82 줄 bench scaffold — fixture generator + 3 query type 측정 lock. 그러나 실행 결과 commit / dashboard 부재. SPIKE-001 (L8-C) 진입 시 RUNBOOK 절차 의무. | flag | P-G·S5 |
| L8-Q | tests/unit/source_registry_test.ts:278 줄 | 27 test() — seed dry-run + enum validation + YAML structure + slug 중복 + upsert. AC-022 검증 ✓. SQLite trigger interaction 검증 부재 (v2 enum trigger 가 source_material_policy 에는 적용 안 됨 — inline CHECK constraint 만, line 73-75 v1) — design intent OK. | OK | P-D·S3 |
| L8-R | tests/unit/audit_policy_decisions_test.ts 19 test (claimed 16) | 19 test — TEST-032 와 매핑 안 됨 (TEST-032 = raw cloud zero E2E planned). 실제 검증: BEFORE/AFTER row attribute + audit-by-absence + INTENDED_ACTION enum + rationale format. L1-B 와 매핑 — AC-032 evidence 가 audit logic 만 cover, raw cloud zero E2E 부재. | P2 | P-C·S2 |

#### L8 cross-cutting (다음 layer 로 이관)

- **L9 (CI/CD)**: `bun install` 자동화 + CI 의 `bun test` required check 등록 / failing test policy
- **L10 (security)**: safe_fetch_test 130 tests 의 INV-0028-* 매핑 + DNS rebinding scope.out 명시
- **L11 (concurrency)**: multi-worker race test 도입 시점
- **L12 (sustainability)**: 21 test file 의 운영자 attention budget vs P0-M2 게이트 검증 가능 수준

### L9 — CI/CD & supply chain

baseline 실측:
- `.github/workflows/` 8 file: 4 active (ci.yml / doc-freshness.yml / doc-governance.yml / invariant-check.yml) + 4 .example
- `scripts/check-doc-governance.rb` 415줄 (Ruby — bun stack 안에 1건)
- `gh api repos/alxdr3k/k-world-monitor/branches/main/protection` 실측 → **"Branch not protected" (HTTP 404)**
- `bun.lock` 1차 deps 4 + transitive ~10
- `.github/dependabot.yml` 부재

#### L9 findings

| ID | 위치 | 발견 | Severity | Perspective·Stage |
|---|---|---|---|---|
| L9-A | GH API `repos/.../branches/main/protection` 404 vs DEC-020 Q-048 lock | DEC-020 Q-048 resolution + PRD line 208-212 가 "main branch protection: PR-only" 단언. 실제 GH state = **Branch not protected**. PRD/IMPL_PLAN/TRACE-044 의 단언과 fact 불일치 — admin task 미실행. **CLAUDE.md "Git Branch Policy" 가 "k-world-monitor — main 에 직접 커밋/push 허용" 명시 — DEC-020 의 PR-only 와 직접 충돌**. 두 policy 모순 + 실제 GH state 가 CLAUDE.md 와 정합. 운영자 결정 필요: (a) DEC-020 우선 → CLAUDE.md 예외에서 k-world-monitor 제거 + branch protection 등록 / (b) CLAUDE.md 우선 → DEC-020 의 "PR-only" 후퇴 + PRD/IMPL_PLAN 갱신. | P0 | P-B·S2 |
| L9-B | CI required check 등록 없음 (L9-A 결과) | ci.yml workflow 활성 — bun typecheck + bun test + migrate dry-run 실행. 그러나 required check 미등록 → PR 가 ci fail 도 merge 가능. DEC-020 Q-048 명시 "required check = ci.yml" — 등록 운영자 admin task 미실시. CLAUDE.md 의 "k-world-monitor main 직접 push 허용" 과 정합. | P1 | P-D·S2 |
| L9-C | 4 workflow 모두 advisory (block 안 함) | ci.yml (required check 미등록, L9-B) / doc-freshness.yml (`continue-on-error: true` line 137 명시) / invariant-check.yml (validator `exit 0` line 102) / doc-governance.yml (required 미등록). v0 single-operator 정책 ✓. 단 향후 multi-collaborator 도입 시 hardening 의무. | P2 | P-D·S4 |
| L9-D | doc-governance.yml `ruby scripts/check-doc-governance.rb` | bun + TS stack 안에 Ruby script 1건. ubuntu-latest default Ruby 보유 ✓. 설치 step 부재 → 정확히 stdlib 만 (415줄 script 본문 미read). 향후 Ruby 미보유 환경 / Node-only runner 도입 시 alternative 필요. | P3 | P-G·S5 |
| L9-E | `.github/workflows/*.example` 4 file 잔존 (L1-P 보강) | active 3쌍 + cd.yml.example only. doc-governance.yml 만 .example 없음. boilerplate sync surface. 운영자 confusion risk. | P2 | P-G·S1 |
| L9-F | invariant-check.yml `--regenerate` → `--ci` (L1-G + L2-E 보강) | CI 안에서 docs/_generated/ 정상 생성 ✓ + 7일 retention upload. 단 운영자 local fresh worktree 부재 그대로 (L2-E). AGENTS.policy.md 의무 read 대상이 fresh local 에서 prerequisite (`bun run invariant:regen`) 명시 부재. | P2 | P-D·S5 |
| L9-G | CI runner Bun version pin `1.3` | ci.yml:41 + invariant-check.yml:87. 본 review bun 1.3.5 정합 ✓. 향후 bun 1.4 / 2.0 도입 시 CI 와 local sync 운영자 의무. 자동화 메커니즘 없음. | P3 | P-G·S5 |
| L9-H | ci.yml:62-70 debug artifacts | logs/ + coverage/ + test-results/ — production code 가 그 경로에 emit 안 함. `if-no-files-found: ignore` → silent empty artifact. actual failure 시 debug 정보 0건. v0 OK. | P3 | P-G·S4 |
| L9-I | npm supply chain audit 자동화 없음 | `bun audit` / `npm audit` step CI 안 0건. `.github/dependabot.yml` 부재 — automated dep update 미설정. deps: 1차 4개 (fast-xml-parser / js-yaml / neo4j-driver / ulid) + transitive ~10 (특히 micro-package: @nodable/entities / strnum / xml-naming / path-expression-matcher). 작은 surface ✓ 단 micro-package supply chain risk. dependabot 또는 Renovate 도입 의무. | P1 | P-F·S4 |
| L9-J | `.github/pull_request_template.md` 30줄 | PR template content 미check (본 review 영역 외). 운영 hygiene only. | P3 | — |
| L9-K | ci.yml:44 `bun install --frozen-lockfile` | lockfile 위반 시 CI fail ✓. local fresh worktree 운영자도 동일 명령 의무 — 그러나 명시 부재 (L8-H 와 동일). | P2 | P-D·S3 |
| L9-L | doc-governance.yml DOC_GOVERNANCE_STRICT 미활성 | line 37-42 commented out. boilerplate placeholder 가 모두 채워졌으면 strict mode 도입 가능. 미land. | P3 | P-G·S5 |
| L9-M | doc-freshness.yml:42 `fetch-depth: 0` | full clone history fetch — base ref diff 계산 위해 의도 ✓. small repo OK. large repo 시 CI 시간 영향. | P3 | P-G·S1 |
| L9-N | doc-freshness.yml:66-81 grep based path detection | `grep -E '^src/'` 등 regex 매칭. source path 이동 시 silent miss. 본 repo path stable ✓. | P3 | P-G·S5 |
| L9-O | check-doc-governance.rb 415줄 vs validate_invariants.ts 380줄 분담 명시 부재 | 두 script 가 doc governance 검증 분담 — Ruby: duplicate IDs / dangling refs / AC link / Markdown / TS: scope_tree / term_usage / effective_invariant_policy / term_effects / scope_creep. 분담 명시 부재 → 운영자 confusion risk. README / RUNBOOK 명시 의무. L2 의 validator integrity 와 cross-cutting. | P2 | P-G·S2 |
| L9-P | Doppler secret rotation 절차 (Q-047 / DEC-020) | RUNBOOK Doppler integration 섹션 존재 (current-state line 248 명시) — 그러나 본 review 영역 (L12 sustainability) 으로 이관. rotation cadence + 운영자 절차 RUNBOOK 검증 필요. | flag | P-G·S5 |

#### L9 cross-cutting (다음 layer 로 이관)

- **L10 (security)**: micro-package supply chain (strnum / xml-naming / @nodable/entities) audit + secret rotation procedure
- **L12 (sustainability)**: 4 workflow advisory 누적 + dependabot 부재 → 운영자 attention burden

### L10 — Security & adversarial surface (집중 패스)

baseline 실측:
- ADR-0028 (safe-fetch SSRF/redirect/size/TLS/robots, 196줄) + ADR-0029 (LLM prompt injection containment, 183줄) 전수 read
- `src/extraction/` 디렉토리 **부재** — ADR-0029 INV-0029-1~5 코드 0건
- Cypher query inventory: 모두 parameter `$id` 사용, `${}` interpolation 0건
- SQLite query inventory: 모두 `.prepare(...)` + parameterized run/all/get
- `process.env` 직접 read 18 위치 (R2/Neo4j/SQLite/Discovery)
- `bun audit` 실측: **"No vulnerabilities found"** ✓
- batch-report.ts markdown 보간 (L6-K 보강)

#### L10 findings

| ID | 위치 | 발견 | Severity | Perspective·Stage |
|---|---|---|---|---|
| L10-A | `src/extraction/` 부재 + ADR-0029 INV-0029-1~5 | 모든 prompt injection 방어 코드 land 0건 — EXTR-1A.0 (planned) slice 가 P0-M3 entry. 현재 시점 LLM 호출 path 자체 없음 → risk dormant. EXTR-1A.0 진입 직전 (`untrusted-wrapper.ts` + `html-to-text.ts` + `llm-policy-gate.ts`) 의무 lock. ADR-0029 PRE-0029-2 가 EXTR-1A.0 → EXTR-1A.1 순서 강제 ✓ 단 운영자가 sequence 무시 시 silent bypass 가능. | P1 | P-A·S5 |
| L10-B | Cypher injection surface = 0 | 모든 `tx.run` / `session.run` 호출 — Neo4j driver bound parameter (`$id`, `$sessionId`, `$contentHash`) 사용. user input 직접 `${}` interpolation 0건. snapshot-fingerprint 의 `$contentHash` 는 sha256 hex (derived from body) — cypher syntax 영향 없음. **Cypher injection 방어 정합 ✓**. | OK | P-F·S2 |
| L10-C | batch-report.ts markdown 보간 (L6-K 잔향) | operator-controlled sourceName ✓ safe. 그러나 `url` / `attemptedAction` / `accessResult` / `whyItMatters` 가 적대자 controlled (RSS feed → access intervention path). `[XSS](javascript:alert(1))` 형식 inject 가능. v0 markdown = 운영자 자체 review 만 → risk 매우 낮음. 향후 markdown 이 publication (Astro) path 도달 시 risk 증가. | P3 | P-F·S4 |
| L10-D | SQLite injection surface = 0 | 모든 `.prepare(...).run/all/get` parameterized. `IN (${placeholders})` 패턴 도 placeholders = `'?'.repeat(...).join(',')` value spread parameter. **SQLite injection 방어 정합 ✓**. | OK | P-F·S2 |
| L10-E | process.env 직접 read 18 위치 (R2/Neo4j/SQLite/Discovery) | Doppler boundary = secret → process.env inject 후 코드 read ✓. 그러나 18 read site 가 centralized 안 됨 — secret rotation 시 어떤 module restart 의무 명시 부재 (L4-N 보강). singleton (R2 client / Neo4j driver / SQLite db) 모두 process lifetime cache → secret rotation 후 process restart 의무. RUNBOOK Doppler section 절차 검증 필요. | P3 | P-D·S5 |
| L10-F | console.warn / error 안 credential propagation surface | snapshot-fingerprint / audit / safe-fetch 다수 `console.warn(err.message)` — Neo4j driver / SQLite native error 가 password 노출 안 함 ✓ (driver design). R2 Bun.S3Client error 가 credential 노출하는지 외부 검증 영역. error message 정책 RUNBOOK 명시 + structured logging secret scrub 권고. | P2 | P-F·S4 |
| L10-G | bun audit 실측 = clean | "No vulnerabilities found" ✓. v0 시점 supply chain clean. L9-I 의 dependabot.yml 부재 → manual audit 운영자 의무. cadence (e.g. 주간 / 월간) 명시 부재 — RUNBOOK 권고. | OK | P-F·S3 |
| L10-H | LLM payload size enforcement (INV-0023-6 / INV-0029-3) 미land | ADR-0023 INV-0023-6 (1000+ rows / 50KB+ raw payload → LLM raw 직접 금지) + ADR-0029 INV-0029-3 (Tier 별 token cap 4000/8000/16000). EXTR-1A.0 / EXTR-1A.5 (Data Science Module) 진입 직전 lock 의무. 현재 코드 0건. L5-T 의 safe-fetch maxBytes (5MB/10MB) 가 LLM-side 검증 못 함 — EXTR 가 추가 layer. | P2 | P-A·S5 |
| L10-I | R2 IAM scope (.env.example 명시) | "Restrict the IAM token to the project bucket via Cloudflare R2 policy" — operator setup 의무. bucket scope down + read+write only + region 제한 자동 enforce 안 됨. compromised credential blast radius (한 bucket 만). RUNBOOK Doppler section 안 IAM scope 검증 절차 권고. | P2 | P-F·S4 |
| L10-J | Operator attacker model 가벼움 | 1인 운영자 = trust boundary 안. 그러나: (a) 운영자 device compromised 시 모든 secret 노출 (Doppler local cache + .env fallback) (b) 운영자 의도 외 `.env` commit (.gitignored ✓ + pre-commit hook 부재) (c) GH access token revoke 절차 부재. L12 sustainability 본격. | P1 | P-F·S5 |
| L10-K | Doppler secret rotation cadence 미명시 | DEC-020 Q-047 → Doppler primary lock. rotation cadence (90일 / 180일) 명시 부재. RUNBOOK Doppler section 검증 필요. 4 vendor key (OpenAI / Anthropic / Google / R2 + Neo4j password) 의 rotation procedure. | P2 | P-F·S5 |
| L10-L | HTML/JSON parser DoS surface | xml-safe (fast-xml-parser) — XXE 방어 ✓ (DEC-018) + zip bomb 방어 ✓ (L5). JSON.parse caller 0건 (EXTR layer 미land — `body.toString()` snapshot-fingerprint 직접). EXTR 진입 시 JSON recursion depth / circular reference DoS 검증 의무. | P3 | P-F·S5 |
| L10-M | XXE + billion-laughs 방어 | xml-safe.ts:16 `processEntities: false` ✓ DEC-018. XML entity expansion 차단. billion-laughs / DOCTYPE attack 방어. xml-safe_test 7 tests 검증 ✓. | OK | P-F·S2 |
| L10-N | DNS rebinding scope.out (L5-B 잔향) | ADR-0028 본문 line 215-220 comment 명시 trade-off. operator awareness 의무. RUNBOOK / SECURITY 문서 한 줄 명시 권고. | P2 | P-F·S4 |
| L10-O | Prompt injection 1인 vault 환경 모델 | Q-050 multi-round agent loop + second-brain vault 안 fetched 외부 컨텐츠 inline → operator 본인 노트 안에 적대자 inject payload 잠재 진입. ADR-0029 INV-0029-1 (untrusted wrapper) 가 LLM 직전 enforce — 그러나 operator 자체 vault 안 데이터를 trust 단계로 명시 분리 의무. Q-050 lock 시점 결정 의무. | P2 | P-F·S5 |
| L10-P | safe-fetch test coverage (L5-A 보강) | safe_fetch_test 130 tests — INV-0028-1~6 각각의 sub-test 매핑 명시 부재 (L8-B). DNS rebinding scope.out test anchor 부재 (L8-J). cypher injection / SQL injection 명시 negative test 부재 (L10-B / L10-D 가 design 자체로 safe — test 추가 권고). | P3 | P-A·S2 |
| L10-Q | safe-fetch.ts:218 DNS-rebinding TOCTOU narrative | "narrow under normal TTLs" — DNS TTL 검증 안 함. attacker controlled DNS 가 TTL=0 설정 시 narrow window 가 wide. server-side Host header validation 가 mitigations 라고 하지만 모든 target server 가 검증 안 함 (특히 cloud metadata endpoint). | P2 | P-F·S4 |

#### L10 cross-cutting (다음 layer 로 이관)

- **L11 (concurrency)**: secret rotation 도중 multi-process race + audit row 1/2+2/2 atomic (L4-K) 보안 영향
- **L12 (sustainability)**: 1인 운영자 attacker model 본격 + 4 vendor key rotation cadence

### L11 — Concurrency & failure modes

baseline 실측:
- DEC-019 (Q-037~Q-041 resolution) 5개 hardening lock — INFRA-1B.6.x + 1B.3.x + 1B.2.x + DEPLOY-1A.1/1A.2 모두 deferred
- L4-K audit row atomic + L5-H Promise.allSettled memory + L6-L resolveIntervention race + L7-M BEGIN DEFERRED + L10-K Doppler rotation cross-cutting
- compensation pattern (manual_claim + temp_text) idempotent DELETE WHERE id ✓
- snapshot-fingerprint stale-reclaim threshold 60min

#### L11 findings

| ID | 위치 | 발견 | Severity | Perspective·Stage |
|---|---|---|---|---|
| L11-A | DEC-019 Q-037~Q-041 lock (5 hardening) | INFRA-1B.6.x (apoc.lock multi-reviewer) + INFRA-1B.3.x (worker_id CAS) + INFRA-1B.2.x (chunked streaming) + DEPLOY-1A.1 (migration framework) + DEPLOY-1A.2 (millis-bearing CHECK) 모두 P0-M6 accept 후 진입. v0 single-worker 안전. RESEARCH-1A.* (P1+) 진입 시 multi-reviewer / web UI 도입 — race 발생 가능. timing critical lock. | P1 | P-D·S5 |
| L11-B | `src/pipeline/feedback/intervention-review.ts:52-86 resolveIntervention` (L6-L 본격) | Cypher `MATCH ... WHERE status='pending_user_review' SET ...` 단일 query atomic at Cypher level. 그러나 two reviewers 동시 시 양쪽 matched=1 return 가능 (Neo4j MERGE-vs-SET race). result: importanceScore double-adjust (-0.4 의도 -0.2x2) + manual_claim 2개 + :RESOLVES edge 2개 (L3-C UNIQUE 부재). DEC-019 → `apoc.lock.nodes([i])` 또는 strict CAS pattern (`MATCH {status: 'pending_user_review'} SET ... RETURN`) lock 도입 의무. | P1 | P-D·S4 |
| L11-C | `src/discovery/worker/snapshot-fingerprint.ts:411-444 markQueueItem* UPDATE` | `WHERE queue_id = ? AND status = 'processing'` — worker_id 없음. 두 worker 가 같은 queue_id claim race 후 양쪽 SET 'done' 시도 가능. 두 번째 update changes=0 silent miss. Snapshot MERGE on content_hash idempotent ✓ (constraint enforce) 단 link edge 중복 가능. DEC-019 INFRA-1B.3.x lock = worker_id CAS 도입. | P1 | P-D·S4 |
| L11-D | `src/discovery/scheduler/scheduler.ts:111 Promise.allSettled` (L5-H 본격) | 72 source × 5MB rss = 360MB worst case. v0 small pool OK. DEC-019 INFRA-1B.2.x = chunked streaming Phase 1/2 — `async function* streamPolls(targets, chunkSize=8)` 패턴. memory bounded by chunkSize × maxBytes. Tier B/C/D 확장 시 의무. | P2 | P-D·S4 |
| L11-E | ISO timestamp format mix (Q-041 → DEC-019 lock) | spot check: `new Date().toISOString()` (TS, ms precision) / SQLite `strftime('%Y-%m-%dT%H:%M:%SZ','now')` (second) / SQLite `strftime('%Y-%m-%dT%H:%M:%fZ',...,'+7 days')` (ms) / `seed.ts:179 toISOString().replace(/\.\d{3}Z$/,'Z')` (second, ms 제거) — 4 format mix. lexicographic compare 시 same-length region 까지만 매칭 → silent drift risk. future writer 잘못된 format 사용 시 comparison fail. DEC-019 DEPLOY-1A.2 lock = 모든 ISO timestamp 컬럼 `CHECK (col GLOB '????-??-??T??:??:??.???Z')` (millis-bearing 강제). P1-MVP-prep 진입 의무. | P1 | P-D·S4 |
| L11-F | `src/storage/audit/policy-decisions.ts recordR2UploadDecision` (L4-K 본격) | BEFORE row + AFTER row 별도 INSERT, transaction wrap 부재. design 옵션: (1) caller BEGIN/COMMIT (snapshot-fingerprint 책임) (2) multi-row INSERT CTE (3) 단일 row 의 2 column (intended_action_at / outcome / outcome_at) — design 3 가장 robust. v0 single-worker OK. multi-worker 도입 시 의무. | P2 | P-D·S4 |
| L11-G | `scripts/migrate.ts:80 BEGIN DEFERRED` (L7-M 본격) | bun:sqlite singleton + busy_timeout 5초 ✓. 같은 process 안 multi-async-task 가 동시 write 시도 시 shared lock → exclusive 승격 race + busy_timeout 5초 후 fail throw. v0 single-worker 안전. multi-worker (P1-M2-hardening) 도입 시 BEGIN IMMEDIATE 또는 application-level mutex 의무. | P2 | P-D·S4 |
| L11-H | `src/discovery/scheduler/scheduler.ts` phase 1/2 + `runWithPool` timeout 부재 | line 53-55 dedup ✓. 그러나 runWithPool 의 acquire (per-host + global semaphore) 가 hung 시 phase 2 진행 지연 — semaphore.acquire timeout 없음 → infinite hang risk. L5-G comment 가 "future AbortSignal-aware Semaphore" 명시 forward-looking. 현재 hang risk 미land. | P2 | P-D·S4 |
| L11-I | compensation 패턴 cascade (L6-M + L6-N 본격) | manual_claim + temp_text 모두 compensation = `DELETE WHERE id = $id` — idempotent ✓ multi-worker 안전. 단 multi-failure cascade: Op A success → Op B fail → compensation fail (swallow) → Op A 결과 영구 + intervention pending. worker2 가 같은 intervention review 시도 시 idempotent DELETE 가 worker1 의 stale data 정리 — 재생성 안전 ✓. design robust. | OK | P-D·S4 |
| L11-J | `src/discovery/worker/run-discovery.ts:294-307 shutdown` (L1 retro 절반 fix 잔여) | closeDb() 만 호출, closeDriver() 미호출 (comment "v0 does not open a Neo4j session" 명시). 정합 ✓. 향후 run-discovery 가 Neo4j 호출 path 도입 시 closeDriver 추가 의무. | flag | P-G·S5 |
| L11-K | Doppler secret rotation multi-process race (L10-K 본격) | operator rotation 시 (1) Doppler 갱신 → (2) running process 의 process.env 은 cached old → (3) new process 만 new secret. running process 가 old secret 사용 — old key revoke 시점에 R2/Neo4j/LLM API 호출 fail. 절차 = (1) Doppler 갱신 (2) 모든 running process restart. RUNBOOK 명시 의무. | P2 | P-F·S4 |
| L11-L | Neo4j MERGE on content_hash race | `MERGE (s:Snapshot {content_hash: $contentHash})` + snapshot_content_hash_unique constraint. Neo4j MERGE atomic at constraint level — 두 worker 동시 MERGE 중 한 명만 CREATE 성공, 다른 명 constraint violation throw. 현재 코드는 throw propagate → markQueueItemError. retry 자체 없음 — 다음 stale-reclaim 60min 후 재시도. acceptable v0 단 transient race 가 60min 지연 — operator 인지 의무. | P2 | P-D·S4 |
| L11-M | `src/discovery/worker/chunker.ts:223-225 commitAttempted` | `commitAttempted = true; await tx.commit();` — commit 전 flag 설정. tx.commit() throw 시 catch 가 rollback skip. tx 가 partial state 가능성 — Neo4j driver 자체 cleanup 의존. design intent: commit 실패 시 자동 rollback (Neo4j docs 검증 필요). v0 OK. | P2 | P-G·S4 |
| L11-N | `src/discovery/scheduler/semaphore.ts:32 double-release detection` | `if (queue.length === 0 && active <= 0) throw new Error(...)` — double-release throw. design robust ✓. 단 catch 안 release 호출 시 두 번째 release throws → callstack noise. v0 OK. | P3 | P-G·S4 |
| L11-O | `src/discovery/worker/snapshot-fingerprint.ts:793 STALE_RECLAIM_THRESHOLD_MS = 60min` | worker crash 시 queue row stuck status='processing' → 1h 후 stale-reclaim. AI extractor 5분 안 끝나면 stuck 가능 — 1h reclaim 너무 늠. 권고: 15min 줄이기 + heartbeat (Q-038 worker_id CAS 와 함께). 또는 progressive backoff. multi-worker 도입 직전 의무. | P2 | P-E·S4 |
| L11-P | discovery scheduler 의 phase 2 ok-record delayed (L5-J 보강) | recordFetchOutcome(ok) 가 run-discovery parse 성공 후 deferred (codex P1 oscillation fix). 정합 ✓. 단 parse 실패 시 phase 2 가 not_modified/error 만 기록 → ok 영구 부재 → 다음 run 시 다시 fetch (parse retry). 정상 design — single-pass 자체가 cost 없음. | OK | P-C·S3 |
| L11-Q | Cross-store TOCTOU window (L4-F 본격) | snapshot-fingerprint allLinkedSourcesAllowRawCloud BEFORE/AFTER r2Put 양쪽 recheck. cross-store policy 갱신 source = seed.ts 만 (운영자 manual) → race window 매우 좁음. policy_learning_events (OPS-1A.4 미land) 가 자동 mutation 도입 시 cross-store transactional integrity 재검토 의무. | flag | P-D·S4 |
| L11-R | 4 vendor API key rate-limit failure mode | OpenAI / Anthropic / Google + Cloudflare R2 — 각 vendor 429 Too Many Requests / 5xx outage 시 worker behavior. retry policy 미구현 (EXTR-1A.* 미land). 향후 token bucket / exponential backoff 의무. AC-019 cost ceiling 의 hard cap 도 별도. | flag | P-F·S5 |
| L11-S | concurrent migration race | `bun run migrate:sqlite` 가 두 process 동시 실행 시 — `schema_migrations` row INSERT race (line 298 of v1) → INSERT OR IGNORE 가 idempotent ✓. BEGIN DEFERRED 두 process 동시 → busy_timeout 5초 + retry. 정합 robust. 운영자 실수 risk 미land. | OK | P-D·S4 |

#### L11 cross-cutting (L12 로 이관)

- 19 finding 중 P1 4건 (L11-A/B/C/E) 모두 DEC-019 의 5 hardening lock 의 specific facet — L12 sustainability 안 통합 권고 anchor
- compensation 패턴 (L11-I) + Neo4j MERGE race (L11-L) + Doppler rotation (L11-K) 가 operator awareness 의존 — L12 1인 운영자 attention budget 본격
- L11-R rate-limit / failure mode — EXTR-1A.* land 시 본격, L12 의 future planning anchor

### L12 — 1인 운영자 sustainability + 12 layer 통합 권고

baseline 실측:
- doc inventory: 159 docs / 31 ADR / 23 DEC / 37 Q / 44 AC / 28 REQ / 10 NFR / 22 glossary
- code inventory: 27 src TS file + 9 migration + 21 test file = 57 file
- governance doc 총 ~2750줄 (PRD 276 + HLD 398 + IMPL_PLAN 284 + AC 156 + Q 83 + DEC 68 + TRACE 135 + RUNBOOK 413 + DOC 176 + retro 352 + 본 review 추가 ~700)
- ADR total ~4600줄 (avg ~150줄/file)
- DEC + Q total ~6000줄 (avg ~100줄/file)
- glossary + research + discovery + design/archive ~3500줄
- **total ~17K줄 governance/decision** for ~5K줄 code → **doc:code ratio ≈ 3.4:1**
- decision velocity (2026-05 시점): DEC-001~023 (9개월) / Q-001~051 (~8개월) / ADR-0001~0031 (~9개월) = 약 1주당 2~3 decision artifact
- 누적 advisory: 189 finding (본 review) + 36 warnings + 81 infos (invariant validator)

#### L12-A. Doc weight 분석

각 새 세션 진입 시 의무 read order (`AGENTS.md`):
1. `docs/context/current-state.md` (287 lines)
2. `docs/04_IMPLEMENTATION_PLAN.md` active milestone (284 lines)
3. `docs/current/CODE_MAP.md` (size 미확인)
4. `docs/current/TESTING.md` (size 미확인)
5. `docs/11_CI_CD.md` if relevant (249 lines)
6. task-relevant source files
7. relevant ADR (각 ~150 lines × 인용)

baseline read 가 ~1000+ 줄 매 세션. 그 위에 AGENTS.policy.md (250 lines) + DOCUMENTATION.policy.md (35 lines) + project-specific AGENTS.md (additions) + CLAUDE.md global (~150 lines local + 본 review 기록 후 추가). **세션 startup 가 ~1500줄 doc read** 후 작업 진입.

비교: 27 src TS file 평균 ~180 lines = ~5000 lines code total. doc read budget 가 code base 의 **약 30%** 매 세션 시작 시 소비.

→ 1인 운영자 / agent 세션 시작 비용 큼. 그러나 design intent (AGENTS.md "Read order" lock) 이라 inevitable trade-off. doc-heavy repo design 의 의도된 cost.

#### L12-B. Decision velocity vs review capacity

각 decision (DEC / Q / ADR) 매 lock 시점에:
- frontmatter (12-15 fields: id / status / touches[] / term_effects[] / reviewed_terms[] / reviewed_scopes[] / invariant_review / unresolved_warnings[] etc.) — LLM 생성 30s + 운영자 review ~1분
- body (Decision / Rationale / Consequences / References) — LLM 생성 1-2분 + 운영자 review 3-5분
- cross-ref 매핑 (TRACE row / impacted ADR / DEC chain) — 1-2분
- invariant validator regen + warning review — 30s-1분

평균 새 DEC / Q lock = **5-10분 운영자 review**.

velocity = 주당 2-3 decision × 5-10분 = **주당 ~30분 review burden** governance only (code review 별도).

비교: P0-M6 MVP 목표 = 2주 (DEC-005). 첫 publication 1건. 이 사이 governance review burden ~1시간. 그러나 본 review 가 발견한 P0 (1) + P1 (~25) finding 응답 review burden 가 ~5-10시간 추가. operator capacity 압박.

#### L12-C. Advisory accumulation

| layer | warning/finding count |
|---|---|
| validator (`bun run invariant:check`) | 36 warnings + 81 infos = **117 advisory** |
| 본 review (L1~L11) | **189 finding** |
| CI 4 workflow (advisory all) | block 0건 — 모든 PR 가 silent merge 가능 |
| doc-freshness PR comment | per PR advisory comment |

→ **누적 ~300+ advisory** for 1인 운영자. 1주 attention budget 으로 review 불가능. 실측 effects:
- 2026-05-13 review 의 P1 fix "본 PR fix (`bun run invariant:regen`)" 가 illusory (gitignored, L1-G)
- L9-A main branch protection mismatch — 결정 lock 후 admin task 영구 미실행
- 다수 stale fact (L1-A current-state / L1-J Risks / L3-A schema header / 03 SPIKE follow-up)

설계: warning-only by design (ADR-0002 INV-0002-1). 그러나 1인 운영자 attention budget 위에 누적 advisory 가 **systemically ignored** — design intent 와 실제 운영 사이 gap.

#### L12-D. Cross-cutting risk pattern 통합

12 layer 가 발견한 가장 자주 반복된 4개 패턴:

**Pattern 1 — "lock 후 admin/code task 미실행"** (정책 단언 vs 실제 fact mismatch):
- L1-A current-state stale (post-43c8178 미갱신)
- L1-B AC-032 status drift
- L1-J Risks section stale
- L2-J Q-045 cross_ref_code[] enforce 미land
- L7-N Neo4j schema versioning 미결정
- L9-A main branch protection — 3중 policy mismatch
- L6-B / L8-N AC-019 enforcement 미구현

**Pattern 2 — "design lock 의 향후 hardening deferred"** (v0 single-worker assumption):
- L4-K audit row atomic
- L5-H Promise.allSettled chunked streaming (Q-039 INFRA-1B.2.x)
- L6-L resolveIntervention multi-reviewer race (Q-037 INFRA-1B.6.x)
- L7-N Neo4j version tracking
- L11-B/C/E DEC-019 5 hardening lock
- L11-O stale-reclaim 60min

**Pattern 3 — "invariant 가 코드로 enforce 되지 않음"** (warning-only / advisory):
- L2-A 6 frontmatter YAML parse fail → ADR-0023/24/27 + DEC-009/10/11 invisible
- L2-B effective_invariant_policy.yaml 안 superseded INV 살아남음
- L2-C 20 invalid relation values (L9-O TS + Ruby validator 분담 명시 부재)
- L3-C `:EVIDENCE_FOR` schema-level 부재
- L3-M / L2-H 50+ term glossary anchor 부재
- L8-D AC-023 test 부재 + P0-M2 게이트 검증 단계 진입

**Pattern 4 — "fresh setup 절차 명시 부재"**:
- L1-G / L2-E `docs/_generated/` cold clone 부재
- L8-H `bun install` 의무 명시 부재 (9 test fail silent)
- L9-K frozen-lockfile RUNBOOK 미명시
- L10-J operator pre-commit hook 부재

#### L12-E. 1인 운영자 attacker model + supply chain weight

L10 cross-cutting:
- L10-J device compromised → 5 secret 노출 (4 vendor + Neo4j) — Doppler 만 의존
- L10-K rotation cadence 미명시 — 90일 / 180일 결정 부재
- L10-O 1인 vault prompt injection model — Q-050 lock 시점 결정 의무
- L9-I dependabot.yml 부재 — `bun audit` manual 운영자 의무 cadence 부재
- npm deps 4 + transitive ~10 (micro-package: @nodable/entities / strnum / xml-naming / path-expression-matcher)

설계: 1인 운영자 = trust boundary 안. 그러나 attacker model 의 가벼움 = 운영자 단일 점 implosion risk.

#### L12-F. 12 layer 통합 우선순위 매트릭스

| 우선순위 | Layer / Finding | 영향 |
|---|---|---|
| **P0 (critical, 즉시)** | L9-A main protection 3중 mismatch (DEC-020 vs CLAUDE.md vs GH state) | 운영 정책 정합 / 모든 향후 session 의 baseline ambiguity |
| **P1 (P0-M2 gate 진입 직전)** | L1-A current-state stale (43c8178 post-) / L2-A 6 frontmatter YAML parse / L2-B superseded INV / L2-C relation enum / L2-D `--write-warnings` noop / L8-C SPIKE-001 / L8-D AC-023 test 부재 / L8-H `bun install` 명시 / L9-B required check / L9-I supply chain audit / L10-A ADR-0029 코드 0건 (EXTR 직전) / L10-J operator hygiene RUNBOOK | P0-M2 게이트 accept 차단 사유들 + invariant tracking 시스템 정합성 회복 |
| **P1 (P0-M6 MVP gate 진입 직전)** | L3-C `:EVIDENCE_FOR` schema-level / L6-L resolveIntervention race (Q-037) / L6-B AC-019 enforcement (OPS-1A.2) / L11-A 5 DEC-019 hardening | MVP 진입 의무 + multi-reviewer 도입 시 |
| **P1 (P1+ deferred)** | L7-N Neo4j schema versioning / L11-E millis-bearing CHECK / L11-C worker_id CAS / L10-H LLM payload size | DEPLOY-1A.* / P1-M2/M3-hardening |
| **P2 (단기)** | L1-D/E/F/J doc drift batch / L2-F/G/I/J/L validator extension batch / L3-B/H/I/M/O/P schema batch / L4-G/I/M/Q/N (storage cross-cutting) / L5-E/I/K/N (discovery hardening) / L6-M/N/O/Q (audit/feedback) / L7-D/P (migration) / L8-A/E/I/J/K/R (test coverage) / L9-C/E/F/K/O (CI/CD) / L10-F/I/K/N/O/Q (security) / L11-D/F/G/H/K/L/M/O (concurrency) | doc consistency + invariant cross-ref + schema hardening + test coverage |
| **P3 (관찰)** | L1-C/H/K/N/O/P / L2-K/M/N / L3-A/L/N/Q / L4-A/E/H/I/O / L5-C/D/O/S/T / L6-F/J/K/P/S / L7-A/F/J/K/L/M/O/Q/R / L8-B/L/P / L9-D/G/H/J/L/M/N / L10-C/E/L/P / L11-I/J/N/P/Q/R/S | operational hygiene + future risk anchor |

총: **P0 1 / P1 ~25 / P2 ~80 / P3 ~80 / OK ~30**.

#### L12-G. 통합 권고 — 다음 4주 priority (운영자 attention budget 고려)

**Week 1 — P0 + P1-blocker resolution**:
1. **L9-A 결정** — DEC-020 (PR-only) vs CLAUDE.md (k-world-monitor 직접 push) 어느 쪽 winner. 옵션 (a) DEC-020 우선 → branch protection 등록 + CLAUDE.md 예외 제거 / (b) CLAUDE.md 우선 → DEC-020 PR-only 후퇴 + PRD/IMPL_PLAN line 208-212 + TRACE-044 갱신. **이 결정이 다른 모든 향후 session 의 baseline 결정**.
2. **L2-A frontmatter fix** — 6 file (ADR-0023/24/27 + DEC-009/10/11) frontmatter YAML block scalar 변환. 1 commit. validator 가 INV-0023-1~8 + INV-0024-* + INV-0027-3/5 자동 등록.
3. **L2-B + L2-D + L9-I** — validator 가벼운 fix batch: (i) `generateArtifacts()` ADR `status==='superseded'` skip 1줄 (ii) `MODE_WRITE` 실제 구현 또는 policy 텍스트 변경 (iii) `dependabot.yml` 도입 + CI 안 `bun audit` step.
4. **L1-A doc drift fix** — current-state line 38 / line 184-189 / line 248 갱신 (post-43c8178 INFRA-1B.3.x-audit landed 반영) + L1-J Risks section 갱신.
5. **L8-H + L9-K + L10-J** — 운영자 setup RUNBOOK 1 entry: `bun install --frozen-lockfile` + Doppler boot + GH token revoke + pre-commit hook (env scrub).

**Week 2 — P0-M2 gate accept**:
6. **L8-C SPIKE-001 실행** — Neo4j Community local docker setup + bench run + result commit + docs/03_RISK_SPIKES.md Result 갱신. P0-M1 gate accept 차단 해소.
7. **L8-D AC-023 test 추가** — tests/policy/gate_test.ts 8 위험 행동 트리거 검증 — 또는 AC-023 scope phase 분리 (L1-I phasing 패턴).
8. **L8-N + L6-B AC-019 quota-enforcement** — `src/ops/quota-enforcement.ts` + QuotaKind enum 도입 (OPS-1A.2 slice 진입) — EXTR-1A.* 직전 의무.
9. **L10-A ADR-0029 EXTR-1A.0 slice** — `untrusted-wrapper.ts` + `html-to-text.ts` + `llm-policy-gate.ts` 3 module 도입.

**Week 3 — P0-M3 entry preparation**:
10. **L3-C `:EVIDENCE_FOR` schema** — Neo4j v2 migration (L7-N versioning strategy 동시 결정) + AGG-1A.1 진입 직전 evidence_role + operator_lock enforce.
11. **L11-E millis-bearing timestamp CHECK** — DEPLOY-1A.2 진입 또는 v8 migration 안에 묶기. 4 format mix 통일.
12. **L2-J cross_ref_code[] validator extension** — `INFRA-1A.9-validator-extension` slice 진입. INV-0012-3 / INV-0028-* / INV-0023-3 / INV-0017 우선 backfill.

**Week 4 — P2 doc consistency batch**:
13. **L2-H + L3-M glossary backfill** — 신규 slice `INFRA-1A.10-glossary-backfill` 진입. 40+ unique term 정리 (evidence_role / lifecycle_state / stance / market_stance / archive_policy / quote_reason / intervention_severity 우선).
14. **L1-D/E/F doc drift batch** — PRD Open Questions Q-035/Q-050 추가 / 03_RISK_SPIKES.md SPIKE-002/003 ADR-0023+DEC-010 으로 reflow / Milestones 표 P0-M2-hardening row 추가.
15. **L2-C relation enum** — 20 invalid relation 사용처 migrate 또는 enum 확장 결정.

**Deferred (P1+ slice 진입 직전)**:
- L11-A DEC-019 5 hardening lock — INFRA-1B.6.x + 1B.3.x + 1B.2.x + DEPLOY-1A.1 + DEPLOY-1A.2
- L7-N Neo4j schema versioning — INFRA-1B.7b / 1B.9 / 1B.10 진입 시점

**관찰 / 위험 보류**:
- L4-A 100% always_prohibited (AC-032 trivial-by-absence) — design intent, monitoring 만
- L4-E PERMITTED_PREFIXES 8/9 dead — forward-looking 유지
- L10-O 1인 vault prompt injection — Q-050 lock 시점
- L11-R 4 vendor rate-limit — EXTR-1A.* land 시

#### L12-H. 메타 risk — review 의 self-similar pattern

본 review 자체가 1인 운영자 attention burden 의 증거:
- 12 layer × ~15 finding = 189 finding
- 각 finding 의 review 가 5-15분 = **~30시간 운영자 review budget**
- P0-M6 MVP 2주 목표 (DEC-005) vs 본 review backlog 30시간
- 결정 항목 ~25 P1 — 각 결정 5-10분 = 2~4시간 추가
- backlog 정리만 추가 1~2주 소비

→ 본 review 가 발견한 가장 큰 finding 은 **review 자체가 1인 운영자 capacity 를 초과**. doc:code 3.4:1 + 91 decision artifact + 189 finding + 300+ advisory 가 누적된 상태.

가능 path:
1. **Strict prioritization** — P0 (1건) + P1-blocker (~10건) 만 fix, P1-deferred + P2 + P3 archived. operator capacity 안에서만.
2. **LLM-assist triage** — LLM 이 P2 / P3 batch fix 제안 + operator approval-only (시간 절약 ~50%).
3. **scope reduction** — 일부 ADR / DEC supersede 또는 archive. governance overhead 감소.
4. **MVP gate accept 우선** — 본 review backlog 보다 PUB-1A.5 첫 발행 우선. 발행 후 backlog 정리.

권고: **path 4 + path 1 combination** — P0-M6 MVP 발행 가능성 회복이 1인 운영자 의 첫 deliverable 이고, governance backlog 가 그 deliverable 차단하면 안 됨. P0 (L9-A) + P1-blocker (~10건) 만 fix 후 P0-M2 gate accept + P0-M3 진입. 나머지 (~170 finding) 는 PUB-1A.5 후 retrospective 안에 누적 / archived.

#### L12-I. 통합 최종 권고 — 운영자 결정

**즉시 결정 (1건)**:
- **L9-A 정책 충돌 resolution** — 본 review 의 가장 critical 결정. 어느 path 든 향후 모든 doc drift 의 anchor.

**1주 안에 처리 (~10건)**:
- L2-A frontmatter fix (1 commit)
- L2-B superseded INV skip (1 line)
- L1-A current-state + L1-J Risks 갱신 (1 commit)
- L8-H + L9-K + L10-J RUNBOOK 1 entry
- L9-I dependabot.yml
- L2-D `--write-warnings` 결정 (구현 vs policy 변경)

**MVP gate 직전 (~10건)**:
- L8-C SPIKE-001
- L8-D AC-023 test
- L10-A ADR-0029 EXTR module
- L6-B AC-019 quota module
- L3-C `:EVIDENCE_FOR` schema

**Backlog (~170건)**:
- P2 (~80) + P3 (~80) — 시점 lock 또는 archive

### Final Numbers (2026-05-15)

- Layers 검토: **12**
- 총 finding: **208** (L1×16 + L2×14 + L3×17 + L4×15 + L5×20 + L6×19 + L7×18 + L8×18 + L9×16 + L10×17 + L11×19 + L12×19 권고)
- 분류: P0 (1) / P1 (~25) / P2 (~80) / P3 (~80) / OK (~30)
- 결정 항목: ~30 P1+P2 결정 (L1~L11 누적) + L12 priority matrix
- 운영자 review budget: ~30시간 (full review) / 1주 (강제 prioritization 시 ~10시간)

### Progress

- 2026-05-15: L1~L12 전수 완료. 12 layer × 7 perspective × 5 stage matrix 적대적 리뷰 종료.
- 본 entry 자체 가 `docs/10_PROJECT_RETROSPECTIVE.md` 신규 ## section. PR 또는 main 직접 commit 시 진행.
- 운영자 우선 결정: **L9-A (main branch protection 3중 policy mismatch)** — 다른 모든 결정의 baseline anchor.

### Cross-review by GPT (2026-05-15)

본 review 직후 GPT (운영자 cross-reviewer) 가 동일 repo 에 4 부 분할 review 수행. curated summary + Claude 의 비판적 평가 + 두 review 의 합리적 종합 결과는 다음 파일에 분리 보존:

- [`docs/retrospectives/2026-05-15-gpt-cross-review.md`](retrospectives/2026-05-15-gpt-cross-review.md) — GPT review curated summary + Claude 비판적 평가 + commensurability table + Finding index (26 row)
- [`docs/retrospectives/2026-05-15-action-items.md`](retrospectives/2026-05-15-action-items.md) — 종합 action items: 신규 Q-052~Q-059 + 신규 slice 16개 + 운영자 admin task + 다음 4주 sequence

**가장 큰 종합 결과**:
1. **GPT P0 (R2 cross-source policy guard 가 `archive_policy` 검사 안 함)** 정확 — Claude L4-F 의 "정합 robust ✓" 결론 후퇴. `allLinkedSourcesAllowRawCloud()` 가 raw_cloud_policy 만 봐서 cross-source dedup 시 `metadata_only` source 가 R2-backed Snapshot 에 link 가능. `INFRA-1B.3.h1-policy-fix` candidate slice 즉시 의무.
2. **GPT Latent P1 (chunker raw text persistence 가 source policy 안 받음)** 정확 — Claude L3/L5/L6 chunker analysis 의 본질적 보강. `INFRA-1B.4.h1-chunker-policy-gate` candidate slice 의무 (DEC-024 D2 lock 후).
3. **Claude P0 (L9-A main branch protection 3중 mismatch)** 는 GPT 미커버 — Claude unique. Q-052 결정이 모든 향후 governance baseline anchor.
4. 두 review 가 commensurable 하지 않음. Claude = governance/invariant/code/test angle systemic. GPT = product viability / operator UX / data quality / cross-source policy semantic angle systemic. 양쪽 blind spot 상호 cover.

다음 단계 = `docs/retrospectives/2026-05-15-action-items.md` section E "다음 4주 권고 sequence" 진행.
