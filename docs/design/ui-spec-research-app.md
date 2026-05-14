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
research session 을 진행할 수 있는 web app. CLI 는 v1+ optional secondary
entry (자동화 / cron / scripting 용도).

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

## 4. Hosting / Deploy 옵션

### 옵션 (a) — Cloudflare Workers + R2 + Pages

- ADR-0022 vendor surface 안 (이미 Pages 사용)
- edge runtime — mobile latency 낮음
- Cloudflare Access 로 single-operator auth 자연
- 단점: ADR Constraints "managed edge 도입 X" 와 충돌 → reflow 의무

### 옵션 (b) — self-host (VPS, Docker)

- ADR Constraints 그대로 준수
- 단점: 운영 부담 (1인 운영자), mobile latency (지리 위치 의존)

### 옵션 (c) — hybrid

- Static asset (HTML/CSS) = Cloudflare Pages
- API + AI 호출 server = self-host VPS
- 복잡도 증가, 단순 권고 안 함

**기본 권고: (a) Cloudflare Workers + R2 + Pages**. ADR Constraints
본문 reflow 의무 — Cloudflare 는 "managed edge 도입 X" 의 exception 으로
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

**기본 권고: (i) Cloudflare Access**. 1인 운영 + 무료 tier 충분 + 단순.

## 6. 페이지 구조 (mobile-first)

### 6.1 Top-level routes

```
/                          홈 (recent sessions + quick ask)
/ask                       global ask (mobile-first text input + voice)
/sessions                  session list
/sessions/:id              session detail (round timeline + summary)
/sessions/:id/rounds/:rid  round detail (turn list + active context)
/rounds/:rid               redirect to session/:id/rounds/:rid
/turns/:tid                turn detail (user message + AI answer + artifacts)
/claims/:cid               claim viewer (evidence + source trace)
/snapshots/:sid            snapshot viewer (URL + content_hash + r2 link if permitted)
/dossiers/:did             dossier editor (promoted_claim_ids[] + counterclaim pool)
/scenarios/:sid            scenario detail (branches / impact_targets / revisions)
/theses/:tid               thesis editor (stance + market_stance + EditorialIntent link)
/drafts/:did               content draft editor (blog_long markdown)
/publications              publication list + cite check status
/settings                  operator settings (Doppler keys / max_rounds / cost cap)
```

### 6.2 모바일 우선 페이지 (간소화)

- `/` 홈 — "Continue last session" CTA + "New session" + recent 5 sessions
- `/ask` — 풀스크린 text input + send button + voice icon
- `/sessions` — list view (title + mode + last activity + active marker)
- `/sessions/:id` — vertical timeline (round → turn) + "Add round" / "Ask"
  버튼 fixed bottom
- `/turns/:tid` — user message + AI answer (markdown render) + artifact
  link list

### 6.3 데스크탑 우선 페이지 (full UX)

- `/dossiers/:did` — 2-pane: claim list + evidence panel
- `/scenarios/:sid` — graph view (vega-lite / mermaid) + branches list
- `/publications/:pid` — preflight panel + cite check inspector

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
  fork_session / new_session
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

- **Auth**: Cloudflare Access (zero trust)
- **API key**: Doppler 안에서만 (server-side), client 노출 절대 X
- **Quote ≤ 200자** (ADR-0015 NFR-005) — client 입력 시 검증, server 재검증
- **Raw cloud 0건** (NFR-008) — server 가 R2 prefix policy 강제
- **Source policy gate** (ADR-0017) — server 가 매 외부 fetch 시 적용

## 13. 배포

### Cloudflare Workers + Pages

```
research.<domain>            (Cloudflare Workers + Hono)
  → /api/* (server routes, Doppler env)
  → /* (HTMX HTML + static asset)

<domain>                     (Cloudflare Pages, Astro publication site)
  → public publication (ADR-0022)
```

- Cloudflare Access 가 `research.<domain>` 만 protect
- public publication site 는 익명 접근

## 14. 사용자 결정 항목 (UI-spec)

본 spec 의 다음 항목 사용자 결정 후 정식 ADR 작성:

1. Stack: 옵션 A~F 중 선택. 기본 권고: E (bun + Hono + HTMX + Tailwind)
2. Hosting: 옵션 a/b/c 중 선택. 기본 권고: a (Cloudflare Workers). ADR
   Constraints 본문 reflow 의무
3. Auth: 옵션 i/ii/iii 중 선택. 기본 권고: i (Cloudflare Access)
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

P0-M6 turn-key MVP (2주 lock) 안에는 위 슬라이스 미포함 — single-shot
LLM + 시나리오 1 + 첫 publication 발행 만. Research app 은 P0-M6 accept
후 진입.

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
