---
id: adr-0026
type: adr
title: Active source subset vs Tier A seed universe — v0 첫 발행 active ingestion scope 분리
status: accepted
created_at: 2026-05-11
updated_at: 2026-05-11
deciders: [user]
supersedes: []
superseded_by: []

scope:
  in:
    - pipeline.source_layer.active_subset_flag
    - pipeline.discovery_layer.active_polling_filter
    - pipeline.extraction_layer.active_ingestion_cap
    - storage.neo4j.source_node.active_v0_flag
  out:
    - pipeline.source_layer.tier_assignment
    - pipeline.extraction_layer.routing

invariants:
  - id: INV-0026-1
    statement: Tier A seed universe (72 source proposed, `docs/research/source-seed-list-2026-05.md`) 와 v0 active ingestion subset 은 분리된 두 집합이다. universe = "등록 후보 + 분포 균형 metric (REQ-022/AC-027) 적용 대상", active subset = "discovery polling + extract + dossier 합성에 실제 진입하는 source".
    status: active
  - id: INV-0026-2
    statement: v0 첫 발행 (DEC-009 + DEC-011) 의 active source subset = 13~14 source — 경제 핵심 9 + 정책 1 + 사회 1 + 부동산 specific 한국 3 신규 (KAB / MOLIT / HF). 나머지 58 source 는 universe 등록되지만 active ingestion 에서 제외.
    status: active
  - id: INV-0026-3
    statement: source registry 에 `active_v0` boolean flag 추가 (Neo4j Source 노드 속성). 운영자 명시 결정으로 true/false 설정. Discovery polling worker 는 `active_v0 = true` source 만 polling (또는 lower priority polling 옵션).
    status: active
  - id: INV-0026-4
    statement: active subset 외 source (universe 등록) 는 discovery / collection queue 에서 polling 제외 또는 lower priority. RSS / API endpoint 검증은 active subset 만 INFRA-1A.6 진입 시 의무. 나머지 universe source 는 endpoint 검증 deferred (v0 진행 중 누적 시점).
    status: active
  - id: INV-0026-5
    statement: active subset 확장은 운영자 명시 결정 (별도 ledger 또는 source registry 의 `active_since` 필드). 누적 확장 trigger = (a) v0 발행 retrospective 결과 source gap 발견, (b) 신규 주제 / 카테고리 진입, (c) 운영 cap (DEC-013) 안에서 attention bandwidth 여유 확인. v0 turn-key 진행 중 confirm trigger 없으면 13~14 source 유지.
    status: active
  - id: INV-0026-6
    statement: REQ-022 / AC-027 의 source_perspective 분포 균형 enforcement scope 는 **Tier A seed universe 전체** (72 source) 그대로 — active subset 만의 부분 분포 enforcement 아님. universe 분포 (risk 19% / opportunity 29% / neutral 42% / mixed 10%) 가 의무. active subset 의 분포는 reference only (예 v0 첫 발행 active 14 중 risk 4 / opportunity 3 / neutral 5 / mixed 2 정도).
    status: active

preconditions:
  - id: PRE-0026-1
    statement: Neo4j Source 노드 schema 에 `active_v0` boolean + `active_since` iso datetime + `active_until` iso datetime (nullable) 필드 추가 — INFRA-1A.2 migration 에 포함.
  - id: PRE-0026-2
    statement: Discovery polling worker (INFRA-1B.2) 가 `active_v0 = true` filter + (optional) lower priority polling for `active_v0 = false` source 를 지원.

defines:
  - term: active_source_subset
    role: primary
  - term: tier_a_seed_universe
    role: extends
  - term: active_v0_flag
    role: primary

invariant_review:
  status: pending
  reviewed_at: null
  fingerprint: null
unresolved_warnings: []
reviewed_terms:
  - source
  - source_perspective
  - reliability_tier
  - collectability_score
reviewed_scopes:
  - pipeline.source_layer
  - pipeline.discovery_layer
  - storage.neo4j.source_node

provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true
---

# ADR-0026: Active source subset vs Tier A seed universe

## Status

accepted — 2026-05-11

## Context

