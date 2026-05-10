# Testing

> Last verified against code: n/a (no implementation yet — 2026-05-11)

## Testing policy

- Behavior changes need verification evidence.
- Prefer test-first for bug fixes and clear behavior changes when a concise
  failing test can express the target behavior.
- Otherwise add or update tests in the same slice as the implementation.
- Bug fixes should leave regression coverage unless impractical.
- If automated coverage is not practical, record the manual check, eval, or
  reason.

## Install

> **현재 상태 (2026-05-11)**: `package.json` / Bun runtime / `scripts/validate_invariants.ts`는
> 아직 commit되지 않았다 (`INFRA-1A.2` slice 진입 시 도입 예정). 아래 `bun run ...`
> 명령들은 그 시점부터 실행 가능. 그 전까지는 **현재 실행 가능한 lint**:
>
> ```bash
> ruby scripts/check-doc-governance.rb           # default mode (CI에서 실행)
> ruby scripts/check-doc-governance.rb --strict  # placeholder remnant 검출 (옵션)
> ```

```bash
bun install   # INFRA-1A.2 slice 도입 후 사용 가능
```

## Invariant validator (primary check) — INFRA-1A.2 이후

```bash
# Read-only validation — exits 0 by design (warning level only)
bun run invariant:check

# Fixture regression tests — verify Case 1 / Case 2 detection
bun run invariant:fixture:scope-creep
bun run invariant:fixture:glossary-drift

# Regenerate docs/_generated/ artifacts (--ci is read-only; --regenerate writes)
bun run invariant:regen
```

## Foreground recovery (write mode) — INFRA-1A.2 이후

```bash
# Foreground LLM only — persists unresolved_warnings into doc frontmatter
# AND orphan_warnings.yaml. Never run from CI; ADR-0002 INV-0002-2.
bun run invariant:write
```

## Code tests (planned)

> 코드 도입 전이라 모든 TEST는 (planned) 상태. INFRA-1A.2 slice 진입 시
> `tests/` 디렉토리 + bun test 러너 commit.

| Check | Local command | CI workflow / job | Required? | Notes |
|---|---|---|---|---|
| install | `bun install` | invariant-check job | yes | bun is mandatory runtime (PRE-0002-1) |
| invariant validation | `bun run invariant:check` | invariant-check job | no (warning only) | INV-0002-1: never hard-fails |
| fixture regression | `bun run invariant:fixture:*` | (manual / pre-PR) | recommended | covers Case 1 + Case 2 |
| regenerate artifacts | `bun run invariant:regen` | invariant-check job (post-validate) | yes | uploads docs/_generated/ as PR artifact |
| unit tests | `bun test` | (planned, INFRA-1A.2 이후) | yes (after code lands) | TEST-001 ~ TEST-021 |
| FTS5 bench | `bun run bench:fts5` | (manual, SPIKE-001) | spike only | 1만 건 fixture 검색 p95 |
| reproducibility manual | n/a (manual) | n/a | yes (P0-M5 gate) | AC-017 NFR-002 |

## CI / required checks

| Check | Local command | CI workflow / job | Required? | Notes |
|---|---|---|---|---|
| install | `bun install` | invariant-check job | yes | bun is mandatory runtime |
| invariant validation | `bun run invariant:check` | invariant-check job | no (warning only) | ADR-0002 INV-0002-1 |
| fixture regression | `bun run invariant:fixture:*` | (manual / pre-PR) | recommended | |
| regenerate artifacts | `bun run invariant:regen` | invariant-check job | yes | uploads docs/_generated/ as PR artifact |

## CI notes

- Workflow files: `.github/workflows/invariant-check.yml.example` (rename to `.yml` to activate)
- Required branch protection checks: none — validator는 warning-level by contract
- Non-blocking / advisory checks: invariant-check (annotations only, exit 0)
- 코드 테스트(`bun test`)는 INFRA-1A.2 slice 도입과 함께 required check 후보
- External CI owner: same repo (.github/workflows/)

## Before opening a PR

- run typecheck if available (`bun run typecheck` — INFRA-1A.2 이후)
- run tests if available (`bun test` — INFRA-1A.2 이후)
- run lint if available (`bun run lint` — INFRA-1A.2 이후)
- update relevant docs if behavior/schema/runtime changed

---

Rules:

- List only real commands once project has code.
- If no command exists, write "No command currently defined."
- Do not invent commands.
- If CI runs a command that cannot be run locally, explain where it runs and why.
- If a check is required for merge, name the exact workflow / job.
