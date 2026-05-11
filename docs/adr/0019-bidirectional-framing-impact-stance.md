---
id: adr-0019
type: adr
title: Bidirectional framing — scenario.impact_targets[]/impact_direction_by_target, thesis.stance + market_stance, EvidencePack multi-layer
status: accepted
created_at: 2026-05-11
updated_at: 2026-05-11
deciders: [user, claude-opus-4-7, gpt]
supersedes: []
superseded_by: []

scope:
  in:
    - storage.neo4j.scenario_node.impact_targets
    - storage.neo4j.scenario_node.impact_direction_by_target
    - storage.neo4j.scenario_node.transmission_channels
    - storage.neo4j.scenario_node.summary_valence
    - storage.neo4j.thesis_node.stance
    - storage.neo4j.thesis_node.market_stance
    - storage.policy.source_perspective_tag
    - storage.policy.balanced_framing
    - pipeline.evidence_pack.multi_section
    - pipeline.llm_synthesis.mode_separation
    - pipeline.cite_check_layer.bidirectional_warning
  out:
    - storage.neo4j.edges                  # edge ledger는 ADR-0013
    - pipeline.metrics_framework           # metrics는 ADR-0020

invariants:
  - id: INV-0019-1
    statement: 시스템 정체성은 "Scenario intelligence pipeline tracking risk + opportunity + resilience + asymmetric impact, translated into content production"이다 (R25 4축 병렬). "리스크 탐지 시스템"으로 협소화 금지
    status: active
  - id: INV-0019-2
    statement: scenario는 v0부터 impact_targets[] + impact_direction_by_target (dict, target별 direction) + transmission_channels[]를 보유한다. impact_direction_by_target value는 {upside, downside, mixed, neutral} 4값. asymmetric은 target별 direction 분포에서 derive되는 파생 속성 (R25 R23 single valence enum 정정)
    status: active
  - id: INV-0019-3
    statement: scenario.summary_valence (선택) ∈ {upside, downside, mixed, neutral} 4값 — 상위 요약 필드만. impact_direction_by_target이 canonical
    status: active
  - id: INV-0019-4
    statement: thesis는 stance + market_stance(optional) 2 필드를 보유한다 — thesis.stance ∈ {constructive, cautionary, neutral, mixed, asymmetric, exploratory} (일반 thesis) / thesis.market_stance ∈ {bullish, bearish, range_bound, volatility_up, volatility_down, neutral} (자산·시장 thesis, optional v0, 필수 v1). 두 필드는 mutual exclusive 아님 (자산 thesis가 둘 다 가질 수 있음)
    status: active
  - id: INV-0019-5
    statement: Source는 source_perspective tag를 보유한다 — {risk_observer, opportunity_observer, neutral, mixed}. Q21 Tier A seed 작성 시 분포 균형 강제 (예: 30개 중 risk_observer ≤ 15, opportunity_observer ≥ 8, neutral ≥ 7)
    status: active
  - id: INV-0019-6
    statement: RAG build_evidence_pack은 v0에서 4 section을 출력한다 — supporting_evidence / opposing_evidence / mitigating·amplifying (merged) / monitoring_signals. v1에서 8 section으로 확장 — + neutral_base_rate / uncertainty_factors / unresolved_access_interventions / amplifying_factors(분리)
    status: active
  - id: INV-0019-7
    statement: LLM synthesis prompt는 mode 분리 — balanced (양방향 default, scenario·thesis 구체화 단계) vs specific (단방향, specific lookup). balanced mode에서는 "한쪽 방향 evidence만으로 결론 금지 / winners·losers 분리 / 확률보다 transmission channel 우선" 제약을 prompt에 명시 (R25)
    status: active
  - id: INV-0019-8
    statement: counterclaim은 polarity-symmetric — thesis-relative challenge evidence. downside thesis의 counterclaim은 upside argument, upside thesis의 counterclaim은 downside argument, regime shift의 counterclaim은 reversion argument. v0는 사용자가 counterclaim 입력 시 direction tag(bull/bear/regime/mixed) 명시 (manual). v1+에서 LLM 자동 판정 옵션 (R24 R23-focused 정정)
    status: active
  - id: INV-0019-9
    statement: ImpactAssessment는 v0에서 scenario embedded dict로 시작 — v1에서 ImpactAssessment 별도 Neo4j 노드 + HAS_IMPACT/AFFECTS/TRANSMITTED_THROUGH edges (Q-029)
    status: active

preconditions:
  - id: PRE-0019-1
    statement: 9-stage 객체 모델 (ADR-0011) — Scenario / Thesis / Source
  - id: PRE-0019-2
    statement: counterclaim multi-relation v1 도입 시점은 ADR-0013 INV-0013-4 발효 후 (Q-030)

defines:
  - term: impact_target
    role: primary
  - term: transmission_channel
    role: primary
  - term: source_perspective
    role: primary

invariant_review:
  status: pending
  reviewed_at: null
  fingerprint: null
