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
| AC-001 | REQ-001 | Given 신규 fetch된 Snapshot. When extractor가 claim을 추출 → dossier 합성 → scenario revision → **EditorialIntent 운영자 명시 lock** → thesis → contentdraft → publication 까지 진행. Then **10-stage object model 안에서 각 stage 의 노드가 정확한 순서로 생성** (Source → Document → Snapshot → Claim → Dossier → Scenario → EditorialIntent → Thesis → ContentDraft → Publication) + **EditorialIntent 노드의 `decided_by_operator = true` flag 확인** (ADR-0025 INV-0025-4) + Thesis 의 `:HAS_INTENT` relationship → EditorialIntent 정확히 1개 link 확인 (INV-0025-2) + ContentDraft 의 `:USES_INTENT` relationship 확인. 9-stage 의 stage skip path 도 valid (INV-0025-5 trace path 옵션) — 단 stage 자체는 schema 에 정의되어 있어야 함 | manual + automated TEST-001 | defined |
| AC-002 | REQ-002 | Given Neo4j Community 인스턴스. When 1만 graph object(Claim + Snapshot + Source + Document + Edge) 적재. Then Neo4j native FTS keyword 검색 + 1-hop traversal이 cold cache p95 < 1초 (NFR-001, SPIKE-001) | TEST-002 (bench) | defined |
| AC-003 | REQ-003 | Given Snapshot row. When r2_key가 가리키는 객체를 fetch. Then sha256이 일치하고 mime이 일치한다 | TEST-003 | defined |
| AC-004 | REQ-004 | Given 1만 건 candidate claim. When 그 중 50건이 promoted. Then Markdown vault에는 50건만 존재하고 나머지는 SQLite에만 존재한다 | TEST-004 + manual | defined |
| AC-005 | REQ-005 | Given 신규 객체 생성. When ID 발급. Then 접두 + 단조 증가 식별자(`src_/doc_/snap_/clm_/dos_/scn_/eit_/ths_/drf_/pub_/edge_/run_/aci_/mcl_/met_`) 규칙을 따른다. **신규 prefix `eit_` (EditorialIntent, ADR-0025) + `met_` (derived_metric, ADR-0024) 도 실제 객체 생성 시 의무 적용** | TEST-005 | defined |
| AC-006 | REQ-006 | Given Document, Claim, Scenario row. When 단일 confidence 필드 검사. Then 어떤 row에도 단일 confidence 필드가 없고 reliability_tier / extraction_confidence / claim_status / scenario assumption weight가 분리되어 있다 | TEST-006 | defined |
| AC-007 | REQ-007 + NFR-005 | Given Claim row. When evidence quote 길이 검사. Then quote ≤ 200자 + locator + quote_hash가 모두 채워져 있다. 비면 invalid | TEST-007 | defined |
| AC-008 | REQ-008 | Given claim/scenario/publication frontmatter. When supports[]/contradicts[]/qualifies[] 배열 검색. Then 검색 결과 0건 (모든 관계는 edges 테이블) | TEST-008 (lint) | defined |
| AC-009 | REQ-009 | Given 신규 source type(article/dataset/report). When extractor 호출. Then (a) article/report 는 LLM 호출 (Tier 2 default GPT-5 mini, ADR-0023), (b) **dataset 은 Data Science Module (ADR-0024) 경로 — Polars/DuckDB/statsmodels/scipy deterministic transform**, (c) **1000+ rows 또는 50KB+ raw payload dataset 은 LLM raw 입력 절대 금지 (assertion fail) — derived metric 으로 압축 후 LLM 호출** (ADR-0024 INV-0024-4, ADR-0023 INV-0023-6), (d) derived_metric_ledger 에 reproducibility 3-tuple (`dataset_vintage_id` + `spec_sha256` + `library_version_lock_sha256`) row 생성 | TEST-009 | defined |
| AC-010 | REQ-010 | Given reliability_tier=high + extraction_confidence ≥ 0.85 claim. When extractor 결과 처리. Then (a) auto-confirm 으로 claim_status=confirmed, reviewer queue 미진입, (b) **LLM 호출은 ADR-0023 4-tier multi-vendor 라우팅 — Tier 2 default GPT-5 mini, escalate → Tier 1 GPT-5.5 Pro standard, selective → Tier 0 GPT-5.5 Pro xthink + Opus 4.7 xhigh cross-review** (DEC-010 mapping table), (c) **모든 vendor 호출에 strict schema (response_format: json_schema / `strict: true` / `responseSchema`) + post-LLM quote substring 검증 의무** (faithfulness_rate ≥ 0.99 KPI), (d) cross-vendor review 강제 단계 3 종 (preflight cite check overclaim / scenario validate adversarial / high-stakes thesis) 의 cross_vendor_review_coverage ≥ 0.95 KPI 측정, (e) run_ledger 의 vendor / tier / cross_vendor_review_of / domain_override_reason 필드 모든 LLM 호출에 기록 | TEST-010 | defined |
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
| AC-026 | REQ-021 | Given Scenario 작성 + EditorialIntent 운영자 명시 lock. When validate + Thesis compose. Then (a) Scenario 의 impact_targets[] + impact_direction_by_target dict + transmission_channels[] 채움 (summary_valence optional), (b) Thesis 가 stance ∈ {constructive, cautionary, neutral, mixed, asymmetric, exploratory} + market_stance (optional v0 / 필수 v1) ∈ {bullish, bearish, range_bound, volatility_up, volatility_down, neutral} 보유, (c) **Thesis 가 `editorial_intent_id` field 와 `:HAS_INTENT` relationship 로 정확히 1 개 EditorialIntent 와 link (ADR-0025 INV-0025-2)**, (d) **Thesis stance + market_stance 가 EditorialIntent `bidirectional_weight_intent` 와 align — divergence 발견 시 manual review trigger 또는 v1+ cite check 5+1 의 one-sided thesis warning (INV-0025-6)**, (e) **EditorialIntent `decided_by_operator = true` flag** (INV-0025-4) — false 면 Thesis composer reject | TEST-026 | defined |
| AC-027 | REQ-022 | Given Tier A seed set 전체 (size 무관 — Q-021 가 upper cap 폐기, 누적 가능). When source_perspective 분포 검사. Then **전체 seed 기준** risk_observer ≤ 50% + opportunity_observer ≥ 25% + neutral ≥ 15% 충족 (mixed 는 valid value 이나 ratio 분모에서 제외하지 않음 — 의무 ratio 는 4 dim 중 3 dim 에 대해서만 적용). 카테고리 subset compliance 는 reference only — 의무 아님 | TEST-027 + manual review | defined |
| AC-028 | REQ-023 | Given build_evidence_pack 호출 (mode=balanced). When output 구조 검사. Then v0에서 4 section (supporting / opposing / mitigating·amplifying / monitoring) 모두 채워졌거나 명시 "no evidence found". LLM synthesis prompt에 "한쪽 방향 evidence만으로 결론 금지 / winners·losers 분리" 제약 포함 | TEST-028 | defined |
| AC-029 | REQ-024 | Given pipeline run 종료. When metrics_run 기록 + daily aggregation. Then 6 카테고리 metrics 모두 row 생성. v0 9+ metrics (unsupported_sentence_rate / counterclaim_presence_rate / stale_violation_rate / policy_block_count / manual_claim_entry_rate / db_size_growth_rate / upside_claim_presence_rate / downside_claim_presence_rate / one_sided_warning_rate) 측정됐다 | TEST-029 | defined |
| AC-030 | REQ-025 | Given 사용자가 같은 source ignore 3회. When policy_learning_events 검사. Then Pattern 1 rule_candidate 생성 (active=false), 사용자에게 confirm prompt 제시. 사용자 accept 시 rule active=true. 완화 방향 rule은 terms_url + license_url 입력 필수 | TEST-030 | defined |
| AC-031 | REQ-026 | Given v0 카테고리 enum (DEC-004로 4 메타 카테고리로 축소). When Source registry / Dossier topic 입력. Then **`topic` 필드는 4 메타 enum (`policy` / `economy` / `society` / `pop_culture`) 외 값 reject**. **`subtopic_tags[]` 는 기존 8 enum (macro_finance / geopolitics_security / health_biosecurity / energy_commodities / trade_supply_chain / climate_environment / technology_cyber_ai / digital_assets) + tag 5개 (social_stability_information / demographics_migration / food_water_security / governance_institutions / critical_infrastructure) 외 값 reject**. 8 enum + 5 tag 가 4 메타 카테고리 안에서 의미 있게 매핑 (예 `digital_assets ∈ economy`, `geopolitics_security ∈ policy`, `health_biosecurity ∈ society` 등 — `data/categories.yaml` 의 매핑 표가 권위) | TEST-031 + manual | defined |
| AC-032 | NFR-008 | Given 모든 R2 upload + 모든 외부 LLM 호출. When policy_decisions ledger + source_material_policy 검사. Then raw_cloud_policy=always_prohibited 위반 0건, 모든 upload에 archive_policy 통과 audit log 존재, raw third-party text의 클라우드 저장 0건 | TEST-032 | defined |
| AC-033 | NFR-009 | Given trailing 50개 publication. When thesis_polarity_distribution 측정. Then 한 방향(direction 6값 중 하나) ≥ 70% 쏠림 0건 (v1+ 활성화) | TEST-033 (v1+) | defined |
| AC-034 | NFR-010 + REQ-027 | Given 자체 사이트 publish + 외부 플랫폼 cross-post (Substack / YouTube / X). When cross-post 게시물의 cite footnote anchor URL 추출. Then **외부 플랫폼 발행물의 모든 cite footnote가 자체 사이트 도메인 URL을 가리킨다** (외부 임의 URL 0건). v0 manual cross-post에서는 사람 검증, v1+ auto cross-post 도입 시 link transform + lint 자동 (ADR-0022 INV-0022-2). vault `publications/` 외 디렉토리(documents/, dossiers/, scenarios/, theses/, content_drafts/, promoted_claims/) URL을 cite anchor로 사용 시 reject (internal canonical 비노출, ADR-0022 INV-0022-4) | TEST-034 | defined |
| AC-035 | REQ-027 + ADR-0022 INV-0022-3 | Given `vault/publications/blog_long/<slug>.mdx` (그리고 v1+ newsletter / youtube_long / shorts) 발행. When Astro Content Collection 빌드 실행. Then **Zod schema (status / cite_refs[] / correction_ledger[] / format / editorial_intent_id / editorial_quality_rubric_passed) 가 strict 검증** — invalid value (예 `status` enum 외 값) 또는 **dead-link `cite_refs` (claim id 존재 안 함)** 또는 **`editorial_intent_id` dead-link** (ADR-0025) 또는 **`editorial_quality_rubric_passed = false 또는 missing`** (DEC-012) 시 **build fail** (Cloudflare Pages 가 이전 successful deploy 유지). 정상 시 사이트에 publication URL 노출 + `<Cite/>` / `<RetractionBanner/>` / `<CorrectionLedger/>` 컴포넌트가 frontmatter 값을 render | TEST-035 | defined |
| AC-036 | DEC-012 (CQ-001) | Given publication preflight (PUB-1A.5 accept). When 운영자가 본문 read-aloud. Then **thesis 가 한 문장으로 명확히 진술** — 10초 안에 thesis 1문장 정확히 인용 가능 | TEST-036 (manual verify v0 / LLM judge v1+) | defined |
| AC-037 | DEC-012 (CQ-002) | Given publication preflight. When 운영자가 self-check. Then **독자가 새로운 관점을 얻음** — "이 글을 안 쓰고 source 만 읽었으면 같은 결론 도달했을까?" 에 No. source summary 가 아니라 운영자 판단 제공 | TEST-037 (manual v0) | defined |
| AC-038 | DEC-012 (CQ-003) + ADR-0027 | Given publication preflight. When 본문 evidence 분석. Then **supporting evidence + opposing evidence 둘 다 본문에 등장**. ADR-0027 minimum coverage (supporting ≥ 3 / opposing ≥ 2) 자동 충족 + 본문에 "그러나" / "반론은" / "opposing" section 명시 | TEST-038 (manual v0) | defined |
| AC-039 | DEC-012 (CQ-004) + REQ-021 | Given publication preflight. When target 분석. Then **target 별 upside / downside / mixed / neutral 분리** 명시 (DEC-011 의 10 target × impact_direction 예시 형태 또는 본문 narrative). 단일 axis 표현 X | TEST-039 (manual v0) | defined |
| AC-040 | DEC-012 (CQ-005) | Given publication preflight. When monitoring section 검사. Then **monitoring signal 이 구체적** — measurable indicator (예 "월별 미분양 5만 호 초과", "DSR 신규 대출 비율 70% 돌파"). modal verb ("주시할 만하다") X | TEST-040 (manual v0) | defined |
| AC-041 | DEC-012 (CQ-006) | Given publication preflight. When forecast language 검사. Then **과장 forecast 없음** — 단정적 prediction ("폭락한다") X, 확률 / 조건 / horizon 명시 ("X 조건 시 1~3년 내 가격 -30% 시나리오 가능성 ↑") O | TEST-041 (manual v0) | defined |
| AC-042 | DEC-012 (CQ-007) | Given publication preflight. When 글 말미 / 별도 section 검사. Then **correction 가능성 / 불확실성 명시** — "본 thesis 의 retraction trigger" 또는 "이 글이 틀릴 수 있는 시나리오" section 존재 | TEST-042 (manual v0) | defined |
| AC-044 | ADR-0027 / REQ-023 | Given Dossier 합성. When 각 thesis 후보별 evidence_role 분류 검사. Then (a) supporting_evidence ≥ 3 claim + opposing_evidence ≥ 2 claim + monitoring_signal ≥ 3 claim **minimum coverage 충족** (미달 시 Dossier reject → manual review queue), (b) 모든 `:EVIDENCE_FOR` relationship 의 `evidence_role` 필드 (6 enum 중 하나) + `assigned_by = operator_lock` (LLM-only 진입 차단, INV-0027-5), (c) EvidencePack v0 4-section 이 evidence_role grouping 기준으로 생성 (REQ-023 본문 + ADR-0027 INV-0027-3) | TEST-044 | defined |

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
| TEST-001 | **10-stage object trace anchor** + EditorialIntent stage 존재 + `:HAS_INTENT` / `:USES_INTENT` relationship + `decided_by_operator = true` flag (ADR-0025) | `tests/pipeline/object_model_test.ts` (planned) | AC-001 |
| TEST-002 | Neo4j native FTS 1만 graph object 검색 bench | `tests/bench/neo4j_fts_search_bench.ts` (planned) | AC-002 |
| TEST-003 | R2 sha256 round-trip | `tests/storage/r2_integrity_test.ts` (planned) | AC-003 |
| TEST-004 | promoted only markdown | `tests/storage/markdown_promoted_only_test.ts` (planned) | AC-004 |
| TEST-005 | ID prefix lint | `tests/lint/id_prefix_test.ts` (planned) | AC-005 |
| TEST-006 | confidence 분해 lint | `tests/lint/no_single_confidence_test.ts` (planned) | AC-006 |
| TEST-007 | evidence quote 200자 + 3-tuple | `tests/extraction/evidence_test.ts` (planned) | AC-007 |
| TEST-008 | frontmatter 관계 배열 lint | `tests/lint/no_frontmatter_relation_array_test.ts` ✓ 9 tests pass | AC-008 |
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
| TEST-026 | Scenario impact_targets + Thesis stance/market_stance + **Thesis↔EditorialIntent linkage + intent.bidirectional_weight_intent ↔ thesis.stance align + EditorialIntent.decided_by_operator = true** (ADR-0025 INV-0025-2/-4/-6) | `tests/scenario/bidirectional_test.ts` (planned) | AC-026 |
| TEST-027 | Tier A seed source_perspective 분포 | `tests/source/perspective_distribution_test.ts` (planned) | AC-027 |
| TEST-028 | EvidencePack v0 4-section + LLM mode prompt | `tests/rag/evidence_pack_test.ts` (planned) | AC-028 |
| TEST-029 | metrics 6 카테고리 + v0 9+ metrics 측정 | `tests/metrics/v0_metrics_test.ts` (planned) | AC-029 |
| TEST-030 | policy learning Pattern 1 rule_candidate | `tests/policy_learning/pattern_1_test.ts` (planned) | AC-030 |
| TEST-031 | 4 메타 카테고리 enum + 8 subtopic + tag 5개 enum (DEC-004) | `tests/lint/category_enum_test.ts` (planned) | AC-031 |
| TEST-032 | raw cloud upload 0건 audit | `tests/policy/raw_cloud_zero_test.ts` (planned) | AC-032 |
| TEST-033 | thesis_polarity_distribution v1+ | `tests/metrics/polarity_distribution_test.ts` (planned, v1+) | AC-033 |
| TEST-034 | cross-post cite anchor canonical lint (외부 플랫폼 footnote가 자체 사이트 도메인 URL만) + internal vault path leakage 차단 | `tests/publishing/cross_post_anchor_lint_test.ts` (planned) | AC-034 |
| TEST-035 | Astro Content Collection Zod schema build-time gate — invalid status / dead-link cite_refs / dead-link editorial_intent_id / editorial_quality_rubric_passed=false 인 fixture 로 빌드하면 fail, 정상 fixture 로 빌드하면 pass + `<Cite/>` / `<RetractionBanner/>` / `<CorrectionLedger/>` 컴포넌트 출력 검증 | `tests/publishing/astro_zod_build_gate_test.ts` (planned) | AC-035 |
| TEST-036 | Editorial Quality Rubric CQ-001 — thesis 한 문장 명확성 manual verify (v0) / LLM judge (v1+) | `tests/publishing/editorial_rubric_cq1_test.ts` (planned, v1+ LLM judge) | AC-036 |
| TEST-037 | Editorial Quality Rubric CQ-002 — 독자 새 관점 제공 manual self-check | manual review (v0) / LLM judge planned (v1+) | AC-037 |
| TEST-038 | Editorial Quality Rubric CQ-003 — supporting + opposing 본문 등장 (ADR-0027 minimum coverage 자동 + 본문 section 존재 manual) | `tests/publishing/editorial_rubric_cq3_test.ts` (planned) | AC-038 |
| TEST-039 | Editorial Quality Rubric CQ-004 — target 별 upside/downside 분리 manual verify | manual review (v0) | AC-039 |
| TEST-040 | Editorial Quality Rubric CQ-005 — monitoring signal 구체성 manual verify | manual review (v0) / LLM judge (v1+) | AC-040 |
| TEST-041 | Editorial Quality Rubric CQ-006 — 과장 forecast language 없음 manual verify | manual review (v0) / LLM judge (v1+) | AC-041 |
| TEST-042 | Editorial Quality Rubric CQ-007 — correction 가능성 / 불확실성 section 존재 | `tests/publishing/editorial_rubric_cq7_test.ts` (planned, section heading lint) | AC-042 |
| TEST-044 | Dossier evidence_role minimum coverage (supporting ≥3 / opposing ≥2 / monitoring ≥3) + operator_lock enforcement (LLM-only progression 차단) | `tests/aggregation/dossier_evidence_role_test.ts` (planned) | AC-044 |

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
