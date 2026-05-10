# DOCUMENTATION.policy.md

Boilerplate-owned policy rows for the documentation trigger table.
Synced to boilerplate-structure repos — do not edit in project repos.

## Feedback trigger row

Add this row to `docs/DOCUMENTATION.md`'s change-type trigger table:

| Change type | Required doc action |
|---|---|
| User feedback reveals a defect, UX regression, or acceptance failure | triage through `docs/04_IMPLEMENTATION_PLAN.md`; update `docs/06_ACCEPTANCE_TESTS.md` and the project's TESTING doc when gate or regression evidence changes |

## Project mode

This boilerplate is used in two modes:

- **Greenfield** — the project starts with this boilerplate already in
  place. REQ/NFR/AC/TEST/TRACE entries are part of normal working surface
  from the first milestone, not a backfill task. Adoption work sections
  in `docs/DOCUMENTATION.md` (Roadmap / status migration, CI/CD migration)
  do not apply.
- **Adoption** — an existing project introduces this boilerplate after
  code, tests, or legacy docs already exist. Run the adoption work
  sections in `docs/DOCUMENTATION.md` to map old paths to canonical paths
  and backfill REQ/NFR/AC/TEST/TRACE from implemented behavior. Do not
  invent traceability for behavior that is unresolved or unknown — leave
  it as an open question (Q) or risk spike.

Pick the mode once at adoption time and record it in
`docs/context/current-state.md` under the `Project mode` block. The
`mode` value must be exactly `greenfield` or `adoption`; the template
ships as `unset`. Both modes must set the value — greenfield is not a
default. The stop rule that enforces this lives in `AGENTS.policy.md`
"Project mode stop rule".
