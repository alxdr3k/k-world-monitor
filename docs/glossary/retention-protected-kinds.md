---
id: glossary-retention-protected-kinds
type: glossary_term
term: retention_protected_kinds
term_type: capability
defined_in: DEC-007
last_changed_by: DEC-007
status: active
created_at: 2026-05-19
updated_at: 2026-05-19
aliases:
  - RETENTION_PROTECTED_KINDS
  - retention protected kinds
detect_patterns:
  - "(?i)retention[\\s_-]+protected[\\s_-]+kinds"
  - "(?i)RETENTION_PROTECTED_KINDS"
related_invariants: []
provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true

applies_to_planes:
  - storage.retention.gc_batch_reject_list
forbidden_paths:
  - storage.r2.native_lifecycle_expire  # R2 native lifecycle 은 본 list 를 알지 못함 — application batch job 이 reject 책임
---

# retention_protected_kinds

## Definition

`retention_protected_kinds` (코드 상수 `RETENTION_PROTECTED_KINDS`) 는 retention
GC batch job 이 삭제 대상에서 **항상 reject 해야 하는** 항목 enum list 다 (DEC-007).

DEC-007 lock 시점의 canonical list:

- `publication_node` — Publication Neo4j node
- `derived_publication_r2` — 발행 산출물의 R2 derived artifact
- `access_intervention_ledger` — access_intervention 누적 ledger
- `policy_decisions_sqlite` — policy_decisions SQLite 테이블
- `jsonl_audit_export_r2` — JSONL audit export R2 객체
- `claim_retracted_tombstone` — claim retraction tombstone marker
- `cited_snapshot_locked` — 발행에 인용된 snapshot 의 lock marker
- `dataset_vintage_metadata` — dataset vintage 메타데이터
- `tombstone_node` — Neo4j tombstone node (supersede / retract / dedupe 후 marker)

## Why this term exists

DEC-007 (R2 native lifecycle vs application batch retention boundary) 결정에
서, R2 의 native lifecycle expire 기능은 `backups/neo4j` (30d) / `backups/sqlite`
(90d) / `tmp/multipart` (7d) 3 path 에만 한정해서 사용한다. 그 외 의미적 GC
(retraction / supersede / dedupe / EOL / cited-lock) 는 모두 application batch
job 책임이며, 본 batch 가 실수로 보존 의무 자료를 삭제하지 않도록 reject 해야
할 항목을 미리 lock 한 것이 `retention_protected_kinds` 다.

## Examples

- 긍정 예: GC batch 가 30 일 지난 dedup-orphan snapshot 을 삭제하려 할 때,
  해당 snapshot 이 `cited_snapshot_locked` marker 를 보유하면 reject.
- 긍정 예: 정책 변경으로 policy_decisions 일부 row 를 일괄 삭제하려 할 때
  `policy_decisions_sqlite` 가 list 에 있으므로 batch job 이 거부.
- 부정 예 (보호 대상이 아닌 항목): `tmp/multipart/*` 객체는 R2 native lifecycle
  로 7 일 후 expire — application batch 가 별도 reject 검사 안 함.

## Drift history

- 2026-05-19 DEC-007 — 9 항목 enum lock (publication_node / derived_publication_r2
  / access_intervention_ledger / policy_decisions_sqlite / jsonl_audit_export_r2
  / claim_retracted_tombstone / cited_snapshot_locked / dataset_vintage_metadata
  / tombstone_node). 항목 추가는 DEC 갱신 + term_effects 명시 의무.
