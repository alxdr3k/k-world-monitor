---
id: adr-0023
type: adr
title: LLM routing v2 — GPT default + Anthropic dual-vendor (performance-tiered) + Google exploration-only + minimal cross-vendor review
status: accepted
created_at: 2026-05-11
updated_at: 2026-05-11
deciders: [user]
supersedes: [adr-0006]
superseded_by: []

scope:
  in:
    - pipeline.extraction_layer.routing
    - pipeline.aggregation_layer.routing
    - pipeline.scenario_layer.routing
    - pipeline.thesis_layer.routing
    - pipeline.publication_layer.cite_check_routing
    - pipeline.discovery_layer.exploration_grounding
    - storage.sqlite.run_table.cost_ledger
    - storage.sqlite.run_table.cross_vendor_review_ledger
  out:
    - pipeline.extraction_layer.dataset
    - pipeline.extraction_layer.derived_metric_computer

invariants:
  - id: INV-0023-1
    statement: LLM router default vendor = **OpenAI (GPT 계열)**. 각 단계의 default 모델은 OpenAI Tier N 모델이며, 다른 vendor 사용은 (a) 도메인 명확 우위 입증 (운영 데이터 / SPIKE) 또는 (b) cross-vendor review 단계 강제 또는 (c) 탐색(검색 grounding) 보조 + 동일 tier 비용효율 우위, 3 조건 중 하나 충족 시에만 허용.
    status: active
    cross_ref_code:
      - src/ops/run-ledger.ts:startRun
  - id: INV-0023-2
    statement: Tier 0 (frontier reasoning, judgment / validation) = **OpenAI frontier reasoning model with extended thinking** (default) + **Anthropic frontier reasoning model with high effort** (cross-vendor review only). Google (Gemini) 사용 절대 금지. 두 모델은 성능/특성 기준으로 동 tier (Anthropic frontier = source-grounded reasoning + agentic long-task 우위, OpenAI extended thinking = 일반 frontier reasoning 우위). 가격 단독 매핑 금지. 실제 model snapshot 은 `data/llm_routing.yaml` operational config — ADR 본문은 capability tier 만 lock.
    status: active
  - id: INV-0023-3
    statement: Tier 매핑 기준 = **capability (성능 / 분야 우위 / 특성)** (가격 단독 매핑 금지, INV-0023-5 강화). vendor 별 동 tier 모델은 quality benchmark + domain advantage 로 매핑되며 cost 는 보조 지표. **실제 model snapshot (정확한 model name / version / effort level) 은 `data/llm_routing.yaml` operational config 가 관리** — ADR 본문은 stable invariant (capability tier + vendor role), config 는 운영 catalog change 시 갱신. ADR 본문에 사용되는 model name 은 example snapshot (2026-05-11 시점, OpenAI API catalog 변경 시 config 만 update — ADR 본문 stable).
    status: active
  - id: INV-0023-4
    statement: "Cross-vendor review **강제 단계는 3 종으로 한정**: (1) publication preflight cite check overclaim LLM judge (Tier 3 cross-vendor — GPT-5 nano 생성 시 Claude Haiku 4.5 review), (2) scenario validate adversarial pass (Tier 0 cross-vendor — GPT-5.5 Pro xthink 생성 시 Opus 4.7 xhigh review), (3) 운영자 명시 high-stakes thesis (Tier 0 cross-vendor). 그 외 단계 (article extract / dossier 합성 / EvidencePack / 일반 thesis) 는 cross-vendor 의무 X — manual review + deterministic 검증 (quote substring 등) 만 적용."
    status: active
  - id: INV-0023-5
    statement: "Google (Gemini API) 사용 scope = **Tier 3 + 탐색(Google Search grounding) 보조 + 동일 tier 비용효율 우위 시만**. 메인 generator (extract / dossier / scenario / thesis / publication) 의 default 또는 reviewer 로 사용 금지 (INV-0023-2 와 정합). 사용 가능한 경우: discovery layer 의 검색 grounding (Gemini Search grounding 기능) / 단순 structured 추출에서 GPT-5 nano 대비 비용효율 우위 입증 시 fallback."
    status: active
  - id: INV-0023-6
    statement: 대형 dataset (1000+ rows 또는 50KB+ raw payload) 는 **ADR-0024 Data Science Module 을 통과 후 derived metric 으로만 LLM 입력**. dataset raw → LLM 직접 금지. LLM 호출에 raw dataset 발견 시 assertion fail.
    status: active
  - id: INV-0023-7
    statement: run_ledger 확장 — `vendor` (openai/anthropic/google), `tier` (0/1/2/3), `cross_vendor_review_of` (FK to other run_id, nullable), `prompt_version`, `system_prompt_sha256`, `cached_tokens`, `batch_id`, `domain_override_reason` (text, nullable). ADR-0006 INV-0006-5 의 확장.
    status: active
  - id: INV-0023-8
    statement: Quote substring 검증 (post-LLM deterministic) 은 모든 vendor 의 모든 LLM 호출에 의무 — vendor 별 hallucination rate 차이와 무관. faithfulness_rate ≥ 0.99 KPI.
    status: active

