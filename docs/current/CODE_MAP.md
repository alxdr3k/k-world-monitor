# Code Map

> Last verified against code: n/a (no implementation yet — 2026-05-11)

코드 구현이 아직 없다. 이 문서는 INFRA-1A.2 slice 진입과 동시에 실제 경로로
갱신된다.

P0-M1 단계에서 채워질 항목 미리보기:

| Path (planned) | Purpose |
|---|---|
| `src/cli/` | bun-based CLI entrypoint (manual_intake, search, dossier, draft) |
| `src/storage/sqlite/` | SQLite + FTS5 connection / migration runner / schema helpers |
| `src/storage/r2/` | Cloudflare R2 client wrapper (upload / download / sha256 verify) |
| `src/domain/` | Document / Snapshot / Claim / Dossier / Scenario / ContentDraft / Publication 도메인 모델 |
| `src/discovery/` | RSS / API / sitemap discovery worker + Source Registry |
| `src/extraction/` | Article / Dataset / Report extractor + LLM router |
| `src/scenario/` | Scenario composer + revisions ledger + validator |
| `src/cite_check/` | stale / retracted / horizon / unit / overclaim 5종 검사 |
| `src/ops/` | Run ledger + cost throttling + Stale worker |
| `migrations/` | SQL 마이그레이션 (Document/Snapshot/Claim/Edge/Run/Revisions) |
| `tests/` | TEST-001 ~ TEST-021 (코드 도입 후 매핑) |

## Entry points

| Path | Purpose |
|---|---|
| (not yet) |  |

## Runtime / App

| Path | Purpose |
|---|---|
| (not yet) |  |

## Domain / Services

| Path | Purpose |
|---|---|
| (not yet) |  |

## Data / Persistence

| Path | Purpose |
|---|---|
| (not yet) |  |

## Tests

| Path | Purpose |
|---|---|
| (not yet) |  |

## Needs audit

| Path | Reason |
|---|---|
| (none — implementation has not started) |  |

---

Rules:

- Use actual paths once implementation exists.
- Mark uncertain modules as `needs audit`.
- Do not invent modules.
