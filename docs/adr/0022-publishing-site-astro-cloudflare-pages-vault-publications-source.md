---
id: adr-0022
type: adr
title: Publishing site — Astro 5.0 + Cloudflare Pages + vault publications/ as source
status: accepted
created_at: 2026-05-11
updated_at: 2026-05-11
deciders: [user]
supersedes: []
superseded_by: []

scope:
  in:
    - publishing.static_site_stack
    - publishing.cite_anchor_canonical
    - publishing.correction_visibility_layer
    - publishing.vault_publications_source
    - publishing.build_time_cite_gate
    - publishing.rss_feed_per_format
    - publishing.search_pagefind
  out:
    - publishing.external_platform_auto_export
    - publishing.tts_pipeline
    - publishing.dossier_public_exposure
    - publishing.scenario_thesis_public_exposure
    - publishing.incremental_build_engine

invariants:
  - id: INV-0022-1
    statement: 자체 사이트의 모든 발행물은 vault `publications/` 디렉토리의 markdown/mdx 파일을 single source로 사용한다 (외부 CMS 미사용, ADR-0012 Markdown curated view 분담 보존)
    status: active
  - id: INV-0022-2
    statement: 자체 사이트 URL이 cite footnote의 canonical anchor다. 외부 플랫폼(Substack/YouTube/X) 발행물의 인용은 모두 자체 사이트 URL을 가리킨다 (정정 cascade 단일 anchor)
    status: active
  - id: INV-0022-3
    statement: ContentDraft frontmatter의 `status` ∈ {live, corrected, retracted}와 `correction_ledger[]`, `cite_refs[clm_...]`는 빌드 시 Astro Content Collection + Zod schema로 strict 검증되며 dead-link cite_refs 또는 invalid status는 build fail이다 (ADR-0015 cite check 5+1의 build-time enforcement)
    status: active
  - id: INV-0022-4
    statement: vault `publications/` 외 디렉토리(documents/, dossiers/, scenarios/, theses/, content_drafts/, promoted_claims/)는 자체 사이트에 노출되지 않는다 (internal canonical store 보존, ADR-0012)
    status: active
  - id: INV-0022-5
    statement: stack은 Astro 5.0 + Cloudflare Pages + R2 (이미 ADR-0012로 lock된 permitted artifact 인프라와 정합). vendor-neutral host migration 자동화는 의도적으로 out (ADR-0014 intentional lock-in 원칙 연장)
    status: active
  - id: INV-0022-6
    statement: ContentDraft 4-format(blog_long/youtube_long/shorts/newsletter, ADR-0011) 중 v0에서 publish 활성화되는 format은 DEC-005가 정한 phasing을 따른다. publications/ 디렉토리에는 4 subdirectory(blog_long/, newsletter/, youtube_long/, shorts/) 가 1:1 매핑된다
    status: active
  - id: INV-0022-7
    statement: Publication state 변경 (live → corrected → retracted) 은 ContentDraft frontmatter의 `status` 필드 + `correction_ledger[]` append-only로 표현되며 Astro 빌드가 `<RetractionBanner/>` + `<CorrectionLedger/>` 컴포넌트로 사이트 visible 렌더한다 (correction visibility는 외부 플랫폼 의존 X)
    status: active

preconditions:
  - id: PRE-0022-1
    statement: vault publications/ 디렉토리 layout은 본 ADR이 정의한 4 subdirectory (blog_long/, newsletter/, youtube_long/, shorts/) 구조를 따른다 (ContentDraft format enum과 1:1)
  - id: PRE-0022-2
    statement: ContentDraft Composer(PUB-1A.1)와 Astro Content Collection schema가 frontmatter schema(status, cite_refs[], correction_ledger[], format)를 공유한다. divergence 발생 시 build fail (예 schema mirror script + lint)
  - id: PRE-0022-3
    statement: Cloudflare Pages free tier(월 500 build, 100GB bandwidth)가 1인 운영의 build/deploy 빈도를 감당한다 (주 1~3회 발행 기준)
  - id: PRE-0022-4
    statement: Cloudflare R2 + Anthropic API + Cloudflare Pages는 같은 vendor surface 안에서 정합. 추가 vendor 도입 없음 (ADR-0014 intentional lock-in 연장)

