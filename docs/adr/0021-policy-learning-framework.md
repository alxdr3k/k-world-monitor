---
id: adr-0021
type: adr
title: Policy learning framework — rule-based, auto-tighten allowed, auto-relax prohibited (staged v0-v3 patterns)
status: accepted
created_at: 2026-05-11
updated_at: 2026-05-11
deciders: [user, claude-opus-4-7, gpt]
supersedes: []
superseded_by: []

scope:
  in:
    - storage.sqlite.policy_learning_events
    - storage.sqlite.source_policy_rules
    - storage.sqlite.research_session
    - storage.sqlite.raw_cache_items
    - pipeline.policy_learning
    - pipeline.policy_learning.pattern_1_source_refinement
    - pipeline.policy_learning.pattern_2_domain_rule
    - pipeline.policy_learning.pattern_3_anomaly
    - pipeline.policy_learning.pattern_4_llm_suggestion
    - pipeline.policy_learning.pattern_5_negative
  out:
    - pipeline.policy_gate                  # policy gate는 ADR-0017
    - pipeline.metrics_framework            # metrics는 ADR-0020

invariants:
  - id: INV-0021-1
    statement: Policy learning은 rule-based다. ML fine-tuning 학습은 도입하지 않는다 — 1인 프로젝트 데이터 부족 + audit 어려움 (R15/Q10-4 Claude 결정)
    status: active
  - id: INV-0021-2
    statement: 학습 방향은 "auto-tighten allowed, auto-relax prohibited"다. 보수화(예: 3회 연속 manual → 기본값 manual) 자동 적용 / 완화 방향은 항상 사용자 명시 승인 + 추가 정보(terms_url, license_url) 입력 요구 (R15/Q10-4 GPT 원칙)
    status: active
  - id: INV-0021-3
    statement: 5 pattern 단계화 — v0 Pattern 1 (source policy refinement) / v1 Pattern 2 (domain-level rule, e.g., *.ft.com N회 paywalled → rule 제안) / v2 Pattern 3 (anomaly detection) + Pattern 5 (negative learning) / v3 옵션 Pattern 4 (LLM-based suggestion)
    status: active
  - id: INV-0021-4
    statement: 모든 학습 결정은 policy_learning_events ledger에 audit 가능하게 기록한다. user_action / proposed_rule / rule_accepted 필드 필수. 자동 적용 X — 항상 사용자 승인 (보수화 방향도 propose만, accept는 사용자)
    status: active
  - id: INV-0021-5
    statement: source_policy_rules는 active=true일 때만 적용된다. 잘못된 rule은 자동 demote (source_count 차감, 임계치 미만이면 active=false)
    status: active
  - id: INV-0021-6
    statement: research_session + raw_cache_items 객체는 정책 학습과 독립한 RAG infrastructure다. raw_cache_items는 indexed=false / embedded=false / TTL 24h~7d / finalize 또는 abandon 시 즉시 삭제 (R13/Q8)

preconditions:
  - id: PRE-0021-1
    statement: ADR-0017 policy_decisions ledger 도입 (policy_learning_events의 anchor)
  - id: PRE-0021-2
    statement: ADR-0018 manual_claim_entries 도입 (Pattern 1 / Pattern 5의 hook)
  - id: PRE-0021-3
    statement: ADR-0016 source_perspective tag — Pattern 2 domain-level rule이 perspective와 충돌 안 하는지 검증

defines:
  - term: policy_learning_event
    role: primary
  - term: source_policy_rule
    role: primary

invariant_review:
  status: pending
  reviewed_at: null
  fingerprint: null
unresolved_warnings: []
reviewed_terms:
  - source
  - policy_gate
  - access_intervention
  - manual_claim_entry
  - archive_policy
  - raw_cloud_policy