unresolved_warnings: []
reviewed_terms:
  - scenario
  - thesis
  - source
  - claim
  - impact_target
  - transmission_channel
  - source_perspective
reviewed_scopes:
  - storage.neo4j.scenario_node.impact_targets
  - storage.neo4j.scenario_node.impact_direction_by_target
  - storage.neo4j.scenario_node.transmission_channels
  - storage.neo4j.scenario_node.summary_valence
  - storage.neo4j.thesis_node.stance
  - storage.neo4j.thesis_node.market_stance
  - storage.policy.source_perspective_tag
  - storage.policy.balanced_framing
  - pipeline.evidence_pack.multi_section
  - pipeline.llm_synthesis.mode_separation
  - pipeline.cite_check_layer.bidirectional_warning
  - storage.neo4j.edges
  - pipeline.metrics_framework

provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true
---

# ADR-0019: Bidirectional framing

## Status

accepted — 2026-05-11

## Context

ideation Round 23에서 사용자 발의: "지금 너무 하방을 전제하고 논의가 전개되고
있는 것 같은데, 상방 요인들도 동일한 성능으로 커버 가능한 거지?" 검토 결과:

- 시스템 architecture는 양방향 대응 가능 (Scenario outcome enum 없음, Thesis
  작성자 정의, claim/Dossier 방향 무관)
- 그러나 명명·default·시드 source가 risk-centric으로 편향됨 (WEF Risks Report,
  IMF downside risks, shock_type axis, monitoring signal default, falsifier
  counterclaim 양쪽 disprove 중심, Tier A seed 대부분 risk observer)

R23 → R24 자체 audit → R25 GPT 메타 재검토 누적 결과:
- R23 `scenario.valence` 단일 enum 5값 → R25 target별 분해 (impact_targets[]
  + impact_direction_by_target)
- R23 `thesis.direction` 6값 → R25 thesis.stance + market_stance 2 필드
- R23 `valence_balance_score` → R25 `one_sided_warning_rate` +
  `opposing_evidence_coverage`
- R23 RAG "양방향 default" → R25 EvidencePack 다층 (v0 4 / v1 8) + mode 분리

R25 시스템 정체성 갱신: **"Scenario intelligence pipeline tracking risk +
opportunity + resilience + asymmetric impact, translated into content
production"** (4축 병렬).

## Decision

**시스템 정체성** (Current Canonical Direction):
> "Scenario intelligence pipeline tracking risk + opportunity + resilience +
> asymmetric impact, translated into content production." 라는 4축 병렬을
> Standards of Care 명문화. "downside-risk monitor"로 협소화 금지.

**Scenario 필드** (v0 즉시):

```yaml
scenario:
  impact_targets: ["global_growth", "korea_exports", "us_equities", ...]
  impact_direction_by_target:
    korea_exports: downside
    energy_exporters: upside
    global_growth: mixed
  transmission_channels: ["energy", "credit", "fx", "policy", "technology", "information"]
  summary_valence: upside | downside | mixed | neutral   # 선택, 상위 요약만
  # asymmetric은 impact_direction_by_target 분포에서 derive
```

**Thesis 필드** (v0 즉시):

```yaml
thesis:
  stance: constructive | cautionary | neutral | mixed | asymmetric | exploratory  # 일반
  market_stance: bullish | bearish | range_bound | volatility_up | volatility_down | neutral  # 자산·시장, optional v0 / 필수 v1
```

두 필드는 mutual exclusive 아님 (자산 thesis는 stance + market_stance 둘 다
가질 수 있음).

**Source 필드** (v0 즉시):

```yaml
source:
  source_perspective: risk_observer | opportunity_observer | neutral | mixed
```

Q21 Tier A seed 분포 균형 (30~50개):
- risk_observer ≤ 50%
- opportunity_observer ≥ 25%
- neutral ≥ 15%

**EvidencePack 구조** (RAG build_evidence_pack):

| Section | v0 | v1 |
|---|---|---|
| supporting_evidence | ✓ | ✓ |
| opposing_evidence | ✓ | ✓ |
| mitigating·amplifying (merged) | ✓ | — |
| mitigating_factors (분리) | — | ✓ |
| amplifying_factors (분리) | — | ✓ |
| monitoring_signals | ✓ | ✓ |
| neutral_base_rate | — | ✓ |
| uncertainty_factors | — | ✓ |
| unresolved_access_interventions | — | ✓ |

**LLM synthesis prompt mode 분리**:
- `mode=balanced` — scenario·thesis 구체화 단계, 양방향 default. prompt 제약:
  "한쪽 방향 evidence만으로 결론 금지 / winners·losers 분리 / 확률보다
  transmission channel 우선"
- `mode=specific` — specific lookup query (e.g., "이 claim이 어디서 나왔어?"),
  단방향 OK

**v0 metrics 3개** (ADR-0020 metrics framework에 통합):
- `upside_claim_presence_rate` (publication preflight + build_evidence_pack
  부산물)
- `downside_claim_presence_rate` (동일)
- `one_sided_warning_rate` (R23 valence_balance_score 폐기 후 rename) — 한
  방향 evidence만 보유한 publication 비율