defines:
  - term: publishing_site
    role: primary
  - term: vault_publications_directory
    role: primary
  - term: cite_anchor_canonical
    role: primary
  - term: correction_visibility_layer
    role: primary
  - term: content_draft
    role: extends

invariant_review:
  status: pending
  reviewed_at: null
  fingerprint: null
unresolved_warnings: []
reviewed_terms:
  - content_draft
  - publication
  - dossier
  - scenario
  - thesis
  - claim
  - raw_cloud_policy
reviewed_scopes:
  - storage.markdown.curated_view
  - pipeline.publication_layer
  - pipeline.cite_check_layer
  - cli.pipeline_vault_sync

provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true
---

# ADR-0022: Publishing site — Astro 5.0 + Cloudflare Pages + vault publications/ as source

## Status

accepted — 2026-05-11

## Context

이 repo는 9-stage 파이프라인(ADR-0011)의 final stage가 Publication이고 vault에
Publication record가 sync된다(Q-026 open). 그러나 vault Publication record가
어디에 발행되어 외부 독자가 읽는지가 정의되어 있지 않다. ContentDraft 4-format
(blog_long / youtube_long / shorts / newsletter, ADR-0011)이 외부 플랫폼
(Substack / YouTube / X)에만 의존하면 다음 문제가 발생한다:

- **Cite anchor canonical URL 부재** — N개 외부 플랫폼 × N개 게시물의 footnote
  anchor를 동기화해야 정정 cascade가 정합. Q-026의 vault sync 문제가 외부
  플랫폼 surface에서 더 큰 규모로 재발.
- **Retraction visibility 손실** — Substack은 edit visibility가 약하고 YouTube
  description revision은 추적이 어렵다. ADR-0015 cite check 5+1의 retracted
  state가 발행 후 visible 보존 불가.
- **계정 정지 / 정책 변경 리스크** — 외부 플랫폼 단일 의존은 cite anchor를
  영구 손실시킬 수 있다.
- **vault canonical(ADR-0012)과 외부 발행 사이 sync overhead 누적** —
  vault publications/ 그대로 source로 쓸 수 있는 경로가 비어 있음.

본 결정은 자체 사이트를 publishing primary source로 정의하고, 외부 플랫폼은
자체 사이트 URL을 cite anchor로 가리키는 cross-post target으로 한정한다.

## Decision

자체 사이트 stack을 **Astro 5.0 + Cloudflare Pages + vault publications/
디렉토리 직결**로 lock한다. 핵심:

1. **vault `publications/` 디렉토리를 Astro Content Collection의 single
   source로 사용** — `glob('vault/publications/**/*.{md,mdx}')` loader.
2. **publications/ 하위 4 subdirectory** (blog_long / newsletter / youtube_long
   / shorts) — ContentDraft 4-format(ADR-0011)과 1:1 매핑. v0 phasing은
   DEC-005가 결정 (v0 blog_long only).
3. **Zod schema build-time cite gate** — ContentDraft frontmatter schema
   (status, cite_refs[], correction_ledger[], format) 를 Astro Zod schema로
   mirror. build 시 dead-link cite_refs 또는 invalid status는 build fail
   (ADR-0015 cite check 5+1의 build-time enforcement 일부).
4. **Cite / Retraction / Correction 컴포넌트** — `<Cite refs={[clm_...]}/>` /
   `<RetractionBanner status={...}/>` / `<CorrectionLedger entries={...}/>` 가
   cite anchor + retraction + 정정 ledger를 visible 렌더 (correction
   visibility는 외부 플랫폼 의존 X).
5. **호스팅: Cloudflare Pages** — R2(ADR-0012 permitted artifact) + Anthropic
   API(ADR-0006) 와 같은 vendor surface. vendor lock-in 의도적 수용
   (ADR-0014 lock-in 원칙 연장).