preconditions:
  - id: PRE-0023-1
    statement: OpenAI API key + Anthropic API key + Google AI Studio API key 모두 self-host 가능 (Doppler / 환경 변수, `docs/05_RUNBOOK.md`).
  - id: PRE-0023-2
    statement: "각 vendor 의 strict tool-use / structured outputs / prompt caching / batch API equivalent 가 v0 시점에 사용 가능. OpenAI = `response_format: json_schema`, Anthropic = `strict: true` + `anthropic-beta: structured-outputs-2025-11-13`, Google = `responseSchema`."
  - id: PRE-0023-3
    statement: vendor 별 cost API 가 run_ledger 에 cost / cached_tokens 기록 가능한 수준의 detail 제공. 미제공 vendor 는 Tier 3 fallback 만 허용.
  - id: PRE-0023-4
    statement: Cross-vendor review 강제 단계 (INV-0023-4 의 3 종) 의 runtime overhead 가 NFR-004 cost ceiling (DEC-010 갱신) 안에 들어옴.

defines:
  - term: model_tier_v2
    role: primary
  - term: frontier_reasoning_model
    role: primary
  - term: exploration_grounding_model
    role: primary
  - term: cross_vendor_reviewer
    role: primary
  - term: domain_override_reason
    role: primary

invariant_review:
  status: pending
  reviewed_at: null
  fingerprint: null
unresolved_warnings: []
reviewed_terms:
  - claim
  - dossier
  - scenario
  - thesis
  - content_draft
  - publication
  - access_intervention
  - reliability_tier
  - extraction_confidence
reviewed_scopes:
  - pipeline.extraction_layer.routing
  - pipeline.aggregation_layer.routing
  - pipeline.scenario_layer.routing
  - pipeline.thesis_layer.routing
  - pipeline.publication_layer.cite_check_routing
  - pipeline.discovery_layer.exploration_grounding
  - storage.sqlite.run_table.cost_ledger

provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true
---

# ADR-0023: LLM routing v2 — GPT default + Anthropic dual-vendor + Google exploration-only + minimal cross-vendor review

## Status

accepted — 2026-05-11

**Supersedes ADR-0006** (Haiku 1차 + Sonnet escalate, Anthropic-only).

## Context

ADR-0006 은 Haiku 4.5 1차 + Sonnet 4.6 escalate (Anthropic only) 구조로
lock 됐다. 2026-05-11 사용자 결정으로 다음 4 가지 변경:

1. **system LLM router default 가 GPT 계열** — ideation 의 Anthropic 우위
   가정은 2026 H1 frontier model 갱신 (GPT-5.5 Pro extended thinking
   GA) 후 폐기.
2. **Tier 0 (frontier reasoning) 동 tier = GPT-5.5 Pro xthink + Opus 4.7
   xhigh effort** — 성능/특성 기준 (가격 매핑 금지). Opus 4.7 의
   source-grounded reasoning + agentic long-task 우위 + GPT-5.5 Pro 의
   일반 frontier reasoning 우위 보완.
3. **Google (Gemini) 는 메인/리뷰 사용 금지, 탐색 보조 + Tier 3 비용효율
   우위 시만** — Google Search grounding 기능을 discovery layer 보조로만.
4. **Cross-vendor review 강제는 3 단계로 최소화** — preflight cite check
   overclaim, scenario validate adversarial pass, 운영자 명시 high-stakes
   thesis. 그 외 단계 cross-vendor 의무 X (cost 폭발 차단).

추가로 ADR-0024 (Data Science Module) 와 연계 — 대형 dataset 은 deterministic
data science module 통과 후 derived metric 만 LLM 입력 (토큰 폭발 차단).

## Decision

### 1. Tier × Vendor 매핑 (capability 기준, model snapshot 은 config 분리)

ADR 본문은 **capability tier + vendor role** 만 lock — 실제 model snapshot
(정확한 model name / version / effort level) 은 `data/llm_routing.yaml`
operational config 가 관리 (INV-0023-3). 본 표의 model name 은 2026-05-11
시점 example snapshot — vendor catalog 변경 시 ADR 본문 갱신 X, config 만
갱신.

