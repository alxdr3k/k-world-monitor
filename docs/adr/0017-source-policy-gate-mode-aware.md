---
id: adr-0017
type: adr
title: Source policy gate (archive/raw_cloud/external_llm policy) — mode-aware (inline_block / inline_warn / batch_report) with access_interventions
status: accepted
created_at: 2026-05-11
updated_at: 2026-05-11
deciders: [user, claude-opus-4-7, gpt]
supersedes: []
superseded_by: []

scope:
  in:
    - storage.sqlite.source_policy
    - storage.sqlite.policy_decisions
    - storage.neo4j.access_intervention_node
    - pipeline.policy_gate
    - pipeline.policy_gate.discovery_mode
    - pipeline.policy_gate.extract_cache_embed_mode
    - pipeline.policy_gate.exploration_mode
    - pipeline.policy_gate.publication_preflight_mode
    - pipeline.policy_gate.batch_report
  out:
    - storage.policy.tier_classification     # Tier A-D는 ADR-0016
    - pipeline.manual_feedback               # manual feedback은 ADR-0018
    - storage.sqlite.policy_learning_events  # policy learning은 ADR-0021

invariants:
  - id: INV-0017-1
    statement: source_policy는 3 필드를 보유한다 — archive_policy ∈ {metadata_only, excerpt_only, full_snapshot_allowed, do_not_collect}, raw_cloud_policy ∈ {always_prohibited, allowed_public_data_only}, external_llm_policy ∈ {allowed, manual_review_required, prohibited}. default는 archive_policy=metadata_only / raw_cloud_policy=always_prohibited / external_llm_policy=manual_review_required (R7/Q2, R14/Q9-5)
    status: active
    cross_ref_code:
      - src/storage/source-registry/seed.ts:seedSources
  - id: INV-0017-2
    statement: policy_gate는 mode-aware다 — {inline_block, inline_warn, batch_report}. 단계별 default mode를 따른다 (R18)
    status: active
    cross_ref_code:
      - src/utils/enums.ts:POLICY_GATE_MODE
  - id: INV-0017-3
    statement: 단계별 default policy_gate_mode — Discovery/Initial fetch=inline_warn / Extract/Cache/Embed/Cloud upload=inline_block / 탐색(scenario·thesis interactive)=batch_report / 콘텐츠 제작 추가 fetch=batch_report (단 위험 행동은 inline_block) / Publication preflight=inline_block
    status: active
    cross_ref_code:
      - src/pipeline/policy-gate/risk-triggers.ts:stageDefaultMode
  - id: INV-0017-4
    statement: 위험 행동(source policy unknown 또는 unauthorized 상태의 raw external LLM 전송 / paywalled·proprietary full-text fetch / terms violation(no scraping·no AI·no archive·no redistribution) / wire-service full text / article·report 원문 quote·cache / 기사·리포트 도표·스크린샷 콘텐츠 추가 / raw source embedding·indexing / raw source cloud upload)은 어느 mode에서도 inline_block 유지 (R14/Q9-5 알림 트리거 8개 — body §Decision 8 항목이 canonical, 본 frontmatter statement 와 일치. pre-PR-#68 의 'scraping ban / robots disallow' 표현은 stale compressed summary 였음 — 옵션 D 운영자 결정 2026-05-17, robots.txt disallow 는 ADR-0028 safe-fetch boundary 별도 enforcement, ledger coupling 은 `INFRA-1B.5.h3-robots-disallow-ledger-coupling` follow-up anchor)
    status: active
    cross_ref_code:
      - src/pipeline/policy-gate/risk-triggers.ts:detectRisks
      - src/pipeline/policy-gate/risk-triggers.ts:evaluatePolicyGate
  - id: INV-0017-5
    statement: 모든 policy_gate 결정은 policy_decisions ledger에 기록한다 — v9 schema canonical fields = (decision_id, session_id, source_id, url, trigger_type, policy_gate_mode, decision, rationale, intended_action, snap_id, created_at). v0 partial coverage (Opus PR #66~#78 review F8 correction 2026-05-18) — pre-correction statement listed `gate_mode` / `reason` / `risk_level` / `intervention_id` field names that do not exist in actual v1+v7+v9 schema. Actual writer (`src/pipeline/policy-gate/decision-ledger.ts:recordPolicyGateDecision`) emits `policy_gate_mode` (not `gate_mode`) + `rationale` (not `reason`) + `trigger_type` (operator-gate namespace, intended_action=NULL); `risk_level` + `intervention_id` are NOT in v1 schema (writer-side comment 명시) — future hardening anchor = v10 migration `policy_decisions_risk_level_intervention_id` (planned, NOT gate-blocking). Production wiring scope (Opus PR #66~#78 review F1 partial — caller wiring 명시): chunker / R2 upload / embed / external LLM call site 의 generic `evaluatePolicyGate()` 호출 + `recordPolicyGateDecision()` ledger 기록은 EXTR-1A.* 슬라이스 (P0-M3+) scope 임. v0 state — chunker는 INFRA-1B.4.h1-chunker-policy-gate (PR #47) archive_policy gate 별도 enforce, R2 upload는 INFRA-1B.3.x-audit (PR #39) `recordR2UploadDecision()` 별도 ledger writer 사용 (operator-gate namespace 아닌 `intended_action='r2_upload'` namespace). 따라서 INV-0017-5 는 v0 에서 `recordPolicyGateDecision()` operator-gate namespace 의 ledger writer contract 만 closed; generic `evaluatePolicyGate()` production caller 의 ledger persistence 는 EXTR-1A.* wiring 시점까지 deferred.
    status: active
  - id: INV-0017-6
    statement: 탐색·콘텐츠 제작 단계의 막힘은 access_interventions로 누적되고 세션 종료 시 batch 보고된다. access_interventions 필드 — (intervention_id, session_id, scenario_id, thesis_id, url, source_name, attempted_action, access_result, policy_result, related_query, why_it_matters, importance_score, severity, fallback_used_json, requested_user_action, status, created_at, resolved_at) (R18)
    status: active
  - id: INV-0017-7
    statement: severity 자동 산정은 기본 deterministic (keyword overlap with scenario.assumptions[] / 명시적 related_assumption_ids). LLM 호출은 옵션(default off, 사용자 override 가능) — API cost 폭증 방지 (R24 자체 audit)

preconditions:
  - id: PRE-0017-1
    statement: Source 객체 도입 (ADR-0011 9-stage)
  - id: PRE-0017-2
    statement: Tier A-D 분류 (ADR-0016) — source_policy 적용 단위가 Source

defines:
  - term: policy_gate
    role: primary
  - term: access_intervention
    role: primary
  - term: archive_policy
    role: primary
  - term: raw_cloud_policy
    role: secondary  # ADR-0012에서 primary

invariant_review:
  status: pending
  reviewed_at: null
  fingerprint: null
unresolved_warnings: []
reviewed_terms:
  - source
  - policy_gate
  - access_intervention
  - archive_policy
  - raw_cloud_policy
  - manual_claim_entry
reviewed_scopes:
  - storage.sqlite.source_policy
  - storage.sqlite.policy_decisions
  - storage.neo4j.access_intervention_node
  - pipeline.policy_gate
  - pipeline.policy_gate.discovery_mode
  - pipeline.policy_gate.extract_cache_embed_mode
  - pipeline.policy_gate.exploration_mode
  - pipeline.policy_gate.publication_preflight_mode
  - pipeline.policy_gate.batch_report
  - storage.policy.tier_classification
  - pipeline.manual_feedback
  - storage.sqlite.policy_learning_events

provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true
---

# ADR-0017: Source policy gate — mode-aware + access_interventions

## Status

accepted — 2026-05-11

## Context

ideation Round 14/Q9-5는 policy_gate 단계를 신설하기로 결정 — 외부 LLM에 raw
text 전송 / paywalled fetch / scraping ban 위반 / wire-service full text 등
8개 트리거에 대해 자동 알림.

그러나 Round 18에서 사용자가 발의: "탐색·콘텐츠 제작 단계의 추가 fetch는 inline
중단이 비효율". 시나리오 탐색은 여러 sources를 가설 검증하며 빠르게 훑는 것이
본질이라 중간에 block popup 뜨면 흐름 깨짐. 콘텐츠 제작 중 reference fetch도
마찬가지.

R18에서 mode-aware policy gate(inline_block / inline_warn / batch_report) +
exploration_block_reports → GPT 정교화 흡수로 access_interventions로 격상.
severity / importance_score / why_it_matters / related_query / fallback_used 등
필드 추가.

## Decision

**source_policy** 3 필드 (R14/Q9-5에서 R7/Q2 단일 archive_policy를 3 필드로
확장):

| 필드 | enum | default |
|---|---|---|
| archive_policy | {metadata_only, excerpt_only, full_snapshot_allowed, do_not_collect} | metadata_only |
| raw_cloud_policy | {always_prohibited, allowed_public_data_only} | always_prohibited |
| external_llm_policy | {allowed, manual_review_required, prohibited} | manual_review_required |

`source_material_policy` 테이블 (SQLite):
```sql
source_material_policy (
  source_id text references source(source_id),
  archive_policy text not null,
  raw_cloud_policy text not null,
  external_llm_policy text not null,
  terms_url text,
  license_url text,
  checked_at text not null
);
```

**policy_gate_mode** (3-mode):
- `inline_block` — 즉시 중단, 사용자 응답 대기
- `inline_warn` — 경고 로깅 후 계속 진행, 사용자 응답 안 받음
- `batch_report` — 막힘 누적, 세션 종료 시 batch 보고

**단계별 default mode**:

| 단계 | Mode | 이유 |
|---|---|---|
| Discovery / Initial fetch | inline_warn | 자동 수집 중, 한 source 막혀도 다음으로 |
| Extract / Cache / Embed / Cloud upload | **inline_block** | 위험 행동(저작권/약관/cloud raw) 즉시 중단 |
| 시나리오·thesis 탐색 (interactive) | batch_report | 흐름 유지가 본질 |
| 콘텐츠 제작 추가 fetch | batch_report (default) + inline_block (위험 행동) | 작업 흐름 유지, 위험은 차단 |
| Publication preflight | inline_block | 최종 발행 전 차단 필수 |

**위험 행동** (어느 mode에서도 inline_block, R14/Q9-5 트리거 8개):
1. source policy unknown인데 raw text를 외부 LLM에 보내려 함
2. source가 paywalled / proprietary로 분류됨
3. terms에 no scraping / no AI / no archive / no redistribution 명시
4. wire-service full text (Reuters/AP)
5. article/report 원문을 quote 또는 cache하려 함
6. 기사/리포트 도표·스크린샷을 콘텐츠에 추가하려 함
7. raw source를 embedding/indexing하려 함
8. raw source를 cloud에 upload하려 함

**access_interventions 객체** (Neo4j 노드 — graph object로 분류):
```cypher
(:AccessIntervention {
  intervention_id: string,           // `aci_<ULID>`
  session_id: string,
  scenario_id: string,                // optional FK to Scenario
  thesis_id: string,                  // optional FK to Thesis
  url: string,
  source_name: string,
  attempted_action: enum,             // fetch_for_claim | quote_for_publication | etc.
  access_result: enum,                // blocked | paywalled | bot_protected | terms_unclear | 404
  policy_result: enum,                // manual_only | metadata_only | excluded
  related_query: string,
  why_it_matters: string,
  importance_score: float,            // 0~1
  severity: enum,                     // LOW | MEDIUM | HIGH | CRITICAL
  fallback_used_json: string,
  requested_user_action: enum,        // read_manually_and_enter_claim | optional | ignore
  status: enum,                       // pending_user_review | resolved | ignored
  created_at: datetime,
  resolved_at: datetime
})
```

severity 자동 산정 (default deterministic, R24 자체 audit):
- HIGH/CRITICAL: scenario.assumptions[] keyword overlap ≥ threshold OR 명시적
  related_assumption_ids
- MEDIUM: scenario topic 영역 포함
- LOW: 핵심 영역 외 / 대체 source 충분
- LLM 자동 평가는 옵션 (default off, 사용자 override 가능 — API cost 폭증 방지)

projection edges (ADR-0014 native 활용과 일관):
```cypher
(:AccessIntervention)-[:RELATES_TO]->(:ScenarioAssumption)
(:ManualClaimEntry)-[:RESOLVES]->(:AccessIntervention)
```

policy_decisions ledger (SQLite, audit trail) — **v9 actual schema** (Opus PR #66~#78 review F8 correction 2026-05-18; pre-correction body listed an aspirational schema that drifted from `migrations/sqlite/v1_schema.sql` + v7 + v9 actual columns):
```sql
policy_decisions (
  decision_id        text primary key,                                -- `pdec_<ULID>`
  session_id         text not null,
  source_id          text,                                            -- FK to Neo4j Source.source_id (nullable for unregistered)
  url                text,
  trigger_type       text not null,                                   -- 1..8 from ADR-0017 INV-0017-4 List A, or `non_risk_action` sentinel, or `r2_upload`
  policy_gate_mode   text not null check (policy_gate_mode in ('inline_block','inline_warn','batch_report')),
  decision           text not null,                                   -- allow | warn | block (operator-gate namespace) | uploaded | skipped | failed (r2_upload namespace)
  rationale          text,                                            -- free-form audit trace; serialized multi-trigger format `[trigger_id] rationale | ...`
  intended_action    text,                                            -- NULL = operator-gate namespace (ADR-0017); 'r2_upload' = R2 upload audit namespace (ADR-0012)
  upload_attempt_id  text,                                            -- v8: BEFORE/AFTER audit pair correlation key (only when intended_action='r2_upload')
  snap_id            text,                                            -- v9: structured FK to Snapshot for INV-0012-3 audit-by-absence reconcile
  created_at         text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
```

**Schema drift notes** (Opus PR #66~#78 review F8):

- Pre-correction body listed `gate_mode` / `reason` / `risk_level` / `intervention_id` columns that do not exist in actual v1+v7+v9 schema. Actual writer uses `policy_gate_mode` / `rationale` / `trigger_type`; `risk_level` + `intervention_id` deferred to v10 hardening anchor (`policy_decisions_risk_level_intervention_id`, NOT gate-blocking).
- Multi-trigger ledger: `recordPolicyGateDecision()` writes ONE row per evaluation (Option A — operator decision 옵션 b+ 2026-05-17 post-PR-#68 GPT review). Primary trigger goes into `trigger_type`; all detected triggers serialized into `rationale` as `[trigger_id] rationale | [trigger_id] rationale | ...`. Operator multi-trigger aggregation queries `rationale LIKE '%[trigger_id]%'`. v0 audit query quality trade-off (Opus PR #66~#78 review F7 acknowledged) — future hardening anchor = `policy_decisions_triggers` junction table OR `trigger_types_json` column (v10 schema slice, NOT gate-blocking).

## Alternatives Considered

- **A** (chosen): mode-aware policy gate + 위험 행동 inline_block 보존 +
  access_interventions Neo4j 노드
  - pros: 탐색 흐름 유지, 위험 행동 즉시 차단, batch 보고로 사용자 부담 분산
  - cons: mode 분기 로직 복잡도, severity 산정 정책 필요
- **B** (discarded — R14 초안): policy_gate가 모든 단계에서 inline block / warn
  - pros: 단순
  - cons: 탐색·콘텐츠 제작 흐름이 매번 깨짐 (R18 사용자 발의 폐기)
- **C** (discarded — R18 초안): exploration_block_reports 별도 객체
  - pros: 보고만 분리
  - cons: GPT 정교화로 access_interventions(severity, importance, related_query
    등)로 격상이 더 정밀
- **D** (discarded — R14/Q9-5 GPT 6 필드): source_policy 6 필드 (archive_policy
  + raw_cloud_policy + raw_local_cache_policy + external_llm_policy +
  quote_policy + visual_policy + dataset_vintage_policy)
  - pros: 가장 명시적
  - cons: v0에 과함; quote_policy/visual_policy는 기존 enum과 통합, dataset
    vintage_policy는 v1 (Claude push back — R14/Q9-5)

## Consequences

- 긍정:
  - 위험 행동은 즉시 차단 — 저작권/약관 안전
  - 탐색·콘텐츠 제작 흐름이 batch_report로 자연스러움
  - access_interventions가 unresolved HIGH/CRITICAL을 cite check 5번째
    block(ADR-0015 INV-0015-6)으로 cascade
  - severity / importance / why_it_matters로 사용자 검토 우선순위 명확

- 부정 / trade-off:
  - mode-aware 분기 로직이 단순 inline_block보다 구현 복잡
  - severity 자동 산정의 fp/fn은 사용자 override 메커니즘 필요(ADR-0018 review
    3-option)
  - source_policy 3 필드 추가로 source registry seed 작성 부담 ↑ (Q21)

- 후속 작업:
  - INFRA-1B.1 슬라이스: source_policy 테이블 + policy_decisions ledger +
    8 트리거 inline_block 구현
  - INFRA-1B.2 슬라이스: access_interventions Neo4j 노드 + severity deterministic
    산정 + batch_report 모드
  - ADR-0015 INV-0015-6: cite check 5번째 block 활성화
  - ADR-0018: manual_claim_entry CLI + `pipeline intervention review <id>`
    3-option (ignore / manual_claim / temp_text)
  - ADR-0021: policy_learning_events — intervention 결정(ignore/manual_claim)을
    Pattern 1 학습으로 흡수

## References

- ideation 출처: Round 7/Q2 (archive_policy 단일), Round 14/Q9-5 (3 필드 확장 +
  policy_decisions + manual_claim_entries + 8 트리거), Round 18 (mode-aware +
  access_interventions GPT 정교화 흡수)
- 관련 ADR: ADR-0011, ADR-0012, ADR-0015, ADR-0016, ADR-0018, ADR-0021,
  ADR-0028 (safe-fetch boundary — robots.txt disallow enforcement)

## Drift history (non-normative)

- 2026-05-17: INV-0017-4 frontmatter statement aligned with the accepted
  ADR body §Decision 8-trigger list. The frontmatter statement is a
  compressed summary, not an independent trigger universe. Pre-PR-#68
  frontmatter wording ("raw cache / embedding / cloud upload / quote
  storage / wire-service full text / paywalled fetch / scraping ban /
  robots disallow") was a stale compressed summary that conflicted with
  the body §Decision 8 items (1. source policy unknown/unauthorized raw
  external LLM / 2. paywalled·proprietary full-text fetch / 3. terms
  violation / 4. wire-service full text / 5. raw quote·cache / 6. image
  inclusion without license / 7. raw embedding / 8. raw cloud upload).
  Root cause of Codex PR #68 robots-disallow finding escalation —
  operator decision 옵션 D (canonical = body §Decision, robots.txt
  disallow stays at ADR-0028 safe-fetch boundary, not a ninth
  RiskTrigger). PR #68 implementation `RISK_TRIGGER` enum matches body
  §Decision exactly.

- 2026-05-18: INV-0017-5 frontmatter statement + body §Decision
  policy_decisions SQL schema corrected to match actual v1+v7+v9 schema
  (Opus PR #66~#78 adversarial review F8). Pre-correction statement
  listed `gate_mode` / `reason` / `risk_level` / `intervention_id`
  columns that do not exist in `migrations/sqlite/v1_schema.sql` +
  `v7_policy_decisions_intended_action.sql` + `v9_policy_decisions_snap_id.sql`.
  Actual writer (`src/pipeline/policy-gate/decision-ledger.ts:recordPolicyGateDecision`)
  emits `policy_gate_mode` / `rationale` / `trigger_type` columns; the
  missing `risk_level` + `intervention_id` columns were called out as
  v0 partial coverage in `decision-ledger.ts` comment lines 25-29 but
  the ADR frontmatter/body had not been synced. Drift was first detected
  in PR #76 (which attempted to add INV-0017-5 `cross_ref_code` to
  `recordPolicyGateDecision` but reverted on the writer-vs-production-caller
  argument; the secondary drift between INV-0017-5 statement field
  names and writer field names was not caught at that time). Future
  hardening anchor for the missing columns = v10 migration
  `policy_decisions_risk_level_intervention_id` (planned, NOT
  gate-blocking).

- 2026-05-18: PR #76 metadata correction recorded (Opus PR #66~#78
  adversarial review F5). PR #76 title/body described an INV-0017-5
  `cross_ref_code` backfill against `recordPolicyGateDecision`, but the
  final merged patch reverted the backfill attempt (single-file change
  to `docs/current/TESTING.md` only) because `recordPolicyGateDecision`
  had no production caller — a `cross_ref_code` to a writer-only
  function would have asserted enforcement that did not exist at the
  call sites. The reverted decision is correct (no false enforcement
  proof in the cross_ref system), but PR #76's title/body remained as
  "INV-0017-5 cross_ref_code backfill" instead of the more accurate
  "INV-0017-5 backfill reverted + TESTING baseline correction." This
  is recorded here as a known PR-metadata defect — future audits
  reading the PR-list alone may otherwise misinterpret PR #76 as
  closing INV-0017-5 enforcement. INV-0017-5 cross_ref_code remains
  absent until generic `evaluatePolicyGate()` production callers land
  in EXTR-1A.* (see INV-0017-5 statement scope note).
