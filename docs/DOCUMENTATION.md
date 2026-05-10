# Documentation Policy

## Purpose

This docs tree separates project-stage decisions and roadmap/status tracking
from implementation-stage current state.

## Project mode

Two modes — `greenfield` (project starts with this boilerplate already in
place) or `adoption` (existing project introduces it). The mode is recorded
in `docs/context/current-state.md` under `Project mode`. Canonical
definition lives in `docs/DOCUMENTATION.policy.md` "Project mode";
enforcement lives in `AGENTS.policy.md` "Project mode stop rule".

Most rules in this policy apply to both modes; sections explicitly marked
as adoption work do not apply to greenfield.

## Source-of-truth hierarchy

1. Code, tests, migrations, generated schemas once implementation exists
2. Roadmap / status ledger in `docs/04_IMPLEMENTATION_PLAN.md`
3. Thin current-state docs under `docs/context/` and `docs/current/`
4. PRD/HLD/spec/runbook/acceptance/CI/CD docs
5. ADRs and Decision Register
6. Discovery and archived design notes

## Rules

- Current docs are for fast orientation, not full history.
- Keep docs simple: one source of truth, links over repetition, no speculative sections.
- Prefer small targeted doc patches over broad rewrites.
- `docs/04_IMPLEMENTATION_PLAN.md` owns the roadmap / status ledger:
  milestone, track, phase, slice, gate, status, evidence, and next work.
- `docs/context/current-state.md` only summarizes the active roadmap position.
- `docs/current/` describes implemented state navigation, not future roadmap inventory.
- `docs/11_CI_CD.md` describes stack-neutral CI/CD guidance. Actual commands
  live in `docs/current/TESTING.md`; actual deployment ownership and runbooks
  live in `docs/current/OPERATIONS.md` and `docs/05_RUNBOOK.md`.
- Accepted ADRs are not edited to reflect new behavior; create a new ADR that supersedes the old one.
- Discovery notes are not current implementation authority.
- Archived design notes are not current implementation authority.
- Do not update long historical notes on every implementation change.
- Prefer generated docs for schema/API/enums when generation exists.
- If code changes behavior/schema/runtime, update the relevant thin current doc in the same PR.

## What to update when

Use this table:

| Change type | Required doc action |
|---|---|
| Product scope changes | update `docs/01_PRD.md`; add DEC/ADR if needed |
| Architecture changes | update `docs/02_HLD.md`; add/supersede ADR |
| Roadmap taxonomy or slice status changes | update `docs/04_IMPLEMENTATION_PLAN.md` |
| Active milestone / track / phase / slice changes | update `docs/context/current-state.md` |
| Gate definition or acceptance status changes | update `docs/06_ACCEPTANCE_TESTS.md` |
| User feedback reveals a defect, UX regression, or acceptance failure | triage through `docs/04_IMPLEMENTATION_PLAN.md`; update `docs/06_ACCEPTANCE_TESTS.md` and `docs/current/TESTING.md` when gate or regression evidence changes |
| Runtime behavior changes | update `docs/current/RUNTIME.md` |
| Module/file layout changes | update `docs/current/CODE_MAP.md` |
| DB/schema/data model changes | update `docs/current/DATA_MODEL.md` |
| Test/lint/typecheck/eval command changes | update `docs/current/TESTING.md` |
| Operational/env/deployment changes | update `docs/current/OPERATIONS.md` or `docs/05_RUNBOOK.md` |
| CI/CD workflow, required check, release, or branch protection changes | update `docs/current/TESTING.md`, `docs/current/OPERATIONS.md`, `docs/05_RUNBOOK.md`, and `docs/11_CI_CD.md` as applicable |
| Agent workflow, read order, or behavior policy changes | update `AGENTS.md`; keep `CLAUDE.md` as an import wrapper unless Claude-specific behavior is needed |
| New open question | add Q row to `docs/07_QUESTIONS_REGISTER.md` |
| Lightweight accepted decision | add DEC row to `docs/08_DECISION_REGISTER.md` |
| Major accepted decision | add ADR under `docs/adr/` |
| Cross-document impact | update `docs/09_TRACEABILITY_MATRIX.md` |
| Historical exploration | put under `docs/discovery/` or `docs/design/archive/` |
| Reusable lesson discovered | add candidate to retrospective; promote via external knowledge-base process using `docs/templates/EXTRACTION_TEMPLATE.md` |
| Milestone completion | update `docs/04_IMPLEMENTATION_PLAN.md`, `docs/context/current-state.md`, `docs/09_TRACEABILITY_MATRIX.md`, and `docs/10_PROJECT_RETROSPECTIVE.md` |
| Major project completion | complete final retrospective and prepare extraction packet (`docs/templates/EXTRACTION_TEMPLATE.md`) |
| Raw Q&A / discovery produces reusable knowledge | distill into extraction candidates; do not promote raw transcript |
| Rejected / stale recommendation identified | add to `Do not promote` in extraction packet with rationale |