GPT 메타 리뷰 (2026-05-11, `docs/discovery/meta-review-2026-05-11-gpt-then-
claude-critical.md` Part 1) 의 핵심 지적:

> 72개 source 를 모두 실제 endpoint 검증, source_policy 설정, collectability_
> score 입력, RSS/API polling, dedupe, extraction, review까지 연결하면 첫
> publication 전에 운영 부담이 폭발합니다. ... 따라서 실제 동작 조건은:
> v0에서는 72개를 "등록 후보 universe"로 두고, 첫 발행에는 경제 8~12개
> source만 active ingestion 해야 합니다.

본 repo 의 비판적 리뷰 결과 = **수용**. 이유:
- Q-021 / DEC-009 / source-seed-list 가 72 source universe 를 lock 했지만,
  실제 v0 첫 발행 (PUB-1A.5, DEC-011 한국 부동산 폭락 시나리오) 까지의 운영
  capacity 안에서 72개 endpoint 검증 + policy + collectability + polling +
  extract + review 는 1인 + LLM agent 환경에서 불가능
- 그렇다고 72 universe 를 줄이면 (a) REQ-022 / AC-027 분포 균형 enforcement
  의 denominator 가 작아져 AC-027 통과 risk, (b) v1+ 누적 source 가 다시
  추가될 때 같은 lock 작업 재수행 부담
- 해결 = universe 와 active subset 을 **분리된 두 집합** 으로 정의. universe
  = 분포 + 후보, active subset = polling + 진입.

## Decision

### 1. 두 집합 정의

| 집합 | scope | enforcement | size (v0 entry) |
|---|---|---|---|
| **Tier A seed universe** | source registry 등록 후보 전체. 분포 균형 metric (REQ-022 / AC-027) 적용 대상. INFRA-1A.6 진입 시 정의 (Q-021) | risk ≤ 50% / opportunity ≥ 25% / neutral ≥ 15% (전체 기준) | **72 source** (`docs/research/source-seed-list-2026-05.md`) |
| **v0 active ingestion subset** | Discovery polling + collection queue + fetch + extract + Dossier 진입하는 source. `active_v0 = true` flag | endpoint 검증 + source_policy + collectability_score 의무. 분포는 reference only | **13~14 source** (DEC-011 economy + 부동산 specific) |

### 2. v0 첫 발행 active subset (13~14 source)

DEC-011 의 한국 부동산 폭락 시나리오에 정합한 active subset:

| # | Source | 카테고리 | perspective | 사유 |
|---|---|---|---|---|
| 1 | FRED | 경제 | neutral | 미국 매크로 timeseries anchor |
| 2 | Fed/FOMC | 경제 | risk | 미국 통화정책 (Fed 발 글로벌 금리) |
| 3 | BLS | 경제 | neutral | 미국 노동/물가 anchor |
| 4 | IMF | 경제 | opportunity | 글로벌 macro 안정성 |
| 5 | BIS | 경제 | risk | 금융안정 + 가계부채 cross-country |
| 6 | BOK ECOS | 경제 | risk | 한국 통화정책 + 가계부채 1차 source |
| 7 | KOSIS | 경제 | neutral | 한국 통계 (가계부채 / 인구 / 주택) |
| 8 | KDI | 경제 | opportunity | 한국 정책분석 |
| 9 | KIEP | 경제 | opportunity | Fed/글로벌 → 한국 영향 분석 |
| 10 | 금융위원회 | 경제 | risk | DSR/LTV/PF 정책 1차 |
| 11 | 외교부 | 정책 | neutral | 환율정책 외부 변수 |
| 12 | KIHASA | 사회 | mixed | 인구구조 / 청년 cohort |
| **13** | **한국감정원 (KAB)** | 경제 | neutral | 부동산 가격 통계 1차 (Q-021 추가 등록 의무) |
| **14** | **국토교통부 (MOLIT)** | 경제/정책 | neutral | 부동산 정책 1차 (Q-021 추가 등록 의무) |
| 15 (선택) | 한국주택금융공사 (HF) | 경제 | risk/mixed | 주담대 통계 + 보증 risk (Q-021 추가 등록) |

