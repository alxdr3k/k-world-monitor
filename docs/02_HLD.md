# 02 HLD — High-Level Design

## Overview

`k-world-monitor`는 시간 무관 수집 → 구조화된 **9-stage 파이프라인**을 통해
**위험·기회·회복탄력성·비대칭 영향 4축을 병렬로** 추적하고 콘텐츠를 발행하는,
**모든 인용을 5단계 trace로 역추적 가능하게 보장하는 1인 운영 환경의 LLM 기반
시나리오 인텔리전스 시스템**이다 (ADR-0011, ADR-0019).

canonical store는 **Neo4j Community Edition(graph objects)** + **SQLite + FTS5
(relational metadata)** + **R2(permitted artifacts only — open license dataset
/ 공식 API 응답 / 자체 산출물)**, 사람용 curated view는 **Markdown vault**다
(ADR-0012, ADR-0014). raw third-party text의 cloud 업로드는 영구 금지
(`raw_cloud_policy=always_prohibited` default, ADR-0012 INV-0012-3,
INV-0012-4).

## Architecture Diagram

```text
                        Discovery Layer (Tier A 자동 + Tier B/C/D manual fallback)
        ┌─────────────────────────────────────────────────────────────┐
        │ RSS / API / sitemap / manual_intake / `pipeline feedback`   │
        └────────────────────────┬────────────────────────────────────┘
                                 ▼
                    ┌────────────────────────────┐
                    │ Source Registry (Neo4j)    │
                    │  + Tier A-D                │
                    │  + collectability_score    │
                    │  + source_policy 3 fields  │
                    │  + source_perspective tag  │  (ADR-0016, 0017, 0019)
                    └───────────┬────────────────┘
                                ▼
                    ┌────────────────────────────┐
                    │ Collection Queue (SQLite)  │
                    └───────────┬────────────────┘
                                ▼
          ┌─────────── Source Layer (4-tier, Neo4j) ───────────┐
          │  Source → Document → Snapshot(=fingerprint) → Claim │
          │ (publisher,  (URL    (URL/hash/      (LLM extract,  │
          │  registry,    group,  locator,        evidence,     │
          │  policy)      reliability) R2 예외)    8-state)      │
          └───────────────────────┬─────────────────────────────┘
                                  ▼
                       ┌───────────────────┐
                       │ Review Queue +    │  (auto-accept threshold,
                       │ Edge Ledger       │   ADR-0006 + ADR-0013)
                       │ (Neo4j typed rel) │
                       └────────┬──────────┘
                                ▼
                       ┌───────────────────┐
                       │ Search / FTS      │  (NFR-001 < 1s p95)
                       │ (Neo4j native FTS │
                       │  + SQLite FTS5    │
                       │  for metadata)    │  (ADR-0014)
                       └────────┬──────────┘
                                ▼
       ┌────── Aggregation / Scenario / Thesis Layer (Neo4j) ──────┐
       │  Dossier  →  Scenario(impact_targets) →  Thesis  →  Draft │
       │ (주제별)    (validate +                  (stance +        │
       │             revisions +                   market_stance,  │
       │             counterclaim                  4-format        │
       │             polarity-symmetric)            재사용)        │
       └───────────────────┬──────────────────────────────────────┘
                           ▼
                  ┌────────────────────┐
                  │ Cite Check 5+1     │ (5 block + 1 warning v1+,
                  │ + access_intervention│  ADR-0015, 0017, 0019)
                  │ + EvidencePack     │
                  │   multi-section    │
                  └────────┬───────────┘
                           ▼
                  ┌────────────────────┐
                  │   Publication      │  (live / corrected /
                  │   ledger           │   retracted, cascade)
                  └────────────────────┘

Lateral (모든 단계 횡단):
  ┌─────────────────────────────────────────────┐
  │ Policy Gate (mode-aware: inline_block /     │  (ADR-0017)
  │ inline_warn / batch_report)                 │
  │ → access_interventions Neo4j 노드           │
  │ → manual feedback inbound CLI               │  (ADR-0018)
  │ Metrics Framework (6 카테고리 + harness)    │  (ADR-0020)
  │ Policy Learning (rule-based)                │  (ADR-0021)
  └─────────────────────────────────────────────┘

Storage seams:
  Markdown vault (curated)     ← promoted Claim, Dossier, Scenario, Thesis, Draft, Pub
  Neo4j Community (canonical)  ← Source, Document, Snapshot, Claim, Dossier, Scenario,
                                  Thesis, ContentDraft, Publication, Edge,
                                  ScenarioRevision, ManualClaimEntry, AccessIntervention
                                  (+ native FTS + v1 native vector index HNSW)
  SQLite + FTS5 (relational)   ← source_policy, policy_decisions, policy_learning_events,
                                  source_policy_rules, dataset_vintage, run_ledger,
                                  metrics_run/daily/alerts, evaluation_runs/cases,
                                  retrieval_pack_metrics, research_session, raw_cache_items
  R2 (permitted artifacts)     ← open-license dataset, 공식 허용 API 응답,
                                  자체 산출물(차트/export), 월별 JSONL audit export
                                  (raw third-party text 업로드 영구 금지)
```

