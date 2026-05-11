---
id: glossary-policy-gate
type: glossary_term
term: policy_gate
term_type: capability
defined_in: ADR-0017
last_changed_by: ADR-0017
status: active
created_at: 2026-05-11
updated_at: 2026-05-11
aliases:
  - 정책 게이트
  - source policy gate
detect_patterns:
  - "(?i)policy\\s+gate"
  - "(?i)source\\s+policy\\s+gate"
related_invariants:
  - INV-0017-1
  - INV-0017-2
  - INV-0017-3
  - INV-0017-4
  - INV-0017-5
  - INV-0012-7
provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true

applies_to_planes:
  - pipeline.policy_gate
  - storage.sqlite.source_policy
  - storage.sqlite.policy_decisions
forbidden_paths:
  - storage.r2.bytes              # policy_gate는 metadata, raw bytes 없음
---

# policy_gate

## Definition

`policy_gate`는 source 정책 검사 단계다 (ADR-0017). source_policy 3 필드
(archive_policy / raw_cloud_policy / external_llm_policy)와 8 위험 행동 트리거
를 검사하며, **mode-aware** 동작한다 — `inline_block` / `inline_warn` /
`batch_report` (ADR-0017 INV-0017-2).

단계별 default mode:
- Discovery / Initial fetch — `inline_warn`
- Extract / Cache / Embed / Cloud upload — **`inline_block`**
- 시나리오·thesis 탐색 (interactive) — `batch_report` → access_intervention
- 콘텐츠 제작 추가 fetch — `batch_report` (default) + `inline_block` (위험
  행동)
- Publication preflight — `inline_block`

**위험 행동** (어느 mode에서도 inline_block):
1. source policy unknown인데 raw text를 외부 LLM에 보내려 함
2. source가 paywalled / proprietary
3. terms에 no scraping / no AI / no archive / no redistribution
4. wire-service full text
5. article/report 원문 quote / cache
6. 기사/리포트 도표·스크린샷 콘텐츠 추가
7. raw source embedding/indexing
8. raw source cloud upload

모든 결정은 `policy_decisions` ledger에 기록 (audit trail).

## Why this term exists

Round 14/Q9-5에서 신설 — 외부 LLM에 raw text 전송, paywalled fetch, scraping
ban 위반, wire-service full text 등을 즉각 차단할 메커니즘이 필요했다.
ADR-0007/Q2의 archive_policy 단일 필드를 3 필드로 확장.

Round 18에서 mode-aware 확장 — 탐색·콘텐츠 제작 단계의 inline block은
비효율이라 batch_report mode로 누적해 세션 종료 시 일괄 검토 (access_intervention).

## Examples

- 긍정 예: Reuters wire-service full text fetch 시도 (위험 행동 #4) → 어느
  mode에서도 inline_block → policy_decisions ledger에 (decision=block,
  gate_mode=inline_block, reason="wire_service_full_text") 기록
- 긍정 예: 시나리오 탐색 중 robots disallow URL 만남 → batch_report mode이므로
  AccessIntervention에 LOW severity로 누적 → 세션 종료 시 batch report
- 긍정 예: external_llm_policy=manual_review_required인 source의 raw text를
  Anthropic SDK에 보내려 함 → inline_block (외부 LLM 위험 트리거 #1)
- 부정 예: batch_report mode 안에서 raw cloud upload 통과 — 위험 행동은
  override 불가 (INV-0017-4)
- 부정 예: 모든 단계에서 inline_block만 사용 → 시나리오 탐색 흐름 깨짐
  (Round 18 사용자 발의 폐기)

## Drift history

- 2026-05-11 ADR-0017 (Round 14/Q9-5 + Round 18) — policy_gate 신설 +
  mode-aware (inline_block / inline_warn / batch_report) + 8 위험 행동 트리거
