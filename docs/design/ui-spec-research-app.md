---
id: ui-spec-research-app
type: design
title: Research App UI Spec — Web (mobile-first) for AI-assisted research session orchestration
status: draft
created_at: 2026-05-14
updated_at: 2026-05-14
owner: user
related_q: [Q-050, Q-051]
related_adr: [ADR-0022, ADR-0023]
---

# Research App UI Spec (draft)

> 본 문서는 Q-051 round 2 (2026-05-14, web pivot) 의 UI-spec 초안. 사용자
> 결정 후 정식 ADR (가칭 — Research App UI Stack) 으로 promote 또는
> ADR-0022 본문 확장.

## 1. Goal

1인 운영자가 **데스크탑 + 모바일** (특히 phone) 환경에서 AI 와 함께
research session 을 진행할 수 있는 web app. **P0-M6 까지는 CLI 가
publication critical path (PUB-1A.5 ask/edit/publish trigger), web /ops
는 read-only 보조** (RESEARCH-1A.0). **P1+ 부터 web /ops 가 primary,
CLI 는 자동화/cron/scripting secondary**.

핵심 사용 시나리오:

- **데스크탑**: 본격 research session — round 생성, AI 와 multi-turn
  conversation, evidence inspection, scenario branching, publication
  preflight, cite check
- **모바일 (phone)**: idea capture (즉시 메모), quick AI question, prior
  round summary review, 발행 publication 확인. complex graph view 는
  desktop-first

## 2. Constraints (본 repo 기존 lock 와 align)

| Constraint | Source |
|---|---|
| self-host only / managed edge 도입 X | PRD `01_PRD.md:198` |
| Cloudflare R2 + Pages vendor surface | ADR-0022 |
| Doppler secret store (4 종 API key) | DEC-020 Q-047 |
| LLM routing v2 (OpenAI / Anthropic / Google) | ADR-0023 |
| ResearchTurn / ExplorationRound / RoundContextPack 객체 모델 | Q-050 / Q-051 |
| NFR-003 5-hop trace + NFR-008 raw 0건 cloud + NFR-001 1초 p95 검색 | PRD |
| mobile-first (phone first-class) | 본 round 2 신규 |

본 spec 의 일부 결정 (Cloudflare Workers hosting) 은 ADR Constraints
"managed edge 도입 X" 와 충돌 — Q-051 사용자 결정 항목 #7 (hosting) 에서
ADR Constraints 본문 reflow 의무.

## 3. Stack 옵션 (사용자 결정 항목)

### 옵션 A — Astro 5.0 + Solid islands

- Publishing site (ADR-0022 lock) 와 같은 stack. 단일 codebase, 같은
  Cloudflare Pages 배포
- Solid islands 가 admin UI 의 interactivity 담당
- 장점: vendor surface 추가 X, build pipeline 단일
- 단점: Astro 가 정적 site 중심 — admin app 의 dynamic state / form-heavy
  UX 에 ill-fit. SSR 도 가능하지만 Next/Remix 보다 ergonomic 떨어짐

### 옵션 B — Next.js (App Router)

- Server Components + Server Actions = form-heavy admin UX 친화
- mobile responsive 자연 (Tailwind 호환)
- Cloudflare Workers 배포 가능 (@cloudflare/next-on-pages adapter)
- 장점: ecosystem 풍부, admin UI 패턴 검증됨
- 단점: vendor surface 추가 (Next.js + React + 의존), bun runtime 활용 약함

### 옵션 C — Remix / React Router 7

- full-stack SSR, form-first, mobile responsive
- 단점: Cloudflare Workers 배포 가능하나 deployment complexity 증가

### 옵션 D — SvelteKit

- light, fast SSR, file-based routing
- 단점: ecosystem 작음, 본 repo React/Astro 와 별도 framework family

### 옵션 E — **bun + Hono + HTMX + Tailwind (lightest, 권고)**

