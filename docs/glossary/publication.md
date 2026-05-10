---
id: glossary-publication
type: glossary_term
term: publication
term_type: lifecycle
defined_in: ADR-0003
last_changed_by: ADR-0003
status: active
created_at: 2026-05-11
updated_at: 2026-05-11
aliases:
  - 출판물
  - published content
detect_patterns:
  - "(?i)published\\s+content"
  - "(?i)출판\\s*콘텐츠"
related_invariants:
  - INV-0003-7
provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true

states:
  - name: live
    transitions_from: []
    transitions_to: [corrected, retracted]
    release_paths:
      - draft_published                # ContentDraft.state=published 트리거
    forbidden_paths:
      - cite_check_bypass              # cite_check pass 없이 live 진입 금지
  - name: corrected
    transitions_from: [live]
    transitions_to: [live, retracted]
    release_paths:
      - correction_ledger_entry        # Q-003: 정정 트리거 정의 보류
    forbidden_paths:
      - silent_inline_edit             # body 수정만으로 corrected 표시 금지 — ledger 강제
  - name: retracted
    transitions_from: [live, corrected]
    transitions_to: []
    release_paths:
      - reviewer_retract
      - source_retraction_cascade      # 인용된 claim이 retracted면 cascade
    forbidden_paths:
      - silent_removal                 # retracted 표시 + 사유 강제
---

# publication

## Definition

`Publication`은 발행된 콘텐츠 1건이다. ContentDraft의 published state에서 승격
되며, 외부 publisher(블로그 / 유튜브)에 등록된 URL과 publish_at 시점을 가진다.
인용된 모든 promoted claim id, dossier id, scenario id, scenario revision id를
ledger로 보존해 NFR-003 5단계 trace를 보장한다.

정정(correction) 시 새 inline 편집이 아니라 명시 ledger entry로 표기한다
(corrected state). 정정 트리거 정의는 Q-003에서 보류 중.

## Why this term exists

NFR-003 traceability — Publication 한 문장 → ContentDraft 인용 → Claim →
Snapshot → R2 bytes 5단계. Publication 객체가 없으면 trace anchor가 깨진다.

## Examples

- 긍정 예: "Pub: 부동산 연착륙 분석 (블로그 2026-05-12)" — 인용 12 promoted
  claim, dossier 1, scenario 1 (revision r3)
- 긍정 예: 인용된 claim 1건이 stale로 바뀜 → cascade alert → corrected ledger
  entry 후 corrected state
- 부정 예: 인용된 claim이 retracted인데 Publication은 그대로 — cite check
  cascade 강제

## Drift history

- 2026-05-11 ADR-0003 — 7-stage 모델 도입 (initial definition)
- Q-003 정정 트리거 enum 결정 보류 중
