---
id: glossary-snapshot
type: glossary_term
term: snapshot
term_type: capability
defined_in: ADR-0003
last_changed_by: ADR-0003
status: active
created_at: 2026-05-11
updated_at: 2026-05-11
aliases:
  - 스냅샷
  - source snapshot
detect_patterns:
  - "(?i)source\\s+snapshot"
  - "(?i)원본\\s*스냅샷"
related_invariants:
  - INV-0003-2
  - INV-0004-2
provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true

applies_to_planes:
  - pipeline.source_layer
  - storage.r2.bytes
  - storage.sqlite.snapshot_table
forbidden_paths:
  - storage.markdown.snapshot      # Snapshot 자체는 Markdown 노트로 쓰지 않는다 (수만 건 자동생성 금지)
  - pipeline.publication_layer     # Snapshot은 Claim 추출 입력일 뿐, Publication에 직접 인용되지 않는다 (Claim 경유)
---

# snapshot

## Definition

`Snapshot`은 특정 시점에 fetch한 Document의 immutable bytes다. R2에
`r2_key`로 보존되며 `sha256` 무결성 + `mime` 타입 메타를 가진다. 한
Document는 여러 Snapshot을 가질 수 있다(시간 변동, 다른 mime).

## Why this term exists

원문 변경/삭제 후에도 인용 검증이 가능하려면 fetch 시점의 bytes를 영속
보관해야 한다 (NFR-006). Document만으로는 시간 변동을 다룰 수 없다(ADR-0003
3-tier 분리 사유).

## Examples

- 긍정 예: IMF WEO 2026-04 PDF를 2026-04-22에 fetch한 결과 → Snapshot 1개
  (`r2_key=snap_imf_weo_2026_04/22.pdf`, `sha256=...`)
- 긍정 예: 같은 통계 페이지를 매주 fetch — 매주 새 Snapshot
- 부정 예: 같은 시각에 같은 URL을 두 번 fetch — `sha256` 동일하면 같은
  Snapshot으로 dedupe
- 부정 예: Snapshot 자체를 markdown 노트로 만들기 — 수만 건 markdown 생성은
  vault를 무너뜨림 (`forbidden_paths: storage.markdown.snapshot`)

## Drift history

- 2026-05-11 ADR-0003 — Document/Snapshot/Claim 3-tier 도입 (initial definition)