- bun runtime native (본 repo 이미 사용)
- Hono = bun-friendly HTTP framework
- HTMX = HTML-over-the-wire reactivity (no JS framework)
- Tailwind = mobile responsive (utility-first)
- Alpine.js 또는 HTMX-extensions = small interactivity
- 장점:
  - 본 repo bun stack native — vendor surface 추가 거의 없음
  - 1인 운영 stack surface 최소
  - mobile responsive HTMX + Tailwind 친화
  - self-host 가능 (bun binary), Cloudflare Workers 도 가능 (Hono native
    workers runtime 지원)
  - SSE streaming native 지원 (round_search_run / agent loop progress)
- 단점:
  - SPA-grade interactivity 제한 — graph visualization / drag-and-drop 은
    별도 page (vega-lite / mermaid 정적 render + HTMX swap)
  - 모바일 voice input 등 native API 는 별도 module

### 옵션 F — Nuxt 3

- Vue 3 기반, SSR
- 단점: 본 repo 와 framework family 분리

**기본 권고: 옵션 E (bun + Hono + HTMX + Tailwind)**. 본 repo stack
align + 1인 운영 surface 최소 + mobile responsive 친화. 단 SPA-grade UI
가 필요한 경우 (Q-050 의 scenario branch visualization 등) 는 별도 page
에서 vega-lite / mermaid + HTMX swap 으로 처리.

## 4. Hosting / Deploy — Topology B 채택 (lock, §13 참조)

GPT 31 기술 리뷰 (2026-05-14) 후 **Topology B (Public CF Pages / Private
Hetzner same-origin)** lock. 본 section 의 (a)/(b)/(c) 옵션 비교는 historical
record — 실제 채택은 (c) hybrid 의 정밀화 (CF Pages = public anchor only,
Hetzner = `/ops` + `/api` same-origin, Tailscale-only v0). 사용자 의문
"Hetzner 에 올리는 게 나으려나" + GPT 답변 T-15/T-17/T-18 결합.

### 옵션 (a) — Cloudflare Workers + R2 + Pages — **reject (round 6)**

- CF Pages 에 `/ops` artifact 포함 시 Tailscale-only Hetzner backend 와
  cross-origin / SSR fetch 불가 (T-15)
- ADR Constraints "managed edge 도입 X" 와 충돌 — reflow 의무 발생
- single-operator 환경에서 edge 분산 의미 약함

### 옵션 (b) — self-host only — partial

- ADR Constraints 그대로 준수
- 단점: anchor blog 의 cite anchor durability (5 년+ uptime) 단일 머신 risk

### 옵션 (c) — hybrid — **lock (정밀화 후 채택)**

- **Public artifact** (`/posts/*` / `/citations/*` / `/corrections/*`) =
  Cloudflare Pages (anchor blog 영속성 + edge 분산)
- **Private artifact** (`/ops/*` + `/api/*`) = Hetzner self-host (same-
  origin, Tailscale-only v0 / CF Tunnel + Access v1+)
- ADR-0022 vendor surface (R2 + Pages) 유지 + ADR Constraints 그대로 준수
  (managed edge 는 public anchor 만, dynamic backend 는 self-host)

**기본 권고: (c) 정밀화** — historical (a) 권고는 reject. 상세 deployment
topology 는 §13 참조.

(아래 historical 비교 텍스트는 audit log 로 보존 — 실제 결정은 위 (c)).
이미 인정 (ADR-0022 lock). research app 도 같은 vendor.

## 5. Auth

### 옵션 (i) — Cloudflare Access (zero trust)

- SSO 무료 tier (50 users, single operator 적합)
- email / OAuth provider 통합
- Cloudflare Workers + Access 자연 호환
- 단점: Cloudflare vendor 더 깊게

### 옵션 (ii) — password + 2FA (TOTP)

- self-host 가능
- 단점: 운영 부담 (password reset / 2FA backup codes)

