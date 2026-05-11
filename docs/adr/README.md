# ADR (Architecture Decision Records)

이 폴더에 중요한 아키텍처 결정을 기록한다. 포맷은 Michael Nygard 스타일.

## 파일 이름

`ADR-<NNNN>-<kebab-title>.md`

예: `ADR-0001-use-postgres-for-metadata.md`

## 언제 ADR을 쓰는가

- 되돌리기 어려운 결정
- 여러 컴포넌트/팀에 영향
- 장기 운영 비용을 바꾸는 결정

더 작은 결정은 `../08_DECISION_REGISTER.md`.

## 상태

- `proposed` — 제안 중
- `accepted` — 채택
- `deprecated` — 더 이상 선호되지 않음
- `superseded` — 다른 ADR로 대체됨
- `rejected` — 기각

## Index

| ADR | 제목 | 상태 | 날짜 |
|---|---|---|---|
| 0001 | Example architecture decision (boilerplate placeholder) | rejected | 2026-05-11 |
| 0002 | Cross-document invariant tracking system | accepted | 2026-05-09 |
| 0003 | 7-stage pipeline object model with 3-tier source layer | superseded by 0011 | 2026-05-11 |
| 0004 | Storage tiers — Markdown / SQLite+FTS5 / R2 | superseded by 0012 | 2026-05-11 |
| 0005 | Confidence decomposition | accepted | 2026-05-11 |
| 0006 | LLM routing — Haiku 1차 + Sonnet escalate | superseded by 0023 | 2026-05-11 |
| 0007 | Edge ledger — supports / contradicts / qualifies / updates / supersedes | superseded by 0013 | 2026-05-11 |
| 0008 | Evidence quote and cite check coverage | superseded by 0015 | 2026-05-11 |
| 0009 | Scenario validate and revisions ledger | accepted | 2026-05-11 |
| 0010 | Stale triggers and review queue throttling | accepted | 2026-05-11 |
| 0011 | 9-stage pipeline object model with Source + Thesis (supersedes 0003) | superseded by 0025 | 2026-05-11 |
| 0012 | Non-archival storage — Neo4j / SQLite / R2; raw cloud upload prohibited (supersedes 0004) | accepted | 2026-05-11 |
| 0013 | Edge ledger via Neo4j (supersedes 0007) | accepted | 2026-05-11 |
| 0014 | Neo4j-native feature adoption (APOC + GDS + native vector + native FTS) + intentional lock-in | accepted | 2026-05-11 |
| 0015 | Evidence (nullable + quote_reason + storage_level) and cite check 5+1 (supersedes 0008) | accepted | 2026-05-11 |
| 0016 | Collection realism — Tier A-D + collectability_score + no bot bypass | accepted | 2026-05-11 |
| 0017 | Source policy gate — mode-aware (inline_block / inline_warn / batch_report) + access_interventions | accepted | 2026-05-11 |
| 0018 | Manual feedback inbound — manual_claim_entries 3-way + CLI `pipeline feedback` / `intervention review` | accepted | 2026-05-11 |
| 0019 | Bidirectional framing — scenario impact_targets, thesis stance+market_stance, EvidencePack multi-layer | accepted | 2026-05-11 |
| 0020 | System metrics framework (6 categories + evaluation harness, staged v0/v1/v2) | accepted | 2026-05-11 |
| 0021 | Policy learning framework (rule-based, auto-tighten allowed, auto-relax prohibited) | accepted | 2026-05-11 |
| 0022 | Publishing site — Astro 5.0 + Cloudflare Pages + vault publications/ as source (resolves Q-026 via DEC-006, enables v0 turn-key publish via DEC-005) | accepted | 2026-05-11 |
| 0023 | LLM routing v2 — GPT default + Anthropic dual-vendor (performance-tiered) + Google exploration-only + minimal cross-vendor review (supersedes 0006) | accepted | 2026-05-11 |
| 0024 | Data Science Module — deterministic dataset processing layer (parser + derived metric computer) | accepted | 2026-05-11 |
| 0025 | Editorial Intent layer — 10-stage object model (Scenario → EditorialIntent → Thesis anchor 신설, supersedes 0011 object model) | accepted | 2026-05-11 |

## Template

새 ADR을 만들 때는 `../templates/ADR_TEMPLATE.md`를 복사한다.
