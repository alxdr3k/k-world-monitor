# Data Model

> Last verified against code: n/a (no implementation yet — 2026-05-11)

## Source of truth

Code, migrations, schemas, and generated references are authoritative.

This document is a human-readable map. 마이그레이션 파일이 commit되면 이 문서는
얇은 navigation layer로만 유지되고 generated schema 문서가 별도로 들어선다
(`docs/generated/schema.md` — 미래).

ADR-0003 (객체 모델), ADR-0004 (storage tiers), ADR-0005 (confidence 분해),
ADR-0007 (edge ledger), ADR-0009 (scenario_revisions)이 의도된 모델의 canonical
설계이다.

## Current entities

| Entity | Purpose | Source |
|---|---|---|
| (no implementation yet) | — | ADR-0003 의도된 객체 모델 참조 |

## Planned entities (ADR 기반 의도)

| Entity | Purpose | Storage |
|---|---|---|
| Document | publisher 메타 + URL 그룹 + reliability_tier | SQLite documents + Markdown hub |
| Snapshot | fetch 시점 immutable bytes 메타 | SQLite snapshots + R2 bytes |
| Claim | atomic 사실 + evidence + lifecycle | SQLite claims (모든 candidate) + Markdown promoted only |
| Dossier | 주제별 promoted claim 합성 | SQLite dossiers + Markdown |
| Scenario | drivers / assumptions / branches / falsifiers | SQLite scenarios + Markdown |
| ScenarioRevision | scenario 변경 append-only ledger | SQLite scenario_revisions |
| ContentDraft | Dossier+Scenario → 초고 | Markdown drafts |
| Publication | 발행 콘텐츠 + correction ledger | SQLite publications + Markdown |
| Edge | 객체간 관계 record | SQLite edges |
| Run | LLM/parser run 비용 ledger | SQLite runs |
| Chunk | snapshot 텍스트 청크 (FTS5 인덱스 row) | SQLite fts5 |

## Storage

| Store | Purpose | Source |
|---|---|---|
| Markdown vault | Document hub, Dossier, Scenario, ContentDraft, Publication, promoted Claim | git tree (this repo) — INFRA-1B 단계에서 첫 노트 생성 |
| SQLite + FTS5 | 모든 candidate claim, snapshot 메타, chunk 인덱스, edge ledger, run ledger | `research.db` (INFRA-1A.2 slice 도입) |
| R2 | Snapshot 원본 bytes(HTML/PDF) + 추출 텍스트 캐시 | Cloudflare R2 bucket (INFRA-1A.3 slice 도입) |
| JSONL | import / export 전용 (canonical 아님) | INFRA-1B+ 단계에서 backup/migration용 |

## Lifecycle states

| Entity | States | Notes |
|---|---|---|
| Claim | draft → confirmed → disputed → stale → retracted | 글로서리 [`claim`](../glossary/claim.md) state machine. transitions / forbidden_paths 명시 |
| ContentDraft | draft → reviewing → ready → published / dropped | 글로서리 [`content_draft`](../glossary/content-draft.md) state machine |
| Publication | live → corrected → retracted | 글로서리 [`publication`](../glossary/publication.md) state machine |

## Needs audit

- 모든 entity 가 코드 도입 전이므로 "needs audit" 대상은 현 시점에 없음.
- INFRA-1A.2 slice 첫 마이그레이션 commit 시 이 표를 실제 SQL DDL 기반으로
  갱신하고 generated 문서로 일부 분리.
