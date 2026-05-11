---
id: adr-0016
type: adr
title: Collection realism — Tier A-D source taxonomy, collectability_score, and no-bot-bypass policy
status: accepted
created_at: 2026-05-11
updated_at: 2026-05-11
deciders: [user, claude-opus-4-7, gpt]
supersedes: []
superseded_by: []

scope:
  in:
    - storage.neo4j.source_node
    - storage.policy.tier_classification
    - storage.policy.collectability_score
    - pipeline.discovery_layer
    - pipeline.discovery_layer.tier_a
    - pipeline.discovery_layer.tier_b
    - pipeline.discovery_layer.tier_cd_manual_fallback
    - pipeline.policy.no_bot_bypass
  out:
    - storage.policy.source_material_policy   # archive/llm/cloud policy는 ADR-0017
    - pipeline.extraction_layer.routing       # LLM routing은 ADR-0006

invariants:
  - id: INV-0016-1
    statement: 봇 감지 우회(Playwright stealth + residential proxy + fingerprinting bypass)는 production dependency로 도입하지 않는다. arms race + 법적 risk + 1인 운영 ROI 안 맞음 (R17/Q12-1)
    status: active
  - id: INV-0016-2
    statement: Source는 Tier A-D로 분류한다 — A 공식 API/RSS/open dataset (자동, 우선순위 ↑) / B robots 허용 public (낮은 빈도, metadata·claim 중심) / C anti-bot hard·약관 불명확 (user-triggered 또는 manual) / D paywall·scraping 금지·bot 차단·proprietary (manual_only 또는 excluded)
    status: active
  - id: INV-0016-3
    statement: Source는 collectability_score를 보유한다 — {automation_reliability (0~1), legal_policy_clarity (0~1), anti_bot_friction (none|light|moderate|hard|blocked), preferred_mode (api|rss|manual|excluded)}
    status: active
  - id: INV-0016-4
    statement: source_reliability(ADR-0005 reliability_tier) ⊥ source_collectability. Reuters tier 1 high reliability지만 wire-service full text는 anti-bot heavy + paywall → backbone 부적합. 두 차원 분리 입력
    status: active
  - id: INV-0016-5
    statement: Source는 access_method 필드를 보유한다 — {api, rss, sitemap, public_page, manual_only, do_not_collect}. Tier C/D는 manual_claim_entry workflow(ADR-0018)로 fallback
    status: active
  - id: INV-0016-6
    statement: PRD의 "시간 무관 대량 수집"은 Tier A 한계 내 자동 수집으로 재해석된다. Tier B/C/D는 manual fallback으로 흡수. 1인 콘텐츠 production scale에 Tier A만으로 매일 수천 RSS items + 주당 수십~수백 reports/datasets로 충분 (R17/Q12-1)

preconditions:
  - id: PRE-0016-1
    statement: Source 객체 도입 (ADR-0011 9-stage)
  - id: PRE-0016-2
    statement: manual_claim_entry workflow 도입 (ADR-0018)

defines:
  - term: source
    role: secondary  # ADR-0011에서 primary 정의
  - term: collectability_score
    role: primary

invariant_review:
  status: pending
  reviewed_at: null
  fingerprint: null
unresolved_warnings: []
reviewed_terms:
  - source
  - collectability_score
  - reliability_tier
  - document
  - manual_claim_entry
reviewed_scopes:
  - storage.neo4j.source_node
  - storage.policy.tier_classification
  - storage.policy.collectability_score
  - pipeline.discovery_layer
  - pipeline.discovery_layer.tier_a
  - pipeline.discovery_layer.tier_b
  - pipeline.discovery_layer.tier_cd_manual_fallback
  - pipeline.policy.no_bot_bypass
  - storage.policy.source_material_policy
  - pipeline.extraction_layer.routing

provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true
---

# ADR-0016: Collection realism — Tier A-D + collectability_score

## Status

accepted — 2026-05-11

## Context

ADR-0003/ADR-0004(Round 3 lock)는 "외부 자료 discovery → 큐 → fetch → snapshot
→ chunk → claim" 파이프라인을 정의했지만 수집 가능성(=collectability)을 정책으로
다루지 않았다. ideation Round 17/Q12-1에서 봇 우회 가능성을 검토한 결과:

- 봇 감지 우회(Playwright stealth, residential proxy, fingerprinting bypass)는
  arms race이며, Cloudflare bot management 같은 ML+behavioral+fingerprinting
  시스템과 경쟁하는 1인 운영자에게 ROI가 안 맞는다 (RFC 9309 Robots Exclusion
  Protocol 준수).
- "시간 무관 대량 수집" 원래 가정은 Tier A 한계 내로 재해석 — Tier B/C/D는
  manual fallback으로 흡수. 1인 콘텐츠 production scale에서는 Tier A만으로도
  매일 수천 RSS items + 주당 수십~수백 reports/datasets로 충분.
- source_reliability ⊥ source_collectability — Reuters는 tier 1 high
  reliability지만 wire-service full text는 anti-bot heavy + paywall로 backbone
  source 부적합. 두 차원 분리.

