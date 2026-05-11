# 06 Acceptance Tests

요구사항이 만족되었는지 검증하는 기준.

Implementation status는 `04_IMPLEMENTATION_PLAN.md`가 관리한다. 이 문서는
gate / acceptance 상태만 관리한다.

## AC Format

각 AC는 다음 형태를 권장:

```text
Given <초기 상태>
When  <행동>
Then  <기대 결과>
```

## Criteria

| ID | REQ/NFR | 시나리오 | 검증 방법 | Status |
|---|---|---|---|---|
| AC-001 | REQ-001 | Given 신규 fetch된 Snapshot. When extractor가 claim을 추출. Then Document → Snapshot → Claim 3-tier에 row가 생기고 Dossier/Scenario/Draft/Publication 단계는 미생성 상태로 trace anchor가 보존된다 | manual + automated TEST-001 | defined |
| AC-002 | REQ-002 | Given Neo4j Community 인스턴스. When 1만 graph object(Claim + Snapshot + Source + Document + Edge) 적재. Then Neo4j native FTS keyword 검색 + 1-hop traversal이 cold cache p95 < 1초 (NFR-001, SPIKE-001) | TEST-002 (bench) | defined |
| AC-003 | REQ-003 | Given Snapshot row. When r2_key가 가리키는 객체를 fetch. Then sha256이 일치하고 mime이 일치한다 | TEST-003 | defined |
| AC-004 | REQ-004 | Given 1만 건 candidate claim. When 그 중 50건이 promoted. Then Markdown vault에는 50건만 존재하고 나머지는 SQLite에만 존재한다 | TEST-004 + manual | defined |
| AC-005 | REQ-005 | Given 신규 객체 생성. When ID 발급. Then 접두 + 단조 증가 식별자(`doc_/snap_/clm_/dos_/scn_/drf_/pub_/edge_/run_`) 규칙을 따른다 | TEST-005 | defined |
| AC-006 | REQ-006 | Given Document, Claim, Scenario row. When 단일 confidence 필드 검사. Then 어떤 row에도 단일 confidence 필드가 없고 reliability_tier / extraction_confidence / claim_status / scenario assumption weight가 분리되어 있다 | TEST-006 | defined |
| AC-007 | REQ-007 + NFR-005 | Given Claim row. When evidence quote 길이 검사. Then quote ≤ 200자 + locator + quote_hash가 모두 채워져 있다. 비면 invalid | TEST-007 | defined |
| AC-008 | REQ-008 | Given claim/scenario/publication frontmatter. When supports[]/contradicts[]/qualifies[] 배열 검색. Then 검색 결과 0건 (모든 관계는 edges 테이블) | TEST-008 (lint) | defined |
| AC-009 | REQ-009 | Given 신규 source type(article/dataset/report). When extractor 호출. Then article/report는 LLM 호출, dataset은 parser 경로로 분기한다 | TEST-009 | defined |
| AC-010 | REQ-010 | Given reliability_tier=high + extraction_confidence ≥ 0.85 claim. When extractor 결과 처리. Then auto-confirm으로 claim_status=confirmed, reviewer queue 미진입 | TEST-010 | defined |
| AC-011 | REQ-011 | Given 빈 repo. When 구현 순서대로 진행. Then 04_IMPLEMENTATION_PLAN의 INFRA → INFRA-1B → ... 순서대로 slice가 landed (역순 금지) | manual review | defined |
| AC-012 | REQ-012 | Given Scenario row. When scenario validate 호출. Then assumption weight / branch / falsifier / counterclaim / monitoring 누락 시 reject. 모두 채워졌을 때만 pass | TEST-012 | defined |
| AC-013 | REQ-013 | Given ContentDraft + 인용 claim. When cite check 호출. Then stale / retracted / horizon mismatch / unit mismatch / overclaim 5종을 모두 검사하고, 하나라도 fail이면 ContentDraft state=reviewing | TEST-013 | defined |
| AC-014 | REQ-014 | Given Scenario 변경. When 적용. Then scenario_revisions에 새 row가 append되고 in-place mutation이 발생하지 않는다. 이전 revision은 supersedes/updates edge로 lineage 유지 | TEST-014 | defined |
| AC-015 | REQ-015 | Given 신규 추출 100건 (mix of reliability + confidence). When review queue에 적재. Then auto-confirm 비율과 수동 review 큐 크기가 ADR-0006 INV-0006-4 룰과 일치 | TEST-015 | defined |
| AC-016 | REQ-016 | Given confirmed claim. When (a) snapshot 갱신 (b) 시간 경과 (c) counterclaim 등록 중 하나 발생. Then claim_status: confirmed → stale 전이 + 인용 ContentDraft/Publication에 cascade | TEST-016 | defined |
| AC-017 | NFR-002 | Given 동일 source set + scenario revision id. When 다른 운영자가 cite check + scenario validate 재실행. Then 동일 promoted claim set + 동일 branches 결론에 도달 | manual reproducibility test | defined |
| AC-018 | NFR-003 | Given Publication. When 인용 trace 추출. Then 9-stage anchor를 따라 Publication → ContentDraft → (Thesis →) Scenario revision → (Dossier →) promoted Claim → Snapshot fingerprint → Source 경로로 한 문장이 5단계 이내 역추적 가능 (선택적 단계 skip 허용, ADR-0011 INV-0011-8). R2 bytes는 permitted artifact일 때만 trace 종착점이며 raw third-party text는 미보관 (ADR-0012 INV-0012-3) | TEST-018 | defined |
| AC-019 | NFR-004 | Given 일별 LLM 비용 상한 (TBD). When run ledger 합산. Then 누적 비용이 상한 미만, 초과 시 큐 throttling 동작 | TEST-019 | defined |
| AC-020 | NFR-006 | Given Snapshot fingerprint row. When 원문이 변경/소실됨. Then (a) 모든 Snapshot은 content_hash(sha256) diff로 변경 감지 가능 + claim_status가 source_changed / source_unavailable로 자동 전이 (ADR-0011 INV-0011-5, ADR-0012). (b) r2_key가 NULL이 아닌 permitted artifact (open-license dataset / 공식 API / 자체 산출물)만 R2 round-trip으로 회수 가능 — content_hash + r2_key 무결성 verify. (c) raw third-party text는 r2_key=NULL이므로 R2 회수 대상 아님 (raw_cloud_policy=always_prohibited, NFR-008) | TEST-020 | defined |
| AC-021 | NFR-007 | Given 신규 source type 추가 의도. When extractor interface 확장. Then 기존 article/dataset/report 분기에 영향 없이 dry-run 1건 추가 가능 | TEST-021 + manual | defined |
| AC-022 | REQ-017 | Given Source registry row. When Tier 분류 / collectability_score / access_method / source_perspective 필드 검사. Then 모든 source가 4 dimension collectability + access_method + Tier (A/B/C/D) + source_perspective tag를 보유한다. source_reliability와 collectability는 독립 입력됐다 (Reuters case 검증) | TEST-022 | defined |
| AC-023 | REQ-018 | Given fetch / extract / cache / embed / cloud upload 단계. When source_policy 3 필드(archive/raw_cloud/external_llm) + 8 위험 행동 트리거 검사. Then 위험 행동은 어느 mode에서도 inline_block 되고 모든 결정이 policy_decisions ledger에 기록된다 | TEST-023 | defined |
| AC-024 | REQ-019 | Given 시나리오·콘텐츠 제작 세션. When 막힌 source N건 발생. Then access_interventions 노드 N건 누적되고 세션 종료 시 batch report 생성, severity 자동 산정(deterministic default), unresolved HIGH/CRITICAL은 publication 핵심 근거로 사용 시 cite check inline_block | TEST-024 | defined |
| AC-025 | REQ-020 | Given access_intervention review. When `pipeline intervention review <id>` 호출. Then 3-option (ignore / manual_claim / temp_text) 중 하나 선택 가능. manual_claim 선택 시 `pipeline feedback add` 진입 후 user_written_claim / user_opinion / referenced_quote 3-way 중 하나만 채워진 manual_claim_entry 생성. raw_text_stored=false 강제 | TEST-025 | defined |
| AC-026 | REQ-021 | Given Scenario 작성. When validate. Then impact_targets[] + impact_direction_by_target dict + transmission_channels[]이 채워졌고 (summary_valence는 optional). Thesis는 stance ∈ {constructive, cautionary, neutral, mixed, asymmetric, exploratory} + market_stance (optional v0 / 필수 v1) ∈ {bullish, bearish, range_bound, volatility_up, volatility_down, neutral} 보유 | TEST-026 | defined |
| AC-027 | REQ-022 | Given Q21 Tier A seed 30~50개. When source_perspective 분포 검사. Then risk_observer ≤ 50% + opportunity_observer ≥ 25% + neutral ≥ 15% 충족 | TEST-027 + manual review | defined |
| AC-028 | REQ-023 | Given build_evidence_pack 호출 (mode=balanced). When output 구조 검사. Then v0에서 4 section (supporting / opposing / mitigating·amplifying / monitoring) 모두 채워졌거나 명시 "no evidence found". LLM synthesis prompt에 "한쪽 방향 evidence만으로 결론 금지 / winners·losers 분리" 제약 포함 | TEST-028 | defined |
| AC-029 | REQ-024 | Given pipeline run 종료. When metrics_run 기록 + daily aggregation. Then 6 카테고리 metrics 모두 row 생성. v0 9+ metrics (unsupported_sentence_rate / counterclaim_presence_rate / stale_violation_rate / policy_block_count / manual_claim_entry_rate / db_size_growth_rate / upside_claim_presence_rate / downside_claim_presence_rate / one_sided_warning_rate) 측정됐다 | TEST-029 | defined |
| AC-030 | REQ-025 | Given 사용자가 같은 source ignore 3회. When policy_learning_events 검사. Then Pattern 1 rule_candidate 생성 (active=false), 사용자에게 confirm prompt 제시. 사용자 accept 시 rule active=true. 완화 방향 rule은 terms_url + license_url 입력 필수 | TEST-030 | defined |
| AC-031 | REQ-026 | Given v0 카테고리 enum. When Source registry / Dossier topic 입력. Then core 7 (macro_finance / geopolitics_security / health_biosecurity / energy_commodities / trade_supply_chain / climate_environment / technology_cyber_ai) + secondary 1 (digital_assets) = 8개 + tag 5개 외 값은 reject (또는 manual review tag) | TEST-031 + manual | defined |
| AC-032 | NFR-008 | Given 모든 R2 upload + 모든 외부 LLM 호출. When policy_decisions ledger + source_material_policy 검사. Then raw_cloud_policy=always_prohibited 위반 0건, 모든 upload에 archive_policy 통과 audit log 존재, raw third-party text의 클라우드 저장 0건 | TEST-032 | defined |
| AC-033 | NFR-009 | Given trailing 50개 publication. When thesis_polarity_distribution 측정. Then 한 방향(direction 6값 중 하나) ≥ 70% 쏠림 0건 (v1+ 활성화) | TEST-033 (v1+) | defined |

