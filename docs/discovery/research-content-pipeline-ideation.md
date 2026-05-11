# Discovery: research-content-pipeline-architecture (second-brain ideation)

> 이 노트는 second-brain ideation 세션의 요약 + 링크다. canonical은 second-brain
> 에 있다.
>
> **Round 1~3 lock**: 이 repo의 ADR-0003 ~ ADR-0010이 implementation-ready
> 형태로 옮긴 결과다 (단 ADR-0003/0004/0007/0008은 Round 4~25 결정에 의해
> ADR-0011/0012/0013/0015로 supersede됨).
>
> **Round 4~25**: 시스템 정체성·스택·객체 모델·정책의 대대적 supersede가
> 누적됐다. 본 노트는 Round 1~3 요약만 담는다 — Round 4~25는 **ADR-0011 ~
> ADR-0021** + **DEC-003** + ideation 본문의 "Current Canonical Direction"
> 섹션(라운드 본문보다 우선)에서 implementation-ready 형태로 참조 가능.
> 자세한 supersede trail은 `docs/decisions/DEC-003.md`.

## Source (canonical)

`~/ws/second-brain/02. Ideation/research-content-pipeline-architecture.md`
(Round 1 ~ 25, 2026-05-09 ~ 2026-05-10). 본 repo 외부 vault에 위치. 본 노트는
Round 1~3 요약. Round 4~25는 ADR-0011 ~ ADR-0021로 직접 implementation 진입
(DEC-003).

- Round 1 (Claude 초안): 7-stage 의 첫 안 — SourceNote=URL, ClaimNote 자동
  markdown, single confidence 필드
- Round 2 (GPT 비판): R1 ~ R9 약점 (SourceNote=URL 부족, ClaimNote 자동 생성
  vault 무너짐, confidence 단일 필드, edge frontmatter 배열, cite check 얕음,
  원문 인용 금지 자해, dataset/article extractor 분리, Dossier 중간 계층 필요,
  Discovery+Queue 필수)
- Round 3 (Claude 메타 리뷰 + 사용자 결정): GPT 비판 대부분 수용. 5-tier →
  3-tier 축소. 위치는 vault 내 형 결정 (이후 외부 repo 형으로 진화 — 본 repo).
  A1-A4 추가 (LLM cost / stale 트리거 3종 / review throttling / scenario 진화).

## Round 3 Outcome — 14 settled + A1-A4

second-brain 노트의 "Agreed / settled" 섹션을 그대로 옮긴다. 각 항목은 본 repo의
어느 ADR / REQ에 매핑되는지 명시한다.

| # | Settled | This repo |
|---|---|---|
| 1 | 객체 모델 7-stage (Document → ... → Publication) | ADR-0003, REQ-001 |
| 2 | 위치(vault 내 형) — 이후 외부 repo 형으로 진화 | DEC-001 (이 repo의 분리 결정) |
| 3 | CLAUDE.md 수정 (Projects external-repo 의무 → 옵션) | second-brain 측 처리 (이 repo는 외부 repo 형) |
| 4 | 스키마: type enum 그대로 + research:{object_type, schema_version} 직교 필드 | second-brain vault 측 정책 — 이 repo는 SQLite 자체 스키마로 분리 (ADR-0004) |
| 5 | Bulk store: SQLite + FTS5 처음부터 | ADR-0004, REQ-002 |
| 6 | Storage 분담 (Markdown / SQLite / R2) | ADR-0004, REQ-003, REQ-004 |
| 7 | ID 체계 doc_/snap_/clm_/dos_/scn_/drf_/pub_/edge_/run_ | ADR-0003, REQ-005 |
| 8 | Confidence 분해 (reliability_tier / extraction_confidence / claim_status / scenario weight) | ADR-0005, REQ-006 |
| 9 | Evidence: 짧은 quote (≤200자) + locator + quote_hash | ADR-0008, REQ-007, NFR-005 |
| 10 | Edge: supports/contradicts/qualifies/updates/supersedes는 별도 record | ADR-0007, REQ-008 |
| 11 | Cite check 강화: stale/retracted/horizon/unit/overclaim | ADR-0008, REQ-013 |
| 12 | Extractor 분리: article(LLM) / dataset(parser) / report(LLM with structure) | ADR-0006, REQ-009 |
| 13 | LLM 비용: Haiku 1차 + Sonnet escalate, prompt caching, batch API, auto-accept | ADR-0006, REQ-010 |
| 14 | 구현 순서 (정책 → ID/ledger → registry/queue → fetch/snapshot/chunk → extract → review → search/query → dossier → scenario validate → content + cite_check) | 04_IMPLEMENTATION_PLAN milestones P0-M1 ~ P0-M6 |
| A1 | LLM 비용 — Haiku 1차 + Sonnet escalate, prompt caching, batch API, auto-accept threshold | ADR-0006 (settled 13과 합쳐짐) |
| A2 | Stale 트리거 정의 — 시간 기반 + snapshot diff 기반 + counterclaim 등록 시 | ADR-0010, REQ-016 |
| A3 | Review queue throttling — high reliability + extraction_confidence ≥ 0.85 자동 confirm | ADR-0006, ADR-0010, REQ-015 |
| A4 | Scenario 시간 진화 — scenario_revisions ledger + supersedes/updates edge | ADR-0009, REQ-014 |

