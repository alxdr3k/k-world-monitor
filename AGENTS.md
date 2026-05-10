# AGENTS.md

## Read order

For normal implementation tasks after this boilerplate is copied into a project, read:

1. `docs/context/current-state.md`
2. `docs/04_IMPLEMENTATION_PLAN.md` active milestone / track / phase / slice
3. `docs/current/CODE_MAP.md`
4. `docs/current/TESTING.md`
5. `docs/11_CI_CD.md` if changing CI/CD, release, deployment pipeline, or required checks
6. task-relevant source files
7. relevant ADR only if changing architecture or product scope

Do not read archived design docs by default.

## Project mode

Two modes — greenfield (start fresh with this boilerplate) or adoption
(introduce it into an existing project). The mode is recorded in
`docs/context/current-state.md` under the `Project mode` block.

The canonical rule, including the boilerplate-source exemption, the
applicability scoping (only repos with `docs/context/current-state.md`),
and the one-time migration instructions for existing adopter repos, lives
in `AGENTS.policy.md` "Project mode stop rule". Read that file before
treating any mode state (including missing block, `unset`, or invalid
value) as a blocker — do not enforce the stop based on this short summary
alone. Mode definitions and adoption-only sections live in
`docs/DOCUMENTATION.policy.md` "Project mode".

## Source of truth

- Code, tests, migrations, and generated schema are authoritative for implemented behavior once implementation exists.
- `docs/context/current-state.md` is the compressed current state.
- `docs/04_IMPLEMENTATION_PLAN.md` owns roadmap / status ledger: milestone, track, phase, slice, gate, evidence, and next work.
- `docs/01_PRD.md` owns product scope.
- `docs/02_HLD.md` owns intended high-level design.
- `docs/current/` owns thin implementation-state navigation docs.
- `docs/11_CI_CD.md` owns stack-neutral CI/CD guidance.
- `docs/07_QUESTIONS_REGISTER.md` owns open questions.
- `docs/08_DECISION_REGISTER.md` owns lightweight decisions.
- `docs/adr/` owns major architecture decisions.
- `docs/discovery/` and `docs/design/archive/` are history, not authority.

## When changing code

- If runtime behavior changes, update `docs/current/RUNTIME.md`.
- If roadmap position, slice status, gate status, evidence, or next work changes,
  update `docs/04_IMPLEMENTATION_PLAN.md`.
- If the active milestone / track / phase / slice changes, update
  `docs/context/current-state.md`.
- If acceptance gate definitions or results change, update
  `docs/06_ACCEPTANCE_TESTS.md`.
- If module/file layout changes, update `docs/current/CODE_MAP.md`.
- If DB/schema/data model changes, update `docs/current/DATA_MODEL.md` and
  re-run the schema generator if one exists, then commit the regenerated
  file under `docs/generated/`.
- If test/lint/typecheck/eval commands change, update `docs/current/TESTING.md`.
- If operational/env/deployment behavior changes, update `docs/current/OPERATIONS.md` or `docs/05_RUNBOOK.md`.
- If CI/CD workflow, required check, branch protection, release, or deployment pipeline behavior changes,
  update `docs/11_CI_CD.md`, `docs/current/TESTING.md`, `docs/current/OPERATIONS.md`, or `docs/05_RUNBOOK.md` as applicable.
- If product scope changes, update `docs/01_PRD.md`.
- If architecture direction changes, create or supersede an ADR.
- Do not rewrite archived design notes for implementation changes.
- If the thin doc you are editing carries a `Last verified against code:
  <SHA> (<date>)` header, update the SHA and date to the current commit
  before pushing.

## Validation

Use commands from `docs/current/TESTING.md`.

(Terse output flags, "do not invent commands", and "report why if cannot run" — see `AGENTS.policy.md`.)

## Extraction tasks

Extraction template: [`docs/templates/EXTRACTION_TEMPLATE.md`](docs/templates/EXTRACTION_TEMPLATE.md)

(Extraction methodology — see `AGENTS.policy.md`.)
