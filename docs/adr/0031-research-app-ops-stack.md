---
id: adr-0031
type: adr
title: Research App /ops UI stack — Astro shell + React 18 island + Tailwind + shadcn/ui + Radix + TanStack Query v5 + SSE
status: accepted
created_at: 2026-05-14
updated_at: 2026-05-14
deciders: [user]
supersedes: []
superseded_by: []

scope:
  in:
    - design.ui.research_app
    - design.ui.shared_primitives
    - design.ui.cache_invalidation
    - design.ui.research_app.hydration_policy
    - design.ui.research_app.bundle_budget
    - design.ui.research_app.pwa_sync
    - design.ui.research_app.voice_input
  out:
    - pipeline.extraction_layer
    - pipeline.aggregation_layer
    - pipeline.publication_layer.publication_artifact
    - publishing.static_site_stack
    - publishing.vault_publications_source

invariants:
  - id: INV-0031-1
    statement: |
      Research App `/ops` 사설 surface 는 Astro 5.x shell + React 18 island
      (@astrojs/react integration) + Tailwind CSS + shadcn/ui + Radix UI
      + TanStack Query v5 + SSE transport 6 layer stack 만 사용한다.
      Solid / Svelte / Vue / HTMX / Next.js / Remix 도입 금지 — DEC-022
      lock 일치. ADR-0022 publication site 와 동일 Astro project 안에서
      `astro.config.public.ts` (CF Pages, `/posts/*` 만) + `astro.config.
      ops.ts` (Hetzner Bun, `/ops/*` + `/api/*`) 두 build 변종으로 분리.
    status: active
  - id: INV-0031-2
    statement: |
      Mobile LTE hydration cost 제어 — `/ops/*` 모든 React island 는
      `client:visible` directive 가 default. `client:load` 는 페이지 진입
      즉시 interaction 필요한 경우 (현 시점 `/ops/scenarios/:sid` scenario
      graph 만) 로 한정한다. `client:idle` / `client:media` 도입 허용,
      `client:only="react"` 는 SSR 불가능한 brower-only API 경우만 (예
      `/ops/ask` MediaRecorder 사용 component). 페이지별 directive 결정은
      본 ADR §3.3 directive policy 표 lock — RESEARCH-1A.1 slice 시작
      시 신규 페이지 추가 PR 마다 표 갱신 의무.
    status: active
  - id: INV-0031-3
    statement: |
      shadcn/ui CLI 가 생성하는 Radix-based React component (Dialog / Sheet
      / Drawer / Popover / DropdownMenu / Tooltip / Textarea / Input 등)
      는 **`src/shared/ui/` 단일 디렉토리에 copy-paste** 한다. Astro public
      site (`/posts/*`, CF Pages) 는 본 디렉토리 안의 React-only component
      를 import 하지 않으며, Tailwind utility class + Astro component 만
      사용한다. React island 안에서만 shadcn/ui component import 가능.
      shadcn/ui CLI 설정 (`components.json`) 의 `aliases.ui` 는 `src/
      shared/ui` 로 lock.
    status: active
  - id: INV-0031-4
    statement: |
      TanStack Query v5 + shadcn/ui CLI scaffold + Radix primitives 도입은
      **P1+ RESEARCH-1A.1 슬라이스부터**. P0-M6 RESEARCH-1A.0 (read-only
      mobile minimum) 은 Astro SSR + plain `fetch` + plain Tailwind class
      만 사용하며 React island 0개, shadcn/ui dep 0개, TanStack Query 0개.
      P0-M6 안에서 `bun add @tanstack/react-query` / `@astrojs/react`
      활성화 / `shadcn-ui` CLI 실행 모두 금지. RESEARCH-1A.0 → RESEARCH-1A.1
      전이 시점 = 본 stack 도입 gate.
    status: active
  - id: INV-0031-5
    statement: |
      PWA service worker (RESEARCH-1A.4) 와 본 stack 의 binding —
      IndexedDB 안의 pending turn queue 는 reconnect 시 TanStack Query
      `queryClient.invalidateQueries({ queryKey: ['session', sessionId, 'rounds'] })` +
      `queryClient.setQueryData` optimistic update 와 sync 한다.
      conflict resolution = server timestamp 우선 (UI-spec §8.2 / Q-050
      turn_event durable log 일치). Workbox 의 background sync 가
      `useEventStream` hook 의 reconnect 경로 와 직교 (둘 다 호출 가능).
    status: active
  - id: INV-0031-6
    statement: |
      Voice input (RESEARCH-1A.5, Whisper API) UI 는 React island 안의
      shadcn/ui `<Button variant="ghost">` + Radix Tooltip + `MediaRecorder`
      API 조합. 음성 byte → `POST /api/transcribe` → text → `POST /api/ask`
      서버사이드 routing (ADR-0023 Tier 3 추가). 본 component 는
      `client:only="react"` directive 필수 (SSR 시 MediaRecorder 미존재).
    status: active
  - id: INV-0031-7
    statement: |
      Bundle budget acceptance gate (Lighthouse mobile, Slow 4G throttle)
      — phased per route 도입 시점 기준 enforce. **(a) `client:visible`
      default 페이지 budget = JS transfer ≤ 100KB gzip per route /
      LCP ≤ 2.5s mobile / TBT ≤ 200ms / CLS ≤ 0.1**: RESEARCH-1A.1
      슬라이스 accept 조건 (1A.1 안에서 도입되는 React island 페이지가
      모두 `client:visible` 이므로 본 gate 가 1A.1 안에서 actionable).
      **(b) `client:load` exceptional 페이지 budget = JS transfer ≤
      170KB gzip per route**: 해당 directive 사용 페이지 (`/ops/
      scenarios/:sid`) 가 도입되는 RESEARCH-1A.3 슬라이스 accept 조건
      (그 이전 슬라이스에는 `client:load` 페이지가 없으므로 본 gate
      미적용 — RESEARCH-1A.1 안에서 검증 불가). budget 초과 시 해당
      슬라이스 gate fail — `client:visible` migration 또는 lazy chunk
      분리 의무. P0-M6 RESEARCH-1A.0 은 React island 0 이므로 (a)/(b)
      모두 미적용.
    status: active