reviewed_scopes:
  - storage.sqlite.policy_learning_events
  - storage.sqlite.source_policy_rules
  - storage.sqlite.research_session
  - storage.sqlite.raw_cache_items
  - pipeline.policy_learning
  - pipeline.policy_learning.pattern_1_source_refinement
  - pipeline.policy_learning.pattern_2_domain_rule
  - pipeline.policy_learning.pattern_3_anomaly
  - pipeline.policy_learning.pattern_4_llm_suggestion
  - pipeline.policy_learning.pattern_5_negative
  - pipeline.policy_gate
  - pipeline.metrics_framework

provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true
---

# ADR-0021: Policy learning framework

## Status

accepted — 2026-05-11

## Context

ideation Round 15/Q10-4 — 사용자 발의: "policy에 의해 걸려졌고 내가 조치한
경우, 그 데이터를 파이프라인이 학습해서 다음에는 같은 실수를 안 하도록 만들
수 있나?"

Claude 답변: Rule-based 학습 (ML 학습 X). 5 pattern 단계화. GPT 답변: "auto-
tighten allowed, auto-relax prohibited" 원칙 + 5 policy learning metrics +
rule_candidate generation → confirm 후 active 절차 명시. 두 답변 통합.

또한 R13/Q8에서 도입한 research_session + raw_cache_items 객체를 본 ADR로
flexibility 흡수 (raw_cache_items는 ADR-0018 intervention review 3-option의
temp_text가 흡수).

## Decision

**5 pattern 단계화**:

| Pattern | 동작 | 단계 |
|---|---|---|
| 1. Source policy refinement | 수동 결정 → 같은 source 자동 적용 제안. 사용자가 한 source의 archive_policy를 metadata_only로 명시 → 같은 source의 미래 fetch에서 자동 적용 | v0 |
| 2. Domain-level rule | `*.ft.com` N회 paywalled → 도메인 단위 rule 제안 (사용자 confirm 필요) | v1 |
| 3. Anomaly detection | 피드백 루프 — 같은 source가 갑자기 다른 정책 결과를 내면 alert | v2 |
| 4. LLM-based suggestion | LLM이 source 약관/robots/license를 읽고 policy 제안 (사용자 confirm 필수) | v3 옵션 |
| 5. Negative learning | manual 품질 > 자동 → extraction_confidence 자동 ↓ + reviewer queue priority ↑ | v2 |

**원칙** (R15/Q10-4 GPT):
- **auto-tighten allowed** — 보수화 방향(metadata_only / manual_review_required
  / prohibited) 자동 propose
- **auto-relax prohibited** — 완화 방향(excerpt_only / allowed_public_data_only
  / allowed)은 항상 사용자 명시 승인 + 추가 정보(terms_url, license_url) 입력
  요구
- 모든 학습 결정 audit 가능 — policy_learning_events ledger
- 자동 적용 X — propose만, accept는 사용자

**Schema** (SQLite):

```sql
policy_learning_events (
  event_id text primary key,
  policy_decision_id text references policy_decisions(decision_id),
  user_action text not null,            -- ignore | manual_claim | temp_text | override (ADR-0018 3-option + override)
  pattern text not null,                -- pattern_1 | pattern_2 | pattern_3 | pattern_5
  proposed_rule_id text references source_policy_rules(rule_id),
  rule_accepted boolean,
  created_at text not null
);

source_policy_rules (
  rule_id text primary key,
  pattern text not null,                  -- pattern_1 | pattern_2 | etc.
  applies_to_field text not null,         -- archive_policy | raw_cloud_policy | external_llm_policy
  match_pattern text not null,            -- source_id 또는 URL pattern (`*.ft.com`)
  rule_value text not null,               -- enum value
  source_count integer not null,          -- 이 rule을 트리거한 history
  created_from text not null,             -- policy_learning_event.event_id
  active boolean not null default false,  -- confirm 후 true
  terms_url text,                          -- 완화 방향 rule은 필수
  license_url text,
  confirmed_at text,
  demoted_at text
);

research_session (
  session_id text primary key,
  scenario_id text,
  thesis_id text,
  status text not null,                   -- active | finalized | abandoned
  raw_cache_expires_at text,
  created_at text not null
);

raw_cache_items (
  cache_id text primary key,
  session_id text not null references research_session(session_id),
  url text not null,
  content_hash text,
  indexed boolean not null default false,
  embedded boolean not null default false,
  expires_at text not null,
  deleted_at text
);
```