## Decision

**Tier 분류** (Source 객체 속성):

| Tier | 정의 | 우선순위 / 수집 방식 |
|---|---|---|
| A | 공식 API / RSS / sitemap / open dataset (정부·국제기구·중앙은행·공식 statistics) | 자동, 우선순위 ↑, daily / hourly polling |
| B | robots.txt 허용 public page (블로그/뉴스 sitemap) | 낮은 빈도, metadata + short claim 중심 |
| C | anti-bot hard / 약관 불명확 / dynamic 페이지 | user-triggered 또는 manual_claim_entry로 fallback |
| D | paywall / scraping 금지 명시 / wire-service full text / proprietary | manual_only 또는 do_not_collect |

**collectability_score** (Source 속성):

```yaml
collectability_score:
  automation_reliability: 0.0-1.0    # 자동 수집 성공률
  legal_policy_clarity: 0.0-1.0      # 약관/license 명확도
  anti_bot_friction: none | light | moderate | hard | blocked
  preferred_mode: api | rss | manual | excluded
```

**access_method** (Source 속성, 단일 선택):
- `api` — 공식 API endpoint
- `rss` — RSS/Atom feed
- `sitemap` — XML sitemap
- `public_page` — robots 허용 HTML page
- `manual_only` — 사용자가 직접 접근 후 manual_claim_entry로 입력
- `do_not_collect` — 수집 금지 (cite check에서 reference도 차단)

**원칙**:
- 봇 감지 우회는 production dependency 아님 (Tier 3 stealth는 v2+에서도 미도입)
- Tier C/D는 manual_claim_entry workflow(ADR-0018)로 자동 fallback
- source_reliability(ADR-0005 reliability_tier)와 collectability_score는 독립
  차원. Q21 Tier A seed 작성 시 두 차원 분리 입력.

**Q21 Tier A seed 가이드** (size cap 폐기 — DEC-009 reflow 후 누적 자유.
v0 entry 72 source `docs/research/source-seed-list-2026-05.md` (경제 22 + 정책 17 + 사회 18 + 대중문화 15, 한국 24개 + 글로벌 48개). 분포는
enforcement 유지):
- domain: DEC-004 4 메타 카테고리 (정책 / 경제 / 사회 / 대중문화) +
  subtopic_tags[] 로 강등된 기존 8 enum 보존 — Q-022 historical reference
- perspective: risk_observer / opportunity_observer / neutral / mixed
  (ADR-0019 source_perspective tag — 분포 균형 필수, REQ-022 / AC-027 적용
  scope = Tier A seed set 전체)
- access_method 분포: api > rss > sitemap > public_page

## Alternatives Considered

- **A** (chosen): Tier A-D + collectability_score + no bot bypass + manual
  fallback
  - pros: 법적 risk 최소, 1인 운영 부담 감소, source_reliability와 분리
  - cons: Tier A 한계로 "대량 수집"이 좁아짐 — manual fallback 부담
- **B** (discarded — R17): bot detection bypass를 production dependency로
  - pros: 수집 범위 확장
  - cons: arms race + 법적 risk + 1인 운영 ROI 안 맞음
- **C** (discarded): reliability_tier에 collectability를 흡수
  - cons: Reuters case처럼 high reliability + low collectability 표현 불가
- **D** (discarded — Round 1): "시간 무관 대량 수집"을 모든 source에 적용
  - cons: paywall / proprietary / anti-bot 우회 강제 — R17 결정 폐기

## Consequences

- 긍정:
  - 법적·약관 안전성 확보
  - Tier A seed가 안정적 backbone — 자동 수집 신뢰성 ↑
  - Tier C/D는 사람이 가치 판단해 manual로 수용
  - source_reliability ⊥ collectability 분리로 정밀 정책 가능

- 부정 / trade-off:
  - Tier A 한계로 사회·정성 분석 source가 부족할 수 있음 — manual feedback
    workflow(ADR-0018)로 보완
  - collectability_score는 운영 중 누적 데이터로 보정 필요(자동 수집 성공률은
    초기 추정치)
  - 봇 우회 회피는 미디어 빠르게 변하는 dynamic page를 일부 놓침 — 의도된 수용

- 후속 작업:
  - INFRA-1A.6 (신설): Source registry seed Q21 — Tier A seed (size cap 폐기 후 누적 자유) + 분포 균형 작성. v0 entry 50 source proposed (`docs/research/source-seed-list-2026-05.md`)
  - INFRA-1B.1 슬라이스: Source registry + Collection Queue (Tier 분류 강제)
  - ADR-0017: source policy gate (archive_policy / raw_cloud_policy /
    external_llm_policy 3 필드)
  - ADR-0018: manual_claim_entry workflow + CLI

## References

- ideation 출처: Round 17/Q12-1 (Tier A-D + collectability_score + no bot
  bypass), Round 21 (Q21 Tier A seed 신설), Round 22 (카테고리 8개)
- 관련 ADR: ADR-0005, ADR-0011, ADR-0017, ADR-0018, ADR-0019
