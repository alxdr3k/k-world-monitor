---
id: glossary-access-intervention
type: glossary_term
term: access_intervention
term_type: capability
defined_in: ADR-0017
last_changed_by: ADR-0017
status: active
created_at: 2026-05-11
updated_at: 2026-05-11
aliases:
  - 접근 차단 보고
  - access block report
detect_patterns:
  - "(?i)access\\s+intervention"
  - "(?i)block\\s+report"
related_invariants:
  - INV-0017-2
  - INV-0017-3
  - INV-0017-6
  - INV-0017-7
  - INV-0015-6
  - INV-0018-5
provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true

applies_to_planes:
  - pipeline.policy_gate
  - storage.neo4j.access_intervention_node
  - cli.pipeline_intervention_review
forbidden_paths:
  - storage.r2.bytes              # AccessIntervention은 메타 ledger, raw bytes 미보관
  - pipeline.extraction_layer.routing  # extraction은 별도 단계
---

# access_intervention

## Definition

`AccessIntervention`은 시나리오/콘텐츠 탐색·제작 중 막힌 source의 누적 record
다 (ADR-0017). policy_gate의 mode가 `batch_report`일 때 inline block 대신
이 노드에 기록된다. 세션 종료 시 batch 보고로 사용자가 검토하고 3-option
(ignore / manual_claim / temp_text)으로 후속 조치한다 (ADR-0018).

필드:
- url, source_name, attempted_action, access_result (blocked / paywalled /
  bot_protected / terms_unclear / 404), policy_result (manual_only /
  metadata_only / excluded)
- related_query, why_it_matters, importance_score (0~1)
- **severity** (LOW / MEDIUM / HIGH / CRITICAL) — 자동 산정 default
  deterministic (keyword overlap with scenario.assumptions[] / 명시적
  related_assumption_ids), LLM 옵션 default off
- fallback_used_json, requested_user_action
- status (pending_user_review / resolved / ignored)

## Why this term exists

Round 18 사용자 발의 + GPT 정교화 흡수. policy_gate가 모든 단계에서 inline
block / warn으로만 작동하면 시나리오 탐색·콘텐츠 제작의 흐름이 매번 깨진다.
batch_report mode는 탐색 흐름을 유지하면서 막힘을 누적해 사용자가 일괄 검토
가능하게 만든다.

ADR-0015 cite check 5번째 block은 이 노드를 참조한다 — unresolved HIGH/CRITICAL
access_intervention은 publication의 핵심 근거로 사용 금지.

## Examples

- 긍정 예: WSJ paywalled 기사 fetch 시도 → access_result=paywalled,
  severity=MEDIUM (scenario assumption keyword overlap 있음), status=pending →
  사용자가 `pipeline intervention review aci_001` 실행 → manual_claim 선택 →
  Tier C manual fallback
- 긍정 예: 시나리오 핵심 assumption의 근거가 막힘 → severity=CRITICAL →
  사용자가 manual_claim으로 객관적 사실만 입력 → ADR-0015 cite check 5번째
  block에 의해 이 intervention은 resolved 표시 후 publication 진입 허용
- 부정 예: 모든 막힘을 LLM으로 자동 severity 산정 → API cost 폭증 (R24
  자체 audit). default deterministic.
- 부정 예: batch_report 안에 위험 행동(raw cache / cloud upload) 포함 → 위험
  행동은 어느 mode에서도 inline_block 유지 (INV-0017-4)

## Drift history

- 2026-05-11 ADR-0017 — access_interventions 객체 신설 (Round 18 GPT 정교화
  흡수). 처음에는 exploration_block_reports로 명명됐으나 severity / importance
  / why_it_matters 필드 추가하며 access_interventions로 격상.
