---
id: adr-0018
type: adr
title: Manual feedback inbound — manual_claim_entries (claim/opinion/quote 3-way) + CLI (`pipeline feedback` + `pipeline intervention review`)
status: accepted
created_at: 2026-05-11
updated_at: 2026-05-11
deciders: [user, claude-opus-4-7, gpt]
supersedes: []
superseded_by: []

scope:
  in:
    - storage.neo4j.manual_claim_entry_node
    - storage.policy.claim_opinion_quote_separation
    - cli.pipeline_feedback
    - cli.pipeline_intervention_review
    - pipeline.manual_feedback_inbound
    - pipeline.intervention_review.three_option
  out:
    - pipeline.policy_gate                    # policy gate는 ADR-0017
    - pipeline.cite_check_layer               # cite check는 ADR-0015
    - storage.sqlite.policy_learning_events   # policy learning은 ADR-0021

invariants:
  - id: INV-0018-1
    statement: manual_claim_entries는 사용자 user_written_claim / user_opinion / referenced_quote 3-way로 분리한다. 같은 row에서 한 필드만 채워질 수 있다 (claim과 opinion을 한 row에 혼합 입력 금지). publication preflight가 문장별 자동 판정 가능 (R18)
    status: active
  - id: INV-0018-2
    statement: referenced_quote가 채워진 경우 quote_reason(ADR-0015 INV-0015-2 enum) 명시 필수. attribution_json (publisher/author/title/published_at/url) 필수
    status: active
  - id: INV-0018-3
    statement: manual feedback은 collection policy를 우회하는 게 아니라 collection을 사람이 수행한 후 derivation 단계로 진입한다. raw_text_stored=false 강제 (raw cloud upload 금지 ADR-0012 INV-0012-3 보존)
    status: active
  - id: INV-0018-4
    statement: CLI `pipeline feedback add|bulk|link|from-report`는 manual_claim_entry 작성·연결·intervention 검토 진입의 정식 워크플로우다 (R18)
    status: active
  - id: INV-0018-5
    statement: CLI `pipeline intervention review <id>`는 3-option을 제공한다 — ignore (importance_score 자동 ↓, policy_learning_events Pattern 1) / manual_claim (pipeline feedback add로 진입, claim 또는 opinion 또는 둘 다) / temp_text (raw_cache_items로 흡수, ADR-0021 raw_cache_items와 통합)
    status: active
  - id: INV-0018-6
    statement: manual_claim_entry는 graph object로 Neo4j에 저장된다 (ADR-0012 INV-0012-1). source_accessed_via enum {manual_browser, manual_app, manual_pdf_read, manual_print, manual_offline}, self_assessed_confidence float 0~1, policy_gate_passed boolean(audit), intervention_id(FK to AccessIntervention)을 보유한다

preconditions:
  - id: PRE-0018-1
    statement: access_interventions 객체 도입 (ADR-0017)
  - id: PRE-0018-2
    statement: ADR-0015 evidence + quote_reason enum 도입 (referenced_quote 저장 시 정책 적용)
  - id: PRE-0018-3
    statement: CLI bootstrap 진입 (`pipeline` namespace)

defines:
  - term: manual_claim_entry
    role: primary

invariant_review:
  status: pending
  reviewed_at: null
  fingerprint: null
unresolved_warnings: []
reviewed_terms:
  - manual_claim_entry
  - access_intervention
  - claim
  - quote_reason
  - source
reviewed_scopes:
  - storage.neo4j.manual_claim_entry_node
  - storage.policy.claim_opinion_quote_separation
  - cli.pipeline_feedback
  - cli.pipeline_intervention_review
  - pipeline.manual_feedback_inbound
  - pipeline.intervention_review.three_option
  - pipeline.policy_gate
  - pipeline.cite_check_layer
  - storage.sqlite.policy_learning_events

provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true
---

# ADR-0018: Manual feedback inbound workflow

## Status

accepted — 2026-05-11

## Context