## Status vocabulary

| Status | Meaning |
|---|---|
| `defined` | 기준은 정의됐지만 아직 실행하지 않음 |
| `not_run` | 실행 대상이지만 아직 실행하지 않음 |
| `passing` | 통과 |
| `failing` | 실패 |
| `waived` | 명시적 사유로 면제 |

`pending`처럼 모호한 상태는 쓰지 않는다. 기능이 구현되지 않은 상태인지,
staging / manual acceptance가 아직 실행되지 않은 상태인지 분리한다.

## Tests (자동화된 경우)

| ID | 이름 | 위치 | 커버하는 AC |
|---|---|---|---|
| TEST-001 | 9-stage object trace anchor | `tests/pipeline/object_model_test.ts` (planned) | AC-001 |
| TEST-002 | Neo4j native FTS 1만 graph object 검색 bench | `tests/bench/neo4j_fts_search_bench.ts` (planned) | AC-002 |
| TEST-003 | R2 sha256 round-trip | `tests/storage/r2_integrity_test.ts` (planned) | AC-003 |
| TEST-004 | promoted only markdown | `tests/storage/markdown_promoted_only_test.ts` (planned) | AC-004 |
| TEST-005 | ID prefix lint | `tests/lint/id_prefix_test.ts` (planned) | AC-005 |
| TEST-006 | confidence 분해 lint | `tests/lint/no_single_confidence_test.ts` (planned) | AC-006 |
| TEST-007 | evidence quote 200자 + 3-tuple | `tests/extraction/evidence_test.ts` (planned) | AC-007 |
| TEST-008 | frontmatter 관계 배열 lint | `tests/lint/no_frontmatter_relation_array_test.ts` (planned) | AC-008 |
| TEST-009 | extractor type 분기 | `tests/extraction/router_test.ts` (planned) | AC-009 |
| TEST-010 | auto-confirm threshold | `tests/review/auto_confirm_test.ts` (planned) | AC-010 |
| TEST-012 | scenario validate 5종 | `tests/scenario/validate_test.ts` (planned) | AC-012 |
| TEST-013 | cite check 5종 | `tests/cite_check/coverage_test.ts` (planned) | AC-013 |
| TEST-014 | scenario revisions append-only | `tests/scenario/revisions_test.ts` (planned) | AC-014 |
| TEST-015 | review queue throttling | `tests/review/throttling_test.ts` (planned) | AC-015 |
| TEST-016 | stale 트리거 3종 | `tests/stale/triggers_test.ts` (planned) | AC-016 |
| TEST-018 | 9-stage 5-step trace (Publication → Source) | `tests/pipeline/trace_test.ts` (planned) | AC-018 |
| TEST-019 | run ledger cost throttling | `tests/cost/ledger_test.ts` (planned) | AC-019 |
| TEST-020 | Snapshot fingerprint durability + content_hash diff + permitted artifact R2 round-trip | `tests/storage/snapshot_fingerprint_test.ts` (planned) | AC-020 |
| TEST-021 | extractor interface dry-run | `tests/extraction/interface_test.ts` (planned) | AC-021 |
| TEST-022 | Source registry Tier + collectability + perspective | `tests/source/registry_test.ts` (planned) | AC-022 |
| TEST-023 | policy gate mode-aware + 8 위험 행동 | `tests/policy/gate_test.ts` (planned) | AC-023 |
| TEST-024 | access_intervention batch report + severity | `tests/intervention/batch_test.ts` (planned) | AC-024 |
| TEST-025 | manual_claim_entry 3-way 분리 CLI | `tests/feedback/cli_test.ts` (planned) | AC-025 |
| TEST-026 | Scenario impact_targets + Thesis stance/market_stance | `tests/scenario/bidirectional_test.ts` (planned) | AC-026 |
| TEST-027 | Tier A seed source_perspective 분포 | `tests/source/perspective_distribution_test.ts` (planned) | AC-027 |
| TEST-028 | EvidencePack v0 4-section + LLM mode prompt | `tests/rag/evidence_pack_test.ts` (planned) | AC-028 |
| TEST-029 | metrics 6 카테고리 + v0 9+ metrics 측정 | `tests/metrics/v0_metrics_test.ts` (planned) | AC-029 |
| TEST-030 | policy learning Pattern 1 rule_candidate | `tests/policy_learning/pattern_1_test.ts` (planned) | AC-030 |
| TEST-031 | 카테고리 8개 enum + tag 5개 | `tests/lint/category_enum_test.ts` (planned) | AC-031 |
| TEST-032 | raw cloud upload 0건 audit | `tests/policy/raw_cloud_zero_test.ts` (planned) | AC-032 |
| TEST-033 | thesis_polarity_distribution v1+ | `tests/metrics/polarity_distribution_test.ts` (planned, v1+) | AC-033 |

