# 01 PRD — Product Requirements Document

## Problem

세계 경제·지정학·감염병 등 변동성 높은 주제에 대해 1인 운영자가 신뢰 가능한
리서치 콘텐츠를 지속 생산하려 한다. 단순 자연어 요약은 조회·반증·추적이
불가능하고, 원문 전체를 vault 또는 클라우드에 저장하는 것은 저작권·약관·평판
리스크가 있다. 출판 콘텐츠의 한 문장이 어떤 source claim까지 5단계 이내로
역추적 가능하고, 시나리오의 가정·반증조건·반대 증거를 모두 추적하며, 위험
요인뿐 아니라 기회·회복탄력성·비대칭 영향까지 양방향으로 다룰 수 있는
파이프라인이 필요하다.

이 시스템은 **archive(자료 보관소)가 아니라 출처 추적 가능한 claim/scenario/
thesis/content graph를 생산하는 시나리오 인텔리전스 파이프라인**이다 (ADR-0012,
ADR-0019).

## Users & Goals

- 주요 사용자:
  - 운영자(현재는 1인) — 도메인 결정자 + 콘텐츠 작성자
  - 보조 LLM 에이전트 — 후보 claim 추출, dossier 합성, scenario validate,
    thesis 압축, cite check
- 사용자의 목표:
  - **Tier A 한계 내** 자동 수집(공식 API/RSS/open dataset) + Tier B/C/D는
    manual fallback (ADR-0016)
  - 외부 원문은 기본 비저장 — 메타데이터 + content_hash + locator + 정당한
    사유 명시 quote만 (ADR-0012, ADR-0015)
  - 시나리오의 가정·반증조건·반대 증거를 모두 추적 (counterclaim first 강제,
    ADR-0009, ADR-0019 양방향)
  - 같은 Thesis로 블로그/유튜브 long/shorts/뉴스레터 4 format 재사용
    (ADR-0011). v0 turn-key 활성 format은 blog_long 1개 (DEC-005). 나머지
    3 format은 v1+ phasing (Q-032)
  - 콘텐츠의 모든 주장이 source claim까지 5단계 이내 역추적 (publication
    preflight 5-check, ADR-0015)
- 비즈니스 목표:
  - 1인 운영자가 신뢰 가능한 macro 콘텐츠를 지속 발행
  - 같은 source set + scenario 모델이 주어지면 다른 운영자가 같은 결론에
    도달할 만큼 재현 가능한 결정 흔적 (NFR-002)
  - 모든 cloud 업로드 객체에 archive_policy 통과 audit log, raw third-party
    text 0건 cloud 저장 (ADR-0012)

## Scope

### In-scope

- 9-stage 객체 모델 (Source → Document → Snapshot → Claim → Dossier → Scenario
  → Thesis → ContentDraft → Publication, ADR-0011)
- Source registry + Tier A-D 분류 + collectability_score (ADR-0016)
- Discovery (RSS / API / sitemap) → Collection Queue → Fetcher (fingerprint
  record, R2 binary 보관은 예외) → Chunker / Indexer → Claim 추출
- Claim evidence (nullable quote + quote_reason + storage_level + locator +
  quote_hash, ADR-0015) + extraction provenance + claim lifecycle 8-state
  (draft / confirmed / disputed / stale / retracted / source_changed /
  source_unavailable / needs_recorroboration)