### 옵션 (iii) — OAuth (GitHub / Google)

- third-party SSO
- 단점: provider dependency

**기본 권고: v0 Tailscale-only (사용자 명시 선호), v1+ Cloudflare Tunnel
+ Access** (§13 Topology B lock, Q-051 phasing). 본 section 의 (i)/(ii)/
(iii) 옵션 비교는 historical record — 실제 채택은 v0 Tailscale → v1+ CF
Access 의 phasing. (i) Cloudflare Access 직접 default 는 reject (CF Pages
artifact 와 Tailscale-only Hetzner backend 분리 의무 + 폰 외부망 접근의
public exposure risk).

## 6. 페이지 구조 (mobile-first)

### 6.1 Top-level routes

Private operator routes 는 모두 `/ops/*` prefix (Topology B same-origin
auth boundary, §13 lock). Public anchor blog 는 root (`/posts/*` 등, CF
Pages).

```
/ops                       홈 (recent sessions + quick ask)
/ops/ask                   global ask (mobile-first text input + voice)
/ops/sessions              session list
/ops/sessions/:id          session detail (P0-M6 = session header only / P1+ = round timeline + summary)
/ops/sessions/:id/rounds/:rid  round detail (turn list + active context)
/ops/rounds/:rid           redirect to /ops/sessions/:id/rounds/:rid
/ops/turns/:tid            turn detail (user message + AI answer + artifacts)
/ops/claims/:cid           claim viewer (evidence + source trace)
/ops/snapshots/:sid        snapshot viewer (URL + content_hash + r2 link if permitted)
/ops/dossiers/:did         dossier editor (promoted_claim_ids[] + counterclaim pool)
/ops/scenarios/:sid        scenario detail (branches / impact_targets / revisions)
/ops/theses/:tid           thesis editor (stance + market_stance + EditorialIntent link)
/ops/drafts/:did           content draft editor (blog_long markdown)
/ops/publications          publication list + cite check status
/ops/settings              operator settings (Doppler keys / max_rounds / cost cap)
/ops/interventions         AccessIntervention queue (3-option 모바일 1-tap)

Public (CF Pages, no /ops prefix):
/posts/:slug               public publication
/citations/:cid            public cite anchor
/corrections/:cid          public correction / retraction
/rss.xml                   feed
```

### 6.2 모바일 우선 페이지 (간소화)

**P0-M6 phasing 주의 (RESEARCH-1A.0 / RESEARCH-1A.API0)**: P0-M6 안에서는
본 모바일 페이지 **전부 read-only** + API0 가 노출하는 endpoint 만 사용
(`GET /api/sessions` / `GET /api/sessions/:id` / `GET /api/publications`,
RESEARCH-1A.API0 lock — turn-detail / round-timeline endpoint 는 P0
없음). 모든 mutation flow / round timeline / turn-detail page 는 P1+
(RESEARCH-1A.1+) 로 미룬다. 아래 페이지 명세는 P1+ 완성 형태 기준이며,
**P0 read-only 스코프 별로** 명시.

- `/ops/` 홈 — "Continue last session" CTA + "New session" + recent 5
  sessions *(P0 = recent 5 sessions read-only 만 — `GET /api/sessions`;
  CTA / "New session" 버튼 P1+)*
- `/ops/ask` — 풀스크린 text input + send button + voice icon *(P1+ 전용
  — P0 없음, API0 mutation endpoint 미존재)*
- `/ops/sessions` — list view (title + mode + last activity + active
  marker) *(P0 read-only — `GET /api/sessions`; active marker 표시만,
  switch 액션은 P1+)*
- `/ops/sessions/:id` — vertical timeline (round → turn) + "Add round" /
  "Ask" 버튼 fixed bottom *(P0 read-only = `GET /api/sessions/:id` 의
  session header + status + intent 만; **round timeline / turn list 는
  P0 미포함** — RESEARCH-1A.0 plan lock "round timeline 미포함, P0-M6
  안에서는 single-shot research_session 만, ExplorationRound P1+" 와
  일치. "Add round" / "Ask" / mutation 전부 P1+)*
