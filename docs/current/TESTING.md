# Testing

Status: template.

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

## Invariant validator (primary check)

```bash
# Read-only validation — exits 0 by design (warning level only)
bun run invariant:check

# Fixture regression tests — verify Case 1 / Case 2 detection
bun run invariant:fixture:scope-creep
bun run invariant:fixture:glossary-drift

# Regenerate docs/_generated/ artifacts (--ci is read-only; --regenerate writes)
bun run invariant:regen
```

## Foreground recovery (write mode)

```bash
# Foreground LLM only — persists unresolved_warnings into doc frontmatter
# AND orphan_warnings.yaml. Never run from CI; ADR-0002 INV-0002-2.
bun run invariant:write
```

## CI / required checks

| Check | Local command | CI workflow / job | Required? | Notes |
|---|---|---|---|---|
| install | `bun install` | invariant-check job | yes | bun is mandatory runtime (PRE-0002-1) |
| invariant validation | `bun run invariant:check` | invariant-check job | no (warning only) | INV-0002-1: never hard-fails |
| fixture regression | `bun run invariant:fixture:*` | (manual / pre-PR) | recommended | covers Case 1 + Case 2 |
| regenerate artifacts | `bun run invariant:regen` | invariant-check job (post-validate) | yes | uploads docs/_generated/ as PR artifact |

## CI notes

- Workflow files: `.github/workflows/invariant-check.yml.example` (rename to `.yml` to activate)
- Required branch protection checks: none — validator is warning-level by contract
- Non-blocking / advisory checks: invariant-check (annotations only, exit 0)
- Known flaky checks: detect_pattern regex evaluation rare ReDoS — caught by
  isLikelyCatastrophicRegex heuristics + length cap, but extreme inputs may
  hit the workflow timeout. Authors should use literal patterns where possible.
- External CI owner: same repo (.github/workflows/)

## Before opening a PR

- run typecheck if available
- run tests if available
- run lint if available
- update relevant docs if behavior/schema/runtime changed

---

Rules:

- List only real commands once project has code.
- If no command exists, write "No command currently defined."
- Do not invent commands.
- If CI runs a command that cannot be run locally, explain where it runs and why.
- If a check is required for merge, name the exact workflow / job.