| Tier | capability + 용도 | OpenAI (default vendor) | Anthropic (cross-review + override) | Google (탐색 + Tier 3 fallback) | 매핑 근거 |
|---|---|---|---|---|---|
| **Tier 0** | **frontier reasoning with extended thinking** — Scenario validate (3') / high-stakes Thesis / cross-vendor preflight review | **OpenAI frontier reasoning model with extended thinking** (default) — example snapshot: GPT-5.5 Pro extended thinking | **Anthropic frontier reasoning model with high effort** (cross-vendor review only) — example: Claude Opus 4.7 xhigh effort | **사용 금지** (INV-0023-2) | Anthropic frontier = source-grounded reasoning + agentic long-task SOTA / OpenAI extended thinking = 일반 frontier reasoning SOTA. 가격 단독 매핑 X |
| **Tier 1** | **high reasoning** — Scenario composer / Thesis composer (default) / Dossier 합성 (reasoning-heavy) | **OpenAI high-reasoning standard model** (default) — example: GPT-5.5 Pro standard | **Anthropic high-reasoning model with high effort + extended context** (한국어 long-context ≥ 100K tokens 시 override) — example: Sonnet 4.6 high effort | **사용 금지** (메인/리뷰 X) | Anthropic high effort = 200K context window 우위 (long-form 분석) / OpenAI standard = 일반 reasoning 우위. context length 가 override trigger |
| **Tier 2** | **mid structured extraction** — Article extract (default) / Report extract / Dossier 합성 (기본) / EvidencePack 4-section | **OpenAI mid structured-extraction model** (default) — example: GPT-5 mini | **Anthropic standard model** (한국어 + 1만 tokens 이상 context 시 override) — example: Sonnet 4.6 standard | **사용 금지** (메인/리뷰 X) | OpenAI mid = structured tool-use + JSON validity 우위 / Anthropic standard = 한국어 long-context 우위 |
| **Tier 3** | **low-cost high-volume** — Cite check LLM judge / EvidencePack 단순 변환 / 검색 후처리 / search grounding fallback | **OpenAI low-cost high-volume model** (default) — example: GPT-5 nano | **Anthropic low-cost model** (cross-vendor preflight review only) — example: Claude Haiku 4.5 | **Google low-cost fast model with Search grounding** (Search grounding 작업 + 동일 tier 비용효율 우위 시만, INV-0023-5) — example: Gemini 2.5 Flash | Anthropic low-cost = cite-check judge faithfulness 우위 / Google Search grounding 우위 (메인/리뷰 X) / OpenAI low-cost = structured high-volume default |

### 2. Default vendor 결정 룰

각 단계 default = **OpenAI (GPT)**. 다른 vendor 사용은 다음 3 조건 중
하나 충족 시에만:

- **(a) 도메인 명확 우위 입증** — 운영 데이터 200+ 건 누적 후 SPIKE 결과
  로 다른 vendor 가 quality > 5% 우위면 그 단계 default override. 예시:
  - Sonnet 4.6 high effort 가 한국어 long-context dossier 합성에서 5%+ 우위
    입증 시 Tier 1 의 한국어 dossier 단계만 Anthropic override
  - 특정 도메인 (예 거시경제 forecasting) 에서 Opus 4.7 가 우위면 그 도메인
    의 thesis composer 만 Anthropic override
- **(b) cross-vendor review 단계 강제** — INV-0023-4 의 3 종 (preflight
  cite check / scenario validate adversarial / 운영자 명시 high-stakes
  thesis) 은 cross-vendor 의무, 그 외는 의무 X.
- **(c) 탐색 + Tier 3 비용효율** — Gemini 2.5 Flash 가 Google Search
  grounding 작업 또는 동일 tier 대비 비용효율 우위 입증 시 fallback.

domain override 결정은 `run_ledger.domain_override_reason` 필드에 명시
의무 (INV-0023-7).

### 3. Cross-vendor review 강제 단계 (3 종)

| 단계 | 생성 (Generator) | 리뷰 (Reviewer) | Tier | 빈도 |
|---|---|---|---|---|
| **Publication preflight cite check overclaim LLM judge** | GPT-5 nano (default, Tier 3) | **Claude Haiku 4.5** (cross-vendor, Tier 3) | Tier 3 | 발행 시 1회 |
| **Scenario validate (3') adversarial pass** | GPT-5.5 Pro xthink (default, Tier 0) | **Claude Opus 4.7 xhigh effort** (cross-vendor, Tier 0) | Tier 0 | scenario revision 별 1회 |
| **High-stakes Thesis (운영자 명시 flag)** | GPT-5.5 Pro xthink (default, Tier 0) | **Claude Opus 4.7 xhigh effort** (cross-vendor, Tier 0) | Tier 0 | flag 된 thesis 만 (전체의 ~10~20% 추정) |

그 외 모든 LLM 호출 (article extract / dossier 합성 / 일반 thesis / EvidencePack
/ ContentDraft / cite check rule-based 5종) 은 cross-vendor 의무 X.
deterministic 검증 (quote substring) + 운영자 manual review queue 가
quality 가드.

### 4. Google (Gemini) 사용 룰

- **사용 가능**:
  - Discovery layer 의 search grounding 보조 (Gemini API 의 Google Search
    tool — citation 포함 검색 결과). 예: source registry 의 새 publisher
    discovery 시 fallback.
  - Tier 3 structured extraction 에서 GPT-5 nano 대비 비용효율 우위 입증
    시 fallback (운영 데이터 누적 후 SPIKE 채택).
- **사용 금지** (INV-0023-2, INV-0023-5):
  - Tier 0 / Tier 1 / Tier 2 의 메인 generator
  - 모든 cross-vendor reviewer 역할
  - publication preflight gate (cite check / scenario validate / thesis)

### 5. Dataset → LLM 입력 룰 (ADR-0024 연계)

INV-0023-6 — 1000+ rows / 50KB+ raw payload dataset 은 ADR-0024 Data Science
Module 통과 후 derived metric 으로만 LLM 입력. 위반 시 assertion fail.

### 6. Prompt caching / Batch / Strict schema (vendor 추상화)

- **Prompt caching layering** (ADR-0006 INV-0006-3 그대로): tools → system
  → glossary → source_policy → few-shot → [breakpoint] → dynamic.
  - OpenAI: prompt caching 5분 TTL (또는 1시간 sync mode)
  - Anthropic: 5분 / 1시간 TTL
  - Google: implicit caching (Gemini 2.5 Flash 자동)
- **Batch API**: extract / dossier / EvidencePack / ContentDraft (v0
  blog_long only — DEC-005 v0 boundary) 단계는 batch 의무. Scenario
  composer / validate / Thesis composer / cite check preflight 는 sync.
- **Strict schema**: vendor 별 equivalent 사용 (OpenAI `response_format:
  json_schema`, Anthropic `strict: true`, Google `responseSchema`). 99.5%+
  JSON validity 동일 보장.

### 7. run_ledger 확장 필드

기존 ADR-0006 INV-0006-5 필드 + 신규:
- `vendor` (openai / anthropic / google)
- `tier` (0 / 1 / 2 / 3)
- `cross_vendor_review_of` (FK to other run_id, nullable — review 호출인 경우 원 호출 ID)
- `domain_override_reason` (text, nullable — default vendor 가 아닌 다른 vendor 사용 사유)
- `prompt_version` + `system_prompt_sha256` (ADR-0006 그대로)
- `cached_tokens` + `batch_id` (그대로)

### 8. Cost ceiling (DEC-010 에서 lock — 본 ADR 은 정책만)

DEC-010 가 구체 ceiling 값을 lock. ADR-0023 은 ceiling 존재 의무만 정의:
- 일일 soft / hard 한도 + 주간 한도 + backfill 별도 budget bucket.
- Tier 0 호출 (GPT-5.5 Pro xthink / Opus 4.7 xhigh) 일일 cap 별도.

### 9. KPI 5 + 1 추가 (DEC-008 KPI 5 + cross_vendor_review_coverage)

- cost_per_promoted_claim ≤ $0.005/claim
- faithfulness_rate ≥ 0.99 (quote substring 검증)
- auto_confirm_fp_rate ≤ 0.05
- cache_hit_rate ≥ 0.70 (vendor 별 별도 측정)
- counterclaim_coverage ≥ 0.90
- **cross_vendor_review_coverage** ≥ 0.95 (3 종 강제 단계의 cross-vendor
  review 실행률, 신규)

## Alternatives Considered

- **A** (chosen) — GPT default + Anthropic dual-vendor + Google
  exploration-only + minimal 3-stage cross-vendor review:
  - pros: GPT frontier reasoning 우위 + Opus 4.7 source-grounded reasoning
    cross-check, 메인 단계 단일 vendor (cost / 운영 단순) + 발행 게이트만
    cross-vendor, Google 의 Search grounding 만 활용 (vendor 분산 보험),
    데이터 사이언스 모듈로 토큰 / cost 보호
  - cons: vendor 3 개 SDK 통합 부담 (1인 운영) + run_ledger schema 확장
    + cross-vendor reviewer 의 라이브 운영 monitoring 필요
- **B** — Anthropic only (ADR-0006 그대로 유지):
  - pros: 단일 vendor SDK / 단순
  - cons: 2026 H1 frontier model 갱신에서 GPT-5.5 Pro xthink + Opus 4.7
    xhigh dual-vendor 가 quality + cost-quality 측면에서 dominant 입증
    — single vendor 고정은 frontier risk. **rejected**.
- **C** — OpenAI only (Anthropic 제거):
  - pros: 단일 vendor 운영 단순
  - cons: Opus 4.7 의 source-grounded reasoning + agentic 우위 손실, cross-
    vendor review 보험 부재. **rejected**.
- **D** — All-vendor cross-review (전체 LLM 호출에 cross-vendor 의무):
  - pros: quality 최대
  - cons: cost ≥ 2x 폭발, 1인 운영 부담. **rejected** (사용자 결정).
- **E** — Google 전체 vendor 포함 (Tier 0~3 모두):
  - pros: 3-vendor 분산 보험 + Gemini long-context 우위
  - cons: 사용자 결정으로 메인/리뷰 X (vendor 분산 vs 신뢰도 trade-off,
    Google 의 메인 모델 신뢰도 검증 불충분). **rejected** (사용자 결정).

## Consequences

- 긍정:
  - Frontier reasoning quality 우위 (GPT-5.5 Pro xthink + Opus 4.7 xhigh
    dual-vendor)
  - Source-grounded reasoning cross-check (Opus 4.7 가 발행 게이트 review)
    → cite check 5+1 의 hallucination 차단 강화
  - Cost 폭발 차단 (cross-vendor review 3 종 한정 + Data Science Module
    토큰 압축)
  - vendor 분산 보험 (단일 vendor 정책 변경 / outage risk 완화)
  - Google Search grounding 으로 discovery layer 보조
- 부정:
  - vendor 3 개 SDK 통합 부담 (OpenAI / Anthropic / Google AI Studio)
  - run_ledger schema 확장 + cross_vendor_review_ledger 신규 — INFRA-1A.2
    migration 부담
  - vendor 별 prompt caching / batch / strict schema 의 동작 차이 추상화
    layer 필요
  - Tier 0 호출 (GPT-5.5 Pro xthink / Opus 4.7 xhigh) 비용 ↑ — 일일 cap
    별도 관리 의무
  - domain override 결정 누적 (운영 데이터 200+ 후 SPIKE) 까지 single
    default vendor 사용
- 후속 작업:
  - ADR-0006 status: superseded by ADR-0023. 본문에 supersede 사유 + ADR-
    0023 link
  - DEC-008 status: superseded by DEC-010
  - 신규 DEC-010 (LLM routing v2 lock — Tier 매핑 표 + cross-vendor review
    scope + Google 사용 룰 + cost ceiling 재산정 + KPI 6개)
  - 신규 ADR-0024 (Data Science Module — INV-0023-6 enforce)
  - PRD REQ-010 갱신: "Haiku 1차 + Sonnet escalate" → "Tier 2 default
    (GPT-5 mini) + Tier 1 escalate + Tier 0 selective + cross-vendor
    review at preflight + Data Science Module for datasets"
  - PRD NFR-004 갱신: cost ceiling 재산정 (DEC-010 에 lock)
  - HLD Extractor (article) 컴포넌트 Anthropic SDK → Multi-vendor SDK
  - IMPL plan EXTR-1A.2 / EXTR-1A.3 / EXTR-1A.5 재구성 + 신규 slice
    EXTR-1A.6 (Data Science Module bootstrap)
  - 신규 Q (TBD): Google Gemini 사용 scope 확장 시점 (v1+ 메인/리뷰
    포함 검토 시점, 운영 데이터 누적 후)
  - 신규 SPIKE — vendor 별 cache_hit_rate / cost_per_promoted_claim /
    faithfulness_rate 비교 (운영 200+ 호출 후)

## References

- ADR-0006 (superseded — Haiku 1차 + Sonnet escalate)
- ADR-0024 (Data Science Module — dataset → derived metric)
- DEC-008 (superseded by DEC-010)
- DEC-010 (LLM routing v2 lock — 본 ADR 의 cost ceiling + 구체 운영 룰)
- Q-028 (resolved by DEC-008 → re-resolved by DEC-010)
- OpenAI: response_format json_schema, prompt caching, batch API
- Anthropic: strict tool-use, prompt caching, message batches
- Google AI: Gemini API + Google Search grounding + responseSchema
- Recent benchmarks: GDPval-AA, Artificial Analysis intelligence index (2026 H1)