## CI/CD gates

CI/CD checks count as acceptance evidence only when they verify a named
requirement, non-functional requirement, release gate, or operational gate.

| Gate | Environment | Verified by | Required? | Notes |
|---|---|---|---|---|
| PR validation | CI | invariant-check workflow + (planned) bun test | yes | 코드 도입 전: invariant-check만 |
| invariant doc check | CI | `bun run invariant:check` | no (warning only) | ADR-0002 INV-0002-1 |
| MVP hands-on | local | 운영자가 1주제 dossier → scenario → draft → publication 1건 end-to-end 실행 | yes | P0-M6 milestone gate |
| Staging smoke | n/a | n/a | no | 단일 운영자, staging 환경 미정의 (P1 검토) |
| Production smoke | n/a | n/a | no | publish는 외부 publisher (블로그/유튜브) 책임 |
| Rollback validation | n/a | n/a | no | data rollback은 SQLite + R2 백업 정책으로 (RUNBOOK 추가 예정) |

## Definition of Done

프로젝트 level DoD:

- 모든 `must` REQ의 AC가 `passing`
- 모든 required gate가 `passing` 또는 명시적으로 `waived`
- 모든 NFR이 측정 가능한 방식으로 검증됨 (AC-002 / AC-018 / AC-019 / AC-020 등)
- 주요 운영 시나리오가 Runbook에 문서화 (`docs/05_RUNBOOK.md`)
- required CI/CD gates are passing or explicitly waived
- Traceability matrix가 최신 (`docs/09_TRACEABILITY_MATRIX.md`)

## Notes

- AC가 없는 REQ는 verify 불가 → PRD로 돌려보냄.
- 실패 시 회귀 방지를 위해 TEST로 승격.
- TEST 파일은 모두 `(planned)` 상태 — 코드 도입과 함께 실제 위치 commit.
