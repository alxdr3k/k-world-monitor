---
id: glossary-cross-vendor-reviewer
type: glossary_term
term: cross_vendor_reviewer
term_type: capability
defined_in: ADR-0023
last_changed_by: DEC-010
status: active
created_at: 2026-05-19
updated_at: 2026-05-19
aliases:
  - cross-vendor reviewer
  - cross_vendor_review
detect_patterns:
  - "(?i)cross[\\s_-]+vendor[\\s_-]+review(?:er)?"
related_invariants:
  - INV-0023-4
provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true

applies_to_planes:
  - pipeline.publication_layer.preflight_cite_check
  - pipeline.scenario_layer.validate
  - pipeline.thesis_layer.high_stakes_review
forbidden_paths:
  - pipeline.cross_vendor_review.beyond_locked_3_stages  # INV-0023-4 — 3 단계 외 cross-vendor 의무 X
---

# cross_vendor_reviewer

## Definition

`cross_vendor_reviewer` 는 LLM routing v2 (ADR-0023) 의 cross-vendor review
강제 단계에서 사용되는 reviewer 역할의 모델을 가리킨다. 한 vendor 가 생성한
출력을 다른 vendor 의 reviewer 모델이 검토하여 single-vendor blind spot
(hallucination / domain bias / cite check accuracy 편향) 을 차단한다.

cross-vendor review 강제는 ADR-0023 INV-0023-4 에 의해 **3 종 단계로 한정**:

1. `publication_preflight_cite_check_overclaim` — Tier 3 cross-vendor:
   OpenAI GPT-5 nano (generator) → Anthropic Claude Haiku 4.5 (reviewer).
2. `scenario_validate_adversarial_pass` — Tier 0 cross-vendor: OpenAI
   GPT-5.5 Pro extended thinking (generator) → Anthropic Claude Opus 4.7
   xhigh effort (reviewer).
3. `operator_flagged_high_stakes_thesis` — Tier 0 cross-vendor: same as (2).

## Why this term exists

DEC-010 (LLM routing v2 + cost discipline) 에서 ADR-0023 INV-0023-4 의
enforcement scope 를 lock 했다. cross-vendor review 의 cost 부담 때문에
모든 단계에 적용할 수 없으므로 (NFR-004 cost ceiling 충돌) "고위험 / 발행
경계 / 시나리오 검증" 3 단계만 강제하고, article extract / dossier 합성 /
EvidencePack / 일반 thesis 는 cross-vendor 의무 X — manual review +
deterministic 검증 (quote substring 등) 만 적용 한다.

enforcement scope (DEC-010 lock):

- value: `[publication_preflight_cite_check_overclaim, scenario_validate_adversarial_pass, operator_flagged_high_stakes_thesis]`
- reason: INV-0023-4 의 3 종 lock — 비용 충돌로 그 외 단계 cross-vendor 의무화 X.

## Examples

- 긍정 예: blog_long publication 발행 직전, GPT-5 nano cite check overclaim
  judge 가 생성한 verdict 를 Claude Haiku 4.5 가 cross-review → 두 vendor
  모두 OK 일 때만 발행 진행.
- 긍정 예: scenario validate adversarial pass 단계에서 GPT-5.5 Pro extended
  thinking 가 시나리오를 작성하면 Claude Opus 4.7 xhigh 가 adversarial
  reviewer 로 통과 여부 판정.
- 부정 예: article extract 에 cross-vendor reviewer 강제 적용 — INV-0023-4
  scope 외, NFR-004 cost ceiling 위반 위험. manual review + quote substring
  검증으로 충분.
- 부정 예: high-stakes thesis 인데 cross-vendor reviewer 우회 — 운영자
  flag 가 있는 high-stakes thesis 는 (3) lock 으로 cross-vendor 의무.

## Drift history

- 2026-05-19 ADR-0023 — cross_vendor_reviewer 개념 신설 (INV-0023-4 cross-vendor review 강제 단계 3 종 lock).
- 2026-05-19 DEC-010 — enforcement_scope value: `[publication_preflight_cite_check_overclaim, scenario_validate_adversarial_pass, operator_flagged_high_stakes_thesis]` lock.