## Components

| 컴포넌트 | 책임 | 의존성 |
|---|---|---|
| Discovery | RSS / API / sitemap polling, manual intake CLI | Source Registry |
| Source Registry | Source 정의(publisher) + Document URL 그룹 + reliability_tier + collectability_score + source_policy + source_perspective | Neo4j Source 노드 |
| Collection Queue | fetch 대상 큐 (priority, dedup, throttle) | SQLite queue 테이블 |
| Policy Gate | mode-aware 검사 (inline_block / inline_warn / batch_report) — 8 위험 행동 트리거 inline_block | SQLite source_policy + policy_decisions ledger, Neo4j AccessIntervention 노드 |
| Fetcher | URL → fingerprint Snapshot 노드 (R2 binary는 permitted artifact만) | Neo4j Snapshot + R2, SQLite policy_decisions |
| Chunker / Indexer | Snapshot 텍스트 → chunk + Neo4j native FTS 인덱스 | Neo4j FTS, SQLite raw_cache_items (TTL) |
| Extractor (article) | Haiku 4.5 1차 + Sonnet 4.6 escalate (ADR-0006) | Anthropic SDK, run ledger |
| Extractor (dataset) | parser only, LLM 미사용 | parser libs |
| Extractor (report) | Haiku 4.5 with structure prompt | Anthropic SDK |
| Review Queue | reviewer manual + auto-accept threshold | SQLite review_queue 테이블 |
| Edge Ledger | Neo4j typed relationships (SUPPORTS / CONTRADICTS / QUALIFIES / UPDATES / SUPERSEDES) (ADR-0013) | Neo4j |
| Dossier Composer | 주제별 promoted claim + counterclaim 합성 | Neo4j + Markdown promoted_claim |
| Scenario Composer | drivers/assumptions/branches/falsifier/counterclaim(polarity-symmetric)/monitoring/impact_targets/impact_direction_by_target/transmission_channels + ScenarioRevision ledger | Neo4j Scenario/ScenarioRevision, edges |
| Scenario Validator | 5종 검사 (ADR-0009 INV-0009-1) + bidirectional balance | Edge Ledger |
| Thesis Composer | Scenario 압축 → stance + market_stance(optional). 4-format ContentDraft 재사용 anchor | Neo4j Thesis |
| ContentDraft Composer | Thesis + Dossier → draft (format별 분기) + 인용 ledger | Markdown vault |
| Cite Check | 5 block (stale / retracted / horizon / unit / overclaim) + access_intervention block + 1 warning v1+ (one-sided thesis) | Edge Ledger, Scenario, Anthropic SDK (overclaim), AccessIntervention |
| Publication Ledger | live / corrected / retracted state + cascade alert | Neo4j Publication |
| Run Ledger | 모든 LLM/parser run의 (model, tokens, cost, cached_tokens, batch_id) 기록 | SQLite run 테이블 |
| Stale Worker | time / snapshot_diff / counterclaim 트리거 (ADR-0010) | Edge Ledger, snapshot content_hash |
| Manual Feedback CLI | `pipeline feedback add\|bulk\|link\|from-report`, `pipeline intervention review <id>` 3-option | Neo4j ManualClaimEntry, AccessIntervention |
| Access Intervention Queue | 탐색·콘텐츠 제작 중 막힌 source 누적 + 세션 종료 batch report + severity 산정 | Neo4j AccessIntervention |
| Metrics Collector | per-run metrics_run + daily aggregation + evaluation harness (gold query set) | SQLite metrics_* + evaluation_* |
| Policy Learner | rule-based Pattern 1 (v0) → 5 (v3 옵션). auto-tighten 자동 / auto-relax 사용자 명시 | SQLite policy_learning_events + source_policy_rules |
| Research Session Manager | scenario·thesis 탐색 세션 + raw_cache TTL (24h~7d, indexed=false, embedded=false, finalize 시 즉시 삭제) | SQLite research_session + raw_cache_items |

