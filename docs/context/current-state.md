# Current State

Status: template.

This file is the first read for new AI/human sessions.

It is a compressed current operating view, not full history.

Setup (do this once when copying the boilerplate into a project): replace
`Status: template.` above with your real status, set the `Project mode`
block below to a real value, and fill the rest of this file with project
state. The mode stop rule in `AGENTS.md` requires `mode` to be exactly
`greenfield` or `adoption` before any normal implementation work begins.

## Project mode

- mode: unset  (set to exactly `greenfield` or `adoption`; see `docs/DOCUMENTATION.md` Project mode)
- adopted on: unset  (set to `YYYY-MM-DD` or `n/a` for greenfield)
- adoption notes: unset  (link to migration tracking slice or set to `n/a`)

## Product / Project

One paragraph.

## Current roadmap position

- current milestone:
- active tracks:
- active phase:
- active slice:
- last accepted gate:
- next gate:
- canonical ledger: `docs/04_IMPLEMENTATION_PLAN.md`

## Implemented

List implemented items. If no implementation exists yet, say so.

## Planned

List planned items.

## Explicit non-goals

List non-goals.

## Current priorities

1.
2.
3.

## Current risks / unknowns

Link Q IDs or SPIKE IDs.

## Current validation

Link acceptance tests or evals.

## Needs audit

List stale or uncertain areas.

## Links

- PRD:
- HLD:
- Roadmap / status ledger:
- Acceptance tests:
- Questions:
- Decisions:
- ADRs:

---

Rules:

- Keep this file short.
- Do not append full history.
- Do not copy the full roadmap / phase / slice ledger here.
- If historical reasoning matters, link to ADR/discovery/archive.
- If this file becomes long, compress it.