ideation Round 14/Q9-5는 `manual_claim_entries` 테이블을 도입(high-risk source
fallback). Round 17/Q12-1은 Tier C/D source를 manual fallback으로 흡수하는
정책을 확정.

Round 18 사용자 발의: "사용자가 직접 웹사이트에 접근해서 다시 파이프라인으로
본인 의견이나 원문을 피드백할 수 있어야 한다." 이를 능동적 워크플로우로 격상.
GPT 정교화 흡수: 4-option (ignore / manual_claim / manual_note-opinion /
temp_text) → Claude push back으로 3-option 통합 (manual_note는 manual_claim 안의
user_opinion 모드로 흡수, temp_text는 raw_cache_items로 흡수).

또한 user_written_claim 단일 필드는 사용자가 객관적 사실과 본인 의견을 섞기
쉬워 publication preflight가 문장별 판정 어려움. **3-way 분리** —
user_written_claim / user_opinion / referenced_quote.

## Decision

**manual_claim_entry 스키마** (Neo4j 노드, graph object):

```cypher
(:ManualClaimEntry {
  manual_claim_id: string,             // `mcl_<ULID>`
  session_id: string,
  source_id: string,                    // optional FK
  url: string,
  canonical_url: string,
  title: string,
  publisher: string,
  author: string,
  published_at: datetime,
  source_accessed_at: datetime,
  source_accessed_via: enum,            // manual_browser | manual_app | manual_pdf_read | manual_print | manual_offline
  user_written_claim: string,           // 객관적 claim (재구성된 사실)
  user_opinion: string,                 // 사용자 해석/의견 (claim과 분리)
  referenced_quote: string,             // 짧은 원문 인용 (quote_reason 필수)
  quote_reason: enum,                   // ADR-0015 INV-0015-2 (exact_wording_matters | policy_language_analysis | direct_publication_quote | rebuttal_or_critique)
  attribution_json: string,             // {publisher, author, title, published_at, url} (referenced_quote 있을 때 필수)
  self_assessed_confidence: float,      // 0~1
  policy_gate_passed: boolean,          // 작성 전 policy_gate 통과 표시 (audit)
  raw_text_stored: boolean,             // 강제 false (INV-0018-3)
  created_at: datetime,
  intervention_id: string                // FK to AccessIntervention (어느 batch report 검토 후 작성됐는지)
})
```

projection edges:
```cypher
(:ManualClaimEntry)-[:RESOLVES]->(:AccessIntervention)
(:ManualClaimEntry)-[:SUPPORTS|:CONTRADICTS|:QUALIFIES]->(:ScenarioAssumption)
(:ManualClaimEntry)-[:DERIVED_FROM_MANUAL_REVIEW_OF]->(:Source)
```

**CLI** (`pipeline` namespace):

| 명령 | 동작 |
|---|---|
| `pipeline feedback add` | 인터랙티브 prompt — URL + accessed_at + claim + opinion(optional) + quote(optional + quote_reason 필수) + 연결할 scenario/thesis |
| `pipeline feedback bulk` | JSON/YAML 파일로 여러 claim 한 번에 추가 |
| `pipeline feedback link` | 기존 claim과 새 manual claim의 관계(SUPPORTS/CONTRADICTS/QUALIFIES) 설정 → ADR-0013 edge 생성 |
| `pipeline feedback from-report <report_id>` | access_intervention batch report 검토 후 막힌 source에 manual claim 작성 진입 |
| `pipeline intervention review <id>` | 3-option (ignore / manual_claim / temp_text) |

**3-way 분리 원칙**:
- `user_written_claim`: 객관적 사실 재구성 (인용 아님). publication에서 객관적
  statement로 인용 가능
- `user_opinion`: 본인 해석/의견. publication에서 별도 "해설" / "의견" 섹션으로
  표시
- `referenced_quote`: 짧은 원문 인용 (≤200자, ADR-0015 INV-0015-1). quote_reason
  + attribution_json 필수

