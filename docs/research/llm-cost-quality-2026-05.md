---
title: LLM cost/quality sweet spot — k-world-monitor (1인 시나리오 인텔리전스 파이프라인)
created_at: 2026-05-11
status: research
informs:
  - Q-028 (LLM API cost 통제 정책 lock)
  - OPS-1A 비용 통제 worker
  - SPIKE-002 (auto-confirm threshold 0.85)
  - SPIKE-003 (prompt cache hit rate ≥ 70%)
  - 각 stage prompt 설계
provenance: research_synthesis
sensitivity: private
ai_include: true
---

# LLM cost/quality sweet spot — k-world-monitor

## 1. Executive summary

- **결론**: 이 시스템의 sweet spot은 **"Haiku 4.5 + 강제 tool-use 구조화 + 공격적 prompt caching + extract/dossier batch API"** 베이스라인 위에 **Sonnet 4.6은 신뢰도/도메인 게이트로 escalate**, **Opus 4.7은 scenario validate + thesis composer에만 선택적으로** 적용하는 3계층 라우팅이다.
- **모델 선택보다 prompt 설계가 더 큰 효과**: 강제 tool-use(strict schema)로 hallucinated quote 위험을 99.5%+ 구조 일치율로 차단하고, locator/content_hash를 schema 필수 필드로 박는 것이 Haiku→Sonnet 모델 업그레이드보다 faithfulness 개선폭이 크다.
- **비용**: Q-028 baseline $1.10/day는 **prompt caching/batch 적용 전 추정으로 보수적**이다. 캐시 hit ≥70% + extract batch 적용 시 실효 $0.30~0.50/day로 떨어진다. 단, counterclaim 적극 탐색 + backfill 동시 진행 시 $5 한도는 1~2일 만에 깨질 수 있다 — **soft throttle $5/day, hard stop $7.5/day는 합리적**.
- **SPIKE-003 ≥70% 목표는 현실적**: system prompt + tool schema + glossary 합쳐 4~6k 토큰을 5분 TTL 캐시로 유지하면, batch 내부 연속 호출은 거의 100% hit. 단, snapshot text를 메시지 끝(suffix)에 배치하는 prompt 구조가 전제.
- **SPIKE-002 0.85 threshold는 reliability_tier=high에서 fp ≤5% 달성 가능성 높음**. 단, 도메인 mismatch(감염병/거시 등 specialty) 시 Sonnet escalate를 confidence와 무관하게 강제하는 두 번째 게이트가 필요.

---

## 2. Per-workload sweet-spot 매트릭스

