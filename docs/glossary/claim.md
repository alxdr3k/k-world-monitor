---
id: glossary-claim
type: glossary_term
term: claim
term_type: lifecycle
defined_in: ADR-0003
last_changed_by: ADR-0011
status: active
created_at: 2026-05-11
updated_at: 2026-05-11
aliases:
  - 주장
  - candidate claim
  - promoted claim
detect_patterns:
  - "(?i)candidate\\s+claim"
  - "(?i)promoted\\s+claim"
related_invariants:
  - INV-0003-3   # superseded by INV-0011-3
  - INV-0011-5   # 8-state expansion (R9/Q4)
  - INV-0012-1   # graph object store Neo4j
  - INV-0005-2
  - INV-0015-1   # evidence (nullable + quote_reason + storage_level)
provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true

states:
  - name: draft
    transitions_from: []
    transitions_to: [confirmed, disputed, retracted]
    release_paths:
      - llm_extraction
      - manual_intake
    forbidden_paths:
      - publication_inline       # draft claim은 Publication에 직접 인용 불가
  - name: confirmed
    transitions_from: [draft, disputed, needs_recorroboration]
    transitions_to: [disputed, stale, retracted, source_changed, source_unavailable, needs_recorroboration]
    release_paths:
      - reviewer_confirm
      - auto_accept_threshold    # ADR-0006: reliability_tier=high ∧ extraction_confidence ≥ 0.85
    forbidden_paths:
      - body_only_status_change  # status 변경은 frontmatter ledger로만 (Case 2 유사 drift 차단)
  - name: disputed
    transitions_from: [confirmed]
    transitions_to: [confirmed, retracted, stale, needs_recorroboration]
    release_paths:
      - counterclaim_registered
      - reviewer_dispute
    forbidden_paths:
      - silent_resolve           # disputed 해소는 명시 review 필요
  - name: stale
    transitions_from: [confirmed, disputed, source_changed]
    transitions_to: [confirmed, retracted, needs_recorroboration]
    release_paths:
      - time_trigger             # ADR-0010: 시간 기반
      - snapshot_diff_trigger    # ADR-0010: snapshot diff
      - counterclaim_trigger     # ADR-0010: counterclaim 등록
    forbidden_paths:
      - silent_revival           # stale → confirmed는 새 evidence 필요
  - name: retracted
    transitions_from: [draft, confirmed, disputed, stale, source_changed, source_unavailable, needs_recorroboration]
    transitions_to: []
    release_paths:
      - source_retraction
      - reviewer_retract
    forbidden_paths:
      - silent_reuse             # retracted claim은 새 Publication에 인용 금지 (cite check 차단)
  - name: source_changed
    transitions_from: [confirmed, disputed]
    transitions_to: [stale, retracted, needs_recorroboration]
    release_paths:
      - snapshot_diff_detected   # ADR-0011 R9/Q4: content_hash diff로 원문 변경 감지
    forbidden_paths:
      - publication_core_evidence  # source_changed claim은 cite check stale_check로 차단 (ADR-0015 INV-0015-5)
  - name: source_unavailable
    transitions_from: [confirmed, disputed]
    transitions_to: [retracted, needs_recorroboration]
    release_paths:
      - fetch_404_detected       # ADR-0011 R9/Q4: URL 404 / DNS fail
    forbidden_paths:
      - publication_core_evidence  # source_unavailable claim은 cite check로 차단
  - name: needs_recorroboration
    transitions_from: [confirmed, disputed, stale, source_changed, source_unavailable]
    transitions_to: [confirmed, retracted]
    release_paths:
      - manual_review_required   # ADR-0011 R9/Q4: 다중 출처 룰 위반 또는 reviewer flag
    forbidden_paths:
      - silent_reconfirm         # needs_recorroboration → confirmed는 명시 evidence 추가 필요
---

# claim

## Definition

`Claim`은 Snapshot에서 추출된 단일 사실/주장 단위다. evidence(`quote (nullable,
≤ 200자 + quote_reason 명시 시)` + `locator` + `quote_hash` + `storage_level`)
를 보유하며, 8-state lifecycle(`draft / confirmed / disputed / stale /
retracted / source_changed / source_unavailable / needs_recorroboration`)을
거친다 (ADR-0011 INV-0011-5, R9/Q4 R10/Q5 확장). 모든 candidate claim은
Neo4j Claim 노드에 저장되며, scenario에 인용된 promoted claim만 markdown으로
승격된다 (ADR-0012).

`extraction_confidence` 는 LLM 추출 신뢰도(0-1)이며 `claim_status`와 함께
관리된다. 단일 `confidence` 필드는 reliability / extraction confidence /
evidence strength / lifecycle / scenario weight 다섯 개념을 섞으므로 폐기됨
(ADR-0005).

## Why this term exists

ADR-0003 7-stage 모델의 source layer 마지막 단계로, Snapshot bytes에서 의미
단위로 분해된 atomic 사실. Scenario / Dossier / Publication이 모두 Claim을
인용하므로 status / evidence / edge ledger의 anchor가 된다.

## Examples

- 긍정 예: "IMF는 2026년 글로벌 GDP 성장률을 3.1%로 전망" → Claim 1개,
  evidence(quote + page locator + sha256)
- 긍정 예: "WHO 2026-04 주간 보고: H5N1 사람간 전파 case 0건" → Claim 1개
- 부정 예: "글로벌 경제는 위태롭다" → 너무 광범위, 단일 source에서 추출 불가
  (Claim 분해 단위로 부적합)
- 부정 예: candidate claim 1만 건을 markdown으로 자동 생성 — vault 무너뜨림
  (ADR-0004 Markdown은 promoted only)

## Drift history

- 2026-05-11 ADR-0003 — Document/Snapshot/Claim 3-tier 도입 (superseded by
  ADR-0011)
- 2026-05-11 ADR-0005 — `confidence` 단일 필드 폐기, `extraction_confidence` +
  `claim_status` 분해
- 2026-05-11 ADR-0008 — evidence quote ≤ 200자 + quote_hash 정책 lock
  (superseded by ADR-0015)
- 2026-05-11 ADR-0010 — stale 트리거 3가지(time / snapshot_diff / counterclaim)
  release_paths에 추가
- 2026-05-11 ADR-0011 — 4-tier source layer 확장(Source + Document + Snapshot
  + Claim) + claim_status 8-state 확장(R9/Q4: + source_changed,
  source_unavailable, needs_recorroboration)
- 2026-05-11 ADR-0012 — canonical store SQLite → Neo4j (graph objects)
- 2026-05-11 ADR-0015 — evidence nullable + quote_reason enum + storage_level
  4단계 (R10/Q5)
