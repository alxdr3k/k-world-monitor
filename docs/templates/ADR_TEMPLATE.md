---
id: adr-<NNNN>
type: adr
title:
status: proposed
created_at:
updated_at:
deciders: []
supersedes: []
superseded_by: []

# Cross-document invariant tracking — see docs/adr/0002-invariant-tracking-system.md
scope:
  in: []                      # path-style namespaces this ADR governs (e.g., control-plane.telemetry)
  out: []                     # negative space — what this ADR explicitly does NOT cover

invariants: []
# Each entry: {id, statement, status}
# - id: INV-<adr-id>-<n> (e.g., INV-0012-1)
# - status: active | deprecated | superseded
# Example:
# invariants:
#   - id: INV-0012-1
#     statement: critic_loop은 control-plane에서만 동작한다 (judgment-plane 호출 금지)
#     status: active

preconditions: []
# Each entry: {id, statement}
# 외부 전제 — 깨지면 이 ADR의 결정이 다시 논의되어야 함
# Example:
# preconditions:
#   - id: PRE-0012-1
#     statement: cheap inference model이 telemetry latency budget 안에 있다

defines: []
# Each entry: {term, role}
# 이 ADR이 정의 권리를 가진 glossary term
# - role: primary (정의 보유) | extends (정의 확장만)
# Example:
# defines:
#   - term: critic_loop
#     role: primary

# Self-check artifacts (ADR은 4개 모두 강제)
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

# ADR-<NNNN>: <title>

## Status

proposed — <date>

## Context

문제와 배경. 제약.

## Decision

선택한 접근을 능동태 한 문단.

## Alternatives Considered

- **A** (chosen):
  - pros:
  - cons:
- **B**:
  - pros:
  - cons:
- **C**:
  - pros:
  - cons:

## Consequences

- 긍정:
- 부정 / trade-off:
- 후속 작업:

## References

- Issues / PRs:
- Related ADRs:
- External sources:
