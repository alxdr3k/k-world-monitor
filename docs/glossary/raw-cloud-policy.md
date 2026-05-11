---
id: glossary-raw-cloud-policy
type: glossary_term
term: raw_cloud_policy
term_type: capability
defined_in: ADR-0012
last_changed_by: ADR-0017
status: active
created_at: 2026-05-11
updated_at: 2026-05-11
aliases:
  - cloud raw policy
detect_patterns:
  - "(?i)raw\\s+cloud\\s+policy"
  - "(?i)cloud\\s+raw\\s+upload"
related_invariants:
  - INV-0012-3
  - INV-0012-4
  - INV-0017-1
  - INV-0017-4
  - INV-0018-3
provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true

applies_to_planes:
  - storage.policy.raw_cloud_prohibition
  - storage.r2.permitted_artifacts
  - pipeline.policy_gate
forbidden_paths:
  - storage.r2.bytes_for_raw_third_party_text     # 영구 금지 (always_prohibited default)
---

# raw_cloud_policy

## Definition

`raw_cloud_policy`는 source의 raw third-party material을 클라우드 destination
(R2 / external LLM / public bucket)에 업로드 가능 여부를 결정하는 enum이다
(ADR-0012, ADR-0017):

- `always_prohibited` (default) — 일반 article / report raw text 등 모든
  third-party raw material에 적용. 어느 클라우드 destination에도 업로드 금지.
- `allowed_public_data_only` — 예외. source_material_policy에 명시된 open-
  license dataset / 공식 API 응답 / 자체 산출물만 R2 업로드 허용.

ADR-0017 policy_gate INV-0017-4의 위험 행동 #7, #8 트리거와 직결.

## Why this term exists

Round 14/Q9-4에서 사용자 결정으로 신설. ADR-0004(Round 3 lock)는 R2를 "Snapshot
원본 bytes(HTML / PDF) + 추출 텍스트 캐시의 canonical 저장소"로 정의했지만,
저작권/약관/평판 위험을 고려해 Round 14에서 raw cloud upload를 영구 금지로
강화. R13에서 잠시 검토했던 "R2 temporary object" 옵션도 명시 폐기.

ADR-0012 INV-0012-3 — Snapshot은 fingerprint record이며 R2 binary 보관은
예외(open-license / 공식 API / 자체 산출물)로만 허용.

## Examples

- 긍정 예: WSJ 기사 raw HTML — raw_cloud_policy=always_prohibited 적용 → R2
  업로드 금지, Snapshot은 fingerprint(URL/content_hash/locator)만 보관
- 긍정 예: FRED API JSON response — raw_cloud_policy=allowed_public_data_only
  + source_material_policy=open_license dataset → R2 업로드 허용 (r2_key
  채워짐)
- 긍정 예: 자체 작성 chart PNG — derived artifact이므로 정책 무관 R2 허용
- 부정 예: terms에 "no redistribution" 명시된 source의 raw text를
  raw_cloud_policy=allowed로 override — 위험 행동 트리거 #8, inline_block
- 부정 예: external LLM(Anthropic API)에 raw third-party text 전달 — cloud
  destination 정의에 포함, INV-0017-4 트리거 #1

## Drift history

- 2026-05-11 ADR-0012 (Round 14/Q9-4) — raw_cloud_policy 신설, default
  always_prohibited
- 2026-05-11 ADR-0017 (Round 14/Q9-5) — source_policy 3 필드의 하나로 통합
  (archive_policy + raw_cloud_policy + external_llm_policy)