같은 manual_claim_entry row에서 한 필드만 채워진다(혼합 입력 금지). 한 manual
입력 세션이 claim + opinion 둘 다 만들고 싶으면 2개 row로 분리.

**`pipeline intervention review` 3-option**:

| Option | 동작 |
|---|---|
| `ignore` | 중요도 낮춤. 유사 source importance_score 자동 ↓ (ADR-0021 Pattern 1 policy learning) |
| `manual_claim` | `pipeline feedback add`로 진입. user_written_claim 모드 / user_opinion 모드 / 둘 다 |
| `temp_text` | raw_cache_items(R13 / ADR-0021 연관)로 흡수 — TTL 24h~7d, indexed=false, embedded=false, finalize 시 즉시 삭제 |

**Workflow 통합 예**:
1. 사용자가 batch report 받음 → access_interventions HIGH 10개 확인
2. `pipeline intervention review aci_001` 실행
3. 인터랙티브 prompt: "ignore / manual_claim / temp_text"
4. manual_claim 선택 → `pipeline feedback add` 진입 (URL/title 자동 prefill)
5. claim 작성 시 quote_reason enum 필수 (ADR-0015 일관)
6. policy_gate가 작성 단계에서 한 번 더 check (claim에 의견이 섞이지 않았는지,
   quote가 너무 길지 않은지 자동 검증)
7. edge 생성 (선택): SUPPORTS / CONTRADICTS / QUALIFIES (ADR-0013)

## Alternatives Considered

- **A** (chosen): manual_claim_entries 3-way 분리 + CLI 5종 + intervention
  review 3-option
  - pros: publication preflight가 문장별 자동 판정 가능, 사용자 능동적 입력
    가능, intervention 후속 처리 자동화
  - cons: 3-way 분리로 입력 부담 ↑ (한 row에 한 필드만)
- **B** (discarded — R14/Q9-5 초안): manual_claim_entries 단일 user_written_claim
  필드
  - cons: 사용자가 claim과 의견을 섞기 쉬워 publication preflight 자동 판정
    어려움
- **C** (discarded — R18 GPT 4-option): ignore / manual_claim / manual_note /
  temp_text
  - cons: manual_note는 manual_claim 안의 user_opinion 모드와 중첩 — 흡수
- **D** (discarded — R18 GPT temp_text 별도 객체): Temporary local text input을
  별개 객체로
  - cons: R13 raw_cache_items와 중첩 — 흡수 (Claude push back, R18)

## Consequences

- 긍정:
  - publication preflight 자동 판정 가능 (3-way 분리로 의견 inline 표시)
  - 능동적 manual feedback workflow — Tier C/D source 자연스러운 fallback
  - intervention 후속 처리 자동화 — policy learning Pattern 1과 연결
  - manual claim도 graph object로 — edge ledger / scenario / thesis와 자연
    통합

- 부정 / trade-off:
  - 3-way 분리로 입력 부담 ↑ — 단축 명령(`pipeline feedback add --claim "..."`)
    필요
  - manual_claim 작성 단계의 policy_gate 재검사로 자동 검증 부담 ↑
  - intervention review의 temp_text 옵션은 raw_cache TTL 운영(24h~7d 삭제)
    필요

- 후속 작업:
  - CLI 부트스트랩 슬라이스: `pipeline feedback`, `pipeline intervention review`
  - INFRA-1B.5 (신설): manual_claim_entry Neo4j 노드 + edge 생성 워크플로우
  - INFRA-1B.6 (신설): raw_cache_items TTL worker (24h~7d) + finalize delete
  - PUB-1A.1 (수정): publication preflight가 user_written_claim vs user_opinion
    분리 인식

## References

- ideation 출처: Round 14/Q9-5 (manual_claim_entries fallback), Round 17/Q12-1
  (Tier C/D manual fallback), Round 18 (사용자 발의 + GPT 정교화 → 3-way
  분리 + 3-option intervention review)
- 관련 ADR: ADR-0013, ADR-0015, ADR-0016, ADR-0017, ADR-0021