## Data Model (요약)

| Entity | 주요 필드 | 저장소 |
|---|---|---|
| Source | src_id, publisher_name, urls_root[], reliability_tier, collectability_score{automation_reliability, legal_policy_clarity, anti_bot_friction, preferred_mode}, access_method, source_perspective, source_policy_fk | Neo4j Source + Markdown hub |
| Document | doc_id, src_id (FK), title, urls[], schema_version | Neo4j Document |
| Snapshot | snap_id, doc_id, fetched_at, url, content_hash, locator, mime, byte_size, r2_key (NULL unless permitted artifact) | Neo4j Snapshot (+ R2 예외) |
| Claim | clm_id, snap_id, body, evidence{quote nullable, locator, quote_hash, quote_reason, storage_level}, extraction_confidence, claim_status (8-state), run_id | Neo4j Claim (+ promoted Markdown) |
| Dossier | dos_id, topic, promoted_claim_ids[], counterclaim_ids[], outlook (v1), stale_after | Neo4j Dossier + Markdown |
| Scenario | scn_id, dossier_id, current_revision_id, horizon, impact_targets[], impact_direction_by_target{target: enum}, transmission_channels[], summary_valence (optional) | Neo4j Scenario + Markdown |
| ScenarioRevision | revision_id, scenario_id, revision_no, body_snapshot(JSON), change_summary | Neo4j ScenarioRevision |
| Thesis | ths_id, scenario_revision_id, stance, market_stance (optional v0 / 필수 v1), reuse_format_count | Neo4j Thesis + Markdown |
| ContentDraft | drf_id, thesis_id, dossier_id, scenario_revision_id, format (blog_long / youtube_long / shorts / newsletter), body, cite_check_status, state | Markdown |
| Publication | pub_id, draft_id, publish_url, publish_at, state, correction_ledger[] | Markdown + Neo4j Publication |
| Edge | edge_id, from_id, to_id, relation_type (v0 5종), scope, rationale, provenance, run_id | Neo4j relationship |
| Run | run_id, kind, model, tokens_in, tokens_out, cost, cached_tokens, batch_id, started_at, ended_at | SQLite run |
| source_policy | source_id (FK), archive_policy, raw_cloud_policy, external_llm_policy, terms_url, license_url, checked_at | SQLite |
| policy_decisions | decision_id, session_id, source_id, url, intended_action, decision, gate_mode, risk_level, reason, intervention_id, created_at | SQLite |
| policy_learning_events | event_id, policy_decision_id, user_action, pattern, proposed_rule_id, rule_accepted, created_at | SQLite |
| source_policy_rules | rule_id, pattern, applies_to_field, match_pattern, rule_value, source_count, created_from, active, terms_url, license_url, confirmed_at, demoted_at | SQLite |
| dataset_vintage | source_id, dataset_id, series_id, observation_date, vintage_date, retrieved_at, value, query_params, checksum | SQLite |
| AccessIntervention | intervention_id, session_id, scenario_id, thesis_id, url, source_name, attempted_action, access_result, policy_result, related_query, why_it_matters, importance_score, severity, fallback_used_json, requested_user_action, status, created_at, resolved_at | Neo4j |
| ManualClaimEntry | manual_claim_id, session_id, source_id, url, canonical_url, title, publisher, author, published_at, source_accessed_at, source_accessed_via, user_written_claim, user_opinion, referenced_quote, quote_reason, attribution_json, self_assessed_confidence, policy_gate_passed, raw_text_stored (false), intervention_id, created_at | Neo4j |
| metrics_run / metrics_daily / metric_alerts | (ADR-0020 schema) | SQLite |
| evaluation_runs / evaluation_cases / retrieval_pack_metrics | (ADR-0020 schema) | SQLite |
| research_session / raw_cache_items | (ADR-0021 schema) | SQLite |

세부 스키마는 `docs/current/DATA_MODEL.md`(코드 도입 후 갱신) 참조.
마이그레이션 파일은 INFRA-1A.2 slice에서 commit 예정 (Neo4j Cypher schema +
SQLite migration).

## Key Interfaces

