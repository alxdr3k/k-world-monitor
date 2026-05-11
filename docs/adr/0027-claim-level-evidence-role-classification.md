---
id: adr-0027
type: adr
title: Claim-level evidence_role 분류 — source-level perspective 와 독립 차원 도입 (Dossier composer 강화)
status: accepted
created_at: 2026-05-11
updated_at: 2026-05-11
deciders: [user]
supersedes: []
superseded_by: []

scope:
  in:
    - pipeline.aggregation_layer.dossier_composer
    - pipeline.aggregation_layer.evidence_pack
    - storage.neo4j.claim_node.evidence_role
  out:
    - pipeline.source_layer.source_perspective
    - pipeline.thesis_layer.composer

invariants:
  - id: INV-0027-1
    statement: Dossier 합성 시 각 promoted Claim 은 thesis 후보 별로 `evidence_role` 분류 의무 — enum 6 종: `supporting_evidence` / `opposing_evidence` / `mitigating_factor` / `amplifying_factor` / `monitoring_signal` / `base_rate_context`. 동일 Claim 이 thesis A 에서는 `supporting`, thesis B 에서는 `opposing` 가능 — evidence_role 은 (Claim, Thesis_candidate) 쌍 의 속성.
    status: active
  - id: INV-0027-2
    statement: source-level `source_perspective` (ADR-0019, REQ-022) 와 claim-level `evidence_role` 은 **독립 차원**. source_perspective = seed 분포 균형 metric (REQ-022 / AC-027) 용, evidence_role = Dossier 합성 + EvidencePack 구조 용. 동일 source (예 IMF, opportunity_observer) 도 claim 단위로 supporting / opposing / monitoring 모두 낼 수 있음.
    status: active
  - id: INV-0027-3
    statement: EvidencePack v0 4-section (REQ-023, ADR-0019) 는 evidence_role 의 grouping — section 1 = supporting_evidence, section 2 = opposing_evidence, section 3 = mitigating_factor + amplifying_factor 합집합, section 4 = monitoring_signal. base_rate_context 는 EvidencePack 시작부 컨텍스트 section 으로 (REQ-023 본문은 4-section 그대로, base_rate_context 는 EvidencePack header 의 context blob 으로).
    status: active
  - id: INV-0027-4
    statement: Dossier composer 가 각 thesis 후보에 대해 **minimum coverage 의무**: supporting_evidence ≥ 3 claim + opposing_evidence ≥ 2 claim + monitoring_signal ≥ 3 claim. 미달 시 Dossier reject (manual review queue 진입). polarity-symmetric counterclaim (ADR-0009 INV-0009-1) 의 운영자 강제 UX 구현.
    status: active
  - id: INV-0027-5
    statement: evidence_role 분류는 Dossier composer LLM (Tier 2 default GPT-5 mini, ADR-0023 / DEC-010) 이 propose + 운영자 manual review (Dossier curated view) 로 lock. LLM 자동 분류는 운영자 review 없이 promoted claim 으로 진입 X.
    status: active
  - id: INV-0027-6
    statement: evidence_role enum 의 의미:
      - `supporting_evidence`: thesis 의 핵심 주장을 직접 뒷받침
      - `opposing_evidence`: thesis 와 반대 방향의 증거 (counterclaim, polarity-symmetric)
      - `mitigating_factor`: thesis 의 effect 를 완화 / 약화 (예 정부 개입, 자동 stabilizer)
      - `amplifying_factor`: thesis 의 effect 를 강화 / 가속 (예 cascade, feedback loop)
      - `monitoring_signal`: thesis 의 진행/반전 을 향후 추적할 수 있는 leading indicator
      - `base_rate_context`: thesis 와 독립적이지만 독자가 thesis 를 이해하는 데 필요한 baseline (예 한국 GDP 대비 가계부채 비율 1990~2025 추이)
    status: active

preconditions:
  - id: PRE-0027-1
    statement: Neo4j Claim 노드 schema 에 `evidence_role` 필드 추가 — 단 (Claim, Thesis_candidate) 쌍 의 속성이므로 Neo4j `:EVIDENCE_FOR` relationship 의 속성 으로 저장 (relationship.evidence_role). INFRA-1A.2 migration 에 포함.
  - id: PRE-0027-2
    statement: Dossier composer (AGG-1A.1) LLM prompt 에 evidence_role enum 6 종 + 분류 기준 + minimum coverage 룰 명시. 운영자 review CLI (`pipeline dossier curate`) 가 evidence_role lock UI 제공.

defines:
  - term: evidence_role
    role: primary
  - term: supporting_evidence
    role: primary
  - term: opposing_evidence
    role: primary
  - term: mitigating_factor
    role: primary
  - term: amplifying_factor
    role: primary
  - term: monitoring_signal
    role: primary
  - term: base_rate_context
    role: primary
  - term: dossier
    role: extends
  - term: evidence_pack
    role: extends