## settled (2)(3)(4) — vault 측 결정의 본 repo boundary

settled (2)(3)(4)는 vault 측 결정으로, 본 repo (외부 코드 repo)에서는 직접
적용 대상이 아니다. boundary lock은 [`../decisions/DEC-002.md`](../decisions/DEC-002.md)
에 명시되어 있다 — vault 위치 / CLAUDE.md 정책 / `research:{object_type,
schema_version}` 직교 필드 각각에 대해 본 repo가 어떻게 처리하는지(주로
"second-brain 측 책임" 또는 "PUB-1A 단계 export 정책에서 결정")를 다룬다.

DEC-001(외부 repo 형 진화)과 DEC-002(settled (2)(3)(4) boundary)는 ideation
Round 3 결정의 두 갈래 — 하나는 ideation 결정의 진화, 다른 하나는 vault 측
결정의 본 repo boundary 명시 — 를 표현한다.

## Round 3 Discarded — 본 repo는 따라간다

- 새 top-level `08. Research/` (vault) — 본 repo는 외부 코드 repo이므로 무관
- SourceNote = URL 1:1 모델 — Document/Snapshot 분리 (ADR-0003)
- ClaimNote 대량 Markdown 자동 생성 — SQLite canonical (ADR-0004)
- NOTE_SCHEMA `type` enum 5종 추가 — second-brain vault 정책, 본 repo 무관
- `confidence: 0-1` 단일 필드 — 분해 (ADR-0005)
- `supports[]/contradicts[]` frontmatter 배열 — edge record (ADR-0007)
- `fetch_url.ts`로 시작 — registry/queue가 먼저 (REQ-011)
- "원문 인용 전면 금지" — 짧은 quote + hash 허용 (ADR-0008)
- JSONL only bulk store — SQLite + FTS5 처음부터 (ADR-0004)
- `evidence_strength` 별도 필드 — status + reliability에서 파생 (ADR-0005)

## Open Questions (still open)

second-brain 세션의 4개 Open Question은 본 repo의 `docs/questions/`에 per-file로
이전됐다.

- Q-001: scenario horizon enum 정의 → [`../questions/Q-001.md`](../questions/Q-001.md)
- Q-002: Dossier `stale_after` 기본값 → [`../questions/Q-002.md`](../questions/Q-002.md)
- Q-003: Publication 정정 ledger 트리거 → [`../questions/Q-003.md`](../questions/Q-003.md)
- Q-004: SQLite vs vault `_System/Indexes/*.jsonl` 책임 분담 →
  [`../questions/Q-004.md`](../questions/Q-004.md)

## Why this discovery note exists

- Discovery 노트는 implementation authority가 아니다 (`docs/DOCUMENTATION.md`
  source-of-truth hierarchy 참조).
- 그러나 이 repo의 ADR-0003 ~ ADR-0010이 어느 외부 ideation에서 왔는지 anchor가
  없으면 reviewer가 결정 사유를 추적할 수 없다.
- 따라서 이 노트는 외부 source(second-brain)의 anchor만 제공하며, 결정의
  rationale은 각 ADR의 `## Context` / `## Decision` / `## Consequences` 섹션이
  canonical이다.

## Round 4~25 supersede summary

ideation은 Round 4~25에서 시스템 정체성·스택·객체 모델·정책을 대대적으로
supersede했다. 본 repo는 Round 3 lock만 반영한 초기 부트스트랩(ADR-0003 ~
ADR-0010)을 2026-05-11 DEC-003 reset으로 Round 25 canonical에 맞춰
재정렬했다.