**v1 추가 metrics 2개**:
- `opposing_evidence_coverage` — thesis-relative opposing evidence 수집률
- `mitigation_coverage` + `amplification_coverage`

**v2+ metrics 2개**:
- `upside_signal_recall` / `downside_signal_recall` (gold query set 필요)
- `asymmetric_impact_coverage` (impact_targets 누적 후)

**Counterclaim polarity-symmetric** (ADR-0009 INV-0009-1 보강):
- downside thesis counterclaim → upside argument
- upside thesis counterclaim → downside argument
- regime shift counterclaim → reversion argument
- v0: 사용자가 counterclaim 입력 시 direction tag (bull/bear/regime/mixed)
  명시 (manual). publication_preflight가 thesis.stance/market_stance와
  counterclaim.direction이 정반대인지 검증
- v1+: LLM 자동 판정 옵션

**Publication preflight 6번째 check (warning, ADR-0015 INV-0015-7)**:
- thesis.stance/market_stance가 한쪽으로 강하게 기울었는데 EvidencePack
  opposing/mitigating/uncertainty가 비어 있을 때 warn (block 아님). reviewer가
  명시적으로 dismiss 가능.

**ImpactAssessment 단계화** (Q-029):
- v0: scenario embedded dict (impact_direction_by_target)
- v1: ImpactAssessment 별도 Neo4j 노드 + edges (HAS_IMPACT / AFFECTS /
  TRANSMITTED_THROUGH / SUPPORTS / WEAKENS / MITIGATES / AMPLIFIES / MONITORS)
- ADR-0013 v0 5-edge 유지 — v1 4 추가 edge (WEAKENS/STRENGTHENS/MITIGATES/
  AMPLIFIES, Q-030)

## Alternatives Considered

- **A** (chosen): target별 impact_direction + stance + market_stance 분리 +
  EvidencePack 다층 + mode 분리 + polarity-symmetric counterclaim
  - pros: 시스템 정체성 4축 병렬 명확, winners/losers 분리, bull/bear vs
    constructive/cautionary 정밀 분리
  - cons: scenario/thesis schema migration cost (정성 필드, 비싸지 않음)
- **B** (discarded — R23 single valence): scenario.valence 단일 enum 5값
  (upside/downside/mixed/neutral/asymmetric)
  - cons: asymmetric은 target별 분포에서 derive — 두 차원 섞음 (R25 GPT 정정
    채택)
- **C** (discarded — R23 thesis.direction): 6값 mutual exclusive enum
  - cons: 자산 thesis (bull) + 일반 thesis (constructive) 동시 표현 불가
- **D** (discarded): risk 단어 제거 + opportunity 단어만 사용
  - cons: 4축 병렬 위반 — R25 GPT 정정 (risk + opportunity + resilience +
    asymmetry 4축)
- **E** (discarded): valence_balance_score 기계적 50:50 강제
  - cons: 도메인 사실관계에 반하는 균형 강제 → "누락 탐지" metric으로 변경
    (one_sided_warning_rate, R25)

## Consequences

- 긍정:
  - 시스템 정체성이 4축 병렬로 명확 — 콘텐츠가 perpetual bear / bull로 흐르지
    않음
  - winners/losers가 같은 scenario 안에서 분리 표현
  - publication preflight 6th warning으로 자연스러운 enforce
  - counterclaim이 polarity-symmetric으로 작동 — cherry-picking 양방향 차단

- 부정 / trade-off:
  - scenario / thesis schema에 새 필드 6~7개 추가 (정성 필드, 입력 부담 ↑)
  - Q21 Tier A seed 분포 균형 강제 — opportunity_observer Tier A 후보가
    Tier B/C로 분산될 수 있음 → manual_feedback workflow(ADR-0018)가 v0에
    더 자주 작동
  - LLM synthesis prompt mode 분기 로직 추가
  - counterclaim direction tag manual 입력 부담 — v1+ LLM 자동 판정으로 완화

- 후속 작업:
  - INFRA-1A.7 (신설): scenario / thesis / source schema에 v0 즉시 필드 추가
  - PUB-1A 단계: publication preflight 6th warning 활성화 (ADR-0015
    INV-0015-7과 연결)
  - ADR-0020: metrics framework에 v0 3개 / v1 2개 / v2+ 2개 분배
  - Q-029: ImpactAssessment v0 embedded vs v1 노드 finalize
  - Q-030: counterclaim multi-relation v1 도입 우선순위

## References

- ideation 출처: Round 23 (사용자 발의 + Claude 답변 + GPT 양방향 framing
  정교화), Round 24 (자체 audit + R23-focused 정정), Round 25 (GPT 메타
  재검토 — 4축 병렬 + target별 분리 + stance/market_stance + EvidencePack
  다층 + one_sided_warning_rate)
- 관련 ADR: ADR-0009, ADR-0011, ADR-0013, ADR-0015, ADR-0016, ADR-0017,
  ADR-0020
