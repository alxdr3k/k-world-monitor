---
id: adr-0020
type: adr
title: System metrics framework — 6 categories + evaluation harness (staged v0/v1/v2)
status: accepted
created_at: 2026-05-11
updated_at: 2026-05-11
deciders: [user, claude-opus-4-7, gpt]
supersedes: []
superseded_by: []

scope:
  in:
    - storage.sqlite.metrics_run
    - storage.sqlite.metrics_daily
    - storage.sqlite.metric_alerts
    - storage.sqlite.evaluation_runs
    - storage.sqlite.evaluation_cases
    - storage.sqlite.retrieval_pack_metrics
    - pipeline.metrics_framework
    - pipeline.metrics_framework.data_quality
    - pipeline.metrics_framework.operational_perf
    - pipeline.metrics_framework.policy_safety
    - pipeline.metrics_framework.content_production
    - pipeline.metrics_framework.traceability
    - pipeline.metrics_framework.system_health
    - pipeline.evaluation_harness
  out:
    - storage.sqlite.policy_learning_events  # policy learning은 ADR-0021
    - pipeline.evidence_pack                  # evidence pack section은 ADR-0019

invariants:
  - id: INV-0020-1
    statement: 6 카테고리 metrics — (1) 데이터 품질, (2) 운영 성능, (3) Policy·safety, (4) 콘텐츠 production, (5) 추적성, (6) 시스템 건강. 매 pipeline run 후 metrics_run 기록 + 일별 metrics_daily aggregation (R15/Q10-3 Claude 6 카테고리 + GPT evaluation harness 통합)
    status: active
  - id: INV-0020-2
    statement: v0 측정 metrics 6+α — unsupported_sentence_rate (publication preflight 부산물), counterclaim_presence_rate (scenario_validate 부산물), stale_violation_rate, policy_block_count, manual_claim_entry_rate, db_size_growth_rate + R19 bidirectional 3개 (upside_claim_presence_rate, downside_claim_presence_rate, one_sided_warning_rate)
    status: active
  - id: INV-0020-3
    statement: v1 추가 metrics — retrieval_recall@k (gold query set 필요), source_diversity_score, opposing_evidence_coverage, mitigation_coverage, amplification_coverage, repeat_violation_rate, policy_rule_hit_rate, manual_workflow_success_rate, override_rate, false_positive/negative_policy_rate (ADR-0021 policy learning 5개 통합)
    status: active
  - id: INV-0020-4
    statement: v2+ 추가 metrics — pack_stability (동일 query 반복 시 overlap), human_correction_rate, upside_signal_recall, downside_signal_recall, asymmetric_impact_coverage
    status: active
  - id: INV-0020-5
    statement: evaluation harness (evaluation_runs / evaluation_cases / retrieval_pack_metrics)는 gold query set 기반 평가. v1에서 retrieval_recall@k 측정 활성화
    status: active
  - id: INV-0020-6
    statement: 대시보드는 v0 CLI report (markdown/CSV) → v1 static HTML (Cloudflare Pages 또는 GitHub Pages) → v2 알림 webhook 단계화

preconditions:
  - id: PRE-0020-1
    statement: run_ledger (ADR-0006) 도입 — metrics_run의 anchor
  - id: PRE-0020-2
    statement: ADR-0015 publication preflight 5종 / ADR-0009 scenario_validate / ADR-0019 bidirectional 측정 hook
  - id: PRE-0020-3
    statement: ADR-0021 policy_learning_events — 5 metrics 측정 hook

defines: []

invariant_review:
  status: pending
  reviewed_at: null
  fingerprint: null
unresolved_warnings: []
reviewed_terms:
  - claim
  - scenario
  - thesis
  - publication
  - access_intervention
  - manual_claim_entry
  - policy_gate
reviewed_scopes:
  - storage.sqlite.metrics_run
  - storage.sqlite.metrics_daily
  - storage.sqlite.metric_alerts
  - storage.sqlite.evaluation_runs
  - storage.sqlite.evaluation_cases
  - storage.sqlite.retrieval_pack_metrics
  - pipeline.metrics_framework
  - pipeline.metrics_framework.data_quality
  - pipeline.metrics_framework.operational_perf
  - pipeline.metrics_framework.policy_safety
  - pipeline.metrics_framework.content_production
  - pipeline.metrics_framework.traceability
  - pipeline.metrics_framework.system_health
  - pipeline.evaluation_harness
  - storage.sqlite.policy_learning_events
  - pipeline.evidence_pack

provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true
---

# ADR-0020: System metrics framework

## Status

accepted — 2026-05-11

## Context

ideation Round 15/Q10-3 — 시스템 성능 지표 관리는 주요 설계로 들어가야. Claude
6 카테고리 + GPT evaluation harness 4 카테고리(retrieval/synthesis/policy/cost-
latency) 통합. R23/R25 bidirectional framing metrics 추가. ADR-0021 policy
learning 5 metrics 통합.

## Decision

**6 카테고리 metrics**:

