# Current State

This file is the first read for new AI/human sessions.

It is a compressed current operating view, not full history.

## Project mode

- mode: greenfield
- adopted on: n/a
- adoption notes: n/a

## Product / Project

`k-world-monitor`는 세계 경제·지정학·감염병 등 변동성 높은 주제를 시간 무관하게
대량 수집해 (Document → Snapshot → Claim → Dossier → Scenario → ContentDraft →
Publication) 7-stage 파이프라인으로 구조화하고, 출판 콘텐츠의 모든 주장을
원 snapshot bytes까지 5단계 이내로 역추적 가능하게 유지하는 리서치/콘텐츠
파이프라인이다. 이 repo는 second-brain ideation
[`research-content-pipeline-architecture`](../discovery/research-content-pipeline-ideation.md)
Round 3 lock 결정을 구현하는 외부 코드 repo다.

## Current roadmap position

- current milestone: `P0-M1` (Schema & Bulk Store Bootstrap)
- active tracks: `INFRA` (스키마/registry/queue/store 부트스트랩)
- active phase: `INFRA-1A` (정책 + ID/ledger 고정)
- active slice: `INFRA-1A.1` (도메인 글로서리 + ADR 확정)
- last accepted gate: none yet
- next gate: `AC-001` (도메인 객체 7-stage 모델 + 3-tier source layer가 ADR로 lock)
- canonical ledger: `docs/04_IMPLEMENTATION_PLAN.md`

## Implemented

코드 구현은 아직 없다. 현재까지 채워진 것은 문서 기반 architecture 합의(ADR-0003 ~
ADR-0010) + project delivery artifacts(PRD/HLD/Plan/Acceptance/Glossary).

## Planned

- Schema & Bulk Store Bootstrap (`P0-M1`): SQLite + FTS5 스키마, ID 발급 정책,
  Markdown ↔ DB ↔ R2 책임 분담 결정 lock
- Source Registry & Collection Queue (`P0-M2`): RSS / API / sitemap discovery →
  큐 적재 → fetch / snapshot / chunk
- Extraction & Review (`P0-M3`): Haiku 1차 + Sonnet escalate, auto-accept
  threshold, review queue throttling
- Search & Dossier (`P0-M4`): FTS5 검색 + Dossier 합성
- Scenario Validate (`P0-M5`): assumptions / branches / falsifiers / counterclaim
  검증 + scenario_revisions ledger
- Content & Cite Check (`P0-M6`): ContentDraft → Publication, stale / horizon /
  unit / overclaim 검출

## Explicit non-goals

- 실시간 뉴스 피드 / 대시보드
- 일반 PKM 영역(Inbox / SlipBox 등) 재구조화
- 마크다운 본문에 모든 candidate claim을 자동 생성 (vault 무너뜨림)
- 단일 LLM extractor로 article + dataset + report 통합 처리

## Current priorities

1. 도메인 글로서리 + 핵심 ADR(ADR-0003 ~ ADR-0010) lock
2. SQLite + FTS5 스키마 초안 + ID 발급 / ledger 정책 확정
3. Discovery → Queue 파이프라인 첫 slice 구현 진입 준비

## Current risks / unknowns

- Q-001 scenario horizon enum 정의
- Q-002 Dossier `stale_after` 기본값
- Q-003 Publication 정정 ledger 트리거
- Q-004 SQLite vs `_System/Indexes/*.jsonl` 책임 분담
- SPIKE-001 SQLite + FTS5가 1만 건 시점 검색 < 1초 NFR을 만족하는지

## Current validation

- 문서 invariant validator (`bun run invariant:check`) — warning level only
  (ADR-0002 INV-0002-1)
- 코드 acceptance gate는 아직 없음 — `06_ACCEPTANCE_TESTS.md` AC 정의만 완료

## Needs audit

- `docs/05_RUNBOOK.md`: 배포 파이프라인이 아직 정의되지 않음 — "No deployment
  pipeline currently defined." 상태로 유지
- `docs/current/CODE_MAP.md`, `DATA_MODEL.md`, `RUNTIME.md`, `OPERATIONS.md`,
  `TESTING.md`: 코드 미존재. SQLite 스키마 / runtime flow 합의 후 갱신 필요

## Links

- PRD: [`../01_PRD.md`](../01_PRD.md)
- HLD: [`../02_HLD.md`](../02_HLD.md)
- Roadmap / status ledger: [`../04_IMPLEMENTATION_PLAN.md`](../04_IMPLEMENTATION_PLAN.md)
- Acceptance tests: [`../06_ACCEPTANCE_TESTS.md`](../06_ACCEPTANCE_TESTS.md)
- Questions: [`../07_QUESTIONS_REGISTER.md`](../07_QUESTIONS_REGISTER.md) (per-file under `../questions/`)
- Decisions: [`../08_DECISION_REGISTER.md`](../08_DECISION_REGISTER.md) (per-file under `../decisions/`)
- ADRs: [`../adr/`](../adr/)
- Ideation source: [`../discovery/research-content-pipeline-ideation.md`](../discovery/research-content-pipeline-ideation.md)

---

Rules:

- Keep this file short.
- Do not append full history.
- Do not copy the full roadmap / phase / slice ledger here.
- If historical reasoning matters, link to ADR/discovery/archive.
- If this file becomes long, compress it.