- 주제별 Dossier 합성, Scenario(drivers/assumptions/branches/falsifier/
  counterclaim/monitoring/**impact_targets/impact_direction_by_target/
  transmission_channels**) 모델링, ScenarioRevision ledger (ADR-0009)
- Thesis(stance + market_stance optional) — 4 format ContentDraft 재사용
  anchor (ADR-0011, ADR-0019)
- ContentDraft → Publication 추적, cite check 5종 block + 1 warning (stale /
  retracted / horizon mismatch / unit mismatch / overclaim / unresolved
  HIGH/CRITICAL access_intervention; v1+ one-sided thesis warning, ADR-0015)
- Edge ledger via Neo4j (supports / contradicts / qualifies / updates /
  supersedes; v1+ weakens / strengthens / mitigates / amplifies, ADR-0013)
- Storage 분담: **Neo4j (graph objects)** + **SQLite + FTS5 (relational
  metadata)** + **R2 (permitted artifacts only)** + Markdown (curated view)
  (ADR-0012, ADR-0014)
- Source policy gate mode-aware (inline_block / inline_warn / batch_report) +
  access_interventions Neo4j 노드 (ADR-0017)
- Manual feedback inbound — `pipeline feedback add|bulk|link|from-report` +
  `pipeline intervention review <id>` 3-option (ignore / manual_claim /
  temp_text) (ADR-0018)
- Bidirectional framing — source_perspective tag, scenario.impact_targets,
  thesis.stance, EvidencePack multi-section, balanced framing standards of
  care (ADR-0019)
- System metrics framework (6 categories + evaluation harness, ADR-0020)
- Policy learning framework (rule-based, auto-tighten allowed / auto-relax
  prohibited, ADR-0021)
- LLM 비용 가드(Haiku 1차 + Sonnet escalate, prompt caching, batch API,
  auto-accept threshold, ADR-0006)
- **자체 사이트 publishing primary** (Astro 5.0 + Cloudflare Pages + vault
  publications/ single source) — ContentDraft 4-format 매핑, build-time
  cite gate (Zod schema), correction visibility 컴포넌트 (ADR-0022)
- **v0 turn-key publish scope** — blog_long 1개 + 자체 사이트 + manual
  Substack/YouTube/X cross-post + manual correction approve. TTS deferred,
  auto retraction deferred (DEC-005)

### Out-of-scope

- 실시간 뉴스 피드 / 대시보드 (변동성에 휘둘리지 않는 시간 무관 수집이 목표)
- 일반 PKM 영역(Inbox / SlipBox 등) 재구조화
- 마크다운 본문에 모든 candidate claim을 자동 생성 (vault 무너뜨림 — ADR-0012)
- 단일 LLM extractor로 article / dataset / report 통합 처리 (parser 분리 —
  ADR-0006)
- 자동 publish 자동화 (사람 운영자가 최종 발행 결정)
- **v0 TTS 파이프라인** (youtube_long / shorts script → audio 변환은 v1+
  외주 또는 자체 — Q-031)
- **v0 외부 플랫폼 auto cross-post** (Substack / YouTube / X API
  integration 은 v1+ — Q-033)
- **v0 자동 retraction trigger** (manual approve only — auto trigger는 v1+
  cite check / access_intervention 기반 일부 자동화 — Q-034)
- **Dossier / Scenario / Thesis / promoted Claim 의 자체 사이트 공개 노출**
  (internal canonical store 유지 — ADR-0022 INV-0022-4, DEC-005)
- **봇 감지 우회를 production dependency로** (ADR-0016 INV-0016-1)
- **Raw third-party text의 클라우드 업로드** (ADR-0012 INV-0012-3, raw_cloud_policy=always_prohibited default)
- **다양한 graph DB 동시 지원 / vendor-neutral 마이그레이션 자동화** (ADR-0014
  intentional lock-in)
- ML fine-tuning 기반 policy 학습 (ADR-0021 rule-based 한정)

## Requirements

### Functional (REQ-###)

> Source 열은 second-brain ideation `research-content-pipeline-architecture`
> Round 1~25 의 결정 차수를 가리킨다 (R3 lock + R4~R25 supersede 누적).

| ID | 요구사항 | 우선순위 | 관련 AC | Source (Round) | ADR |
|---|---|---|---|---|---|
| REQ-001 | 객체 모델은 9-stage(Source → Document → Snapshot → Claim → Dossier → Scenario → Thesis → ContentDraft → Publication)이며 source layer는 4-tier(Source/Document/Snapshot/Claim)로 분리한다 | must | AC-001 | R3, R6 | ADR-0011 |
| REQ-002 | graph objects(Source, Document, Snapshot, Claim, Dossier, Scenario, Thesis, ContentDraft, Publication, Edge, ScenarioRevision, ManualClaimEntry, AccessIntervention)는 Neo4j Community Edition을 canonical store로 사용한다 | must | AC-002 | R18, R19 | ADR-0012, ADR-0014 |
| REQ-003 | Snapshot은 fingerprint record(URL, accessed_at, content_hash, locator)다. R2 binary 보관은 예외(open-license dataset / 공식 허용 API / 자체 산출물)로만 허용. 일반 raw text R2 업로드는 영구 금지 (raw_cloud_policy=always_prohibited) | must | AC-003 | R8, R14 | ADR-0012 |
| REQ-004 | Markdown vault에는 Document hub, Dossier, Scenario, Thesis, ContentDraft, Publication, scenario에 인용된 promoted claim만 둔다. candidate claim 자동 markdown 생성은 금지 | must | AC-004 | R3 | ADR-0012 |
| REQ-005 | ID 체계는 `src_/doc_/snap_/clm_/dos_/scn_/ths_/drf_/pub_/edge_/run_/aci_/mcl_` 접두 + 단조 증가 식별자다 | must | AC-005 | R3, R6, R18 | ADR-0011 |
| REQ-006 | confidence 단일 필드는 사용하지 않는다. Document `reliability_tier`, Claim `extraction_confidence` + `claim_status`(8-state), Scenario assumptions[] `weight`, Source `collectability_score`로 분해한다 | must | AC-006 | R3, R9, R17 | ADR-0005, ADR-0011, ADR-0016 |
| REQ-007 | claim evidence는 (quote nullable + locator + quote_hash + quote_reason + storage_level) 5-tuple이다. quote는 schema-level nullable, storage_level=excerpt_evidence일 때만 채워지며 quote_reason 명시 필수 | must | AC-007 | R3, R10 | ADR-0015 |
| REQ-008 | edge 관계는 Neo4j typed relationships로 저장한다. v0 5종(SUPPORTS / CONTRADICTS / QUALIFIES / UPDATES / SUPERSEDES). frontmatter `supports[]/contradicts[]` 배열은 금지 | must | AC-008 | R3, R18 | ADR-0013 |
| REQ-009 | extractor는 article(LLM) / dataset(parser) / report(LLM with structure prompt)로 분리한다 | must | AC-009 | R2, R3 | ADR-0006 |
| REQ-010 | LLM 호출은 Haiku 4.5 1차 + Sonnet 4.6 escalate, prompt caching, batch API를 사용한다. `reliability_tier=high` ∧ `extraction_confidence ≥ 0.85`일 때 auto-accept한다 | must | AC-010 | R3 A1 | ADR-0006 |
| REQ-011 | discovery(RSS / API / sitemap) → Source Registry(Tier A-D + collectability_score) → Collection Queue → fetch / fingerprint Snapshot / chunk → extract → review → search / query → dossier → scenario validate(impact_targets/transmission_channels) → thesis(stance + market_stance) → content + cite check 순서로 구현한다 | must | AC-011 | R3, R6, R17, R19 | (roadmap) |
| REQ-012 | scenario validate는 falsifier / counterclaim(polarity-symmetric) / monitoring signal 누락을 차단한다. counterclaim direction tag(bull/bear/regime/mixed) manual v0 | must | AC-012 | R3, R19 | ADR-0009, ADR-0019 |
| REQ-013 | cite check는 v0에서 5종 block(stale / retracted / horizon mismatch / unit mismatch / overclaim) + unresolved HIGH/CRITICAL access_intervention block 추가 = 5+1 block. v1+에서 6번째 warning(one-sided thesis without opposing/mitigating/uncertainty) | must | AC-013 | R3, R18, R23 | ADR-0015 |
| REQ-014 | scenario는 시간에 따라 진화한다. `scenario_revisions` ledger + `SUPERSEDES`/`UPDATES` edge로 변경 이력을 추적한다 | must | AC-014 | R3 A4 | ADR-0009, ADR-0013 |
| REQ-015 | review queue는 throttling 정책을 적용한다(`reliability_tier=high` ∧ `extraction_confidence ≥ 0.85` 자동 confirm) | must | AC-015 | R3 A3 | ADR-0006, ADR-0010 |
| REQ-016 | stale 트리거는 (a) 시간 기반 (b) snapshot diff 기반 (c) counterclaim 등록 시 셋 다 적용한다 | must | AC-016 | R3 A2 | ADR-0010 |
| REQ-017 | Source registry는 Tier A-D 분류 + collectability_score(automation_reliability, legal_policy_clarity, anti_bot_friction, preferred_mode) + access_method + source_perspective tag를 보유한다. 봇 감지 우회는 production dependency 아님 | must | AC-022 | R17 | ADR-0016, ADR-0019 |
| REQ-018 | Source policy 3 필드 (archive_policy / raw_cloud_policy / external_llm_policy) + mode-aware policy_gate (inline_block / inline_warn / batch_report). 위험 행동은 어느 mode에서도 inline_block. Discovery=inline_warn / Extract·Cache·Embed·Cloud upload=inline_block / 탐색·콘텐츠 제작=batch_report / Publication preflight=inline_block | must | AC-023 | R14, R18 | ADR-0017 |
| REQ-019 | 탐색·콘텐츠 제작 중 막힌 source는 access_interventions Neo4j 노드에 누적되고 세션 종료 시 batch report. severity 자동 산정(deterministic default, LLM 옵션). unresolved HIGH/CRITICAL은 publication 핵심 근거 사용 금지 | must | AC-024 | R18 | ADR-0017, ADR-0015 |
| REQ-020 | Manual feedback inbound — `pipeline feedback add|bulk|link|from-report` + `pipeline intervention review <id>` 3-option. manual_claim_entries는 user_written_claim / user_opinion / referenced_quote 3-way 분리 (한 row 한 필드만). raw_text_stored=false 강제 | must | AC-025 | R18 | ADR-0018 |
| REQ-021 | Scenario는 impact_targets[] + impact_direction_by_target (dict, target별 upside/downside/mixed/neutral) + transmission_channels[]를 보유한다. asymmetric은 derive. Thesis는 stance(constructive/cautionary/neutral/mixed/asymmetric/exploratory) + market_stance(optional v0, 필수 v1; bullish/bearish/range_bound/volatility_up/volatility_down/neutral) | must | AC-026 | R23, R25 | ADR-0019 |
| REQ-022 | Source는 source_perspective tag (risk_observer/opportunity_observer/neutral/mixed)를 보유한다. Q21 Tier A seed 작성 시 분포 균형 강제 (risk_observer ≤ 50%, opportunity_observer ≥ 25%, neutral ≥ 15%) | must | AC-027 | R23 | ADR-0019 |
| REQ-023 | RAG `build_evidence_pack`은 v0에서 4 section(supporting_evidence / opposing_evidence / mitigating·amplifying / monitoring_signals)을 출력한다. LLM synthesis prompt는 mode 분리(balanced / specific) | must | AC-028 | R23, R25 | ADR-0019 |
| REQ-024 | System metrics — v0 측정 9+개 (unsupported_sentence_rate, counterclaim_presence_rate, stale_violation_rate, policy_block_count, manual_claim_entry_rate, db_size_growth_rate, upside_claim_presence_rate, downside_claim_presence_rate, one_sided_warning_rate). 6 카테고리(데이터 품질/운영 성능/Policy safety/콘텐츠 production/추적성/시스템 건강) + evaluation harness | must | AC-029 | R15, R23 | ADR-0020 |
| REQ-025 | Policy learning은 rule-based, "auto-tighten allowed, auto-relax prohibited". v0 Pattern 1 (source policy refinement). 자동 적용 X — propose만, accept는 사용자. 잘못된 rule은 자동 demote | must | AC-030 | R15 | ADR-0021 |
| REQ-026 | 도메인 카테고리는 v0에서 **4 메타 카테고리** (정책 / 경제 / 사회 / 대중문화) 로 lock한다 (DEC-004, Q-022 supersede). 기존 8 enum(macro_finance / geopolitics_security / health_biosecurity / energy_commodities / trade_supply_chain / climate_environment / technology_cyber_ai / digital_assets) + tag 5개는 4 메타 카테고리의 `subtopic_tags[]` 로 강등 보존 — v1+ 누적 dossier 기반 재승격(Q-032) | must | AC-031 | R22 | DEC-004 (supersedes Q-022) |
| REQ-027 | Publishing primary 는 **자체 사이트 (Astro 5.0 + Cloudflare Pages)** 이고 vault `publications/` 디렉토리(4 subdirectory: blog_long / newsletter / youtube_long / shorts)가 single source 다 (ADR-0022). 외부 플랫폼(Substack / YouTube / X)은 cross-post target — 모든 외부 발행물의 cite footnote는 자체 사이트 URL을 canonical anchor 로 가리킨다 (ADR-0022 INV-0022-2). v0 turn-key 발행 scope 는 blog_long 1개 + 자체 사이트 + manual cross-post + manual correction approve (DEC-005). TTS / auto cross-post / 자동 retraction trigger 는 v1+ (Q-031 / Q-033 / Q-034). cite check 5+1(ADR-0015)의 일부는 Astro Content Collection + Zod schema 로 **build-time enforce** (dead-link cite_refs / invalid status 는 build fail, ADR-0022 INV-0022-3) | must | AC-013, AC-018, AC-028 | (R25 + v0 turn-key) | ADR-0022, DEC-005, DEC-006 |

### Non-functional (NFR-###)

| ID | 카테고리 | 목표 | 측정 방법 | 관련 AC | Source (Round) | ADR |
|---|---|---|---|---|---|---|
| NFR-001 | performance | graph object 1만 건 시점에서 단일 검색 < 1초 (p95) | bench script: Neo4j Community + native FTS cold cache 검색, 1만 graph object fixture (SPIKE-001 갱신 — SQLite+FTS5에서 Neo4j로 대상 변경) | AC-002 | (rubric) | ADR-0012, ADR-0014 |
| NFR-002 | reproducibility | 동일 source set + scenario 모델로 다른 운영자가 같은 결론 도달 가능 | scenario evidence + edge ledger reproducibility test (수동 + diff) | AC-017 | (rubric) R3 A4 | ADR-0009 |
| NFR-003 | traceability | 콘텐츠 한 문장 → 원 source까지 5단계 이내 (Publication → ContentDraft → Thesis → Scenario → Claim → Snapshot → Source) — 9-stage 안에서 5단계 이내 유지(선택적 단계 skip) | cite check report에서 trace depth 측정 | AC-018 | (rubric) | ADR-0011 |
| NFR-004 | cost | 일일 LLM 비용 상한 설정 + 초과 시 조용한 backoff | `run_` 단위 비용 ledger + threshold alert | AC-019 | R3 A1 | ADR-0006 |
| NFR-005 | safety | 외부 인용 시 `quote ≤ 200자` 강제 + quote_reason 명시 필수 + storage_level=excerpt_evidence | extract pipeline assertion + cite check | AC-007 | R3, R10 | ADR-0015 |
| NFR-006 | durability | snapshot은 fingerprint(URL+content_hash+locator)로 변경 감지 가능. 원문 변경 후 재검증 시 새 fetch 필요 (raw bytes 미보관) | content_hash diff 검출 + R2 round-trip은 permitted artifact만 | AC-020 | R8 | ADR-0012 |
| NFR-007 | maintainability | 새로운 source type을 LLM/parser 분리 원칙 안에서 추가 가능 | extractor interface contract + 1개 신규 type 추가 dry-run | AC-021 | R2, R3 | ADR-0006 |
| NFR-008 | legal_safety | 모든 cloud 업로드 객체에 archive_policy 통과 audit log, raw third-party text 0건 cloud 저장 | policy_decisions ledger 검사 (block 케이스 빈도 + 모든 R2 upload의 source_material_policy check) | AC-032 | R8, R14 | ADR-0012, ADR-0017 |
| NFR-009 | bidirectional_balance | publication 콘텐츠가 한 방향(direction 6값 중 하나)으로 trailing 50개 ≥ 70% 쏠리면 alert (v1+) | thesis_polarity_distribution metric | AC-033 | R23, R25 | ADR-0019, ADR-0020 |
| NFR-010 | publish_traceability | 자체 사이트의 모든 publication URL은 canonical cite anchor — 외부 플랫폼 발행물 100%가 자체 사이트 URL을 cite footnote로 가리킨다 (cross-post lint 검사) | cross-post lint (ADR-0022 INV-0022-2) | AC-018 | R25 + v0 turn-key | ADR-0022 |

## Assumptions

- ASM-001: 운영자가 Cloudflare R2 + SQLite(local) + self-host Neo4j Community
  Edition(Docker / binary) 운영을 감당할 수 있다.
- ASM-002: Haiku 4.5 + Sonnet 4.6의 prompt caching + batch API가 비용 모델을
  유지할 만큼 캐시 적중률을 만든다.
- ASM-003: Markdown vault에 promoted claim만 들어가도 운영자가 컨텍스트를
  잃지 않는다.
- ASM-004: Neo4j Community Edition + native FTS가 1만 graph object 규모에서
  NFR-001을 만족한다 (SPIKE-001로 검증, 대상 SQLite+FTS5에서 Neo4j로 갱신).
- ASM-005: 외부 source 대부분이 fetch 시점 sha256 content_hash로 변경 감지가
  충분하다.
- ASM-006: Tier A source(공식 API/RSS/open dataset) 30~50개 seed로 1인 콘텐츠
  production scale을 충족 (매일 수천 RSS items + 주당 수십~수백 reports).
  Tier B/C/D는 manual fallback으로 흡수.
- ASM-007: Neo4j Community GPL v3 boundary는 1인 internal use에서 contagion
  없다 (Q-020 검토 후 확인).

위 가정 중 결과에 큰 영향을 주는 가정은 `03_RISK_SPIKES.md`에 SPIKE-###로 옮긴다.

## Constraints

- LLM-only 작성 환경(사람이 코드를 손으로 자주 편집하지 않음). 모든 산출물은
  LLM 에이전트가 frontmatter + boilerplate invariant tracking을 따라 작성.
- Markdown은 사람용, graph는 Neo4j, relational metadata는 SQLite, permitted
  artifact는 R2. 한 곳에서 모든 책임을 지지 않는다 (ADR-0012).
- self-host only — Cloudflare Workers / D1 같은 managed edge는 도입 X.
  GitHub Actions cron 또는 로컬·자체 서버 cron만 (R16 ADR 결정).
- 외부 의존성 통제: tsx CLI + Anthropic SDK + Neo4j (APOC/GDS native) +
  SQLite. Python community detection 의존성 X (GDS 대체). vendor-neutral graph
  migration 자동화 X (ADR-0014 intentional lock-in).
- second-brain ideation `research-content-pipeline-architecture` Round 1~25
  의 "Current Canonical Direction" 섹션을 따른다. 변경하려면 새 ADR 또는
  supersedes.
- 코드/CI 채택 boilerplate는 `alxdr3k/boilerplate` (mode: greenfield).
- main 브랜치 직접 push 허용(global policy의 actwyn/concluv/boilerplate/
  my-skill/devdeck/k-world-monitor 군).

## Open Questions

상위 수준 열린 질문은 `07_QUESTIONS_REGISTER.md` → per-file `docs/questions/
Q-<NNN>.md`로 이동.

- Q-001: scenario horizon enum 정의 (1Q / 1Y / 5Y / generational?)
- Q-002: Dossier `stale_after` 기본값 (주제별로 다른가?)
- Q-003: Publication 정정(correction) ledger의 트리거
- Q-004: SQLite relational metadata와 vault `_System/Indexes/*.jsonl`의 책임
  분담
- Q-008: Thesis ID 체계 (`ths_<sha256[0:10]>` vs draft 내부 thesis_text)
- Q-012: graph DB 도입 후 SQLite ↔ Neo4j sync 정책 (CDC vs batch)
- Q-020: Neo4j Community GPL v3 boundary (1인 internal use vs 배포)
- Q-021: Tier A source universe 초기 seed 30~50개 + perspective 분포 균형
- ~~Q-022~~: v0 카테고리 8개 — **resolved by DEC-004** (v0 4 메타
  카테고리로 축소: 정책 / 경제 / 사회 / 대중문화. 8 enum + tag 5개는
  subtopic_tags[] 로 강등 보존)
- Q-024: Neo4j-specific 기능 활용 boundary (APOC standard vs extended, GDS
  Community 알고리즘 list, Cypher 5.x 범위)
- Q-025: 외부 repo 부트스트랩 cadence (week 1-9)
- ~~Q-026~~: Vault sync trigger — **resolved by DEC-006** (ADR-0022 자체 사이트
  stack 결정 후 git push 단일 trigger로 단순화. Cloudflare Pages git
  integration이 publications/ 변경분 자동 build + deploy)
- Q-031: TTS v1 timing + provider (외주 vs 자체) — DEC-005 v0 TTS deferred
  연장
- Q-032: ContentDraft 4-format auto-generate phasing (v1+ youtube_long /
  shorts / newsletter) — DEC-005 v0 blog_long only 연장
- Q-033: 외부 플랫폼 auto cross-post timing (Substack / YouTube / X) —
  DEC-005 v0 manual 연장
- Q-034: Auto retraction trigger 정책 v1+ (manual approve → auto 전환 기준)
  — DEC-005 v0 manual approve 연장
- Q-027: 백업 schedule + R2 lifecycle (Neo4j dump 일간 30d / SQLite snapshot
  일간 90d / JSONL audit 월간 1y / R2 derived 무기한 / open-license versioned)
- Q-028: LLM API cost 통제 정책 (prompt caching + batch + per-day ceiling)
- Q-029: ImpactAssessment v0 embedded dict vs v1 별도 Neo4j 노드
- Q-030: counterclaim multi-relation v1 도입 우선순위 (weakens/strengthens/
  mitigates/amplifies)

## Success Metrics

- 수집 큐가 자동 discovery로 채워진다(매주 신규 큐 entry > 0).
- 100% 의 promoted claim이 evidence locator + extraction provenance +
  lifecycle status + (excerpt_evidence인 경우) quote_reason을 가진다.
- 100% 의 published Publication이 cite check 5+1을 pass한다 (block 5 +
  warning 1; warning은 v1+).
- graph object 1만 건 시점에서 NFR-001 검색 p95 < 1초.
- 운영자가 같은 source set + scenario 모델을 다시 돌렸을 때 동일 promoted
  claim set + scenario branches 결론에 도달.
- raw third-party text의 cloud 저장 0건 (NFR-008).
- thesis_polarity_distribution이 trailing 50개에서 한 방향 ≥ 70% 쏠림 0건
  (v1+ NFR-009).