| 카테고리 | v0 / v1 / v2+ |
|---|---|
| 데이터 품질 | unsupported_sentence_rate / counterclaim_presence_rate / stale_violation_rate (v0) + opposing_evidence_coverage / mitigation_coverage / amplification_coverage (v1) |
| 운영 성능 | 검색 latency p95 (NFR-001 검증) / extract throughput / batch_api_hit_rate (v0) + retrieval_recall@k / source_diversity_score (v1) + pack_stability (v2+) |
| Policy / safety | policy_block_count / manual_claim_entry_rate (v0) + repeat_violation_rate / policy_rule_hit_rate / manual_workflow_success_rate / override_rate / fp_fn_policy_rate (v1, ADR-0021) |
| 콘텐츠 production | scenario→thesis rate / time_to_publication / publication_correction_rate (v0) + thesis_polarity_distribution (v1) |
| 추적성 | trace_depth_avg / trace_depth_p95 / NFR-003 5-step 위반 비율 (v0) |
| 시스템 건강 | db_size_growth_rate / r2_storage_growth / vault_sync_lag / LLM_provider_availability / Neo4j_uptime (v0) |
| Bidirectional (ADR-0019) | upside_claim_presence_rate / downside_claim_presence_rate / one_sided_warning_rate (v0) + upside_signal_recall / downside_signal_recall / asymmetric_impact_coverage (v2+) |

**Schema** (SQLite):

```sql
metrics_run (
  metric_run_id text primary key,
  run_id text not null,          -- FK to run_ledger
  category text not null,        -- 데이터 품질 | 운영 성능 | ...
  metric_name text not null,
  metric_value real not null,
  measured_at text not null,
  context_json text
);

metrics_daily (
  date text not null,
  metric_name text not null,
  metric_value real not null,
  sample_count integer not null,
  primary key (date, metric_name)
);

metric_alerts (
  alert_id text primary key,
  metric_name text not null,
  threshold real not null,
  triggered_at text not null,
  resolved_at text,
  notes text
);

evaluation_runs (
  evaluation_run_id text primary key,
  gold_query_set_id text not null,
  started_at text not null,
  completed_at text,
  total_cases integer,
  pass_rate real
);

evaluation_cases (
  case_id text primary key,
  evaluation_run_id text not null references evaluation_runs(evaluation_run_id),
  query text not null,
  expected_claims_json text,
  retrieved_claims_json text,
  pack_metrics_json text,
  pass boolean
);

retrieval_pack_metrics (
  pack_metric_id text primary key,
  evaluation_run_id text not null,
  case_id text not null,
  recall_at_k real,
  diversity_score real,
  bidirectional_balance real,
  stability_score real
);
```

**Dashboard 단계화**:
- v0: CLI `pipeline metrics report --since YYYY-MM-DD` (markdown / CSV)
- v1: static HTML (Cloudflare Pages 또는 GitHub Pages)
- v2: 알림 webhook (metric_alerts threshold 초과 시)

**Measurement 시점**:
- per pipeline run: metrics_run 기록 (run_id anchor)
- daily: metrics_daily aggregation (cron / GitHub Actions)
- per evaluation: evaluation_runs / evaluation_cases (gold query set 갱신 후)

## Alternatives Considered

- **A** (chosen): 6 카테고리 + evaluation harness 통합 + per-run + daily +
  evaluation 3-layer schema + 단계화 dashboard
  - pros: data quality / retrieval / policy / production / trace / health
    포괄, gold query set 기반 retrieval recall 측정 가능
  - cons: schema 7개 테이블 + dashboard 3단계
- **B** (discarded — R15 GPT 4 카테고리): retrieval / synthesis / policy /
  cost-latency만
  - cons: system health / content production / 추적성 누락 (Claude push back —
    R15/Q10-3)
- **C** (discarded — Claude 6 카테고리 단독): evaluation harness 없이
  - cons: retrieval recall 측정 불가 — gold query set 필요

## Consequences

- 긍정:
  - 6 카테고리로 system health + content production + 추적성 + bidirectional
    framing + policy + retrieval 모두 커버
  - run-level / daily / evaluation 3-layer로 granularity 조정 가능
  - dashboard 단계화로 v0 부담 최소

- 부정 / trade-off:
  - 측정 자체의 비용 (특히 gold query set 작성 + LLM 비교는 LLM cost)
  - schema 7개 테이블 + alerts 운영 부담
  - v1 retrieval_recall@k는 gold query set 누적 필요

- 후속 작업:
  - INFRA-1B.7 (신설): metrics_run + metrics_daily 기록 hook (publication
    preflight / scenario_validate / build_evidence_pack 부산물로)
  - INFRA-1B.8 (신설): CLI `pipeline metrics report` (markdown/CSV 출력)
  - EVAL-1A (신설): gold query set 작성 + evaluation harness v1 슬라이스

## References

- ideation 출처: Round 15/Q10-3 (Claude 6 카테고리 + GPT evaluation harness
  통합), Round 23/R25 (bidirectional metrics 추가), Round 14/Q9-3 (evidence
  pack 측정 지표 단계화 v0/v1/v2)
- 관련 ADR: ADR-0006, ADR-0009, ADR-0015, ADR-0019, ADR-0021