6. **검색: pagefind** — Astro 호환 client-side full-text 인덱스 (빌드 시
   생성).
7. **차트 임베드**: vega-lite + mermaid (rehype-mermaid SSR로 정적 SVG).
8. **RSS / Atom feed**: `@astrojs/rss` — 4 format 각각 별도 feed.
9. **internal 디렉토리 비노출**: vault publications/ 외 디렉토리 (documents/,
   dossiers/, scenarios/, theses/, content_drafts/, promoted_claims/) 는 자체
   사이트에 노출 X (internal canonical 보존, DEC-005).
10. **외부 플랫폼(Substack/YouTube/X)은 cross-post target** — 자체 사이트
    URL을 cite anchor로 가리킴. 자동 cross-post는 v1+ (Q-033).

vault → 자체 사이트 매핑:

```
vault/
├── documents/                      # 사이트 노출 X (internal hub)
├── promoted_claims/                # 사이트 노출 X (cite anchor target)
├── dossiers/                       # 사이트 노출 X (DEC-005 internal)
├── scenarios/                      # 사이트 노출 X
├── theses/                         # 사이트 노출 X
├── content_drafts/                 # 사이트 노출 X (drafts)
└── publications/                   # 자체 사이트 PRIMARY source (INV-0022-1)
    ├── blog_long/   → /posts/[slug]
    ├── newsletter/  → /newsletter/[slug]
    ├── youtube_long/→ /videos/[slug]   (script + chapters + cite anchor)
    └── shorts/      → /shorts/[slug]   (script + cite anchor)
```

YouTube/Substack/X 발행물의 footnote는 모두 자체 사이트 `/posts/[slug]` 또는
`/videos/[slug]` URL을 canonical cite anchor로 사용한다. 정정 발생 시 자체
사이트 ContentDraft frontmatter `status: corrected` + `correction_ledger[]`
append만으로 cascade가 정합 (외부 플랫폼은 자체 사이트 anchor를 가리키므로
독자 redirect로 visibility 보존).

## Alternatives Considered

- **A** (chosen) — Astro 5.0 + Cloudflare Pages:
  - pros: Content Collections + Zod = build-time cite gate, MDX로 cite /
    retraction / chart 컴포넌트 자연 임베드, 5.0 이후 빌드 빠름(5x markdown
    / 2x MDX 개선), R2 / Anthropic / Cloudflare Pages 같은 vendor surface,
    islands architecture로 zero JS default
  - cons: MDX는 plain markdown보다 빌드 비용 ↑, Cloudflare 추가 lock-in,
    Astro 5.0 breaking change 의존성

- **B** — Hugo:
  - pros: 빌드 속도 압도적(Go single binary), 수천 페이지 ms
  - cons: MDX 미지원 → cite / retraction / chart 컴포넌트가 Go shortcode로
    강제. type-safe frontmatter 검증에 별도 도구 필요. cite/retraction이
    핵심 UX인 우리 시스템에 컴포넌트 reusability 손실

- **C** — Quartz (Obsidian publish-style):
  - pros: backlinks / graph view native, Obsidian-flavored markdown 지원
  - cons: vault가 7종 graph object + custom cite/retraction UX인 우리 케이스엔
    framework가 좁음. Obsidian-flavored 가정으로 4-format publications/
    분기에 부적합

- **D** — Next.js (App Router):
  - pros: full-stack SSR/ISR, React 컴포넌트 ecosystem
  - cons: 정적 발행에 과잉, 1인 + LLM agent 환경 대비 over-engineering,
    JS 번들 zero-by-default가 아님

- **E** — 외부 플랫폼만 사용 (Substack + YouTube + X, 자체 사이트 X):
  - pros: 초기 셋업 비용 0, 인프라 운영 0
  - cons: cite anchor canonical URL 부재 → 정정 cascade 폭발(Q-026
    surface 확대), retraction visibility 손실, 계정 정지 시 cite anchor
    영구 손실, vault canonical과 외부 사이 sync overhead 누적 — ADR-0015
    cite check 5+1 정합성 무너짐. **rejected**.

## Consequences

