# Current State

This file is the first read for new AI/human sessions.

It is a compressed current operating view, not full history.

## Project mode

- mode: greenfield
- adopted on: n/a
- adoption notes: n/a

## Product / Project

`k-world-monitor`는 세계 경제·지정학·감염병 등 변동성 높은 주제에서 **세계
변화의 위험·기회·회복탄력성·비대칭 영향 4축을 병렬 추적하는 시나리오
인텔리전스 파이프라인**이다. 9-stage 객체 모델(Source → Document → Snapshot →
Claim → Dossier → Scenario → Thesis → ContentDraft → Publication)로 구조화하고,
출판 콘텐츠의 모든 주장을 source까지 5단계 이내로 역추적 가능하게 유지하며,
raw third-party text는 클라우드에 저장하지 않는 콘텐츠 생산 시스템이다.

이 repo는 second-brain ideation
[`research-content-pipeline-architecture`](../discovery/research-content-pipeline-ideation.md)
의 "Current Canonical Direction" 섹션(Round 1~25 누적 결론)을 구현하는 외부
코드 repo다. 부트스트랩 시 Round 3 lock만 반영했던 ADR-0003/0004/0007/0008은
2026-05-11 reset에서 R6/R8/R10/R14/R17/R18/R19/R23/R25의 후속 결정을 반영해
ADR-0011~0021로 supersede됐다.

## Current roadmap position

- current milestone: `P0-M1` (Schema & Bulk Store Bootstrap — Round 25 canonical
  기준)
- active tracks: `INFRA` (Neo4j + SQLite + R2 부트스트랩 + Source policy gate +
  access_interventions)
- active phase: `INFRA-1A` (ADR scaffold + 9-stage 글로서리 + Round 25
  canonical 확정)
- active slice: **`INFRA-1A.1` 재작성 완료** — ADR-0011~0021 신규 + ADR-0003/
  0004/0007/0008 supersede + 9-stage 글로서리 + PRD/HLD/current-state 갱신
- last accepted gate: none yet
- next gate: `AC-001` (도메인 객체 9-stage 모델 + 4-tier source layer + Neo4j
  graph store가 ADR로 lock — ADR-0011 + ADR-0012 + ADR-0013)
- canonical ledger: `docs/04_IMPLEMENTATION_PLAN.md`

## Implemented

코드 구현은 아직 없다. 현재까지 채워진 것은 문서 기반 architecture 합의:
- ADR 0001~0010 (boilerplate placeholder 1개 + 0002 invariant tracking +
  Round 3 lock 시점 0003~0010 8개. 0003/0004/0007/0008은 0011~0015로
  superseded)
- ADR 0011~0021 (Round 4~25 canonical) 11개 신규 작성
- project delivery artifacts(PRD/HLD/Implementation Plan/Acceptance Tests/
  Glossary/Questions/Decisions/Traceability)

## Planned

- Schema & Bulk Store Bootstrap (`P0-M1`): Neo4j Community Edition + SQLite
  스키마, R2 permitted-artifact 정책 lock, Source policy gate + access_intervention
  스키마 lock
- Source Registry & Collection Queue (`P0-M2`): Tier A 30~50 seed +
  collectability_score (Q21), Discovery → 큐 적재 → fetch / fingerprint
  snapshot / chunk
- Extraction & Review (`P0-M3`): Haiku 1차 + Sonnet escalate, auto-accept
  threshold, review queue throttling, run ledger, metrics_run
- Search & Dossier (`P0-M4`): Neo4j native FTS 검색 + Dossier 합성 (counterclaim
  pool)
- Scenario Validate (`P0-M5`): assumptions / branches / falsifiers /
  counterclaim(polarity-symmetric) / impact_targets / transmission_channels
  검증 + scenario_revisions ledger
- Thesis & Content (`P0-M6`): Thesis(stance + market_stance) → ContentDraft
  4-format → Publication + cite check 5+1
- Manual Feedback & Policy Learning (cross-cutting): `pipeline feedback` CLI,
  access_interventions batch report, policy_learning Pattern 1

## Explicit non-goals

- 실시간 뉴스 피드 / 대시보드
- 일반 PKM 영역(Inbox / SlipBox 등) 재구조화
- 마크다운 본문에 모든 candidate claim을 자동 생성 (vault 무너뜨림)
- 단일 LLM extractor로 article + dataset + report 통합 처리
- 봇 감지 우회를 production dependency로 (ADR-0016)
- Raw third-party text의 클라우드 업로드 (ADR-0012, raw_cloud_policy=always_prohibited)
- 다양한 graph DB 동시 지원 / vendor-neutral 마이그레이션 자동화 (ADR-0014
  intentional lock-in)