| Round | 결정 요지 | 본 repo |
|---|---|---|
| R4 | 외부 repo 형 결정 | DEC-001 (이미 기록) |
| R5 | WorldMonitor 6패턴 차용 → "참조 후 독립 구현"으로 표현 변경 | ADR-0002 (예정 신설) / 본 노트 |
| R6/Q1 | 7-stage → 9-stage (Source + Thesis 추가) | ADR-0011 (supersedes 0003) |
| R7/Q2 | source_material_policy + archive_policy v0 4-enum | ADR-0017 (Round 14에서 3 필드 확장) |
| R8/Q3 | Snapshot 의미 변경: R2 binary → fingerprint record | ADR-0012 (supersedes 0004) |
| R9/Q4 | claim_status 5→8 state + dataset_vintage + observation/vintage date | ADR-0011, ADR-0005 update |
| R10/Q5 | evidence quote nullable + quote_reason + storage_level 4단계 | ADR-0015 (supersedes 0008) |
| R11/Q6 | visual_policy (별도 ADR — 미작성, follow-up) | follow-up |
| R12/Q7 | Thesis 객체 + counterclaim first + publication preflight 4-check | ADR-0011, ADR-0015 |
| R13/Q8 | RAG 단계화 + research_session + raw_cache_items + GraphRAG v3 보류 | ADR-0021 + 본 노트 |
| R14/Q9 | graph DB deferred, raw_cloud_policy=always_prohibited, policy_gate + 8 트리거 | ADR-0012, ADR-0017 |
| R15/Q10 | metrics framework 6 카테고리 + policy learning rule-based | ADR-0020, ADR-0021 |
| R16/Q11 | canonical export contract + adapter (R19에서 폐기) / Apache AGE vs Neo4j | (ADR-0015 candidate 폐기) |
| R17/Q12 | Tier A-D + collectability_score + 봇 우회 금지 + BSL OK | ADR-0016 |
| R18 | Q18 사용자 결정 — **Neo4j Community Edition 채택** + mode-aware policy gate + access_interventions + manual_claim_entries 3-way + publication preflight 5-check | ADR-0012, ADR-0013, ADR-0017, ADR-0018, ADR-0015 |
| R19 | ADR-0015 폐기 + Neo4j-native 기능 최대 활용 + 의도적 lock-in | ADR-0014 |
| R20 | Q5 finalize → `alxdr3k/k-world-monitor` | (외부 repo bootstrap) |
| R21 | GPT 종합 리뷰 흡수 + Current Canonical Direction 섹션 + Q-020/Q-021 신설 | (ideation 본문) |
| R22 | 카테고리 8개 (core 7 + `digital_assets`) + tag 5개 + transmission_channel | Q-022, ADR-0019 |
| R23 | Bidirectional framing 발의 (시스템 양방향 대응 + source_perspective + v0 metrics 3개) | ADR-0019 |
| R24 | 자체 audit + R23 정정 + Q-024~Q-028 신설 | DEC-003 follow-ups |
| R25 | GPT 메타 재검토 — 4축 병렬 + target별 impact 분리 + thesis_stance/market_stance + EvidencePack 다층 + valence_balance_score 폐기 → one_sided_warning_rate | ADR-0019, ADR-0020 |

자세한 Round별 supersede trail은 `docs/decisions/DEC-003.md` "Context"
섹션 참조.

## Lifecycle Trail

- 2026-05-09 second-brain ideation Round 1~3 완료 → outcome lock
- 2026-05-10 ideation Round 4~25 supersede 누적 (R18 Neo4j 결정 + R19 native
  + R23/R25 bidirectional framing)
- 2026-05-11 본 repo 부트스트랩 + ADR-0003 ~ ADR-0010 lock + INFRA-1A.1
  slice landed (Round 3 lock 기준 — 후속 reset 필요)
- 2026-05-11 INFRA-1A.1 reset (DEC-003) — Round 25 canonical 반영, ADR
  0003/0004/0007/0008 supersede, ADR 0011~0021 신규, PRD/HLD/current-state/
  Implementation Plan/Acceptance Tests/Glossary/Traceability 갱신
- 다음: INFRA-1A.2 slice (SQLite + FTS5 스키마 v1)