- CLI 우선 (1인 운영) — `pipeline` namespace
  - `pipeline source register|tier-assign|policy-set`
  - `pipeline fetch` (Tier A 자동 batch)
  - `pipeline feedback add|bulk|link|from-report`
  - `pipeline intervention review <id>` (ignore / manual_claim / temp_text)
  - `pipeline scenario validate <id>`
  - `pipeline thesis compose <scenario_revision_id>`
  - `pipeline draft compose <thesis_id> --format {blog_long|youtube_long|shorts|newsletter}`
  - `pipeline publish <draft_id>` (cite check 5+1 gate)
  - `pipeline metrics report --since <date>`
  - `pipeline vault-sync` (publication 시점 자동 + manual trigger, Q-026)
- HTTP API는 PUB 단계 이후 검토.
- 이벤트/메시지: GitHub Actions cron / 로컬·자체 서버 cron (self-host only)
- 외부 통합:
  - Anthropic SDK (Haiku 4.5 + Sonnet 4.6, prompt caching, batch API)
  - Cloudflare R2 (S3 compatible API, permitted artifact only)
  - 소스별 RSS / API client (Discovery, Tier A)
- Neo4j 접속: bolt://localhost:7687 (self-host Docker / binary) + APOC + GDS
  plugin

## Cross-cutting

- 인증/인가: 1인 운영 환경, 로컬 CLI는 OS 사용자 권한, R2/Anthropic/Neo4j는
  API key / DB credential (Doppler / 환경 변수 보안 — `docs/05_RUNBOOK.md`에
  정책 추가 예정)
- 로깅/관찰성: Run Ledger가 모든 LLM/parser run을 기록 (cost / token / latency).
  cron worker는 stdout + 일일 요약. Metrics Framework(ADR-0020)가 매 run에서
  6 카테고리 metrics 수집.
- 에러/재시도: Fetcher/Extractor는 idempotent (snap_id / clm_id 기준 dedupe).
  실패 run은 run ledger에 status=failed 기록 후 backoff
- 보안/프라이버시: 외부 인용 quote ≤ 200자 (NFR-005, ADR-0015). 사용자 PII
  수집 안 함. R2 객체는 private bucket. **raw third-party text 클라우드 업로드
  영구 금지** (NFR-008, ADR-0012).
- 비용 가드: NFR-004 일별 LLM 비용 상한 + run ledger 기반 throttling
  (ADR-0006). Q-028에서 정책 정밀화.
- 백업: Neo4j dump 일간 (retention 30d) + SQLite snapshot 일간 (retention 90d)
  + JSONL audit export 월별 (retention 1y) + R2 derived artifact 무기한 +
  open-license dataset versioned (ADR-0014 INV-0014-6, Q-027)
- Bidirectional framing: ADR-0019 standards of care — 콘텐츠가 perpetual
  bear/bull로 흐르지 않도록 thesis polarity 분포 의도적 관리. Q21 Tier A seed
  분포 균형 강제. EvidencePack v0 4-section / v1 8-section. LLM synthesis
  mode 분리 (balanced / specific).

## Trade-offs & Alternatives

주요 구조 결정은 `adr/`로 이동. 여기에는 요약/링크만.

- **ADR-0011** (supersedes ADR-0003): 9-stage object model with Source +
  Thesis. 4-format reuse anchor + publisher-level entity 분리.
- **ADR-0012** (supersedes ADR-0004): Neo4j(graph) + SQLite(relational) +
  R2(permitted artifacts only) + Markdown(curated). Snapshot = fingerprint
  record. raw cloud upload 영구 금지.
- ADR-0005: confidence 단일 필드 폐기 — reliability_tier / extraction_confidence
  / claim_status (8-state) / scenario weight / collectability_score 분해
- ADR-0006: LLM routing (Haiku 1차 + Sonnet escalate) + parser split +
  auto-accept
- **ADR-0013** (supersedes ADR-0007): edge ledger via Neo4j typed
  relationships. v0 5 edge type, v1+ counterclaim multi-relation 4 추가.
- **ADR-0014**: Neo4j-native feature adoption (APOC + GDS + native vector +
  native FTS) + intentional lock-in. vendor-neutral 원칙 폐기.
- **ADR-0015** (supersedes ADR-0008): evidence nullable quote + quote_reason
  + storage_level 4단계 + cite check 5 block + 1 warning v1+.