| Stage | 권장 모델 | Cache | Batch | 정확성 메커니즘 | 근거 |
|---|---|---|---|---|---|
| (1a) Article extract → Claim | **Haiku 4.5** + tool_choice 강제 | system + schema + glossary cache (5분 TTL) | **Batch** (밤배치) | strict JSON schema, locator/content_hash 필수 필드, "quote_reason는 quote 원문 substring 검증" | Haiku 4.5는 25~26% hallucination rate(상위 3등), structured tool-use는 99.5%+ validity. 추출 batch는 latency 비민감 |
| (1b) Dataset parse | **Parser (LLM 미사용)** | — | — | schema diff against prior snapshot | ADR-0006 INV-0006-2 — dataset은 결정론적 parser로 |
| (1c) Report extract | **Haiku 4.5** + structure prompt | 동일 | Batch | section-by-section 추출, page locator 필수 | Report는 PDF 구조 강함 — Haiku로 충분, Sonnet escalate trigger 두기만 |
| (1d) Escalate path | **Sonnet 4.6** | 동일 cache 공유 | Sync (재추출은 즉시) | re-extract + diff vs Haiku 결과, "왜 차이가 났는가" 메타 필드 | confidence < 0.85 OR reliability_tier ∈ {medium,low} OR domain ∈ specialty(감염병/거시) |
| (2) Dossier 합성 | **Haiku 4.5** | source_policy + dossier template cache | Batch (일 1회 묶음) | claim → dossier 매핑은 deterministic; LLM은 source_perspective 분류 + counterclaim pool 정제만 | aggregation은 reasoning-light. counterclaim balance check만 Sonnet sampling |
| (3) Scenario composer | **Sonnet 4.6** | scenario template + glossary | Sync | assumptions/branches/falsifiers 강제 schema, counterclaim polarity-symmetric 검증 패스 | reasoning-heavy; Haiku는 falsifier 누락 위험. Opus는 비용 대비 marginal |
| (3') Scenario validate | **Opus 4.7** (선택적) | 동일 | Sync | adversarial pass: "이 시나리오의 가장 강한 반박은?" + transmission_channel 검증 | Opus 4.7은 GDPval-AA SOTA, source-grounded 시 21% 적은 오류. 시나리오는 발행 직전 1회만 — 비용 정당화됨 |
| (4) Thesis composer | **Sonnet 4.6** (기본) → **Opus 4.7** (high-stakes) | thesis template + market_stance taxonomy | Sync | stance/market_stance enum 강제, "one-sided thesis" 자체 비판 패스 | 발행 thesis는 빈도 낮음(주 단위) — Opus 비용 부담 적음. v1+ one-sided warning은 별도 |
| (5) ContentDraft 4-format | **Haiku 4.5** | thesis 본문 cache + 포맷 가이드 cache | Batch (4 포맷 동시) | 포맷별 token 한도, 동일 thesis 4 호출 → cache hit 거의 100% | 같은 thesis로 4번 호출하므로 cache로 큰 절감. Sonnet은 long-form 품질에서 Haiku와 marginal gap |
| (6) Cite check 5+1 | **Haiku 4.5 LLM-judge + deterministic rules 혼합** | source_policy + check rubric cache | Sync (발행 전 게이트) | 5개 룰(stale/retracted/horizon/unit/overclaim)은 deterministic, "one-sided thesis"만 LLM | LLM judge는 80~90% human agreement; deterministic 룰이 80% 커버 |
| (7) EvidencePack v0 | **Haiku 4.5** | section template cache | Batch | 4 section은 동일 dossier에서 추출 → 1 호출에 묶기 | 단순 포맷 변환 — Haiku로 충분 |

**Opus 4.7 적용 결정 룰**: 비용 unified pricing(Opus = Sonnet × 1.67 input, 동일 output rate)이지만 token efficiency 12~18% 우위 + tool retry 감소 효과 있음. 따라서 **Opus는 (3') scenario validate 1회 + (4) high-stakes thesis 주 1회**에 한정. 다른 곳은 ROI 음수.

---

## 3. Prompt caching 전략

### Cacheable units (정적 prefix, 변경 빈도 낮음)

1. **System prompt** — pipeline 역할, 5단계 trace 의무, counterclaim 대칭 강제, "절대 quote를 ‌지어내지 않는다" 규칙. (~1~2k tokens)
2. **Tool schema** — extract_claim / compose_scenario / cite_check 도구 JSON schema. (~1~2k tokens)
3. **Glossary subset** — 도메인 용어(reliability_tier, source_perspective, transmission_channel 등). (~1k tokens)
4. **Source policy table** — source_id → reliability_tier / external_llm_policy / horizon 매핑. (~0.5~1k tokens)
5. **Few-shot exemplars** — stage별 1~2개 모범 입출력 쌍. (~1~2k tokens)

총 4~6k tokens — Claude 캐시 최소 1024 tokens 임계 충분히 상회.

### Layering 규칙

캐시 키는 누적적(전 블록 해시 의존). 따라서 변경 빈도 오름차순으로 배치:

```
[1] tools (가장 안정) → [2] system → [3] glossary → [4] source_policy
  → [5] few-shot → [cache_breakpoint] → [6] 사용자 messages (snapshot text 등 dynamic)
```

`source_policy`나 `glossary`가 자주 갱신되면 그 뒤에 오는 few-shot 캐시까지 무효화된다. **`docs/_generated/` artifact regeneration처럼 정책 변경 시 캐시 무효화를 인지하는 build step이 필요**.

### Invalidation cascade (운영 룰)

- glossary 용어 추가/수정 → 다음 batch까지 cache write 1회 비용 흡수 (1.25× input)
- source_policy 변경(reliability_tier 재평가) → 동일
- tool schema 변경(필드 추가/제거) → 모든 stage 캐시 무효화 — **재배포 batch와 동기화**
- system prompt 변경 → 가장 비용 큼, 변경 시 prompt version bump + run_ledger 기록

### Hit rate target ≥ 70%은 현실적인가?

- 한 batch(예: 100 snapshot extract) 내부에서 cache prefix 4~6k tokens는 첫 호출 1회만 write, 99 호출은 read. 산술적으로 hit rate = 99/100 = 99%.
- **5분 TTL이 문제**: batch가 5분 안에 들어오지 않으면 cache miss. Anthropic Message Batches API는 대부분 1시간 내 완료되므로, **batch 호출은 1회 큐잉으로 묶고 batch 외부의 sync 호출에서는 1시간 TTL(2× write cost) 사용 검토**.
- 일 전체로 보면 sync(scenario validate, thesis) + batch(extract, cite check) 혼합 → 70%는 보수적, 실제 85~95% 달성 기대.

### 비용 영향 (정량)

캐시 read 비용은 standard input의 0.10× (90% 할인). Haiku 4.5 input $1/M → 캐시 read $0.10/M.
- 1 extract 당 입력 1200 tokens 중 4500이 prefix(캐시), 200이 dynamic snapshot이라고 가정 (현실적으로 더 많음 — extractor schema + glossary).
- Without cache: 4700 × $1/M = $0.0047/extract
- With cache (hit 후): 4500 × $0.10/M + 200 × $1/M = $0.00065/extract
- **약 86% 절감**

---

## 4. Batch API 활용 가이드

| Workload | Batch 가능? | 이유 |
|---|---|---|
| Article/Report extract (1차) | **YES** | 발행 전 어차피 큐잉. 1시간 latency 수용. 50% 할인 즉시 효과 |
| Sonnet escalate 재추출 | NO | reviewer queue 응답성 — sync |
| Dossier 합성 | **YES** | 일 1회 묶음 처리. dependency: extract 완료 후 |
| Scenario composer | NO | sync (운영자 interactive) |
| Scenario validate (Opus) | **선택적 YES** | 발행 직전 게이트면 sync. 미리 후보 시나리오 검증이면 batch |
| Thesis composer | NO | 운영자 검토 직전 — sync |
| ContentDraft 4-format | **YES** | 4 호출 묶음 batch, 50% × 95% cache 효과 |
| Cite check (deterministic 룰) | N/A | LLM 사용 안 함 |
| Cite check overclaim LLM judge | **YES** (발행 D-1) OR NO (발행 직전) | 워크플로 결정 사항 |
| EvidencePack | **YES** | 발행 후 산출물 — async OK |

**50% × 캐시 90% stacking 적용 시 Haiku 추출 단가**: $0.0047 → $0.0047 × 0.5 × ~0.30(cache 효과 평균치) ≈ $0.0007/extract = 약 85% 절감 누적.

**latency tradeoff**:
- batch: 보통 1시간 미만, max 24시간. 운영자 발행 cadence가 일 단위 이상이면 모두 batch.
- 실시간 manual feedback / policy_gate 검증은 sync 필수.

---

## 5. Accuracy / faithfulness 메커니즘 — prompt 설계가 모델보다 크다

연구 결과: 모델 업그레이드(Haiku→Sonnet)는 정확도 5~15% 개선, 강제 tool-use schema 적용은 JSON validity 80~95% → 99.5%+. **schema/locator 강제는 모델 선택보다 효과가 크다**.

### 5.1 강제 tool-use + strict schema (1순위)

```json
{
  "tool_choice": {"type": "tool", "name": "extract_claim"},
  "tools": [{
    "name": "extract_claim",
    "strict": true,
    "input_schema": {
      "type": "object",
      "required": ["statement", "quote_reason", "locator", "content_hash", "confidence"],
      "properties": {
        "statement": {"type": "string"},
        "quote_reason": {"type": "string", "description": "Source text substring used; must appear verbatim in document"},
        "locator": {"type": "string", "pattern": "^(p\\d+|para\\d+|line\\d+(-\\d+)?)$"},
        "content_hash": {"type": "string", "minLength": 16},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1}
      }
    }
  }]
}
```
- `strict: true` + `tool_choice` 강제 → 99.5%+ schema 준수.
- `anthropic-beta: structured-outputs-2025-11-13` header 사용.

### 5.2 Quote substring 검증 (post-LLM, deterministic)

- `quote_reason`이 원문 텍스트의 substring인지 코드로 검증 → 일치 안 하면 LLM 결과 폐기 + retry.
- 이 한 가지가 **hallucinated quote 위험을 거의 0으로** — 모델 크기 무관.
- Anthropic 자체 calibration이 "refuse rather than guess" 성향이라 quote 합성 빈도는 낮지만, 검증은 trust 차원에서 필수.

### 5.3 Two-pass extract → self-critique (선택적)

연구 시사점: self-critique는 **high-accuracy task에서는 오히려 해롭다**(corrosive on high-performance tasks). 따라서:
- extract 1차에는 self-critique 적용 금지.
- counterclaim 탐색 / scenario validate 에만 adversarial pass 적용 — 여기서는 효과 입증됨.

### 5.4 Counterclaim adversarial pass (scenario validate에서 필수)

```
input: scenario(branches, falsifiers)
prompt: "이 시나리오의 각 branch에 대해 polarity 반대의 가장 강한 evidence를
        찾아라. 못 찾으면 'no_counterclaim_found' 표시 후 confidence_penalty."
```

Counterclaim coverage(per scenario)는 측정 가능한 KPI(섹션 7).

### 5.5 LLM-as-judge (cite check)

- LLM judge 인간 동의율 80~90% — overclaim/one-sided thesis 게이트에는 충분.
- 단, **judge overconfidence 현상** 알려져 있음 — 따라서 judge confidence를 그대로 쓰지 말고 deterministic 룰 통과 후 LLM-judge는 "warn only" 단계로 운용.

---

## 6. Reliability — temperature / seed / prompt versioning

### Temperature

- 모든 extract / cite check: **temperature = 0**.
- Scenario composer: temperature 0.3 (branch 다양성 의도). 단, run_ledger에 기록.
- Thesis composer: temperature 0 (deterministic 의도).

### Seed의 한계

- Anthropic API에 seed 파라미터가 사용 가능해도 hosted GPU/batching 비결정성으로 **bit-exact 재현은 보장 불가**. 운영 가정: "동일 입력에 99% 동일 출력" 정도. ADR-0006 reliability 정의를 이 수준으로 lock.
- 완전 결정성이 필요한 단계는 **deterministic parser/검증 layer로 분리** (이미 ADR-0006 dataset=parser, cite check 5룰=deterministic).

### Prompt versioning + run ledger 연동

- `prompts/{stage}/v{N}.md` + `prompts/{stage}/v{N}.schema.json` 짝지어 저장 — git tracked.
- run_ledger row에 `prompt_version`, `model_id`, `temperature`, `cached_tokens`, `batch_id` 기록 — 이미 INV-0006-5에 정의.
- 추가 권고: `system_prompt_sha256`도 ledger에 — cache invalidation 추적과 동일 키로 통합.

---

## 7. Measurement framework — KPI 4~5개

| KPI | 정의 | 수집처 | 목표 | 연관 SPIKE |
|---|---|---|---|---|
| **cost_per_promoted_claim** | (일별 LLM cost) ÷ (promoted claim 수) | run_ledger × claim ledger | ≤ $0.005/claim (Haiku+cache+batch 기준) | OPS-1A |
| **faithfulness_rate** | quote_reason이 원문 substring 일치 비율 | post-LLM 검증 단계 | ≥ 0.99 (1%만 retry/폐기) | — |
| **auto_confirm_fp_rate** | confidence ≥0.85 + tier=high로 auto-confirm 한 것 중 reviewer가 사후 사이즈된 50건에서 부정확 비율 | sampling 라벨링 | ≤ 0.05 (SPIKE-002 hypothesis) | SPIKE-002 |
| **cache_hit_rate** | cached_tokens / tokens_in (일별, run_ledger SUM) | run_ledger | ≥ 0.70 (SPIKE-003 hypothesis, 실제 85%+ 기대) | SPIKE-003 |
| **counterclaim_coverage** | 각 scenario branch당 polarity 반대 evidence 수 ≥ 1 비율 | scenario ledger | ≥ 0.90 | — |

추가 보조 지표:
- daily_cost (USD) — Q-028 ceiling 추적
- escalation_rate (Sonnet escalate / 총 extract) — 도메인 routing 보정 데이터
- judge_human_agreement (sampled cite-check overclaim flag vs reviewer label) — LLM-judge 신뢰도 추적

---

## 8. Q-028 현재 제안 검증 — baseline $1.10/day 재검토

### 원 baseline 가정 분석

- 일 1000 claim extract × Haiku $0.0008/claim = $0.80
- Sonnet escalate 10% × ~$0.003 = $0.30
- cite check 100 × ~$0.001 = $0.10
- **합 $1.20** (원문 $1.10과 거의 일치)

### 누락된 비용

1. **dossier 합성** — 일 50~100 dossier × Haiku $0.002 = $0.10~$0.20
2. **scenario composer/validate** — 주 5~10 scenario × Sonnet $0.05 + Opus 1회 $0.10 → 일 평균 ~$0.10
3. **thesis composer** — 주 2~3 thesis × ($0.05 Sonnet 또는 $0.10 Opus) → 일 평균 ~$0.05
4. **ContentDraft 4-format** — 주 2~3 thesis × 4 포맷 × Haiku $0.005 = $0.04/thesis × 3 = 일 ~$0.05
5. **EvidencePack** — 주 2~3 × Haiku $0.002 = 무시 가능

**보정 baseline ≈ $1.50~$1.70/day** (cache/batch 적용 전).

### Cache + Batch 적용 후 실효

- extract 단계가 비용의 70% 이상. 여기에 cache 90% + batch 50% stacking → 75~85% 절감.
- **보정 실효 baseline ≈ $0.40~$0.60/day**.

### 5배 여유는 어디서 무너지나

1. **대량 backfill** — 과거 N개월 source 일괄 추출 시 일 5000~10000 claim → $4~$8 (cache hit 유지해도). **$5 한도 초과 가능**.
2. **Counterclaim 적극 탐색** — scenario당 polarity 반대 search 추가 LLM 호출 → $0.5~$1/day 추가.
3. **Batch retry 폭주** — schema validation 실패 retry율 ≥10%면 batch 50% 할인 효과 잠식. retry율 alert 필수.
4. **Specialty 도메인 도배(감염병 outbreak)** — Sonnet 강제 routing이 일시적으로 escalation_rate 50%+ → cost 2~3배.

### Ceiling 권고

- **soft throttle $5/day** (Q-028 제안 유지) — 큐 backoff, 알람.
- **hard stop × 1.5 = $7.5/day** — 신규 LLM 호출 차단, 진행 중만 완료.
- **주간 $25** 합리적 — 단, backfill week은 별도 budget bucket 분리 권고 (예: backfill_run_id 태그, 평소 ceiling과 분리 집계).

---

## 9. Sweet-spot 추천 final + 사용자 결정 필요 항목

### Lock 권고 (Q-028 / ADR-0006 정밀화에 반영)

1. **모델 라우팅 3계층**: Haiku 1차 → Sonnet escalate (confidence < 0.85 OR tier ∈ {medium, low} OR domain ∈ {감염병, 거시}) → Opus 선택적 (scenario validate, high-stakes thesis).
2. **Prompt caching layering**: tools → system → glossary → source_policy → few-shot → [breakpoint] → dynamic. 5분 TTL 기본, sync 호출은 1시간 TTL 검토.
3. **Batch API 기본 ON**: extract, dossier, ContentDraft 4-format, EvidencePack. Sync: scenario composer/validate, thesis composer, cite check 발행 게이트.
4. **강제 tool-use + strict schema** 모든 LLM 호출에 적용. `anthropic-beta: structured-outputs-2025-11-13` header.
5. **Quote substring 검증** post-LLM 단계로 필수 — faithfulness ≥ 0.99 게이트.
6. **Temperature 0** (extract/cite check/thesis), 0.3 (scenario branch). seed는 best-effort 기록 — bit-exact 비보장 명시.
7. **Cost ceiling**: soft $5/day, hard $7.5/day, weekly $25. backfill은 별도 budget bucket.
8. **KPI 5개 + run_ledger 필드**: cost_per_promoted_claim, faithfulness_rate, auto_confirm_fp_rate, cache_hit_rate, counterclaim_coverage.
9. **Prompt version + system_prompt_sha256** run_ledger 기록 (INV-0006-5 확장).

### 사용자 결정 필요 (사이트레프트)

- **A. Opus 4.7 적용 범위**: 권고는 "scenario validate + high-stakes thesis만". 더 보수적(Opus 미사용, Sonnet only)도 가능. → ADR-0006 supersede 또는 부속 DEC.
- **B. Specialty 도메인 list**: 감염병/거시 외에 어떤 도메인이 Sonnet 강제 routing 대상인지. glossary `domain` term 정의 필요.
- **C. Cache TTL 정책**: 5분 단일 vs (sync=1시간 + batch=5분) 이중. 후자가 비용 효율 우위지만 코드 복잡도 증가.
- **D. Backfill budget bucket**: 별도 일일 한도(예: $20/day backfill only) vs 평소 ceiling 일시 상향 (예: backfill 주간만 $15/day). 운영 단순성 vs 회계 명확성 trade-off.
- **E. LLM-judge cite check 도입 단계**: v0에 deterministic 룰만, v1+에서 LLM-judge 추가가 안전. SPIKE 별도 신설할지.
- **F. SPIKE-003 측정 시 cache TTL 만료 처리**: batch가 5분을 초과해 미스가 나는 경우를 hit rate 계산에서 어떻게 다룰지(분모 정의).

### Followup (별도 spike 후보)

- **SPIKE-004 (제안)**: Sonnet escalate trigger rule을 confidence-only vs confidence + domain + reliability_tier 복합 룰로 시뮬레이션 (운영 데이터 200건 확보 후).
- **SPIKE-005 (제안)**: Opus 4.7 scenario validate ROI 측정 — Sonnet validate 결과와 Opus validate 결과의 reviewer-judged quality diff vs cost diff.

---

## References

### Anthropic 공식 / pricing
- [Claude API Pricing 2026 — Anthropic platform docs](https://platform.claude.com/docs/en/about-claude/pricing)
- [Prompt caching — Claude API docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Batch processing — Claude API docs](https://platform.claude.com/docs/en/build-with-claude/batch-processing)
- [Structured outputs — Claude API docs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Increase output consistency — Claude API docs](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/increase-consistency)
- [Models overview — Claude API docs](https://platform.claude.com/docs/en/about-claude/models/overview)

### 모델 벤치마크
- [Claude Haiku 4.5 — Artificial Analysis (intelligence, price)](https://artificialanalysis.ai/models/claude-4-5-haiku)
- [Claude Haiku 4.5 Review — DataCamp](https://www.datacamp.com/blog/anthropic-claude-haiku-4-5)
- [Claude Opus 4.7 Benchmarks — Vellum](https://www.vellum.ai/blog/claude-opus-4-7-benchmarks-explained)
- [Opus 4.7 vs Sonnet 4.6 routing — PADISO](https://www.padiso.co/blog/claude-opus-4-7-vs-sonnet-4-6-routing-decision/)
- [Sonnet 4.6 vs Opus 4.7 — Qubrid](https://www.qubrid.com/blog/claude-sonnet-46-vs-claude-opus-47-which-model-wins-for-your-workload)
- [Hallucination rates May 2026 — Suprmind](https://suprmind.ai/hub/ai-hallucination-rates-and-benchmarks/)

### Cost optimization 사례
- [Anthropic API Pricing 2026 — Finout](https://www.finout.io/blog/anthropic-api-pricing)
- [LLM Cost Optimization 5 levers — Morph](https://www.morphllm.com/llm-cost-optimization)
- [Prompt caching cut RCA cost 90% — dev.to](https://dev.to/stella_lin_82914c71e25769/anthropic-prompt-caching-cut-our-rca-cost-by-90-5gmb)
- [Anthropic Batch API production guide — jangwook.net](https://jangwook.net/en/blog/en/anthropic-message-batches-api-production-guide/)

### Faithfulness eval / LLM judge
- [RAGAS Faithfulness metric](https://docs.ragas.io/en/latest/concepts/metrics/available_metrics/faithfulness/)
- [DeepEval Faithfulness](https://deepeval.com/docs/metrics-faithfulness)
- [LLM-as-a-judge guide — Evidently AI](https://www.evidentlyai.com/llm-guide/llm-as-a-judge)
- [FACTS Leaderboard — DeepMind](https://storage.googleapis.com/deepmind-media/FACTS/FACTS_benchmark_suite_paper.pdf)
- [Overconfidence in LLM-as-a-Judge — arXiv](https://arxiv.org/html/2508.06225v2)

### Reproducibility
- [Non-Determinism of Deterministic LLM Settings — arXiv](https://arxiv.org/html/2408.04667v5)
- [Why Temperature=0 doesn't guarantee determinism — Brenndoerfer](https://mbrenndoerfer.com/writing/why-llms-are-not-deterministic)

### Self-critique 한계
- [The Self-Critique Paradox — Snorkel](https://snorkel.ai/blog/the-self-critique-paradox-why-ai-verification-fails-where-its-needed-most/)
- [Can LLMs Correct Themselves? — arXiv](https://arxiv.org/html/2510.16062v1)