- ML fine-tuning 기반 policy 학습 (ADR-0021 rule-based 한정)

## Current priorities

1. INFRA-1A.1 재작성 후 9-stage 글로서리 + 신규 용어(source, thesis,
   access_intervention, manual_claim_entry, collectability_score, policy_gate,
   raw_cloud_policy, impact_target, transmission_channel, source_perspective)
   glossary entry 추가
2. Q-020 (Neo4j GPL v3 boundary) + Q-021 (Tier A seed 30~50개 분포 균형) 결정
3. INFRA-1A.2: Neo4j Cypher schema v1 + SQLite relational schema v1 +
   마이그레이션 commit
4. SPIKE-001 재정의: Neo4j Community + native FTS 1만 graph object < 1초 p95
   (NFR-001)

## Current risks / unknowns

- Q-001 scenario horizon enum 정의
- Q-002 Dossier `stale_after` 기본값
- Q-003 Publication 정정 ledger 트리거
- Q-004 SQLite relational metadata와 vault `_System/Indexes/*.jsonl` 책임 분담
- Q-008 Thesis ID 체계
- Q-012 Neo4j ↔ SQLite sync (CDC vs batch)
- Q-020 Neo4j GPL v3 boundary
- Q-021 Tier A source seed 30~50개 + perspective 분포 균형
- Q-022 v0 카테고리 8개(core 7 + `digital_assets`) + tag 5개 + axis
  transmission_channel finalize
- Q-024 Neo4j-specific 기능 활용 boundary
- Q-025 외부 repo 부트스트랩 cadence
- Q-026 Vault sync trigger
- Q-027 백업 schedule + R2 lifecycle
- Q-028 LLM API cost 통제 정책
- Q-029 ImpactAssessment v0 embedded vs v1 노드
- Q-030 counterclaim multi-relation v1 도입 우선순위
- SPIKE-001 Neo4j Community + native FTS가 1만 graph object 시점 검색 < 1초
  NFR-001을 만족하는지 (SQLite+FTS5에서 대상 갱신)

## Current validation

- 문서 invariant validator (`bun run invariant:check`) — warning level only
  (ADR-0002 INV-0002-1)
- 코드 acceptance gate는 아직 없음 — `06_ACCEPTANCE_TESTS.md` AC 정의만 완료
  (Round 25 canonical 반영 펜딩)

## Needs audit

- `docs/05_RUNBOOK.md`: 배포 파이프라인이 아직 정의되지 않음 — "No deployment
  pipeline currently defined." 상태로 유지
- `docs/current/CODE_MAP.md`, `DATA_MODEL.md`, `RUNTIME.md`, `OPERATIONS.md`,
  `TESTING.md`: 코드 미존재. Neo4j Cypher schema + SQLite relational schema 합의
  후 갱신 필요
- `docs/06_ACCEPTANCE_TESTS.md`: Round 25 canonical 반영 완료 (AC-022~AC-033 +
  TEST-022~TEST-033 신규, DEC-003). 코드 도입 시 TEST 위치 `(planned)` →
  실제 경로 갱신 필요
- `docs/09_TRACEABILITY_MATRIX.md`: Round 25 canonical 반영 완료 (TRACE-001~020
  supersede 표시 + TRACE-021~033 신규). gate evidence는 코드 / SPIKE 결과
  누적 후 갱신

## Links

- PRD: [`../01_PRD.md`](../01_PRD.md)
- HLD: [`../02_HLD.md`](../02_HLD.md)
- Roadmap / status ledger: [`../04_IMPLEMENTATION_PLAN.md`](../04_IMPLEMENTATION_PLAN.md)
- Acceptance tests: [`../06_ACCEPTANCE_TESTS.md`](../06_ACCEPTANCE_TESTS.md)
- Questions: [`../07_QUESTIONS_REGISTER.md`](../07_QUESTIONS_REGISTER.md) (per-file under `../questions/`)
- Decisions: [`../08_DECISION_REGISTER.md`](../08_DECISION_REGISTER.md) (per-file under `../decisions/`)
- ADRs: [`../adr/`](../adr/)
- Ideation source: [`../discovery/research-content-pipeline-ideation.md`](../discovery/research-content-pipeline-ideation.md) — "Current Canonical Direction" 섹션이 canonical view (Round 1~25 누적)

---

Rules:

- Keep this file short.
- Do not append full history.
- Do not copy the full roadmap / phase / slice ledger here.
- If historical reasoning matters, link to ADR/discovery/archive.
- If this file becomes long, compress it.
