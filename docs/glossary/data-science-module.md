---
id: glossary-data-science-module
type: glossary_term
term: data_science_module
term_type: capability
defined_in: ADR-0024
last_changed_by: DEC-010
status: active
created_at: 2026-05-19
updated_at: 2026-05-19
aliases:
  - Data Science Module
  - DSM
detect_patterns:
  - "(?i)data[\\s_-]+science[\\s_-]+module"
related_invariants:
  - INV-0023-6
provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true

applies_to_planes:
  - pipeline.extraction_layer.dataset
  - pipeline.extraction_layer.derived_metric_computer
  - pipeline.dossier_composer.dataset_input
forbidden_paths:
  - pipeline.llm_routing.raw_dataset_to_llm  # 1000+ rows / 50KB+ dataset 의 LLM raw 입력 금지
---

# data_science_module

## Definition

`data_science_module` (ADR-0024) 은 대형 dataset (≥ 1000 rows 또는 ≥ 50KB raw
payload) 을 LLM 입력 직전에 **deterministic 으로 처리** 하여 derived metric
으로 변환하는 모듈이다. raw dataset 을 LLM 에 직접 입력하는 것은 금지 (INV-
0023-6) — 모든 대형 dataset 은 본 module 을 통과한 derived metric (summary
statistics / aggregations / chart-ready series) 만 LLM 입력으로 허용된다.

## Why this term exists

DEC-010 (LLM routing v2 + cost discipline) 에서 ADR-0023 INV-0023-6 의 enforce
mechanism 으로 lock 됐다. LLM API 의 raw token 비용 + 비결정성 + 컨텍스트 한계
때문에 대형 dataset 을 raw 로 입력하면 (a) 비용 폭증, (b) reproducibility
손실, (c) hallucination 위험 증가가 발생한다. Data Science Module 은 raw →
derived 변환을 deterministic 코드로 수행하여 세 risk 를 동시에 차단한다.

enforcement scope (DEC-010 lock):

- value: `mandatory_for_dataset_over_1000_rows_or_50kb`
- raw payload 측정 기준: rows ≥ 1000 OR raw bytes ≥ 50 KB.

## Examples

- 긍정 예: FRED API 의 macro time series (2000 rows × 5 columns) 을 dossier
  composer 에 입력하려 할 때 → Data Science Module 이 chart-ready summary
  metric (slope / volatility / regime shift indicator) 으로 변환 후 LLM 에
  derived metric 만 전달.
- 긍정 예: KOSIS 통계 dataset 500 rows × 12 columns (≥ 50KB raw) → DSM
  통과 의무.
- 부정 예: 200 rows × 5 columns (< 1000 rows, < 50KB) → DSM 우회 허용
  (raw 입력 가능).
- 부정 예: DSM 미경유 raw 1500 rows dataset 을 thesis composer 에 직접
  전달 — INV-0023-6 위반, fail-closed.

## Drift history

- 2026-05-19 ADR-0024 — Data Science Module 신설 (deterministic dataset
  processing for LLM input).
- 2026-05-19 DEC-010 — enforcement: `mandatory_for_dataset_over_1000_rows_or_50kb`
  lock (INV-0023-6).