**Pattern 1 workflow 예** (v0):
1. 사용자가 `pipeline intervention review aci_001`에서 `ignore` 선택
2. policy_learning_events 기록 — pattern=pattern_1, proposed_rule=`source_id=src_xyz
   → importance_score ↓`
3. 사용자가 같은 source_id 3회 ignore → source_policy_rules에 rule_candidate
   생성 (active=false)
4. 다음 trigger 시 시스템 prompt: "이 source 4회 ignore. importance_score
   default를 LOW로 두시겠습니까? (y/n)"
5. 사용자 y → rule 활성 (active=true), 보수화 방향(LOW)이라 terms_url 입력
   불요. 완화 방향이었으면 입력 필수.

**Pattern 5 negative learning** (v2):
- manual_claim_entries에서 사용자가 user_written_claim을 작성 → 같은 URL의
  과거 자동 extraction의 extraction_confidence와 비교
- manual 품질이 자동보다 systematically 높으면 (예: 5회 연속 차이) → 자동
  extraction의 extraction_confidence threshold 자동 ↓
- ADR-0006 auto-confirm threshold(0.85)에 적용 — 같은 source는 더 보수적

**Policy learning metrics 5개** (ADR-0020에 통합):
- repeat_violation_rate
- policy_rule_hit_rate
- manual_workflow_success_rate
- override_rate
- fp_fn_policy_rate

## Alternatives Considered

- **A** (chosen): rule-based 5 pattern 단계화 + auto-tighten/auto-relax 원칙
  + policy_learning_events ledger
  - pros: 1인 프로젝트 운영 가능, audit 명확, 잘못된 rule auto-demote
  - cons: ML 학습 가능성 포기 (데이터 부족이라 unproblematic)
- **B** (discarded — R15/Q10-4 초안): ML fine-tuning 학습
  - cons: 1인 데이터 부족 + audit 어려움 (R15/Q10-4 Claude push back)
- **C** (discarded — R15 GPT 초안): graph DB 안에서 policy도 graph로
  - cons: Policy는 multi-hop 객체 아님 — R16/Q11-3 GPT 본인이 철회

## Consequences

- 긍정:
  - 사용자 결정이 누적되어 같은 실수 반복 차단
  - 보수화는 자동 propose / 완화는 사용자 명시 — 안전 default
  - policy_learning_events / source_policy_rules로 audit 명확
  - jcorrelation rules + research_session / raw_cache_items로 R13 RAG
    infrastructure와 통합

- 부정 / trade-off:
  - rule_candidate confirm UX 필요 — CLI prompt 부담
  - source_count 임계치(자동 demote)는 운영 데이터로 보정
  - Pattern 4 LLM-based는 LLM cost 발생 → v3 옵션

- 후속 작업:
  - INFRA-1B.9 (신설): policy_learning_events / source_policy_rules /
    research_session / raw_cache_items 스키마 + Pattern 1 v0 워크플로우
  - INFRA-1B.10 (신설): raw_cache_items TTL worker (24h~7d delete) +
    finalize/abandon hook
  - ADR-0020: policy learning 5 metrics 통합 (이미 INV-0020-3)

## References

- ideation 출처: Round 13/Q8 (research_session + raw_cache_items), Round 15/
  Q10-4 (Claude 5 pattern + GPT auto-tighten 원칙 + 5 metrics 통합)
- 관련 ADR: ADR-0006, ADR-0016, ADR-0017, ADR-0018, ADR-0020
