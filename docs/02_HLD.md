# 02 HLD — High-Level Design

## Overview

`k-world-monitor`는 시간 무관 대량 수집 → 구조화된 7-stage 파이프라인을 통해
콘텐츠를 발행하고, 모든 인용을 5단계 trace로 역추적 가능하게 보장하는 단일
운영자 환경의 LLM 기반 리서치 시스템이다. canonical bulk store는
SQLite + FTS5, 원문 bytes는 R2, 사람용 curated view는 Markdown vault다
(ADR-0003, ADR-0004).

## Architecture Diagram

```text
                        Discovery Layer
        ┌─────────────────────────────────────────────────┐
        │ RSS / API / sitemap / manual_intake             │
        └────────────────────────┬────────────────────────┘
                                 ▼
                    ┌────────────────────────┐
                    │ Source Registry +      │
                    │ Collection Queue       │  (SQLite)
                    └───────────┬────────────┘
                                ▼
          ┌─────────── Source Layer (3-tier) ───────────┐
          │  Document   →   Snapshot   →     Claim      │
          │ (publisher,    (R2 bytes,    (LLM extract,  │
          │  reliability)   sha256)       evidence,     │
          │                                lifecycle)   │
          └─────────────────────┬───────────────────────┘
                                ▼
                       ┌─────────────────┐
                       │ Review Queue +  │  (auto-accept threshold,
                       │ Edge Ledger     │   ADR-0006 + ADR-0007)
                       └────────┬────────┘
                                ▼
                       ┌─────────────────┐
                       │ Search / FTS5   │  (NFR-001 < 1s p95)
                       └────────┬────────┘
                                ▼
       ┌────── Aggregation / Scenario Layer ──────┐
       │  Dossier  →  Scenario  →  ContentDraft   │
       │ (주제별)    (revisions,    (compose +    │
       │             validate)      cite_check)   │
       └───────────────────┬──────────────────────┘
                           ▼
                  ┌─────────────────┐
                  │   Publication   │  (live / corrected /
                  │   ledger        │   retracted, cascade)
                  └─────────────────┘

Storage seams:
  Markdown vault (curated)   ← promoted Claim, Dossier, Scenario, Draft, Pub
  SQLite + FTS5 (canonical)  ← Document, Snapshot, Claim, Edge, Run, Revisions
  R2 (bytes)                 ← Snapshot HTML/PDF + extracted text cache
```

## Components

| 컴포넌트 | 책임 | 의존성 |
|---|---|---|
| Discovery | RSS / API / sitemap polling, manual intake API | Source Registry |
| Source Registry | Document 정의 + URL 그룹 + reliability_tier | SQLite documents 테이블 |
| Collection Queue | fetch 대상 큐 (priority, dedup, throttle) | SQLite queue 테이블 |
| Fetcher | URL → bytes → R2 upload + Snapshot row 생성 | R2, SQLite snapshots 테이블 |
| Chunker / Indexer | Snapshot 텍스트 → chunk + FTS5 인덱스 | SQLite fts5 |
| Extractor (article) | Haiku 4.5 1차 + Sonnet 4.6 escalate (ADR-0006) | Anthropic SDK, run ledger |
| Extractor (dataset) | parser only, LLM 미사용 | parser libs |
| Extractor (report) | Haiku 4.5 with structure prompt | Anthropic SDK |
| Review Queue | reviewer manual + auto-accept threshold | SQLite review_queue 테이블 |
| Edge Ledger | supports/contradicts/qualifies/updates/supersedes record (ADR-0007) | SQLite edges 테이블 |
| Dossier Composer | 주제별 promoted claim + counterclaim 합성 | SQLite + Markdown promoted_claim |
| Scenario Composer | drivers/assumptions/branches/falsifier/counterclaim/monitoring + revisions ledger | SQLite scenario_revisions, edges |
| Scenario Validator | 5종 검사 (ADR-0009 INV-0009-1) | Edge Ledger |
| ContentDraft Composer | Dossier + Scenario → draft + 인용 ledger | Markdown vault |
| Cite Check | stale / retracted / horizon / unit / overclaim (ADR-0008) | Edge Ledger, Scenario, Anthropic SDK (overclaim) |
| Publication Ledger | live / corrected / retracted state + cascade alert | SQLite publications 테이블 |
| Run Ledger | 모든 LLM/parser run의 (model, tokens, cost, cached_tokens, batch_id) 기록 | SQLite run 테이블 |
| Stale Worker | time / snapshot_diff / counterclaim 트리거 (ADR-0010) | Edge Ledger, snapshot sha256 |

## Data Model (요약)

| Entity | 주요 필드 | 저장소 |
|---|---|---|
| Document | doc_id, publisher, urls[], reliability_tier, schema_version | SQLite + Markdown hub |
| Snapshot | snap_id, doc_id, fetched_at, r2_key, sha256, mime, byte_size | SQLite + R2 |
| Claim | clm_id, snap_id, body, evidence(quote/locator/quote_hash), extraction_confidence, claim_status, run_id | SQLite (+ promoted Markdown) |
| Dossier | dos_id, topic, promoted_claim_ids[], counterclaim_ids[], stale_after | SQLite + Markdown |
| Scenario | scn_id, dossier_id, current_revision_id, horizon | SQLite + Markdown |
| ScenarioRevision | revision_id, scenario_id, revision_no, body_snapshot(JSON), change_summary | SQLite scenario_revisions |
| ContentDraft | drf_id, dossier_id, scenario_revision_id, body, cite_check_status, state | Markdown |
| Publication | pub_id, draft_id, publish_url, publish_at, state, correction_ledger[] | Markdown + SQLite |
| Edge | edge_id, from_id, to_id, relation_type, scope, rationale, provenance, run_id | SQLite edges |
| Run | run_id, kind, model, tokens_in, tokens_out, cost, cached_tokens, batch_id, started_at, ended_at | SQLite run |

