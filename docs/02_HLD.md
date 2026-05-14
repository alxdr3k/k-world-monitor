# 02 HLD — High-Level Design

## Overview

`k-world-monitor`는 시간 무관 수집 → 구조화된 **10-stage 파이프라인**
(Source → Document → Snapshot → Claim → Dossier → Scenario → EditorialIntent
→ Thesis → ContentDraft → Publication, ADR-0025 supersedes ADR-0011) 을 통해
**위험·기회·회복탄력성·비대칭 영향 4축을 병렬로** 추적하고 콘텐츠를 발행하는,
**모든 인용을 Snapshot 까지 5-hop 이내로 역추적 가능하게 보장하는 1인 운영
환경의 LLM 기반 시나리오 인텔리전스 시스템** 이다 (ADR-0011 → superseded by
ADR-0025, ADR-0019). **NFR-003 5-hop 단축 trace path** = Publication →
ContentDraft → Thesis → Scenario → Claim → Snapshot (DEC-020 Q-042 lock).
EditorialIntent (ADR-0025 신규 stage) 는 Thesis 의 anchor metadata 로 분류,
trace 계산 시 선택적 skip 허용 (Thesis ↔ EditorialIntent 1:1 link 으로
reachable 보장). Source layer 의 Source / Document 는 Snapshot 의 metadata
anchor — trace 종점은 Snapshot. manual_claim_entry path 는 Snapshot 미포함
(4-hop 으로 추가 단축, ADR-0018).

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
                    ┌──────────────────────────────────────┐
                    │ Source Registry (2-store seam)       │
                    │  Neo4j Source node                   │
                    │    (property `source_id` PK with     │
                    │     `src_<ULID>` value format,       │
                    │     Tier 0-D, collectability_score,  │
                    │     source_perspective, access_method)│
                    │  SQLite tables (linked by `source_id`│
                    │   value where present — not          │
                    │   enforced FK):                      │
                    │    source_material_policy            │
                    │     (source_id NOT NULL)             │
                    │    source_registry_slug_map          │
                    │     (source_id NOT NULL value col,   │
                    │      not constraint-FK)              │
                    │    source_policy_rules (pattern-     │
                    │     based, no source_id column)      │
                    │    policy_decisions                  │
                    │     (source_id nullable audit ledger)│
                    │  Seed: data/sources_seed.yaml        │
                    │   (INFRA-1B.1 seeds SQLite;          │
                    │    Neo4j Source bootstrap = 후속     │
                    │    슬라이스 미구현 — 운영자 manual   │
                    │    Cypher 필요)                      │
                    └───────────┬──────────────────────────┘  (ADR-0016, 0017, 0019, 0021)
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
  ┌─── Aggregation / Scenario / EditorialIntent / Thesis Layer (Neo4j) ───┐
  │  Dossier → Scenario(impact_targets) → EditorialIntent → Thesis → Draft │
  │ (주제별)   (validate + revisions +    (운영자 명시   (stance +   (4-format│
  │            counterclaim polarity-     lock,           market_     재사용,│
  │            symmetric)                 ADR-0025)       stance,    intent  │
  │                                                       intent     reuse  │
  │                                                       align)    anchor) │
  └────────────────────────────────┬────────────────────────────────────────┘
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
                  └────────┬───────────┘
                           ▼
        ┌──────────────────────────────────────────────────┐
        │ Publishing Site (ADR-0022)                       │
        │ ┌──────────────────────────────────────────────┐ │
        │ │ vault/publications/ (single source)          │ │
        │ │  ├─ blog_long/  → /posts/[slug]   (v0 활성)  │ │
        │ │  ├─ newsletter/ → /newsletter/[slug] (v1+)   │ │
        │ │  ├─ youtube_long/ → /videos/[slug]   (v1+)   │ │
        │ │  └─ shorts/    → /shorts/[slug]      (v1+)   │ │
        │ └──────────────────────────────────────────────┘ │
        │ Astro 5.0 (Content Collection + Zod schema)      │
        │   + <Cite/> / <RetractionBanner/> / <Correction- │
        │     Ledger/> components (build-time cite gate)   │
        │ + pagefind (client-side full-text)               │
        │ + vega-lite / mermaid (chart / diagram)          │
        │ + @astrojs/rss (4 format별 feed)                 │
        │ → Cloudflare Pages (git push trigger, DEC-006)   │
        │                                                  │
        │ External cross-post (manual v0, auto v1+ Q-033): │
        │   Substack / YouTube / X — cite anchor는 자체    │
        │   사이트 URL canonical (INV-0022-2)              │
        └──────────────────────────────────────────────────┘

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
  Markdown vault (curated)     ← internal: Document hub, promoted Claim, Dossier,
                                  Scenario, Thesis, ContentDraft (drafts)
                                  publishing: vault/publications/{blog_long,
                                  newsletter, youtube_long, shorts}/ —
                                  자체 사이트 single source (ADR-0022 INV-0022-1)
  Neo4j Community (canonical)  ← Source, Document, Snapshot, Claim, Dossier, Scenario,
                                  Thesis, ContentDraft, Publication, Edge,
                                  ScenarioRevision, ManualClaimEntry, AccessIntervention
                                  (+ native FTS + v1 native vector index HNSW)
  SQLite + FTS5 (relational)   ← source_policy, policy_decisions, policy_learning_events,
                                  source_policy_rules, dataset_vintage, run_ledger,
                                  metrics_run/daily/alerts, evaluation_runs/cases,
                                  retrieval_pack_metrics, research_session, raw_cache_items
  R2 (permitted artifacts)     ← open-license dataset, 공식 허용 API 응답,
                                  자체 산출물(차트/export/v1+ TTS audio), 월별 JSONL
                                  audit export (raw third-party text 업로드 영구 금지)
  Cloudflare Pages (host)      ← vault/publications/ Astro build artifact —
                                  git push trigger (DEC-006), incremental deploy.
                                  vendor surface는 R2 + OpenAI (default LLM) + Anthropic (cross-vendor review + override) + Google AI Studio (optional 탐색 grounding, Tier 3 fallback) + CF Pages 통합
                                  (ADR-0014 intentional lock-in 연장, ADR-0022 INV-0022-5)