preconditions:
  - id: PRE-0031-1
    statement: |
      DEC-022 (Q-051 #6 stack lock) 가 canonical decision body — 6 layer
      stack + 6 점 rationale + Critique 1~6 + canonical lock 문구가 본 ADR
      의 anchor. DEC-022 supersede 시 본 ADR 도 함께 재평가.
  - id: PRE-0031-2
    statement: |
      ADR-0022 (publication site Astro + CF Pages lock) 가 stack 의 anchor
      build target. Astro 5.x major 의 React island 호환성 (`@astrojs/
      react` integration) 이 본 ADR Lock 의 외부 전제 — 호환성 breaking
      change 발생 시 본 ADR 재평가.
  - id: PRE-0031-3
    statement: |
      Hetzner self-host server (UI-spec §13 Topology B) 에 Bun runtime +
      systemd unit + Tailscale Serve (v0) 가 작동. v1+ Cloudflare Tunnel
      + Access JWT 검증 가능 (RUNBOOK).
  - id: PRE-0031-4
    statement: |
      Q-050 turn_event durable log (`turn_event` table — INFRA-1B.7b v8
      migration) 가 존재. 모바일 SSE reconnect 시 `?after_seq=` replay
      가능. 본 stack 의 SSE binding (`useEventStream`) 이 의존.

defines: []

invariant_review:
  status: pending
  reviewed_at: null
  fingerprint: null
unresolved_warnings: []
reviewed_terms:
  - research_app_ops_stack
  - react_island
  - shadcn_ui
  - radix_primitives
  - tanstack_query
  - sse_transport
  - hydration_directive
  - bundle_budget
reviewed_scopes:
  - design.ui.research_app
  - design.ui.shared_primitives
  - design.ui.cache_invalidation
  - design.ui.research_app.hydration_policy
  - design.ui.research_app.bundle_budget
  - design.ui.research_app.pwa_sync
  - design.ui.research_app.voice_input
  - publishing.static_site_stack
  - storage.shared_schema.zod

provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true
---

# ADR-0031: Research App `/ops` UI stack

## Status

accepted — 2026-05-14

본 ADR 는 DEC-022 (Q-051 #6 resolution, 2026-05-14) 의 발급 의무 anchor
에 따라 promote 됨. Round 18 commit (PR #35 직전) 에서 ADR 번호
reservation 만 한 placeholder stub (`status: proposed`) 상태였고, 본 PR
에서 6 layer stack lock + INV-0031-1~7 + 구체 implementation guide
(package.json / astro.config.ops.ts / client:* directive policy /
`src/shared/ui/` layout / `src/ops/lib/query/` 구조) + bundle budget
acceptance gate 까지 본문 확장하여 `status: accepted` 로 promote.

ADR-0029 / ADR-0030 은 main 에 이미 점유 (각 LLM prompt injection
containment / discovery worker concurrency model) — 다음 사용 가능
번호 ADR-0031 사용.

## Context

Q-051 round 2 (2026-05-14) 에서 CLI → Web (mobile-first) pivot + GPT 31
review (Topology B lock: CF Pages public anchor + Hetzner private /ops +
/api, same-origin) 결정 후, `/ops` frontend stack 미결정 상태가 round
14/15 까지 pending. GPT 32 review (2026-05-14) + 사용자 동의로 DEC-022
가 6 layer stack lock — Astro 5.x shell + React 18 island + Tailwind
CSS + shadcn/ui + Radix UI + TanStack Query v5 + SSE transport.

DEC-022 자체는 결정 본문 + 6 점 rationale + Critique 1~6 + canonical
lock 문구를 보유 (`docs/decisions/DEC-022.md`). 본 ADR 는 그 lock 을
ADR layer 에 reflect 하면서, DEC 가 일부러 deferred 한 구체 구현 anchor
(package.json dep version / astro.config.ops.ts shape / client:*
directive policy / src/shared/ui layout / src/ops/lib/query 구조 / bundle
budget acceptance gate) 를 본 PR 안에서 확정한다.

### 본 ADR 와 DEC-022 의 분담

| 영역 | DEC-022 | ADR-0031 (본 ADR) |
|---|---|---|
| 6 layer stack 결정 | **canonical** (Decision lock 표 + rationale 6 점) | mirror (INV-0031-1) |
| Critique 1 (mobile LTE hydration) | mitigation 방침 lock | **enforce** — page-level directive policy 표 + INV-0031-2 + INV-0031-7 bundle budget |
| Critique 2 (shadcn/ui copy-paste anchor) | `src/shared/ui/` 위치 lock | **enforce** — `components.json` aliases + 디렉토리 layout + INV-0031-3 |
| Critique 3 (TanStack Query phasing) | P0-M6 0 dep / P1+ adoption lock | **enforce** — INV-0031-4 + `src/ops/lib/query/` 구조 정의 |
| Critique 4 (ADR-0031 발급 시점) | RESEARCH-1A.1 슬라이스 시작 직전까지 deferred | **본 ADR 발급으로 해소** |
| Critique 5 (PWA service worker 호환) | RESEARCH-1A.4 슬라이스 spec 안 처리 의무 | **anchor** — INV-0031-5 (sync 의무) |
| Critique 6 (Voice input UI 통합) | shadcn `<Button>` + MediaRecorder 자연 | **enforce** — INV-0031-6 (`client:only="react"` 의무) |
| package.json dep version 권고 | 미정의 | **본 ADR 안에서 lock — §3.1 caret 범위** |
| astro.config.ops.ts shape | 미정의 | **본 ADR 안에서 lock — §3.2** |
| Bundle budget acceptance gate | 미정의 (P1+ 검토 의무만) | **본 ADR 안에서 lock — INV-0031-7 + §3.6** |

## Decision

### 1. 6 Layer stack lock (DEC-022 mirror)

| Layer | 선택 | 본 ADR 안의 anchor |
|---|---|---|
| Shell | **Astro 5.x** | ADR-0022 publication site 와 동일 build target. `astro.config.public.ts` (CF Pages, `/posts/*` only) + `astro.config.ops.ts` (Hetzner Bun, `/ops/*` + `/api/*`) 두 변종 분리 — §3.2 lock |
| Interactive layer | **React 18 island** | `@astrojs/react` integration. `client:*` directive 로 page-level hydration cost 제어 — §3.3 directive policy 표 |
| Styling | **Tailwind CSS** | Astro public site 와 동일 design token (`tailwind.config.ts` 단일 source) |
| Component primitives | **shadcn/ui + Radix UI** | shadcn/ui CLI 가 React component 를 `src/shared/ui/` 로 copy-paste — §3.4 layout |
| Server state / cache | **TanStack Query v5** | `src/ops/lib/query/` provider + queryClient + SSE binding hook — §3.5 구조. P1+ RESEARCH-1A.1 도입 (INV-0031-4) |
| Realtime transport | **SSE (Server-Sent Events)** | Q-050 turn_event durable log 와 binding. WebSocket 도입 X (DEC-022 §14 #6 일치) |

### 2. Phasing (DEC-022 일치, INV-0031-4 enforce)

| 슬라이스 | Phase | stack scope |
|---|---|---|
| **RESEARCH-1A.0** | P0-M6 | Astro SSR + Tailwind only. React island 0 / shadcn/ui dep 0 / TanStack Query 0 / SSE binding 0. `astro.config.ops.ts` 가 본 시점에는 SSR adapter (`@astrojs/node`) 만, `@astrojs/react` integration 비활성 |
| **RESEARCH-1A.1** | P1+ | **본 stack 도입 gate**. `@astrojs/react` integration on + shadcn/ui CLI init + TanStack Query provider + SSE binding hook + Radix primitives 도입. 본 ADR §3.1~§3.6 lock 모두 RESEARCH-1A.1 안에서 적용 |
| **RESEARCH-1A.2** | P1+ | Web UI core pages 가 React island + shadcn/ui Sheet/Drawer 도입 |
| **RESEARCH-1A.3** | P1+ | Scenario graph (`/ops/scenarios/:sid`) 가 `client:load` exceptional directive 사용 — INV-0031-2 가 허용한 유일 경로 |
| **RESEARCH-1A.4** | P1+ | PWA service worker 도입 — IndexedDB pending queue ↔ TanStack Query optimistic update sync (INV-0031-5) |
| **RESEARCH-1A.5** | P1+ | Voice input (Whisper API) — `client:only="react"` MediaRecorder component (INV-0031-6) |

### 3. Implementation guide (본 ADR 안 lock)

#### 3.1 package.json dep version (caret 범위, RESEARCH-1A.1 bun.lock 확정)

```jsonc
{
  "dependencies": {
    "astro": "^5.x",
    "@astrojs/react": "^4.x",
    "@astrojs/node": "^9.x",
    "@astrojs/tailwind": "^5.x",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "tailwindcss": "^3.4.0",
    "@tanstack/react-query": "^5.x",
    "zod": "^3.x",
    "hono": "^4.x",

    "class-variance-authority": "^0.7.0",
    "clsx": "^2.x",
    "tailwind-merge": "^2.x",

    "@radix-ui/react-dialog": "^1.x",
    "@radix-ui/react-popover": "^1.x",
    "@radix-ui/react-dropdown-menu": "^2.x",
    "@radix-ui/react-tooltip": "^1.x",
    "@radix-ui/react-slot": "^1.x",

    "vaul": "^1.x"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "shadcn-ui": "^0.9.x",
    "@playwright/test": "^1.x",
    "lighthouse": "^12.x"
  }
}
```

- 본 표는 caret 범위 권고 — 실제 minor lock 은 RESEARCH-1A.1 슬라이스
  안에서 `bun.lock` 결과로 확정 (한 번 lock 되면 그 lock 이 본 ADR
  보완 anchor).
- shadcn-ui CLI 가 추가 `@radix-ui/react-*` peer dep 을 자동 install
  — 본 표는 v0 기준 최소집합. **Sheet** = `@radix-ui/react-dialog` 기반
  (이미 포함). **Drawer** = `vaul ^1.x` (shadcn-ui v0.9 표준 base) lock —
  Radix Dialog 기반 fallback 미사용.

#### 3.2 astro.config.ops.ts shape (Hetzner build target)

본 ADR 는 phase 별 두 변종을 정의 — INV-0031-4 (P0-M6 안에서 `@astrojs/
react` / TanStack Query / shadcn-ui dep 도입 금지) enforce 위해 P0
변종은 `@astrojs/react` import 자체를 포함하지 않는다.

**P0-M6 (RESEARCH-1A.0) — SSR + Tailwind only**:

```ts
// astro.config.ops.ts (P0-M6 RESEARCH-1A.0 변종)
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [tailwind()],
  build: {
    inlineStylesheets: 'auto',
  },
});
```

**P1+ (RESEARCH-1A.1 부터) — 본 stack 6 layer 활성**:

```ts
// astro.config.ops.ts (P1+ RESEARCH-1A.1 변종)
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwind from '@astrojs/tailwind';
import react from '@astrojs/react';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [tailwind(), react()],
  vite: {
    ssr: {
      noExternal: ['@tanstack/react-query'],
    },
  },
  build: {
    inlineStylesheets: 'auto',
  },
});
```

**Runtime bind (loopback enforcement, production)** — `@astrojs/node`
standalone runtime 의 host/port 는 Astro config 의 `server.*` block 이
아니라 **process env `HOST` / `PORT`** 로 제어한다 (`server.*` block 은
`astro dev` / `astro preview` 전용). production loopback bind 는 systemd
unit `Environment=` 또는 `EnvironmentFile=` 으로 lock — Tailscale Serve
앞 (v0) / Cloudflare Tunnel 앞 (v1+) 모두 동일.

```ini
# /etc/systemd/system/k-world-monitor-ops.service (RUNBOOK anchor)
[Service]
Environment=HOST=127.0.0.1
Environment=PORT=4321
Environment=NODE_ENV=production
ExecStart=/usr/bin/bun /opt/k-world-monitor/dist/server/entry.mjs
```

상세 systemd unit shape / EnvironmentFile (Doppler injection) 은
`docs/05_RUNBOOK.md` 가 canonical.

- `astro.config.public.ts` 는 ADR-0022 lock 그대로 (`@astrojs/cloudflare`
  adapter + `/posts/*` content collection). 본 ADR 는 `astro.config.
  ops.ts` 변종만 lock.
- `output: 'server'` SSR-first (모바일 LCP) + (P1+) React island hydration.
- Bun runtime 호환 — `@astrojs/node` standalone mode 가 Bun 에서도 작동
  (RESEARCH-1A.API0 RUNBOOK 안에서 verify 의무).
- **Tailwind v3 + `@astrojs/tailwind` integration** 사용 — shadcn-ui v0.9
  CLI 가 Tailwind v3 기반이므로 일관성 유지 (Tailwind v4 + `@tailwindcss/
  vite` plugin 은 shadcn-ui v0.9 호환 검증 안 됨 — 향후 v0.10+ 도입 시
  본 §3.2 재평가).
- RESEARCH-1A.0 → RESEARCH-1A.1 전이 = 본 config 의 P0 → P1+ 변종 교체
  PR (`@astrojs/react` + `@tanstack/react-query` dep 추가 + import 추가).

#### 3.3 `client:*` directive policy (페이지별 표 — INV-0031-2 enforce)

| 페이지 | Default directive | Exception | 사유 |
|---|---|---|---|
| `/ops/` 홈 | `client:visible` | — | recent 5 sessions read 위주, viewport 진입 시 hydrate |
| `/ops/ask` | `client:visible` (RESEARCH-1A.2, text + send only) → `client:only="react"` (RESEARCH-1A.5, voice 추가 시) | voice icon 도입 시 directive 전이 | RESEARCH-1A.2 슬라이스에서는 text input + send button 만 (MediaRecorder 없음) → `client:visible` 가능. RESEARCH-1A.5 (Whisper API) 슬라이스에서 voice icon 추가 시 MediaRecorder API 가 SSR 시 미존재하므로 `client:only="react"` 로 전이 (INV-0031-6). 본 directive 전이 PR 안에서 §3.3 표 본 행 갱신 의무 |
| `/ops/sessions` list | `client:visible` | — | list filter / sort 만 |
| `/ops/sessions/:id` | `client:visible` | — | round timeline 은 viewport 진입 시 hydrate |
| `/ops/sessions/:id/rounds/:rid` | `client:visible` | — | turn list streaming, viewport-bound |
| `/ops/turns/:tid` | `client:visible` | — | turn detail + SSE EventSource |
| `/ops/claims/:cid` | `client:visible` | — | claim viewer + evidence panel |
| `/ops/scenarios/:sid` | **`client:load`** | scenario graph 진입 즉시 interaction 필수 | vega-lite/mermaid render + branch expand. INV-0031-2 가 허용한 유일 `client:load` 페이지 |
| `/ops/dossiers/:did` | `client:visible` | — | desktop 2-pane, viewport hydrate |
| `/ops/drafts/:did/edit` | `client:visible` | — | desktop only, viewport hydrate |
| `/ops/interventions` | `client:visible` | — | 모바일 1-tap 3-option queue |
| `/ops/publications/:pid` | `client:visible` | — | preflight panel + cite check |

- 신규 페이지 추가 PR 마다 본 표 갱신 의무 (INV-0031-2).
- `client:idle` / `client:media` 는 향후 RESEARCH-1A.1+ 안에서 사용
  사례 발생 시 추가. v0 시점 미사용.

#### 3.4 `src/shared/ui/` 디렉토리 layout (shadcn/ui CLI init 결과)

`shadcn-ui init` 실행 시 다음 `components.json` 으로 lock:

```jsonc
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/shared/ui/globals.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/shared/ui",
    "ui": "@/shared/ui",
    "utils": "@/shared/ui/lib/utils",
    "lib": "@/shared/ui/lib",
    "hooks": "@/shared/ui/hooks"
  }
}
```

- `aliases.ui` 가 shadcn-ui CLI 의 component install target — INV-0031-3
  의 "단일 디렉토리 lock" 보장. `aliases.components` 와 분리되어 있어야
  CLI 가 Dialog / Sheet 등 UI primitive 를 본 경로로 정확히 install.

디렉토리 결과:

```
src/shared/ui/
  ├── button.tsx                  (shadcn/ui — Radix Slot 기반)
  ├── dialog.tsx                  (Radix Dialog primitive)
  ├── sheet.tsx                   (Radix Dialog 기반, side="bottom/right")
  ├── drawer.tsx                  (vaul ^1.x — shadcn-ui v0.9 표준)
  ├── popover.tsx                 (Radix Popover)
  ├── dropdown-menu.tsx           (Radix DropdownMenu)
  ├── tooltip.tsx                 (Radix Tooltip)
  ├── textarea.tsx                (HTML textarea + Tailwind)
  ├── input.tsx                   (HTML input + Tailwind)
  ├── label.tsx                   (Radix Label)
  ├── globals.css                 (Tailwind base / components / utilities + CSS vars)
  └── lib/
        └── utils.ts              (cn = clsx + tailwind-merge)
```

- **React-only component 는 React island 안에서만 import**. Astro public
  site (`/posts/*`) 의 `.astro` 파일은 `src/shared/ui/lib/utils.ts` 의
  `cn()` 만 import 가능 (Tailwind utility class composition). Radix
  component import 시도 시 **ESLint `no-restricted-imports` rule** 로
  차단 — `eslint-plugin-astro` 도입 + `overrides` block 안 `*.astro`
  pattern 에 `src/shared/ui/{button,dialog,sheet,drawer,popover,
  dropdown-menu,tooltip,textarea,input,label}` 차단 (cn util 만 allow).
  본 ESLint config + `eslint` / `eslint-plugin-astro` devDep 추가는
  RESEARCH-1A.1 슬라이스 의무 (§3.1 caret 표는 minimum set 만 — ESLint
  체인은 RESEARCH-1A.1 안에서 lock). `astro check` 는 type-checker 로
  본 rule enforcement 와 별개로 그대로 사용.
- shadcn/ui component 는 vendor lock-in 회피 의도로 copy-paste — 본
  디렉토리 안 파일은 repo 안 source 로 lock, vendor update risk 0
  (DEC-022 Critique 2 lock 일치).

#### 3.5 `src/ops/lib/query/` TanStack Query 구조

canonical 경로 = **`src/ops/lib/query/`** (UI-spec §7.4 / §13 anchor 와
일치). top-level `ops/` tree 생성 금지 — Astro project root 의
`src/ops/*` 안에서만 운영.

```
src/ops/lib/query/
  ├── client.ts                   (queryClient 인스턴스 + defaults)
  ├── provider.tsx                (<QueryClientProvider> root island)
  ├── use-event-stream.ts         (SSE EventSource → setQueryData hook)
  └── keys.ts                     (queryKey factory — ['session', id] 등)
```

`client.ts` defaults:

```ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,          // 30s — `/ops/sessions` list cache
      gcTime: 5 * 60_000,         // 5min
      refetchOnWindowFocus: false, // 모바일 폰 전환 시 polling 폭증 회피
      retry: 1,
    },
    mutations: {
      retry: 0,                    // mutation 은 explicit retry 만
    },
  },
});
```

`use-event-stream.ts` 표준 패턴 (UI-spec §7.4 lock 일치):

```ts
// SSE binding — `?after_seq=` replay 지원
export function useEventStream<T>(opts: {
  url: string;
  queryKey: readonly unknown[];
  reduce: (prev: T | undefined, event: MessageEvent) => T;
  afterSeq?: number;
}) {
  // ... EventSource open / message → queryClient.setQueryData(queryKey, reducer)
  //     reconnect 시 lastEventId 또는 ?after_seq=N replay
}
```

- `keys.ts` queryKey factory 의무 — `['session', id]` / `['session', id,
  'rounds']` / `['turn', id]` / `['active-context']` 등 type-safe.

#### 3.6 Bundle budget acceptance gate (Lighthouse mobile, INV-0031-7)

페이지 도입 시점 슬라이스 별 phased gate. RESEARCH-1A.1 안에서 도입되는
React island 페이지는 모두 `client:visible` directive 이므로 (a) gate
만 1A.1 안에서 actionable. (b) `client:load` gate 는 `/ops/scenarios/
:sid` 가 도입되는 RESEARCH-1A.3 슬라이스 accept 조건.

| Metric | Budget | 적용 슬라이스 | 측정 조건 |
|---|---|---|---|
| JS transfer per route (`client:visible` default) | ≤ 100KB gzip | **RESEARCH-1A.1** accept | Slow 4G throttle, mobile preset |
| LCP | ≤ 2.5s | **RESEARCH-1A.1** accept | Slow 4G mobile |
| TBT (Total Blocking Time) | ≤ 200ms | **RESEARCH-1A.1** accept | Slow 4G mobile |
| CLS | ≤ 0.1 | **RESEARCH-1A.1** accept | mobile preset |
| JS transfer per route (`client:load` exceptional) | ≤ 170KB gzip | **RESEARCH-1A.3** accept (`/ops/scenarios/:sid` 도입 시점) | Slow 4G throttle, mobile preset. 그 이전 슬라이스에는 `client:load` 페이지 없음 → 본 gate 미적용 (검증 불가). RESEARCH-1A.3 PR 안에서 §3.6 본 행 활성화 의무 |

- 해당 슬라이스 budget 초과 → 그 슬라이스 gate fail. Mitigation 옵션:
  1. `client:load` → `client:visible` 또는 `client:idle` migration
  2. lazy chunk split (dynamic `import()`)
  3. shadcn/ui component 안 사용 안 하는 Radix primitive 제거 (copy-
     paste 안에서 명시적 제거 가능)
- 측정 도구 = Playwright + lighthouse CLI (RESEARCH-1A.1 안에 CI step
  추가 의무 — `client:visible` budget 만 검증; RESEARCH-1A.3 안에서
  `client:load` budget 검증 추가). manual smoke 도 허용 (1인 운영).
- P0-M6 RESEARCH-1A.0 은 React island 0 이므로 본 gate 전부 미적용 —
  SSR HTML + Tailwind CSS 만 측정 (별도 budget 없음, 자명하게 budget 안).

## Alternatives Considered

DEC-022 Decision 표 + Rationale §6 의 reject 결정을 본 ADR 안에 mirror.
이전 round (UI-spec §3 옵션 A~F) 비교는 historical record — canonical
reject 사유는 DEC-022 rationale §6 + 본 §Alternatives.

- **A** (chosen) — **Astro shell + React 18 island + Tailwind + shadcn/ui
  + Radix + TanStack Query v5 + SSE** (DEC-022 lock):
  - pros: ADR-0022 publication site 와 build target / schema / design
    system 일관 (단일 framework) / LLM coding 안전성 ↑ (React 패턴 압도) /
    Radix headless a11y 표준 / shadcn/ui copy-paste 로 vendor lock-in
    회피 / SSE + `turn_event` durable log binding 가 모바일 reconnect
    catch-up 호환
  - cons: React island bundle 가 모바일 LTE 부담 — INV-0031-2 `client:
    visible` default + INV-0031-7 bundle budget 으로 mitigate

- **B** — Astro shell + Solid island:
  - pros: bundle 가 React 보다 작음 (Solid runtime ~7KB)
  - cons: LLM (Claude/Codex) coding 패턴/예제/디버깅 사례 부족 → `/ops`
    유지보수 주체가 LLM 인 1인 운영 repo 에서 코드 신뢰도 risk.
    **rejected** (DEC-022 rationale §3, §6)

- **C** — Astro shell + Svelte island:
  - pros: SvelteKit ecosystem
  - cons: Solid 와 동일 reason (LLM 패턴 부족) + Astro + Svelte 통합
    공식 권고 약함. **rejected** (DEC-022 §6)

- **D** — Next.js (App Router):
  - pros: Server Components + Server Actions 의 form-heavy admin UX
    natively
  - cons: ADR-0022 lock 의 Astro publication site 와 build target 이중화
    — 단일 framework 안에서 `/posts/*` + `/ops/*` 두 변종 분리가 본 ADR
    의 핵심 anchor. Next.js 도입 시 build / schema / design system
    이중화 → 1인 운영 maintenance overhead 과도. **rejected** (DEC-022
    rationale §1, §6)

- **E** — HTMX + Hono + Tailwind (이전 UI-spec §3 권고 E):
  - pros: vendor surface 가장 작음 + bun runtime native
  - cons: `/ops` 가 AI research console — scenario graph + route selector
    + drawer/sheet + SSE progress + cache invalidation + optimistic
    update 등 SPA-grade interaction 필요. HTMX 의 HTML-over-the-wire
    패턴이 이 요구를 cover 못 함. 사용자 명시 ("내가 HTMX 모르는 게
    문제가 아니라 네가 HTMX 충분히 아는가") 로도 reject. **rejected**
    (DEC-022 rationale §6 + UI-spec §14 #1 lock)

- **F** — Vue 3 / Nuxt 3:
  - pros: Vue ecosystem
  - cons: 본 repo React/Astro 와 framework family 분리 + LLM coding
    안전성 React 우위. **rejected** (DEC-022 §6)

- **G** — Remix / React Router 7:
  - pros: full-stack SSR + React
  - cons: Astro anchor build target 이중화 (D 와 동일 사유).
    **rejected**

## Consequences

### 긍정

- **단일 build target** — Astro 단일 framework 위에 `astro.config.
  public.ts` (CF Pages) + `astro.config.ops.ts` (Hetzner) 두 변종만 운영.
  ADR-0022 publication site 와 design token / shared schema / shared UI
  primitives 일관.
- **shared schema 일관** — INFRA-1B.7e 의 `src/shared/schema/` Zod
  schema 가 Astro Content Collection (public anchor 본문) + Bun + Hono
  API (route validation) + React island (form / TanStack Query
  type-inference) 3 surface 에서 동일 import.
- **LLM coding 신뢰도** — Claude/Codex 가 `/ops` 구현 시 React +
  Tailwind + shadcn/ui 패턴 안에서 작성 → 코드 품질 / 디버깅 / 유지보수
  표준화. DEC-022 rationale §3 lock 일치.
- **a11y 기본** — Radix headless 가 keyboard nav + focus trap + aria
  modal / popover 표준 제공. operator console 신뢰도 + 모바일 single-
  handed 대응.
- **vendor lock-in 회피** — shadcn/ui CLI copy-paste 방식이라 `src/
  shared/ui/` 의 component code 가 repo 안 source 로 lock. shadcn vendor
  의 destructive update risk 0.
- **모바일 reconnect 호환** — SSE + Q-050 turn_event durable log binding
  으로 폰 외부망 전환 / sleep wake 시 `?after_seq=` replay 가능.
- **PWA / Whisper API 연계 자연** — INV-0031-5 / INV-0031-6 가 stack 안
  에서 자연 동작 (RESEARCH-1A.4 / 1A.5).

### 부정 / trade-off

- **모바일 LCP 위험** — React 18 + Tailwind + Radix runtime + TanStack
  Query bundle ≈ 70KB gzip estimate. INV-0031-2 `client:visible` default
  + INV-0031-7 bundle budget acceptance gate 의무. budget 초과 시
  RESEARCH-1A.1 gate fail.
- **dep 도입 시점 phasing 의무** — INV-0031-4. P0-M6 RESEARCH-1A.0 안에
  서 shadcn/ui / TanStack Query / `@astrojs/react` 도입 절대 금지.
  RESEARCH-1A.0 → 1A.1 전이 시점 gate 가 stack 도입 anchor.
- **`client:*` directive 결정 의무** — INV-0031-2. 신규 페이지 추가 PR
  마다 §3.3 표 갱신. 누락 시 default `client:visible` 적용이지만,
  exception (`client:load` / `client:only`) 사용 시 본 ADR 갱신 필요.
- **bun.lock 보완 의무** — §3.1 caret 범위만 본 ADR lock. 실제 minor
  version lock 은 RESEARCH-1A.1 안에서 `bun.lock` 결과로 확정 + 본 ADR
  Updated 의무.
- **Astro 5.x major upgrade 위험** — PRE-0031-2 에 의해 Astro / @astrojs/
  react breaking change 시 본 ADR 재평가 trigger.

### 후속 작업

- **RESEARCH-1A.1 슬라이스 (P1+)** — 본 ADR §3.1~§3.6 lock 적용. Stack
  scaffold + `astro.config.ops.ts` 활성화 + shadcn/ui CLI init + TanStack
  Query provider + SSE binding hook + Radix primitives 도입 + Lighthouse
  CI step (bundle budget gate INV-0031-7).
- **RESEARCH-1A.2 ~ RESEARCH-1A.5** — 페이지별 `client:*` directive 결정
  PR 마다 §3.3 표 갱신.
- **INFRA-1B.7e (ModelGateway + shared schema)** — `src/shared/schema/`
  Zod schema 가 본 ADR 의 React island form / TanStack Query type-
  inference 와 import 호환 의무.
- **RUNBOOK 갱신** — Hetzner Bun + systemd unit 가 `@astrojs/node`
  standalone adapter 와 호환 verify. Tailscale Serve (v0) + CF Tunnel +
  Access (v1+) wiring 그대로.
- **CI / lint rule 추가** — Astro public `.astro` 파일 안에서 `src/
  shared/ui/` 의 React-only component import 차단 (INV-0031-3 enforce).
- **DEC-022 unresolved_warnings cross-check** — 본 ADR accept 후 DEC-022
  의 `unresolved_warnings[]` validator 가 ADR-0031 발급 의무 anchor 해소
  signal 반영 의무 (foreground `bun run scripts/validate_invariants.ts
  --write-warnings` 1회 실행).

## References

- **DEC-022** (canonical decision body — Q-051 #6 stack lock,
  `docs/decisions/DEC-022.md`)
- **DEC-023** (Q-051 routing default 5항 lock — 본 stack 위의 ask flow
  / classifier advisory 정책)
- **ADR-0022** (extends — publication site Astro + CF Pages lock,
  `astro.config.public.ts` anchor)
- **ADR-0023** (complies — LLM routing v2 / ModelGateway / Whisper API
  Tier 3 추가 — 본 stack 결정과 직교)
- **ADR-0025** (complies — EditorialIntent.purpose enum / mode /
  bidirectional_weight_intent 의 UI surface 가 본 stack 안 React island
  Form + shadcn/ui Textarea + Radix Dialog 패턴)
- **ADR-0029** (LLM prompt injection containment — `/ops/ask` classifier
  prompt 가 INV-0029-1 untrusted-content wrapper 의무)
- **Q-050** (research orchestration — turn_event durable log + SSE
  binding anchor)
- **Q-051** (CLI vs Web pivot — 본 ADR 의 발급 원인)
- **UI-spec** `docs/design/ui-spec-research-app.md` §13 Deployment
  topology Option B + §14 #1 stack lock
- **RESEARCH-1A.1 / .2 / .3 / .4 / .5 / .API0 / .0** roadmap rows
  (`docs/04_IMPLEMENTATION_PLAN.md`)