## Roadmap / status migration

> Adoption mode only. Greenfield projects start with this taxonomy in place
> and do not normalize.

When adopting this boilerplate in an existing project, normalize scattered
roadmap language into the taxonomy in `docs/04_IMPLEMENTATION_PLAN.md`:

1. Map product / user-facing gates to Milestones.
2. Map technical streams to Tracks.
3. Map ordered implementation stages inside a track to Phases.
4. Map commit-sized or PR-sized implementation units to Slices.
5. Map acceptance criteria, automated tests, staging checks, or manual
   verification to Gates.
6. Split ambiguous `done` / `pending` states into implementation status
   (`planned`, `landed`, `accepted`, etc.) and gate status (`defined`,
   `not_run`, `passing`, etc.).
7. Move the canonical inventory into `04_IMPLEMENTATION_PLAN.md`, then trim
   duplicate status inventories from `current-state`, runtime, architecture,
   and agent instructions.
8. Preserve source anchors when moving status: repo path, commit, PR, ADR,
   DEC, Q, AC, TEST, or issue ID. If unknown, write `anchor missing`.

## CI/CD migration

> Adoption mode only. Greenfield projects build CI/CD against `docs/11_CI_CD.md`
> directly without a migration step.

When adopting this boilerplate in an existing project, migrate CI/CD knowledge
without rewriting history or inventing a cleaner process than the one that
exists.

1. Inventory workflow files, external CI/CD systems, release scripts, deploy
   platforms, package registries, cron jobs, Makefiles, and manual steps.
2. Copy real validation commands into `docs/current/TESTING.md`. If a command
   is unknown, write `Needs audit` instead of guessing.
3. Record deployment ownership, environments, secrets ownership, release
   triggers, and rollback boundaries in `docs/current/OPERATIONS.md`.
4. Move step-by-step deploy, rollback, monitor, and incident procedures into
   `docs/05_RUNBOOK.md`.
5. Use `docs/11_CI_CD.md` for guidance and
   `docs/templates/CI_CD_TEMPLATE.md` as a worksheet when a migration packet or
   single planning view is useful.
6. Map existing checks and release validations to `AC-###` / `TEST-###` when
   they verify acceptance or operational readiness.
7. Track migration slices, gate status, and evidence in
   `docs/04_IMPLEMENTATION_PLAN.md`.
8. Preserve source anchors: workflow path, CI run, PR, release, commit SHA,
   artifact digest, DEC, ADR, Q, or incident link. If unknown, write
   `anchor missing`.

## Enforcement mechanisms

The rules above are honor-system unless something forces compliance. Adopt
these patterns once your project has a code base; they are conventions, not
boilerplate code, so each project wires them up to its own stack.

### Doc Freshness CI

A GitHub Action that diffs the PR (or push) against the base, and warns when
code or workflow paths change without a matching roadmap/status, acceptance
gate, thin current-state doc, generated doc, CI/CD doc, or ADR update. The
warning is a soft comment, not a merge gate — the goal is to surface drift
fast, not block ships.

A skeleton workflow lives at `.github/workflows/doc-freshness.yml.example`
in this boilerplate. Copy to `.github/workflows/doc-freshness.yml` and
customise the `grep -E` patterns to match your project's actual source
directories (`src/`, `app/`, `lib/`, `migrations/`, etc.).

Untrusted GitHub event input must only flow through `env:` blocks, never
inlined into shell `run:` commands. The skeleton follows this convention.

### SHA freshness headers

Thin current-state docs that describe rapidly-evolving logic (LLM call paths,
parsing pipelines, judgment / decision rules) can carry a header on lines 3-5:

```
> Last verified against code: <commit-SHA> (<YYYY-MM-DD>)
```

**Rule:** any commit that modifies code whose behaviour a SHA-headered doc
describes must also update that header. Stale headers are a doc gap, not a
cosmetic issue.

Add the header only to docs that genuinely track fast-moving logic — not to
every thin doc. Most current-state docs do not need it.

### Generated docs

`docs/generated/` holds outputs derived from code, schema, migrations, or
config. Each generated file is paired with a generator script committed in
the project (e.g. `scripts/generate-schema-doc.ts`).

Rules:
- Do not edit generated docs by hand.
- Run the generator and commit the output in the same PR as the source change.
- The PR template carries a checkbox for this.
- See `docs/generated/README.md` for the project's active generators.
