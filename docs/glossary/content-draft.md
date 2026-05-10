---
id: glossary-content-draft
type: glossary_term
term: content_draft
term_type: lifecycle
defined_in: ADR-0003
last_changed_by: ADR-0003
status: active
created_at: 2026-05-11
updated_at: 2026-05-11
aliases:
  - 초고
  - draft
  - blog draft
  - youtube draft
detect_patterns:
  - "(?i)content\\s+draft"
  - "(?i)콘텐츠\\s*초고"
related_invariants:
  - INV-0003-6
provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true

states:
  - name: draft
    transitions_from: []
    transitions_to: [reviewing, dropped]
    release_paths:
      - manual_compose
      - llm_compose_with_dossier_scenario
    forbidden_paths:
      - publish_without_cite_check    # Publication 승격 전 cite check 필수
  - name: reviewing
    transitions_from: [draft]
    transitions_to: [draft, ready, dropped]
    release_paths:
      - cite_check_run
      - reviewer_pass
    forbidden_paths:
      - publish_with_failing_cite_check
  - name: ready
    transitions_from: [reviewing]
    transitions_to: [published, dropped]
    release_paths:
      - cite_check_pass
      - reviewer_approve
    forbidden_paths:
      - silent_publication           # ready → published는 명시 publish 액션
  - name: published
    transitions_from: [ready]
    transitions_to: []
    release_paths:
      - publication_promote          # Publication 객체 생성 트리거
    forbidden_paths:
      - body_only_status_change
  - name: dropped
    transitions_from: [draft, reviewing, ready]
    transitions_to: []
    release_paths:
      - reviewer_drop
    forbidden_paths:
      - silent_revival
---

# content_draft

## Definition

`ContentDraft`는 발행 전 콘텐츠(블로그 / 유튜브 스크립트 등)의 초고다. Dossier
+ Scenario를 입력으로 합성되며, 모든 주장은 promoted claim의 evidence locator로
역추적 가능해야 한다. `cite_check`가 통과되어야 Publication으로 승격된다
(ADR-0008).

## Why this term exists

ADR-0003 Round 1 — 콘텐츠를 추적 가능한 별도 객체로 두지 않으면 발행 후 정정
이력이나 evidence 역추적이 불가능하다. ContentDraft는 Publication의 prefix
ledger 역할이다.

## Examples

- 긍정 예: "초고: 한국 부동산 연착륙 시나리오 분석" — 인용 12개, 모두 promoted
  claim id 링크
- 긍정 예: cite_check가 stale claim 1건 발견 → reviewing 상태로 되돌리고 새
  evidence로 갱신
- 부정 예: cite_check 없이 published — 정책 위반
- 부정 예: candidate claim 직접 인용 — promoted only

## Drift history

- 2026-05-11 ADR-0003 — 7-stage 모델 도입 (initial definition)