- ADR-0009: scenario validate + revisions ledger — in-place mutation 금지
- ADR-0010: stale 트리거 3종 + review queue throttling
- **ADR-0016**: Collection realism — Tier A-D + collectability_score + no
  bot bypass + manual fallback.
- **ADR-0017**: Source policy gate mode-aware + access_interventions.
- **ADR-0018**: Manual feedback inbound — CLI + 3-way 분리.
- **ADR-0019**: Bidirectional framing — scenario impact_targets, thesis
  stance + market_stance, EvidencePack multi-section.
- **ADR-0020**: System metrics framework (6 카테고리 + evaluation harness).
- **ADR-0021**: Policy learning framework (rule-based, auto-tighten /
  auto-relax 분리).

## Open Questions

- Q-001 ~ Q-030: PRD §Open Questions 참조 (per-file `docs/questions/Q-<NNN>.md`)

## Related Requirements

- REQ-001 (9-stage 모델) → 전 컴포넌트가 9-stage anchor (ADR-0011)
- REQ-002 (Neo4j canonical graph) → Neo4j 컴포넌트 + native FTS (ADR-0012,
  ADR-0014)
- REQ-003 (Snapshot fingerprint, R2 raw 금지) → Fetcher + R2 permitted (ADR-0012)
- REQ-004 (Markdown promoted only) → Markdown vault (ADR-0012)
- REQ-005 (ID 체계) → 전 노드 PK + Markdown frontmatter
- REQ-006 (confidence 분해 + collectability) → Source/Document/Claim/Scenario
  schema (ADR-0005, ADR-0016)
- REQ-007 (evidence nullable + quote_reason) → Extractor + Cite Check (ADR-0015)
- REQ-008 (Neo4j typed relationships) → Edge Ledger (ADR-0013)
- REQ-009 (extractor 분리) → 3종 Extractor (ADR-0006)
- REQ-010 (LLM routing) → Routing 로직 (ADR-0006)
- REQ-011 (구현 순서) → Roadmap (`04_IMPLEMENTATION_PLAN.md`)
- REQ-012 (scenario validate + counterclaim polarity-symmetric) → Scenario
  Validator (ADR-0009, ADR-0019)
- REQ-013 (cite check 5+1) → Cite Check (ADR-0015)
- REQ-014 (scenario_revisions) → Scenario Composer + Revisions ledger
  (ADR-0009, ADR-0013)
- REQ-015 (review throttling) → Review Queue + auto-accept (ADR-0010)
- REQ-016 (stale 트리거 3종) → Stale Worker (ADR-0010)
- REQ-017 (Tier A-D + collectability) → Source Registry (ADR-0016)
- REQ-018 (mode-aware policy gate) → Policy Gate (ADR-0017)
- REQ-019 (access_interventions) → Access Intervention Queue (ADR-0017)
- REQ-020 (Manual feedback inbound) → Manual Feedback CLI (ADR-0018)
- REQ-021 (Scenario impact_targets / Thesis stance) → Scenario Composer +
  Thesis Composer (ADR-0019)
- REQ-022 (source_perspective tag) → Source Registry (ADR-0019)
- REQ-023 (EvidencePack multi-section + mode 분리) → Cite Check + RAG
  build_evidence_pack (ADR-0019)
- REQ-024 (metrics 6 카테고리 + harness) → Metrics Collector (ADR-0020)
- REQ-025 (Policy learning rule-based) → Policy Learner (ADR-0021)
- REQ-026 (카테고리 8개) → Source Registry tag + Dossier topic
- NFR-001 (1만건 < 1s p95) → Neo4j native FTS + index 정책 (SPIKE-001로 검증)
- NFR-002 (reproducibility) → scenario_revisions + edge ledger (ADR-0009)
- NFR-003 (5단계 trace) → 9-stage object model + ID propagation (ADR-0011)
- NFR-004 (cost 상한) → Run Ledger + throttling (ADR-0006)
- NFR-005 (quote ≤ 200자 + quote_reason) → Extractor assertion + Cite Check
  (ADR-0015)
- NFR-006 (snapshot durability via fingerprint) → content_hash (ADR-0012)
- NFR-007 (extractor 확장) → Extractor interface (ADR-0006)
- NFR-008 (legal safety, raw 0건 cloud) → Policy Gate + Fetcher (ADR-0012,
  ADR-0017)
- NFR-009 (bidirectional balance) → Metrics Framework + Cite Check warning
  (ADR-0019, ADR-0020)