```

## Components

| 컴포넌트 | 책임 | 의존성 |
|---|---|---|
| Discovery | RSS / API / sitemap polling, manual intake CLI. **검색 grounding 보조 = Gemini 2.5 Flash 의 Google Search tool** (선택, Tier 3, 메인/리뷰 X — ADR-0023 INV-0023-5) | Source Registry, Google AI SDK (선택) |
| Source Registry (Neo4j ↔ SQLite 2-store seam) | **Logical Source Registry** = Neo4j Source node (property `source_id` PK with `src_<ULID>` value format, publisher_name, urls_root[], reliability_tier, collectability_score, source_perspective, access_method) **+** SQLite tables linked by `source_id` value (not constraint-FK): `source_material_policy` (archive_policy / raw_cloud_policy / external_llm_policy, `source_id` NOT NULL — ADR-0017), `source_registry_slug_map` (slug→source_id stable mapping for idempotent seed re-run, DEC-015), `policy_decisions` (immutable audit ledger, `source_id` nullable — ADR-0017 INV-0017-3). `source_policy_rules` (ADR-0021) 는 pattern-based rule template store 로 `source_id` 컬럼 자체가 없음 — seam 의 직접 참여자가 아니라 rule template store. Bootstrap: `data/sources_seed.yaml` → INFRA-1B.1 `seedSources()` 는 SQLite 만 채움. **Neo4j Source node bootstrap 은 현재 미구현** — `src/discovery/worker/snapshot-fingerprint.ts` P1-3 guard 가 Source 부재 시 dedup path 는 `TypedQueueError('source_not_found_in_graph')`, new path 는 plain `Error` → `processOneRow()` 매핑으로 `error_code='runtime_error'` (코덱스 round 2 P2 review). 후속 슬라이스 또는 운영자 manual Cypher 필요. 자세한 composition / FK seam contract / Why split 은 `docs/current/DATA_MODEL.md` "Source Registry — 2-store logical seam" 참조 | Neo4j Source 노드 + SQLite source_material_policy / source_registry_slug_map / policy_decisions (+ source_policy_rules rule template store, source-agnostic) |
| Collection Queue | fetch 대상 큐 (priority, dedup, throttle) | SQLite queue 테이블 |
| Policy Gate | mode-aware 검사 (inline_block / inline_warn / batch_report) — 8 위험 행동 트리거 inline_block | SQLite source_policy + policy_decisions ledger, Neo4j AccessIntervention 노드 |
| Fetcher | URL → fingerprint Snapshot 노드 (R2 binary는 permitted artifact만) | Neo4j Snapshot + R2, SQLite policy_decisions |
| Chunker / Indexer | Snapshot 텍스트 → chunk + Neo4j native FTS 인덱스 | Neo4j FTS, SQLite raw_cache_items (TTL) |
| Extractor (article) | Tier 2 default = GPT-5 mini (OpenAI). 한국어 long-context 시 Sonnet 4.6 standard override. confidence < 0.85 시 Tier 1 escalate (GPT-5.5 Pro standard) — ADR-0023 + DEC-010 | OpenAI SDK + Anthropic SDK (vendor 추상화 layer), run ledger (vendor/tier/domain_override_reason 필드) |
| Extractor (dataset) | **Data Science Module** (ADR-0024) — Polars + DuckDB + statsmodels + scipy deterministic. 1000+ rows / 50KB+ payload 는 LLM raw 입력 금지, derived metric 으로 압축 후 LLM (Tier 2) 합성 | Polars, DuckDB, statsmodels, scipy, derived_metric_ledger (SQLite) |
| Extractor (report) | Tier 2 default = GPT-5 mini with structure prompt + section-by-section page locator | OpenAI SDK + Anthropic SDK |
| Review Queue | reviewer manual + auto-accept threshold | SQLite review_queue 테이블 |
| Edge Ledger | Neo4j typed relationships (SUPPORTS / CONTRADICTS / QUALIFIES / UPDATES / SUPERSEDES) (ADR-0013) | Neo4j |
| Dossier Composer | 주제별 promoted claim + counterclaim 합성 | Neo4j + Markdown promoted_claim |
| Scenario Composer | drivers/assumptions/branches/falsifier/counterclaim(polarity-symmetric)/monitoring/impact_targets/impact_direction_by_target/transmission_channels + ScenarioRevision ledger | Neo4j Scenario/ScenarioRevision, edges |
| Scenario Validator | 5종 검사 (ADR-0009 INV-0009-1) + bidirectional balance + **Tier 0 adversarial pass cross-vendor review mandatory** (GPT-5.5 Pro xthink 생성 + Opus 4.7 xhigh review, ADR-0023 + DEC-010) | Edge Ledger, OpenAI SDK + Anthropic SDK (cross-vendor) |
| Editorial Intent Composer | Scenario revision → EditorialIntent (purpose / audience / tone / call_to_action / alignment_criteria / exclusion_criteria / bidirectional_weight_intent). LLM 자동 propose (Tier 1 GPT-5.5 Pro standard) → **운영자 명시 lock 의무** (`decided_by_operator = true`, ADR-0025 INV-0025-4) | Neo4j EditorialIntent + Markdown vault `editorial_intents/<eit_id>.md` + CLI `pipeline intent compose / show / lock` |
| Thesis Composer | EditorialIntent reference + Scenario revision 압축 → stance + market_stance (intent.bidirectional_weight_intent 와 align). 4-format ContentDraft 재사용 anchor. default = GPT-5.5 Pro standard (Tier 1). **high-stakes 운영자 flag 시 Tier 0 (GPT-5.5 Pro xthink + Opus 4.7 xhigh cross-review mandatory)** — ADR-0023 + DEC-010 + ADR-0025 | Neo4j Thesis (`:HAS_INTENT` → EditorialIntent), OpenAI SDK + Anthropic SDK (cross-vendor on flag) |
| ContentDraft Composer | Thesis + EditorialIntent + Dossier → draft (format별 분기, v0 blog_long only DEC-005) + 인용 ledger. EditorialIntent `:USES_INTENT` reference 의무 (ADR-0025 INV-0025-2). Astro Zod schema 가 `editorial_intent_id` dead-link build fail (ADR-0022 INV-0022-3 확장) | Markdown vault, Neo4j ContentDraft |
| Cite Check | 5 block (stale / retracted / horizon / unit / overclaim) + access_intervention block + 1 warning v1+ (one-sided thesis). overclaim LLM judge = GPT-5 nano 생성 + **Haiku 4.5 cross-vendor review mandatory** (Tier 3, ADR-0023 INV-0023-4 + DEC-010) | Edge Ledger, Scenario, OpenAI SDK + Anthropic SDK (cross-vendor), AccessIntervention |
| Publication Ledger | live / corrected / retracted state + cascade alert | Neo4j Publication |
| Publishing Site | Astro 5.0 (Content Collection + Zod schema) + Cite/Retraction/Correction 컴포넌트 + pagefind + RSS + vega-lite/mermaid → Cloudflare Pages 호스팅. vault publications/ single source. build-time cite gate (ADR-0015 일부 enforcement) | vault/publications/, Cloudflare Pages, R2 (chart/audio 산출물) |
| Cross-post Surface | Substack / YouTube / X 발행 (v0 manual, v1+ API integration Q-033). 모든 외부 발행물의 cite footnote가 자체 사이트 URL canonical anchor (ADR-0022 INV-0022-2) | Publishing Site URL |
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
  - `pipeline intent compose <scenario_revision_id> [--tone ...] [--audience <str>] [--weight-intent ...]` (LLM 자동 propose + 운영자 명시 승인) — ADR-0025
  - `pipeline intent show <eit_id>` / `pipeline intent lock <eit_id>`
  - `pipeline thesis compose <scenario_revision_id> --intent <eit_id>`
  - `pipeline draft compose <thesis_id> --format {blog_long|youtube_long|shorts|newsletter} --intent <eit_id>` (intent reference 의무 — ADR-0025 INV-0025-2)
  - `pipeline publish <draft_id>` (cite check 5+1 gate — vault/publications/
    하위 적합 subdirectory에 ContentDraft 파일 emit)
  - `pipeline metrics report --since <date>`
  - ~~`pipeline vault-sync`~~ — DEC-006 으로 v0에서 제거. vault publications/
    가 자체 사이트 single source 이므로 git push 가 단일 sync trigger.
    v1+ 외부 플랫폼 auto cross-post(Q-033) 도입 시 재도입 검토
  - `pipeline site build` (선택, Astro local preview용 — Cloudflare Pages
    가 git push 시 자동 build이므로 운영에는 불필요)
- HTTP API는 PUB 단계 이후 검토.
- 이벤트/메시지: GitHub Actions cron / 로컬·자체 서버 cron (self-host only)
- 외부 통합:
  - Anthropic SDK (Haiku 4.5 + Sonnet 4.6, prompt caching, batch API)
  - Cloudflare R2 (S3 compatible API, permitted artifact only)
  - **Cloudflare Pages** (자체 사이트 호스팅 — git push trigger, ADR-0022)
  - 소스별 RSS / API client (Discovery, Tier A)
  - v1+ Substack / YouTube Data / X API (auto cross-post — Q-033)
  - v1+ TTS provider API (ElevenLabs / OpenAI TTS / Coqui self-host — Q-031)
- Neo4j 접속: bolt://localhost:7687 (self-host Docker / binary) + APOC
  standard (v0); GDS Community 는 v1+ (Q-024 resolution, INFRA-1A.2). Enterprise
  feature 사용은 별도 ADR 의무.

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
- ~~ADR-0011~~ (object model superseded by ADR-0025): 9-stage object model
- **ADR-0025** (supersedes ADR-0011 object model): 10-stage object model
  with EditorialIntent — Scenario → EditorialIntent → Thesis anchor. 운영
  자 명시 lock 의무, 4-format draft 재사용 anchor, NFR-002 reproducibility
  강화
- ~~ADR-0006~~ (superseded by ADR-0023): LLM routing v1 — Haiku 1차 + Sonnet
  escalate (Anthropic only)
- **ADR-0023** (supersedes ADR-0006): LLM routing v2 — GPT default +
  Anthropic dual-vendor (performance-tiered) + Google exploration-only +
  minimal 3-stage cross-vendor review (preflight cite check / scenario
  validate adversarial / high-stakes thesis)
- **ADR-0024**: Data Science Module — deterministic dataset processing
  (Polars + DuckDB + statsmodels + scipy) + derived_metric_ledger
  reproducibility 3-tuple + 1000 rows / 50KB raw dataset → LLM 직접 입력
  금지
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
- **ADR-0022**: Publishing site — Astro 5.0 + Cloudflare Pages + vault
  publications/ single source. Build-time cite gate (Zod schema), cite
  anchor canonical, correction visibility 컴포넌트. ContentDraft 4-format
  1:1 매핑.

## Open Questions

- Q-001 ~ Q-034: PRD §Open Questions 참조 (per-file `docs/questions/Q-<NNN>.md`).
  resolved: Q-022 (DEC-004), Q-026 (DEC-006).
  신규 v1+: Q-031 (TTS), Q-032 (4-format auto-generate phasing), Q-033 (외부
  플랫폼 auto cross-post), Q-034 (auto retraction trigger)

## Related Requirements

- REQ-001 (10-stage 모델) → 전 컴포넌트가 10-stage anchor (ADR-0025 supersedes ADR-0011)
- REQ-002 (Neo4j canonical graph) → Neo4j 컴포넌트 + native FTS (ADR-0012,
  ADR-0014)
- REQ-003 (Snapshot fingerprint, R2 raw 금지) → Fetcher + R2 permitted (ADR-0012)
- REQ-004 (Markdown promoted only) → Markdown vault (ADR-0012)
- REQ-005 (ID 체계) → 전 노드 PK + Markdown frontmatter
- REQ-006 (confidence 분해 + collectability) → Source/Document/Claim/Scenario
  schema (ADR-0005, ADR-0016)
- REQ-007 (evidence nullable + quote_reason) → Extractor + Cite Check (ADR-0015)
- REQ-008 (Neo4j typed relationships) → Edge Ledger (ADR-0013)
- REQ-009 (extractor 분리) → 3종 Extractor (ADR-0023 supersedes ADR-0006, + ADR-0024 Data Science Module)
- REQ-010 (LLM routing) → Routing 로직 (ADR-0023 supersedes ADR-0006, + DEC-010 cost ceiling lock)
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
- REQ-026 (v0 4 메타 카테고리) → Source Registry tag + Dossier topic
  (DEC-004 supersedes Q-022)
- REQ-027 (자체 사이트 publishing primary + build-time cite gate +
  cite anchor canonical) → Publishing Site 컴포넌트 (ADR-0022)
- NFR-001 (1만건 < 1s p95) → Neo4j native FTS + index 정책 (SPIKE-001로 검증)
- NFR-002 (reproducibility) → scenario_revisions + edge ledger (ADR-0009)
- NFR-003 (5-hop trace) → 10-stage object model + ID propagation (ADR-0025
  supersedes ADR-0011) + DEC-020 Q-042 lock. 단축 trace path = Publication →
  ContentDraft → Thesis → Scenario → Claim → Snapshot (EditorialIntent /
  Source / Document 는 metadata anchor 로 선택적 skip)
- NFR-004 (cost 상한) → Run Ledger + throttling. **Current code state**:
  OPS-1A.1 까지 landed (run ledger + `getDailyCostUsd` / `getDailyCostBreakdown`,
  ADR-0023 INV-0023-7 — vendor / tier / cross_vendor_review_of /
  domain_override_reason 필드 기록). **Planned (OPS-1A.2 슬라이스, P0-M3)**:
  `src/ops/quota-enforcement.ts` 일반화 quota module + QuotaKind enum 으로
  Tier 0 daily / soft / hard / weekly / backfill 일괄 enforce (DEC-010
  cost ceiling lock + DEC-020 Q-046 resolution anchor). 본 module 미구현
  상태 — AC-019 status defined, OPS-1A.2 진입 시 implement
- NFR-005 (quote ≤ 200자 + quote_reason) → Extractor assertion + Cite Check
  (ADR-0015)
- NFR-006 (snapshot durability via fingerprint) → canonical_text_hash diff
  primary (ADR-0010 INV-0010-4, DEC-021 Q-049 lock) + raw_body_hash fallback
  (ADR-0012)
- NFR-007 (extractor 확장) → Extractor interface (ADR-0023 supersedes ADR-0006, + ADR-0024 Data Science Module)
- NFR-008 (legal safety, raw 0건 cloud) → Policy Gate + Fetcher (ADR-0012,
  ADR-0017)
- NFR-009 (bidirectional balance) → Metrics Framework + Cite Check warning
  (ADR-0019, ADR-0020)
- NFR-010 (publish_traceability — 외부 플랫폼 cite footnote 100% 자체 사이트
  URL anchor) → Cross-post lint + ADR-0022 INV-0022-2