invariant_review:
  status: pending
  reviewed_at: null
  fingerprint: null
unresolved_warnings: []
reviewed_terms:
  - claim
  - dossier
  - thesis
  - source_perspective
  - evidence_quote
reviewed_scopes:
  - pipeline.aggregation_layer.dossier_composer
  - pipeline.aggregation_layer.evidence_pack
  - storage.neo4j.claim_node
  - storage.neo4j.edge.evidence_for

provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true
---

# ADR-0027: Claim-level evidence_role 분류

## Status

accepted — 2026-05-11

## Context

GPT 메타 리뷰 (2026-05-11) 의 데이터 품질 섹션 핵심 지적:

> source_perspective 가 source-level 이라는 점. IMF 를 opportunity_observer
> 로, BIS 를 risk_observer 로 라벨링하는 것은 seed 분포 관리에는 유용하지만,
> 실제 문서 단위·claim 단위에서는 같은 source 도 risk 와 opportunity 를 모두
> 냅니다. ... 콘텐츠 품질을 높이려면 나중에는 claim_perspective 또는
> evidence_role 도 필요해질 가능성이 큽니다.

본 repo 의 비판적 리뷰 = **수용 (강함)**. 이유:
- ADR-0019 의 source_perspective 는 분포 균형 metric (REQ-022 / AC-027)
  용도로는 적절하지만, Dossier 합성 시 같은 source 의 다른 claim 이
  supporting / opposing 모두 가능 → source-level 라벨만으로는 Dossier
  구조화 부족
- EvidencePack v0 4-section (REQ-023) 은 이미 supporting / opposing /
  mitigating·amplifying / monitoring 의 grouping 으로 정의 — claim-level
  evidence_role 분류와 자연 정합
- GPT 메타 리뷰의 1순위 병목 (운영자 thesis 판단) + 2순위 병목 (Dossier
  → Scenario 전환) 모두 evidence_role 분류 명시화로 보강

## Decision

### 1. evidence_role enum 6 종 (INV-0027-1, INV-0027-6)

| role | 정의 | 예시 (DEC-011 한국 부동산 폭락 시나리오) |
|---|---|---|
| `supporting_evidence` | thesis 핵심 주장 직접 뒷받침 | "가계부채 / GDP = 105% (BOK 2024Q4)" — 폭락 risk 의 stress factor |
| `opposing_evidence` | thesis 반대 방향 (counterclaim) | "정부 PF 대책 50조 투입 + 한은 금리 인하 검토" — 폭락 막는 개입 |
| `mitigating_factor` | thesis effect 완화 / 약화 | "수도권 vs 비수도권 decoupling — 수도권은 인구 유입 지속" |
| `amplifying_factor` | thesis effect 강화 / 가속 | "청년 영끌 코호트 LTV 70%+ → 가격 5% 하락 시 자산 0 cascade" |
| `monitoring_signal` | leading indicator | "월별 미분양 추이 / DSR 신규 대출 비율 / 가계대출 연체율" |
| `base_rate_context` | thesis 독립 baseline | "한국 가계부채 / GDP 비율 1990~2025 추이 (60% → 105%)" |

### 2. source_perspective vs evidence_role 두 차원

| 차원 | 적용 단위 | 적용 범위 | 용도 |
|---|---|---|---|
| **source_perspective** (ADR-0019) | source-level | Tier A seed universe 전체 (REQ-022 / AC-027 분포 균형) | seed 분포 metric, balance guardrail |
| **evidence_role** (본 ADR) | claim-level 또는 (Claim, Thesis_candidate) 쌍 | Dossier 합성 + EvidencePack 구조 | Dossier 구조 + 운영자 thesis 판단 framework |

두 차원은 **독립** (INV-0027-2):
- 같은 source (예 IMF, opportunity_observer) 의 다른 claim → supporting +
  opposing + monitoring 모두 가능
- 같은 claim 도 thesis A vs thesis B 에 대해 다른 role (예 "가계부채 105%"
  가 부동산 폭락 thesis 에 supporting, 부동산 회복 thesis 에 opposing)

### 3. EvidencePack v0 4-section 와의 매핑 (INV-0027-3)

REQ-023 의 4-section 그대로 + evidence_role grouping:
- section 1 (`supporting_evidence`): role = `supporting_evidence`
- section 2 (`opposing_evidence`): role = `opposing_evidence`
- section 3 (`mitigating·amplifying`): role ∈ {`mitigating_factor`,
  `amplifying_factor`}
- section 4 (`monitoring_signal`): role = `monitoring_signal`

