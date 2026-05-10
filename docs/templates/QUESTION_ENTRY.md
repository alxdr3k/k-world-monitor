---
id: q-<NNN>
type: question
title:
status: open                  # open | in_progress | resolved | dropped
created_at:
updated_at:
owner:
proposed_answer:
blocks: []                    # ["REQ-###", "TRACK-#A.#"]
resolution: null              # set to DEC-### / ADR-#### when resolved

# Cross-document invariant tracking — see docs/adr/0002-invariant-tracking-system.md
touches: []
# Each entry: {id, relation, ...payload}
# - id:        upstream identifier (INV-####-# / ADR-####.section / DEC-### / glossary term)
# - relation:  one of relation_enum.yaml keys (complies | extends_scope | challenges_invariant | depends_on | supersedes)
# - payload:   value-specific required fields (see docs/templates/relation_enum.yaml)
# Example:
# touches:
#   - id: INV-0012-1
#     relation: extends_scope
#     extended_to: [judgment-plane.promotion]
#     parent_invariant: INV-0012-1
#     statement: critic_loop을 promotion 경로까지 확장 제안

term_effects: []
# Each entry: {term, attribute, operation, value, reason}
# 본문 prose에서 글로서리 term의 attribute를 변경하면 반드시 명시 (Case 2 body-only drift 차단)
# Example:
# term_effects:
#   - term: pending
#     attribute: release_paths
#     operation: add            # add | remove | replace
#     value: cross_tier_consensus
#     reason: 다중 tier 합의 경로 신설

# Self-check artifacts (Q는 invariant_review + unresolved_warnings 강제, reviewed_terms/scopes는 선택)
invariant_review:
  status: pending             # pending | reviewed | acknowledged
  reviewed_at: null
  fingerprint: null           # hash of touches[]+term_effects[]+body — 변경 시 재리뷰 필요
unresolved_warnings: []
# Each entry: {id, level, first_seen, last_seen, source_fingerprint, message}
reviewed_terms: []
reviewed_scopes: []

provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true
---

# Q-<NNN>: <질문 한 줄>

## Context

왜 이 질문이 생겼는가.

## Discussion

-

## Resolution

resolved 시 → DEC-### / ADR-####. 동시에 frontmatter `status: resolved` + `resolution` 채움.