active subset 의 분포 (14 source 기준): risk 4 / opportunity 3 / neutral 5
/ mixed 2 = 29% / 21% / 36% / 14%. AC-027 분포는 **universe 기준** 이므로
부분 분포 enforcement 의무 X (INV-0026-6).

### 3. Source 노드 schema 확장

Neo4j `Source` 노드:
- 기존 필드: `src_id`, `publisher_name`, `urls_root[]`, `reliability_tier`,
  `collectability_score{...}`, `access_method`, `source_perspective`,
  `source_policy_fk`
- **신규 필드**:
  - `active_v0` (boolean) — 운영자 명시 결정. default `false`
  - `active_since` (iso datetime, nullable) — active subset 진입 시점
  - `active_until` (iso datetime, nullable) — active subset 탈퇴 시점

### 4. Discovery polling 동작

INFRA-1B.2 (Discovery worker):
- 기본 폴링 = `active_v0 = true` source 만
- optional lower priority polling = `active_v0 = false` source (운영자 옵션,
  v0 비활성)

### 5. v0 진행 중 active subset 확장 trigger

INV-0026-5 의 3 가지 trigger 중 하나:
- (a) v0 발행 retrospective 에서 source gap 발견 (예 첫 발행 후 "PF 부실은
  HF 만으로 부족, 한국은행 금융안정보고서 추가" 같은 운영 발견)
- (b) 신규 주제 / 카테고리 진입 (v1+ phasing 또는 운영자 새 주제 lock 시)
- (c) DEC-013 운영 cap 안에서 attention bandwidth 여유 확인

확장 시 운영자 명시 결정 + `active_since` 기록 + ADR-0026 historical
reference.

## Consequences

- 긍정:
  - v0 첫 발행까지 운영 부담 분리 — universe 72 → active 13~14
  - REQ-022 / AC-027 분포 enforcement 그대로 (universe 기준) — v1+ 확장 시
    재작업 X
  - active subset 확장 trigger 명시 — 운영 누적 결정 traceable
  - DEC-013 의 일일 candidate cap 등 운영 원칙과 자연 정합
- 부정:
  - Source 노드 schema 확장 (3 신규 필드) — INFRA-1A.2 migration 추가 부담
  - Discovery polling 의 active_v0 filter — INFRA-1B.2 추가 복잡도
  - 운영자가 active subset 변경 결정을 매번 명시해야 — manual workload
    (단 v0 turn-key 안에서 1~2회 예상이라 부담 적음)
  - active subset 의 분포가 부분 reference only — 실제 active 14 source 의
    perspective 분포가 우연히 한쪽으로 쏠려도 AC-027 통과 가능 (universe
    기준이라). 이건 의도된 trade-off (active subset 우선 작동 vs 분포 강제)
- Follow-ups:
  - Q-021 (Tier A seed) — 한국 부동산 specific 3 source (KAB / MOLIT /
    HF) 추가 등록 + universe = 75 source 갱신 (72 → 75) + 분포 재계산
  - INFRA-1A.2 (Cypher schema) — Source 노드 `active_v0` / `active_since`
    / `active_until` 필드 migration
  - INFRA-1A.6 (Tier A seed) — universe 75 source 분포 균형 + active
    subset 13~14 source 명시 등록 (active_v0 = true)
  - INFRA-1B.2 (Discovery worker) — active_v0 filter 구현
  - DEC-013 (active source cap, 별도 commit) — 일일 candidate / promoted /
    weekly dossier cap

## References

- DEC-009 (첫 발행 카테고리 = 경제, 상위 주제 = 한국 부동산)
- DEC-011 (sub-topic = 한국 부동산 폭락 시나리오)
- Q-021 (Tier A source seed — 72 source universe)
- Q-036 → DEC-011 (sub-topic resolved)
- ADR-0016 (Tier A-D + collectability_score)
- ADR-0019 (source_perspective 분포 균형, REQ-022)
- `docs/discovery/meta-review-2026-05-11-gpt-then-claude-critical.md` —
  GPT 메타 리뷰 + 비판적 리뷰
- `docs/research/source-seed-list-2026-05.md` — 72 source universe
