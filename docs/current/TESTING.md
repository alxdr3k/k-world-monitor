# Testing

> Last verified against code: 13d61af (2026-05-13) — comprehensive review backfill (18 test files / 200+ cases landed)

## Testing policy

- Behavior changes need verification evidence.
- Prefer test-first for bug fixes and clear behavior changes when a concise
  failing test can express the target behavior.
- Otherwise add or update tests in the same slice as the implementation.
- Bug fixes should leave regression coverage unless impractical.
- If automated coverage is not practical, record the manual check, eval, or
  reason.

## Install

```bash
bun install
```

bun + TypeScript + native bun:sqlite + neo4j-driver + Bun.S3Client.

Ruby lint (pre-INFRA-1A.2 doc governance — 별도):

```bash
ruby scripts/check-doc-governance.rb           # default mode (CI에서 실행)
ruby scripts/check-doc-governance.rb --strict  # placeholder remnant 검출 (옵션)
```

## Invariant validator (primary doc check)

```bash
# Read-only validation — exits 0 by design (warning level only)
bun run invariant:check

# Fixture regression tests — verify Case 1 / Case 2 detection
bun run invariant:fixture:scope-creep
bun run invariant:fixture:glossary-drift

# Regenerate docs/_generated/ artifacts (writes scope_tree.yaml / term_usage.yaml / effective_invariant_policy.yaml)
bun run invariant:regen
```

## Foreground recovery (write mode)

```bash
# Foreground LLM only — persists unresolved_warnings into doc frontmatter
# AND orphan_warnings.yaml. Never run from CI; ADR-0002 INV-0002-2.
bun run invariant:write
```

## Code tests (landed, M1~M2)

| Check | Local command | CI workflow / job | Required? | Notes |
|---|---|---|---|---|
| install | `bun install` | ci.yml install job | yes | bun is mandatory runtime |
| typecheck | `bun run typecheck` | ci.yml typecheck job | yes (after Q-048 resolution) | tsc --noEmit --pretty false |
| unit tests | `bun test` | ci.yml test job | yes (after Q-048 resolution) | 18 file / 200+ cases — Bun native runner |
| migration dry-run | `bun run migrate --dry-run` | (manual) | recommended | verifies all v1~v6 schema files parse |
| invariant validation | `bun run invariant:check` | invariant-check.yml | no (warning only) | INV-0002-1: never hard-fails |
| fixture regression | `bun run invariant:fixture:scope-creep` | (manual / pre-PR) | recommended | Case 1 detection |
| fixture regression | `bun run invariant:fixture:glossary-drift` | (manual / pre-PR) | recommended | Case 2 detection |
| regenerate artifacts | `bun run invariant:regen` | invariant-check.yml (post-validate) | yes | writes docs/_generated/ |
| Neo4j FTS bench | `bun run bench:neo4j` | (manual, SPIKE-001) | spike only | needs Neo4j running; AC-002 p95 < 1s |
| Discovery dry-run | `bun run discovery:dry-run` | (manual) | recommended | RSS parse + queue enqueue dry-run |
| seed sources dry-run | `bun run seed-sources:dry-run` | (manual) | recommended | validates data/sources_seed.yaml |
| reproducibility manual | n/a (manual) | n/a | yes (P0-M5 gate) | AC-017 NFR-002 |

## CI / required checks

Workflow files (활성):

| File | Trigger | Required? | Notes |
|---|---|---|---|
| `.github/workflows/doc-governance.yml` | PR + workflow_dispatch | yes (required, 기존) | Ruby doc lint — duplicate / dangling / must-REQ-AC-link checks |
| `.github/workflows/ci.yml` | PR + push | **required** (DEC-020 Q-048 resolution — branch protection admin task) | bun install + typecheck + bun test (490 cases) + migrate dry-run |
| `.github/workflows/invariant-check.yml` | PR + push (paths-scoped) | advisory (warning-level by ADR-0002 INV-0002-1, never required) | bun run invariant:regen + invariant:check + fixture regression (boilerplate fixture 부재 시 informational skip) |
| `.github/workflows/doc-freshness.yml` | PR | advisory (soft warning) | DEC-020 Q-048 활성. src/scripts/tests/migrations 변경 시 thin docs / IMPLEMENTATION_PLAN / current-state / 06_ACCEPTANCE_TESTS / ADR 동반 갱신 누락 PR 코멘트 |

비활성 (rename 대기):

| File | Reason |
|---|---|
| `.github/workflows/cd.yml.example` | publishing pipeline 도입 시점 활성 (P0-M6) |

## CI notes

- 본 PR (`claude/comprehensive-code-review-FE0w3`) 가 `ci.yml.example` →
  `ci.yml` + `invariant-check.yml.example` → `invariant-check.yml` rename
  으로 advisory 활성.
- branch protection required check 등록은 Q-048 사용자 결정 대기.
- 코드 테스트 (`bun test`) 는 18 file / 200+ 케이스 — Bun native runner
  1 분 이내 expected.
- External CI owner: same repo (.github/workflows/)

## Before opening a PR

- `bun run typecheck`
- `bun test`
- `bun run invariant:check`
- update relevant docs if behavior/schema/runtime changed (AGENTS.md L46-60)

---

Rules:

- List only real commands once project has code.
- If no command exists, write "No command currently defined."
- Do not invent commands.
- If CI runs a command that cannot be run locally, explain where it runs and why.
- If a check is required for merge, name the exact workflow / job.