세부 스키마는 `docs/current/DATA_MODEL.md`(코드 도입 후 갱신) 참조. 마이그레이션
파일은 INFRA-1A.2 slice에서 commit 예정.

## Key Interfaces

- API endpoints: 초기에는 CLI 우선 (1인 운영). HTTP API는 PUB-1A 단계 이후 검토.
- 이벤트/메시지: cron / queue worker (Stale Worker, Fetcher, Extractor batch)
- 외부 통합:
  - Anthropic SDK (Haiku 4.5 + Sonnet 4.6, prompt caching, batch API)
  - Cloudflare R2 (S3 compatible API)
  - 소스별 RSS / API client (Discovery)

## Cross-cutting

- 인증/인가: 1인 운영 환경, 로컬 CLI는 OS 사용자 권한, R2/Anthropic은 API key
  (Doppler / 환경 변수 보안 — `docs/05_RUNBOOK.md`에 정책 추가 예정)
- 로깅/관찰성: Run Ledger가 모든 LLM/parser run을 기록 (cost / token / latency).
  cron worker는 stdout + 일일 요약
- 에러/재시도: Fetcher/Extractor는 idempotent (snap_id / clm_id 기준 dedupe).
  실패 run은 run ledger에 status=failed 기록 후 backoff
- 보안/프라이버시: 외부 인용 quote ≤ 200자 (NFR-005, ADR-0008). 사용자 PII 수집
  안 함. R2 객체는 private bucket
- 비용 가드: NFR-004 일별 LLM 비용 상한 + run ledger 기반 throttling (ADR-0006)

## Trade-offs & Alternatives

주요 구조 결정은 `adr/`로 이동. 여기에는 요약/링크만.

- ADR-0003: 7-stage object model with 3-tier source layer — 단일 SourceNote 모델
  폐기 사유, Dossier 중간 계층 사유
- ADR-0004: Markdown(curated) / SQLite+FTS5(canonical) / R2(bytes) 책임 분담 —
  candidate claim 자동 markdown 생성 금지 사유
- ADR-0005: confidence 단일 필드 폐기 — reliability_tier / extraction_confidence
  / claim_status / scenario weight 분해
- ADR-0006: LLM routing (Haiku 1차 + Sonnet escalate) + parser split + auto-accept
- ADR-0007: edge ledger — frontmatter `supports[]/contradicts[]` 배열 폐기 사유
- ADR-0008: evidence quote + cite check 5종 — 원문 인용 전면 금지 폐기 사유
- ADR-0009: scenario validate + revisions ledger — in-place mutation 금지 사유
- ADR-0010: stale 트리거 3종 + review queue throttling

## Open Questions

- Q-001: scenario horizon enum 정의 (1Q / 1Y / 5Y / generational?)
- Q-002: Dossier `stale_after` 기본값
- Q-003: Publication 정정 ledger 트리거
- Q-004: SQLite와 vault `_System/Indexes/*.jsonl` 책임 분담

## Related Requirements

- REQ-001 (7-stage 모델) → 전 컴포넌트가 7-stage anchor를 따름 (ADR-0003)
- REQ-002 (SQLite canonical) → SQLite + FTS5 컴포넌트 (ADR-0004)
- REQ-003 (R2 bytes) → R2 + Fetcher (ADR-0004)
- REQ-004 (Markdown promoted only) → Markdown vault 컴포넌트 (ADR-0004)
- REQ-005 (ID 체계) → 전 테이블 PK + Markdown frontmatter
- REQ-006 (confidence 분해) → Document/Claim/Scenario 스키마 (ADR-0005)
- REQ-007 (evidence quote ≤ 200자) → Extractor + Cite Check (ADR-0008)
- REQ-008 (edge ledger) → Edge Ledger 컴포넌트 (ADR-0007)
- REQ-009 (extractor 분리) → 3종 Extractor (ADR-0006)
- REQ-010 (LLM routing) → Routing 로직 (ADR-0006)
- REQ-011 (구현 순서) → Roadmap (`04_IMPLEMENTATION_PLAN.md`)
- REQ-012 (scenario validate) → Scenario Validator (ADR-0009)
- REQ-013 (cite check) → Cite Check (ADR-0008)
- REQ-014 (scenario_revisions) → Scenario Composer + Revisions ledger (ADR-0009)
- REQ-015 (review throttling) → Review Queue + auto-accept (ADR-0010)
- REQ-016 (stale 트리거 3종) → Stale Worker (ADR-0010)
- NFR-001 (1만건 < 1s p95) → SQLite + FTS5 인덱스 정책 (SPIKE-001로 검증)
- NFR-002 (reproducibility) → scenario_revisions + edge ledger (ADR-0009)
- NFR-003 (5단계 trace) → 7-stage object model + ID propagation (ADR-0003)
- NFR-004 (cost 상한) → Run Ledger + throttling (ADR-0006)
- NFR-005 (quote ≤ 200자) → Extractor assertion + Cite Check (ADR-0008)
- NFR-006 (snapshot durability) → R2 + sha256 (ADR-0004)
- NFR-007 (extractor 확장) → Extractor interface (ADR-0006)
