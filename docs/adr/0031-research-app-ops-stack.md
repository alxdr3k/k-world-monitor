---
id: adr-0031
type: adr
title: Research App /ops UI stack — Astro shell + React 18 island + Tailwind + shadcn/ui + Radix + TanStack Query v5 + SSE
status: proposed
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
  out:
    - pipeline.extraction_layer
    - pipeline.aggregation_layer
    - pipeline.publication_layer.publication_artifact

invariants:
  - id: INV-0031-1
    statement: |
      Research App `/ops` 사설 surface 는 Astro 5.x shell + React 18 island
      (@astrojs/react integration) stack 만 사용한다. Solid / Svelte / Vue
      / HTMX / Next.js / Remix 도입 금지 — DEC-022 lock 일치.
    status: proposed

provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true
---

# ADR-0031: Research App `/ops` UI stack

> **Status: proposed (placeholder)**.
> 본문 (Decision rationale / Consequences / Implementation guide) 은
> RESEARCH-1A.1 슬라이스 시작 직전 별도 PR 안에서 확장 작성한다. 현재는
> Codex round 18 P1 finding (`ADR-0029` 와의 ID collision 회피) 대응 +
> dangling reference 해소를 위한 stub 만.

## Context

본 ADR 는 `docs/decisions/DEC-022.md` (Q-051 #6 resolution, 2026-05-14)
의 발급 의무 anchor 에 따라 생성됨. DEC-022 본문에 6 layer stack +
6 점 rationale + 6 critique + phasing + canonical lock 문구가 모두
정의되어 있으며, 본 ADR 의 실제 작성 시점에 DEC-022 본문을 흡수 + 구체
`package.json` dep version / `astro.config.ops.ts` shape / `client:*`
directive policy 까지 확정한다.

발급 시점 = **RESEARCH-1A.1 슬라이스 시작 직전** (P1+ phasing). 그 시점
까지 본 stub 으로 ADR 번호 reservation 유지 (status: proposed).

## Decision (lock — DEC-022 흡수, 본문은 후속 PR 에서 확장)

본 ADR 의 6 layer stack lock + phasing + 거절된 옵션은 DEC-022 에서
이미 결정됨:

- **Shell**: Astro 5.x (ADR-0022 publication site 와 동일 build target)
- **Interactive layer**: React 18 island (`@astrojs/react`)
- **Styling**: Tailwind CSS
- **Component primitives**: shadcn/ui + Radix UI (copy-paste in
  `src/shared/ui/`)
- **Server state / cache**: TanStack Query v5
- **Realtime transport**: SSE (binds Q-050 turn_event log)

**Phasing**:
- P0-M6 RESEARCH-1A.0: Astro SSR + Tailwind only (0 React island /
  0 shadcn dep / 0 TanStack Query)
- P1+ RESEARCH-1A.1+: Full stack adoption (React island + shadcn/ui
  CLI scaffold + TanStack Query + SSE binding)

**Rejected**:
- Solid / Svelte / Vue (LLM coding safety + community)
- Next.js (Astro anchor build target 이중화)
- HTMX (SPA-grade interaction 부족, `/ops` 는 AI research console)

## Relations

- **DEC-022** (canonical decision body — Q-051 #6 resolution)
- **ADR-0022** (extends — publication site Astro + CF Pages 위에 동일
  Astro project 안 React island 로 `/ops` 사설 surface 추가)
- **ADR-0023** (complies — LLM routing / Whisper API / ModelGateway 가
  본 stack 결정과 직교)
- **ADR-0025** (complies — EditorialIntent.purpose enum / mode /
  bidirectional_weight_intent 의 UI surface 가 본 stack 안 React island
  Form + shadcn/ui Textarea + Radix Dialog 패턴)
- **RESEARCH-1A.1 슬라이스** (P1+ — 본 ADR body 확장 시점)

## Deferred to RESEARCH-1A.1 슬라이스 직전 PR

본 stub 이 placeholder 상태에서 다루지 않는 항목:

- 구체 `package.json` dep version (Astro / React / Tailwind / shadcn-ui
  CLI / Radix / TanStack Query 각 minor lock)
- `astro.config.ops.ts` shape (Hetzner build target / `@astrojs/react`
  integration / `output: 'server'` adapter 결정)
- `client:*` directive policy (페이지별 hydration 정책 — `client:visible`
  default vs `client:load` 예외)
- `src/shared/ui/` 디렉토리 layout (shadcn/ui CLI init 결과 구조)
- `ops/lib/query/` TanStack Query provider 구조 (queryClient config /
  SSE binding hook `useEventStream` 표준 패턴)
- INV-0031-1 외 추가 INV (DEC-022 Critique 1-6 항목 흡수)
- Bundle budget acceptance gate (Lighthouse mobile budget)