- `/ops/turns/:tid` — user message + AI answer (markdown render) +
  artifact link list *(P1+ 전용 — P0 없음, API0 에 `GET /api/turns/:tid`
  미정의 + RESEARCH-1A.0 plan 의 round timeline P1+ 와 일치)*
- `/posts/:slug` — public publication 검토 *(P0 read-only — `GET /api/
  publications` / public artifact, **public surface 이므로 `/ops` prefix
  없음** §6.1 라우팅 맵과 일치. RESEARCH-1A.0 plan 의 "`/posts/:slug`
  public 검토" 와 일치)*

### 6.3 데스크탑 우선 페이지 (full UX)

- `/ops/dossiers/:did` — 2-pane: claim list + evidence panel
- `/ops/publications/:pid` — preflight panel + cite check inspector (§6.1
  `/ops/publications` list 의 detail 화)
- `/ops/drafts/:did/edit` — **ContentDraft 본문 편집 전체 (Q-F 사용자
  결정 — 데스크탑 only). 모바일은 preview 만, full edit 데스크탑.**

### 6.4 모바일 + 데스크탑 양립 페이지 (Q-G 사용자 결정 — 모바일 zoom/pan)

- `/ops/scenarios/:sid` — Scenario branch graph (vega-lite or mermaid) +
  branches list. **모바일에서 zoom / pan / 1-tap branch expand 가능**.
  단 branch 편집 (assumption / falsifier 추가) 은 데스크탑 우선.

### 6.5 모바일 1-tap 의무 (Q-H 사용자 결정)

- `/ops/interventions` — AccessIntervention 3-option review (ignore /
  manual_claim / temp_text) 모두 1-tap. 모바일 single-handed 가능 의무.

## 7. 핵심 component / interaction

### 7.1 Ask form (mobile-first)

```
┌─────────────────────────────────┐
│ Using: sess_01HX... (directed)  │  ← active context badge
│ Round 2 (verification)          │
├─────────────────────────────────┤
│                                 │
│ [text input — auto-grow]        │
│                                 │
│                                 │
├─────────────────────────────────┤
│ 🎤 voice    [Route ▾]   [Send] │
└─────────────────────────────────┘
```

- Route dropdown: continue_round (default) / new_round / branch_round /
  fork_session / new_session / **answer_only** (Q-051 first-class route —
  turn 만 기록, search_run / synthesis 미생성. 운영자가 검색 없이 단순
  AI 응답만 원할 때 명시 선택)
- AI intent classifier 가 sensitive route 추천 시 confirmation modal:
  > Suggested: fork_session (confidence 0.92)
  > Reason: topic shift detected
  > [Use suggestion]  [Keep continue_round]

### 7.2 Round timeline

```
Session: 한국 부동산 폭락 시나리오
mode: directed | total_cost: $0.34 | max_rounds: 5

Round 1 (broad scan) ✓ closed
  ├─ Turn 1: 가설 지지 근거 찾기
  ├─ Turn 2: 외부 자료 발견
  └─ Synthesis: 5 promoted claims, 2 counterclaims

Round 2A (verification) ⏵ active
  └─ Turn 3: 반대 가설 검증

[+ New round] [+ Branch] [Finalize session]
```

### 7.3 Evidence panel (claim viewer)

```
Claim: "전세 사기 누적 위험..."
status: confirmed | extraction_confidence: 0.89

evidence:
  quote: "..." (200자 이내, ADR-0015)
  storage_level: excerpt_evidence
  quote_reason: directly_supports_claim
  locator: paragraph 3, line 5

source trace:
  Source → Document → Snapshot → Claim
  src_01HX... → doc_01HX... → snap_01HX... → clm_01HX...

[Open source URL]  [Force revalidate]  [Mark stale]
```

### 7.4 Streaming AI response (SSE)

- 사용자 ask 후 AI 응답이 streaming 으로 전개
- HTMX SSE extension 사용
- round_search_run 진행 상황도 streaming (예: "Internal search... 3 claims
  found", "External AI search (Gemini)... 2 candidate URLs")
- 운영자가 mid-stream 에 "Stop" 가능

## 8. 데이터 흐름

### 8.1 Ask flow

```
1. POST /api/ask { message, sessionId?, roundId?, route?, ... }
2. Server:
   - resolve session/round (flag > active_context > error)
   - INSERT research_turn (created_at = NOW, completed_at = NULL)
     // status 컬럼은 Q-051 schema 에 없음 — completion 은 completed_at IS NOT NULL 로 derive
   - if route != 'answer_only':
       - dispatch to SearchOrchestrator (Q-050 INFRA-1B.7c)
   - stream SSE events: turn started / search results / answer chunks
3. Client (HTMX SSE):
   - swap turn detail into round timeline
   - update active context badge if route changed
4. Server finalize:
   - UPDATE research_turn (completed_at = NOW, answer_summary, cost_usd)
   - if route != 'answer_only':
       - INSERT round_search_run (turn_id = current turn_id, ...) /
         INSERT round_candidate_url (search_run_id = ..., ...)
   - else (answer_only):
       - search_run / candidate_url 작성 skip — Q-051 정의 (turn 만 기록)
   - 의무 audit log
```

### 8.2 Offline draft (PWA)

- 모바일 메모 즉시 작성, 동기는 online 시점
- IndexedDB 에 pending turns 저장
- service worker 가 online 되면 POST /api/ask 호출
- conflict resolution: server timestamp 우선

## 9. PWA / offline 지원

- `manifest.json` + service worker
- offline 가능 페이지: `/ask` (입력만), `/sessions/:id` (cached)
- offline 차단 페이지: `/api/*` (네트워크 의무)
- install prompt: 모바일 iOS / Android Add to Home Screen

## 10. Voice input (모바일)

### 옵션 (p) — Web Speech API native

- 무료, latency 낮음
- 단점: 정확도 (특히 한국어 + 전문용어) 낮음

### 옵션 (q) — Whisper API (server-side)

- 음성 파일 → /api/transcribe → text → /api/ask
- 정확도 우수 (gpt-4o-mini-transcribe 또는 whisper-1)
- cost ≈ $0.006 / 분 (whisper-1) — 1 분 메시지 = $0.006
- 본 repo 의 ADR-0023 routing 안에 추가 가능

### 옵션 (r) — 미지원

**기본 권고: (q) Whisper API**. 정확도 + cost 작음. round 2 phasing.

## 11. Realtime / SSE

- SSE = Server-Sent Events (one-way server → client)
- 사용처: turn streaming / round_search_run progress / agent loop step
- WebSocket 불필요 (양방향 안 함)
- HTMX `sse-swap` extension 호환

## 12. 보안 / privacy

- **Auth**: v0 Tailscale-only / v1+ Cloudflare Tunnel + Access (§13 lock)
- **API key**: Doppler 안에서만 (server-side), client 노출 절대 X
- **Quote ≤ 200자** (ADR-0015 NFR-005) — client 입력 시 검증, server 재검증
- **Raw cloud 0건** (NFR-008) — server 가 R2 prefix policy 강제
- **Source policy gate** (ADR-0017) — server 가 매 외부 fetch 시 적용

## 13. 배포 (GPT 31 기술 리뷰 reflect — Topology B 채택)

### 핵심 lock 결정 5

1. **Public artifact 분리** — Cloudflare Pages 에 `/ops` artifact 포함 금지.
   CF Pages = public anchor only. /ops + /api = Hetzner.
2. **`/ops` 와 `/api` 는 same-origin** — cross-origin CORS / cookie / SSE
   복잡성 회피. v0 둘 다 Hetzner.
3. **SSE = transport, turn_event = truth** — SSE 만 의존 X. turn_event
   table 에 durable event log 저장 → 모바일 reconnect / catch-up.
4. **SQLite transaction 은 짧게** — LLM / fetch / Neo4j await 중 SQLite
   transaction 점유 금지. saga / operation_ledger 패턴.
5. **Agent loop = orchestrator in-process** — LLM 이 HTTP tool URL 직접
   호출 금지. Bun orchestrator 가 in-process function 실행 + quota / audit /
   prompt-injection 방어 enforce.

### Deployment topology (Option B)

```
Cloudflare Pages (public artifact only):
  <domain>/
    /posts/*                  (Astro Content Collection build, public)
    /citations/*              (cite anchor, public)
    /corrections/*            (correction ledger, public)
  v0: Tailscale-only Hetzner backend 와 분리

Hetzner (private artifact + API, same-origin):
  ops.<tailnet-or-private>/
    /ops/*                    (CSR-first SPA shell)
    /api/*                    (Bun + Hono, SQLite + Neo4j local access)
  v0: Tailscale Serve (HTTPS, tailnet only)
  v1+: Cloudflare Tunnel + Access (public URL + JWT 검증)

Same repo / shared design:
  src/shared/schema/          (Zod schemas — Astro Content Collection 과 Bun API 양쪽 import)
  src/shared/research/        (RoundContextPack, types — no bun:sqlite / neo4j 의존)
  src/shared/ui/              (Tailwind primitives — Astro public + React /ops 공유)
```

### Auth phasing

- **v0 (Tailscale-only)**: 폰 + 데스크탑에 Tailscale client install. `ops.
  <tailnet-domain>` 접근 가능. public exposure 0.
- **v1+ (Cloudflare Tunnel + Access)**: public URL + Cf-Access-Jwt-Assertion
  header → Hono middleware (JWKS public cert + audience + issuer 검증) →
  operator_id 매핑.

### CF Pages artifact 안전 규칙

- Astro build 시 `vault/publications/**/*.{md,mdx}` 만 include. `src/ops/*`
  / `src/api/*` / `src/shared/research/*` 모두 exclude.
- Astro adapter (Hetzner Bun serve) 가 CF Pages adapter 와 분리된 build
  target — `astro.config.public.ts` (CF Pages) + `astro.config.ops.ts`
  (Hetzner) 두 config.

## 14. 사용자 결정 항목 (UI-spec)

본 spec 의 다음 항목 사용자 결정 후 정식 ADR 작성:

1. Stack: 옵션 A~F 중 선택 — **사용자 결정 Q-051 #6 pending**. 기본 권고:
   **A' (Astro + React island, §13 Deployment topology Option B 와 일치)**
   — round 13 reframe + 사용자 피드백 ("내가 HTMX 모르는 게 문제가 아니라
   네가 HTMX 충분히 아는가") 이후 §13 topology 의 `src/shared/ui/` 가
   `Astro public + React /ops 공유` Tailwind primitives 로 lock 되어,
   동일 spec 안에서 §13 (React island) 와 §14 #1 (HTMX 권고) 가 충돌하면
   `/ops` 구현 방향이 갈라짐. 본 round 에서 권고를 A' 로 align.
   기존 옵션 E (HTMX) 는 historical 비교 항목으로 강등 (사용자가 Q-051 #6
   에서 E 를 명시 선택할 경우 §13 `src/shared/ui/` 본문도 동시 reflow 의무).
2. Hosting: **lock — Topology B (CF Pages public anchor + Hetzner private
   /ops + /api, same-origin)**. GPT 31 review (2026-05-14) + 사용자 명시
   ("나 이미 다른 서비스들 운영중인 hetzner 서버 있어") 로 결정 lock —
   본 항목은 historical 옵션 비교 (a/b/c) 만 남기며, 결정은 §4 / §13 의
   Topology B 본문이 canonical. CF Workers (옵션 a) 는 reject — Hetzner
   backend same-origin 불가 + Tailscale-only v0 와 horizontal 배치 불일치.
   ADR-0022 Constraints 본문은 Topology B 의 CF Pages 부분만 흡수 (`/ops`
   artifact 는 CF Pages bundle 에서 영구 exclude — INV-0022-X 추가 검토)
3. Auth: **v0 Tailscale-only lock (사용자 명시), v1+ CF Tunnel + Access**
   (§13 phasing) — 본 항목은 historical 옵션 비교, 결정은 lock 됨
4. PWA / offline 지원 도입 여부. 기본 권고: 도입 (mobile-first)
5. Voice input: 옵션 p/q/r 중 선택. 기본 권고: q (Whisper API), round 2
   phasing
6. Realtime: SSE 만. WebSocket 불필요 동의 여부
7. Public site vs Research app 의 sub-domain 분리 (research.<domain>)
   동의 여부
8. ADR Constraints "managed edge 도입 X" 본문 reflow — Cloudflare Workers
   는 Pages 와 같은 vendor surface 안 exception 으로 인정 (이미 ADR-0022
   lock) 동의 여부

## 15. 슬라이스 / phasing

본 UI 도입은 Q-049/050/051 resolution 이후 P1+ phasing:

- **RESEARCH-1A.1**: HTTP API + research_turn schema + auth + routing logic
- **RESEARCH-1A.2**: Web UI core pages (mobile-first) — `/ask` / `/sessions`
  / `/sessions/:id` / `/turns/:tid`
- **RESEARCH-1A.3**: Web UI advanced — graph view / evidence inspector /
  publication preflight
- **RESEARCH-1A.4**: PWA + offline draft
- **RESEARCH-1A.5**: Voice input (Whisper API)
- **CLI wrapper** (v1+ optional)

### Q-C / Q-D 사용자 결정 (2026-05-14)

**P0-M6 turn-key MVP (2주 lock) 안의 minimum scope** — 사용자 결정:

- **첫 publication 흐름 = CLI + /ops 둘 다** (Q-C) — CLI 가 critical path
  유지, /ops 가 mobile inspection 보조.
- **/ops minimum P0-M6 scope = Read-only mobile** (Q-D) — publication
  결과 / cite anchor / session list (header + status + intent 만) 보기
  가능. **round timeline / turn detail 은 P0-M6 미포함** (RESEARCH-1A.0
  + §6.2 와 일치, ExplorationRound 자체가 P1+ schema). ask / edit /
  publish trigger 는 CLI.
- Read-only minimum 슬라이스: `RESEARCH-1A.0` (P0-M6 안)
  — `/ops` 홈 + `/ops/sessions` list + `/ops/sessions/:id` 읽기 +
  `/posts/:slug` public 검토. **v0 Auth = Tailscale-only (Q-051 lock)**.
  CF Tunnel/Access 는 v1+ phasing.
  DB 직접 read (Hetzner Bun API 의 thin read-only endpoint).
- Full ask / round / orchestration (RESEARCH-1A.1+) 는 P1+ phasing.

## 16. 관련 ADR / DEC / Q

- ADR-0022 (publishing site Astro + Cloudflare Pages — vendor surface
  align)
- ADR-0023 (LLM routing — Whisper API 추가 + intent classifier)
- ADR-0028 (safe-fetch — research app 의 outbound fetch 가 같은 path)
- DEC-019 (timestamp millis-bearing)
- DEC-020 Q-047 (Doppler secret store)
- Q-049 (재방문 정책 — UI 의 Force revalidate 버튼 trigger)
- Q-050 (research orchestration — UI 가 본 layer 위 surface)
- Q-051 (CLI vs Web pivot — 본 spec 이 결과물)
