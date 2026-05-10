---
id: glossary-<term-slug>
type: glossary_term
term: <term>
term_type: lifecycle  # lifecycle | role | capability — see glossary_term_schema.yaml
defined_in: ADR-####
last_changed_by: ADR-####
status: active        # active | deprecated
created_at:
updated_at:
aliases: []           # synonyms / paraphrase patterns
detect_patterns: []   # regex hints (e.g., "control(?:\\s+|-)critique\\s+stage")
related_invariants: [] # [INV-####-#]
provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true

# --- term_type-specific fields ---
# 정확한 필드 목록은 docs/templates/glossary_term_schema.yaml 참조.

# Example (term_type: lifecycle):
states:
  - name: pending
    transitions_from: []
    transitions_to: [active, dropped]
    release_paths: []        # 이 상태에서 벗어나는 정당한 경로 (e.g., user_explicit, cross_tier_consensus)
    forbidden_paths: []      # 절대 release path가 될 수 없는 것 (e.g., critic_loop)

# Example (term_type: capability):
# applies_to_planes: [control-plane.telemetry, control-plane.audit]
# forbidden_paths: [judgment-plane.promotion, judgment-plane.conflict_detection]

# Example (term_type: role):
# capabilities: [read_audit_log]
# forbidden_paths: [write_decision]
---

# <term>

## Definition

이 term이 무엇을 가리키는지 1-2 문단.

## Why this term exists

처음 도입된 ADR(`defined_in`)의 motivation 한 문단.

## Examples

- 긍정 예: 무엇이 이 term인지
- 부정 예: 무엇이 이 term이 아닌지 (paraphrase trap 회피)

## Drift history

이 term의 의미가 변경된 이력. `last_changed_by`가 마지막 변경자.
신구조에서는 자세한 revision history는 lazy defer — 필요할 때만 누적.

- (예시) 2026-05-08 ADR-#### — release_paths에 `cross_tier_consensus` 추가
