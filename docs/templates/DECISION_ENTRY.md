---
id: dec-<NNN>
type: decision
title:
status: accepted              # proposed | accepted | rejected | superseded | obsolete
created_at:
updated_at:
deciders: []
supersedes: null              # DEC-### / ADR-####
superseded_by: null
resolves: null                # Q-### that this decision resolves
impacts: []                   # ["REQ-###", "NFR-###", "HLD section"]

# Cross-document relations. Q/DEC must declare touches[] (even empty).
# 형식은 QUESTION_ENTRY.md 참조 — relation_enum.yaml 의 closed enum 사용.
touches: []

# DEC도 term의 attribute를 바꿀 수 있음 (Case 2 body-only drift 차단)
term_effects: []
# 형식은 QUESTION_ENTRY.md 참조

# Self-check artifacts (DEC는 invariant_review + unresolved_warnings 강제)
invariant_review:
  status: pending             # pending | reviewed | acknowledged
  reviewed_at: null
  fingerprint: null
unresolved_warnings: []
reviewed_terms: []
reviewed_scopes: []

provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true
---

# DEC-<NNN>: <결정 한 줄>

## Context

## Decision

## Rationale

## Consequences

- 긍정:
- 부정:
- Follow-ups: Slice `<TRACK-#A.#>` / SPIKE-###