추가:
- `base_rate_context` 는 EvidencePack 시작부 의 **context blob** (header
  section, v0 4-section 본문 X)

### 4. Dossier composer minimum coverage 의무 (INV-0027-4)

각 thesis 후보 1개에 대해:
- supporting_evidence ≥ **3 claim**
- opposing_evidence ≥ **2 claim** (polarity-symmetric counterclaim 강제)
- monitoring_signal ≥ **3 claim**
- mitigating / amplifying / base_rate_context = optional (단 운영자 권고:
  최소 1개씩)

미달 시 Dossier reject → manual review queue 진입. 운영자가 추가 claim
탐색 후 promoted.

GPT 메타 리뷰의 "Dossier 단계 운영자 강제 UX (가장 강한 반론 2개)" 권고
구현.

### 5. Neo4j schema

`:EVIDENCE_FOR` relationship (Claim → Thesis_candidate) 의 속성:
- `evidence_role` (enum, 6 종)
- `assigned_by` (`llm_propose` / `operator_lock`)
- `confidence` (0~1)

LLM (Dossier composer, Tier 2 GPT-5 mini, ADR-0023 / DEC-010) 이 propose
+ 운영자 manual review → operator_lock (INV-0027-5).

### 6. AC / TEST 신규

- **AC-044** (REQ-023 / ADR-0027): Given Dossier 합성. When 각 thesis
  후보별 evidence_role 분류 검사. Then supporting ≥ 3 / opposing ≥ 2 /
  monitoring ≥ 3 minimum coverage 충족 + 모든 :EVIDENCE_FOR relationship
  에 evidence_role + assigned_by = operator_lock (LLM-only 진입 차단)
- **TEST-044**: `tests/aggregation/dossier_evidence_role_test.ts`
  (planned) — fixture Dossier + minimum coverage 검증 + operator_lock
  enforcement
- REQ-023 (EvidencePack v0 4-section) 갱신 — 4-section 의 grouping
  기준이 claim.evidence_role 이라는 점 명시

## Consequences

- 긍정:
  - source_perspective (분포 균형) 와 evidence_role (Dossier 구조) 두
    차원 독립 → ADR-0019 의 source-level 라벨 유지 + Dossier 합성 품질 ↑
  - polarity-symmetric counterclaim 강제 UX (운영자 manual lock + minimum
    coverage) → GPT 메타 리뷰 1·2 순위 병목 (운영자 thesis 판단 + Dossier
    → Scenario 전환) 보강
  - EvidencePack v0 4-section 자연 매핑 (REQ-023) → schema migration 부담
    크지 않음
  - base_rate_context 분리 → 독자가 thesis 이전에 baseline 이해 가능
- 부정:
  - Neo4j `:EVIDENCE_FOR` relationship 의 속성 (evidence_role + assigned_by
    + confidence) 추가 → INFRA-1A.2 migration 부담
  - Dossier composer 의 LLM prompt 가 6 enum + minimum coverage 룰 포함 →
    prompt complexity ↑ (단 ADR-0023 strict schema 로 enforce 가능)
  - 운영자 manual review 의무 (operator_lock) → 1인 운영 attention cost ↑
  - 같은 claim 이 thesis A 에 supporting, thesis B 에 opposing 인 경우 →
    Neo4j 에 (Claim, Thesis_candidate, role) 3-tuple 로 저장 (relationship
    의 source 노드는 1개, target 은 thesis 후보별로 N 개)
- Follow-ups:
  - INFRA-1A.2 migration — `:EVIDENCE_FOR` relationship + evidence_role
    enum 추가
  - AGG-1A.1 (Dossier composer) — prompt 갱신 + minimum coverage 의무 +
    CLI `pipeline dossier curate` 의 operator_lock UI
  - REQ-023 (PRD) 갱신 — EvidencePack 4-section grouping 이 evidence_role
    기반
  - AC-044 + TEST-044 신규 (06_ACCEPTANCE_TESTS.md)
  - glossary `evidence-role.md` 신규
  - 신규 Q (Tone enum 또는 LLM judge 자동 분류 정책 v1+ — operator_lock 부담
    완화)

## References

- ADR-0019 (source_perspective, REQ-022, EvidencePack 4-section)
- ADR-0009 (counterclaim polarity-symmetric)
- ADR-0023 / DEC-010 (Dossier composer = Tier 2 GPT-5 mini default)
- ADR-0025 (EditorialIntent — Dossier 의 입력)
- DEC-011 (한국 부동산 폭락 시나리오 — evidence_role 적용 사례)
- DEC-012 (Editorial Quality Rubric — AC-036~042, 별도 commit)
- `docs/discovery/meta-review-2026-05-11-gpt-then-claude-critical.md`
