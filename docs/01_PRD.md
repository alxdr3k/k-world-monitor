# 01 PRD — Product Requirements Document

## Problem

세계 경제·지정학·전염병 같은 변동성 높은 주제에 대해 소수 운영자가 시간이
얼마나 들든 대량의 자료를 수집·구조화해 시나리오로 검증하고 블로그/유튜브
콘텐츠로 발행하려 한다. 단순 자연어 요약은 조회·반증·추적이 불가능하고, 원문
전체를 vault에 저장하는 것은 한계가 있다. 콘텐츠의 한 문장이 어떤 원 snapshot
bytes에서 왔는지를 5단계 이내로 역추적할 수 있는 파이프라인이 필요하다.

## Users & Goals

- 주요 사용자:
  - 운영자(현재는 1인) — 도메인 결정자 + 콘텐츠 작성자
  - 보조 LLM 에이전트 — 후보 claim 추출, dossier 합성, scenario validate, cite
    check
- 사용자의 목표:
  - 시간이 얼마나 들든 대량 수집을 감당
  - 원문은 git 밖(R2)에, vault에는 검증 가능한 메타데이터만
  - 시나리오의 가정·반증조건·반대 증거를 모두 추적
  - 콘텐츠의 모든 주장이 source claim까지 역추적
- 비즈니스 목표:
  - 한 명의 운영자가 신뢰 가능한 macro 콘텐츠를 지속 발행
  - 같은 source set이 주어지면 다른 운영자가 같은 결론에 도달할 만큼 재현
    가능한 결정 흔적

## Scope

### In-scope

- 외부 자료(article / dataset / report) discovery → 큐 → fetch → snapshot →
  chunk → claim 추출
- claim 단위 evidence locator + extraction provenance + lifecycle status 관리
- 주제별 Dossier(현황판) 합성, scenario(드라이버/가정/분기/falsifier) 모델링
- ContentDraft → Publication 추적, cite check (stale / horizon / unit / overclaim)
- SQLite + FTS5 canonical bulk store, Markdown은 curated / promoted view, R2는
  원문 / 추출 텍스트 보관
- supports / contradicts / qualifies / updates / supersedes edge ledger
- LLM 비용 가드(Haiku 1차 + Sonnet escalate, prompt caching, batch API,
  auto-accept threshold)
- scenario_revisions ledger (시간 진화 추적)

### Out-of-scope

- 실시간 뉴스 피드 / 대시보드 (변동성에 휘둘리지 않는 시간 무관 수집이 명시 목표)
- 일반 PKM 영역(Inbox / SlipBox 등) 재구조화
- 마크다운 본문에 모든 candidate claim을 자동 생성 (vault 무너뜨림 — ADR-0004)
- 단일 LLM extractor로 article / dataset / report 통합 처리 (parser 분리 —
  ADR-0006)
- 자동 publish 자동화 (사람 운영자가 최종 발행 결정)

## Requirements

### Functional (REQ-###)

> Source 열은 second-brain ideation `research-content-pipeline-architecture` Round 3
> "Agreed / settled" 14항(번호 1~14) 또는 메타리뷰 추가 항목 A1~A4를 가리킨다.