- 긍정:
  - Cite anchor canonical URL 1개 — 정정 cascade가 자체 사이트 1곳 update로
    정합 (Q-026 resolve via DEC-006 + ADR-0022)
  - Retraction visibility는 ContentDraft frontmatter status + correction_
    ledger를 Astro 컴포넌트가 자동 렌더 → ADR-0015 cite check 5+1이 발행
    후에도 visible 보존
  - Build-time cite gate (Zod schema dead-link 검사) → ADR-0015 cite check
    5+1의 일부가 build 단계에서 hard gate
  - vault publications/ 그대로 source = sync overhead 0
  - Vendor surface 통합 (R2 + Anthropic + Cloudflare Pages)
  - Dossier / Scenario / Thesis internal canonical 보존 — 사용자 결정
    (DEC-005) 반영
- 부정 / trade-off:
  - Cloudflare lock-in 가속화 — ADR-0014 intentional lock-in 연장이지만
    vendor 다양화 옵션 ↓
  - MDX 빌드 비용은 plain markdown보다 ↑. 권장: publications/ 만 MDX, 나머지
    internal markdown은 plain
  - 자체 사이트 디자인 / 유지보수 부담 추가 — 1인 운영에서 시간 박싱 필요
  - Astro 5.0 release schedule + breaking change 의존성 (Cloudflare 인수
    후 long-term 안정성은 가정)
  - vault 파일 수가 ~1만 도달 시 빌드 시간 ↑ — incremental build 도입은
    v2+ (scope.out)
- 후속 작업:
  - PUB-1A.4 신규 slice: Astro skeleton + Content Collection + Zod schema
    mirror + `<Cite/>` / `<RetractionBanner/>` / `<CorrectionLedger/>`
    컴포넌트 + Cloudflare Pages 배포
  - PUB-1A.5 신규 slice: 첫 publication (blog_long 1건) — v0 turn-key gate
    (P0-M6 thin slice)
  - DEC-005 (자매 결정): v0 turn-key publish scope — 1 format(blog_long)
    only, TTS 보류, manual cross-post, manual correction approve
  - DEC-006 (자매 결정): Vault sync trigger — Astro source가 vault
    publications/ 직결이므로 git push가 sync trigger. ADR-0022 INV-0022-1
    보강. Q-026 resolve.
  - PRD REQ-027 신규: 자체 사이트 publishing primary
  - HLD: Publication Ledger → Publishing Site 컴포넌트 추가 (Astro + CF
    Pages + pagefind + RSS)
  - Q-031 (신규): TTS v1 timing + provider (외주 vs 자체)
  - Q-032 (신규): ContentDraft 4-format auto-generate phasing (v1+
    youtube_long / shorts / newsletter)
  - Q-033 (신규): 외부 플랫폼 auto cross-post 시점 (Substack / YouTube / X)
  - Q-034 (신규): Auto retraction trigger 정책 v1+ (manual approve → auto
    전환 기준)
  - INV-0022-2 보호: 외부 플랫폼 발행물의 cite footnote가 자체 사이트 URL이
    아닌 외부 URL을 가리키면 cross-post lint fail (PUB-1A.5 검증)

## References

- ADR-0011 (9-stage object model, 4-format ContentDraft anchor)
- ADR-0012 (Neo4j / SQLite / R2 / Markdown vault 분담)
- ADR-0014 (Neo4j-native + intentional vendor lock-in)
- ADR-0015 (cite check 5+1)
- ADR-0017 (Source policy gate — publication preflight inline_block)
- ADR-0018 (Manual feedback inbound — manual correction approve workflow)
- Q-022 → DEC-004 resolve (v0 카테고리 4개)
- Q-026 → ADR-0022 + DEC-006 resolve (vault sync trigger)
- DEC-005 (v0 turn-key publish scope)
- Astro Content Collections: https://docs.astro.build/en/guides/content-collections/
- Astro 5.0 announcement (Content Layer API, 5x faster markdown, 2x faster
  MDX, 25-50% less memory)
- pagefind: https://pagefind.app/
- Cloudflare Pages free tier limits