| ID | 요구사항 | 우선순위 | 관련 AC | Source (settled #) | ADR |
|---|---|---|---|---|---|
| REQ-001 | 객체 모델은 7-stage(Document → Snapshot → Claim → Dossier → Scenario → ContentDraft → Publication)이며 source layer는 Document/Snapshot/Claim 3-tier로 분리한다 | must | AC-001 | (1) | ADR-0003 |
| REQ-002 | 모든 후보 claim, snapshot 메타, chunk 인덱스, edge는 SQLite + FTS5 canonical bulk store에 저장한다 | must | AC-002 | (5) | ADR-0004 |
| REQ-003 | 원본 HTML/PDF 및 추출 텍스트 캐시는 R2에 저장한다(`r2_key`, `sha256`, `mime` 메타 보존) | must | AC-003 | (6) | ADR-0004 |
| REQ-004 | Markdown vault에는 Document hub, Dossier, Scenario, ContentDraft, Publication, scenario에 인용된 promoted claim만 둔다 | must | AC-004 | (6) | ADR-0004 |
| REQ-005 | ID 체계는 `doc_/snap_/clm_/dos_/scn_/drf_/pub_/edge_/run_` 접두 + 단조 증가 식별자다 | must | AC-005 | (7) | ADR-0003 |
| REQ-006 | confidence 단일 필드는 사용하지 않는다. Document `reliability_tier`, Claim `extraction_confidence` + `claim_status`, Scenario assumptions[] `weight`로 분해한다 | must | AC-006 | (8) | ADR-0005 |
| REQ-007 | claim 인용 시 `quote(≤200자) + locator + quote_hash`를 evidence로 허용한다 | must | AC-007 | (9) | ADR-0008 |
| REQ-008 | edge 관계(supports / contradicts / qualifies / updates / supersedes)는 별도 edge record(SQLite 테이블)로 저장한다. frontmatter `supports[]/contradicts[]` 배열은 금지 | must | AC-008 | (10) | ADR-0007 |
| REQ-009 | extractor는 article(LLM) / dataset(parser) / report(LLM with structure prompt)로 분리한다 | must | AC-009 | (12) | ADR-0006 |
| REQ-010 | LLM 호출은 Haiku 4.5 1차 + Sonnet 4.6 escalate, prompt caching, batch API를 사용한다. `reliability_tier=high` ∧ `extraction_confidence ≥ 0.85`일 때 auto-accept한다 | must | AC-010 | (13), A1 | ADR-0006 |
| REQ-011 | discovery(RSS / API / sitemap) → Source Registry → Collection Queue → fetch / snapshot / chunk → extract → review → search / query → dossier → scenario validate → content + cite check 순서로 구현한다 | must | AC-011 | (14) | (roadmap) |
| REQ-012 | scenario validate는 falsifier / counterclaim / monitoring signal 누락을 차단한다 | must | AC-012 | (1), A4 | ADR-0009 |
| REQ-013 | cite check는 stale / retracted / horizon mismatch / unit mismatch / overclaim을 검출한다 | must | AC-013 | (11) | ADR-0008 |
| REQ-014 | scenario는 시간에 따라 진화한다. `scenario_revisions` ledger + `supersedes`/`updates` edge로 변경 이력을 추적한다 | must | AC-014 | A4 | ADR-0009 |
| REQ-015 | review queue는 throttling 정책을 적용한다(`reliability_tier=high` ∧ `extraction_confidence ≥ 0.85` 자동 confirm) | must | AC-015 | A3 | ADR-0006, ADR-0010 |
| REQ-016 | stale 트리거는 (a) 시간 기반 (b) snapshot diff 기반 (c) counterclaim 등록 시 셋 다 적용한다 | must | AC-016 | A2 | ADR-0010 |

### Non-functional (NFR-###)

| ID | 카테고리 | 목표 | 측정 방법 | 관련 AC | Source (settled #) | ADR |
|---|---|---|---|---|---|---|
| NFR-001 | performance | claim/snapshot 1만 건 시점에서 단일 검색 < 1초 (p95) | bench script: SQLite + FTS5 cold cache 검색, 1만 row fixture | AC-002 | (rubric) | ADR-0004 |
| NFR-002 | reproducibility | 동일 source set + scenario 모델로 다른 운영자가 같은 결론 도달 가능 | scenario evidence + edge ledger reproducibility test (수동 + diff) | AC-017 | (rubric), A4 | ADR-0009 |
| NFR-003 | traceability | 콘텐츠 한 문장 → 원 snapshot bytes까지 5단계 이내 (Publication → ContentDraft → Claim → Snapshot → R2 bytes) | cite check report에서 trace depth 측정 | AC-018 | (rubric) | ADR-0003 |
| NFR-004 | cost | 일일 LLM 비용 상한 설정 + 초과 시 조용한 backoff | `run_` 단위 비용 ledger + threshold alert | AC-019 | A1 | ADR-0006 |
| NFR-005 | safety | 외부 인용 시 `quote ≤ 200자` 강제 | extract pipeline assertion + cite check | AC-007 | (9) | ADR-0008 |
| NFR-006 | durability | snapshot은 원문 변경/삭제 후에도 R2에서 회수 가능 | r2_key + sha256 무결성 verify | AC-020 | (6) | ADR-0004 |
| NFR-007 | maintainability | 새로운 source type을 LLM/parser 분리 원칙 안에서 추가 가능 | extractor interface contract + 1개 신규 type 추가 dry-run | AC-021 | (12) | ADR-0006 |

## Assumptions

- ASM-001: 운영자가 Cloudflare R2 + SQLite(local) 운영을 감당할 수 있다.
- ASM-002: Haiku 4.5 + Sonnet 4.6의 prompt caching + batch API가 비용 모델을
  유지할 만큼 캐시 적중률을 만든다.
- ASM-003: Markdown vault에 promoted claim만 들어가도 운영자가 컨텍스트를 잃지
  않는다.
- ASM-004: SQLite + FTS5가 1만 건 규모에서 NFR-001을 만족한다(SPIKE-001로 검증).
- ASM-005: 외부 source 대부분이 fetch 시점 sha256으로 변경 감지가 충분하다(통계
  데이터셋 외).

위 가정 중 결과에 큰 영향을 주는 가정은 `03_RISK_SPIKES.md`에 SPIKE-###로 옮긴다.

## Constraints

- LLM-only 작성 환경(사람이 코드를 손으로 자주 편집하지 않음). 모든 산출물은
  LLM 에이전트가 frontmatter + boilerplate invariant tracking을 따라 작성.
- Markdown은 사람용, bulk 데이터는 SQLite, 원문은 R2. 한 곳에서 모든 책임을
  지지 않는다 (ADR-0004).
- 외부 의존성 최소화 원칙은 LLM/SDK 도입과 SQLite/R2 추가로 이미 일부 완화됨.
  추가 외부 의존성은 ADR로 정당화.
- second-brain ideation
  [`research-content-pipeline-architecture`](discovery/research-content-pipeline-ideation.md)
  Round 3 lock(14개 settled + A1-A4)을 따른다. 변경하려면 새 ADR 또는
  supersedes.
- 코드/CI 채택 boilerplate는 `alxdr3k/boilerplate` (mode: greenfield).
- main 브랜치 직접 push 허용(global policy의 actwyn/concluv/boilerplate/my-skill/
  devdeck/k-world-monitor 군).

## Open Questions

상위 수준 열린 질문은 `07_QUESTIONS_REGISTER.md` → per-file `docs/questions/Q-<NNN>.md`
로 이동.

- Q-001: scenario horizon enum 정의 (1Q / 1Y / 5Y / generational?)
- Q-002: Dossier `stale_after` 기본값 (주제별로 다른가?)
- Q-003: Publication 정정(correction) ledger의 트리거
- Q-004: SQLite와 vault `_System/Indexes/*.jsonl`의 책임 분담 (vault-wide index는
  jsonl, research-internal은 sqlite?)

## Success Metrics

- 수집 큐가 자동 discovery로 채워진다(매주 신규 큐 entry > 0).
- 100% 의 promoted claim이 evidence locator + extraction provenance + lifecycle
  status를 가진다.
- 100% 의 published Publication이 cite check를 pass한다(stale / horizon / unit /
  overclaim 0건).
- claim/snapshot 1만 건 시점에서 NFR-001 검색 p95 < 1초.
- 운영자가 같은 source set + scenario 모델을 다시 돌렸을 때 동일 promoted claim
  set + scenario branches 결론에 도달.
