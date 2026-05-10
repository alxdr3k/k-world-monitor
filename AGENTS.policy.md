# AGENTS.policy.md

Boilerplate-owned agent policy. Synced to all repos — do not edit in project repos.
Project-specific guidance belongs in `AGENTS.md`.

## Working principles

- Think before editing: state assumptions and tradeoffs when ambiguity changes the solution. Ask before unsafe guesses.
- Keep it simple: add only what the request needs. No speculative features, abstractions, configuration, or docs.
- Make surgical changes: touch only relevant files, preserve local style, and clean up only debris introduced by your change.
- Separate planning from execution: record known scope with status, but execute only ready and authorized work.
- Verify goals: turn work into checkable outcomes, run documented checks, and report any validation you could not run.

## Validation

Prefer terse output flags to reduce context size:

Tests:
- pytest: `-q --tb=short`
- go test: omit `-v` (quiet by default)
- jest / vitest: `--reporter=dot` or `--silent`
- rspec: `-f p` (default)
- cargo test: `-- --quiet`

Lint / typecheck / build:
- eslint: `--format compact`
- rubocop: `--format simple`
- tsc: `--noEmit --pretty false`

Package installs:
- npm: `npm ci --silent`
- yarn: `yarn install --silent`
- bundle: `bundle install --quiet`
- pip: `pip install -q`
- cargo: `cargo fetch -q`

Do not read generated or lock files (`package-lock.json`, `Gemfile.lock`, `yarn.lock`, `*.generated.*`, `schema.rb`, etc.) — they are not source of truth and waste context.

**Exception (round 68):** the cross-document invariant tracking artifacts in `docs/_generated/` (`scope_tree.yaml`, `term_usage.yaml`, `effective_invariant_policy.yaml`) MUST be read before authoring Q / DEC / ADR docs — see the "Cross-document invariant tracking" section below. They are not source of truth either, but they aggregate scope/term/policy state across the repo in a form the validator depends on for coverage cross-checks. Treat them as required context, not as authoritative facts: if they conflict with the underlying Q/DEC/ADR/glossary files, the source files win and the artifacts should be regenerated (`bun run scripts/validate_invariants.ts --regenerate`).

Do not invent commands.

If validation cannot be run, report why.

## Companion policy files

If this repo has boilerplate-structure docs, also read when present:
- `docs/04_IMPLEMENTATION_PLAN.policy.md` — feedback triage policy for the roadmap
- `docs/DOCUMENTATION.policy.md` — doc update trigger policy

## Project mode stop rule

This rule applies only to repos that use the boilerplate documentation
structure — specifically, repos that have `docs/context/current-state.md`.
Universal-profile repos that adopt only `AGENTS.policy.md` and `CLAUDE.md`
without the numbered docs are exempt from the rule because they have no
canonical place to record the mode. If `docs/context/current-state.md`
does not exist in this repo, treat the entire stop rule below as not
applicable and continue with normal work.

The boilerplate operates in two project modes — `greenfield` and `adoption`.
See `docs/DOCUMENTATION.policy.md` "Project mode" for mode definitions and
adoption work obligations. The mode is recorded in
`docs/context/current-state.md` under the `Project mode` block.

The `mode` value must be exactly `greenfield` or `adoption`. If the block
is missing, the value is `unset`, or the value is anything else, stop and
ask the project owner before any normal implementation work — do not
assume greenfield by default and do not skip to coding. Resolving the mode
is a prerequisite for implementation work, not a backfill-only checkpoint.
Once the mode is `adoption`, run the adoption work sections in
`docs/DOCUMENTATION.md` (and complete the relevant backfill) before
implementation work that depends on REQ/NFR/AC/TEST/TRACE state.

Exemption: this rule polices project implementation work in repos that
have copied this boilerplate. The boilerplate source repo (where the docs
tree is the canonical template, not a project's state) is exempt because
its work is template maintenance — editing policies, schemas, validators,
sync scripts, and examples — not project implementation against
REQ/NFR/AC/TEST/TRACE state. If you are unsure whether your work counts as
project implementation, treat it as implementation and resolve mode first.
File-state markers (`Status: template.`, `mode: unset`) are not
exemptions; they are the exact states the rule is meant to police.

### Reachability precondition

This rule lives in a synced policy file, so it only fires for agents that
actually read `AGENTS.policy.md`. Existing adopter repos must ensure their
project-owned `AGENTS.md` references this file (Claude Code receives it
via the `@AGENTS.policy.md` import in `CLAUDE.md`; agents that follow
`AGENTS.md` directly need a corresponding "see `AGENTS.policy.md`" line in
the "Companion policy files" reading order or equivalent). Adopter repos
that synced policy without first running
`boilerplate-sync-docs.sh refs <repo>` (or equivalent) may receive the
file without the rule becoming reachable from the agent entrypoint;
running `refs` once resolves this and is a precondition for the stop rule
to fire as designed.

### One-time migration for existing adopter repos

Repos that copied the boilerplate before this rule landed will receive the
rule via policy sync but will not have the `Project mode` block in their
project-owned `docs/context/current-state.md`. The first time the rule
fires after sync, resolve it once by adding the block below to
`docs/context/current-state.md` (place it under the file's main heading or
near the top of the project state) and setting `mode` to the correct
value. This is a one-time migration step, not a recurring blocker.

```markdown
## Project mode

- mode: unset  (set to exactly `greenfield` or `adoption`; see `docs/DOCUMENTATION.policy.md` Project mode)
- adopted on: unset  (set to `YYYY-MM-DD` or `n/a` for greenfield)
- adoption notes: unset  (link to migration tracking slice or set to `n/a`)
```

After the block exists with a valid `mode`, the rule moves from "block
absent" to its normal enforcement and only fires again if mode becomes
`unset` or invalid.

## Cross-document invariant tracking

If this repo uses `docs/templates/relation_enum.yaml` (boilerplate-owned invariant
tracking system; see `docs/adr/0002-invariant-tracking-system.md`), Q / DEC / ADR
authoring has additional read obligations.

### Before writing a new Q / DEC / ADR

Always read the following before populating `touches[]` / `term_effects[]` /
`scope` / `invariants[]` / `defines[]`:

1. **Generated artifacts** in `docs/_generated/` (regenerate first if stale —
   `bun run scripts/validate_invariants.ts --regenerate`):
   - `scope_tree.yaml` — namespace tree built from existing ADR scope.in/out
   - `term_usage.yaml` — glossary term usage map
   - `effective_invariant_policy.yaml` — boilerplate base + .local merged schema

2. **Upstream Q / DEC / ADR** referenced by `touches[].id` — read each one's
   `scope`, `invariants[]`, `preconditions[]`, `defines[]`. If your new doc
   extends or challenges any of these, encode the relation explicitly in
   `touches[]` (see `docs/templates/relation_enum.yaml` for value-specific
   payload requirements).

3. **Glossary term files** for any term you mention. If you change a term's
   attribute (e.g., add a new `release_paths` value), record it as a
   `term_effects[]` entry — not just in body prose. Body-only term changes
   create silent drift (Case 2).

### After writing

- `reviewed_terms[]` and `reviewed_scopes[]`: list every glossary term and every
  namespace your body cites. Validator cross-checks; coverage gaps become
  warnings.
- `invariant_review.status`: set `pending` for new docs. Foreground runs of
  `bun run scripts/validate_invariants.ts --write-warnings` will populate
  `unresolved_warnings[]` automatically.
- Do NOT run `--write-warnings` from CI or background — that mode is foreground
  only (CI is annotation-only, never modifies docs).

### Why these obligations exist

LLMs miss subtle cross-document dependencies when scope/invariant/term details
live only in body prose. Two failure cases drove this design:

- **Scope creep (Case 1)**: a new Q silently extends an ADR's scope, breaking the
  ADR's premise (e.g., cheap-model recommendation that depended on `control-plane`
  scope). Detected via `touches[].relation: extends_scope` payload + capability
  term `forbidden_paths` cross-check.
- **Glossary drift (Case 2)**: a DEC body changes a glossary term's attribute,
  but the term file is untouched. Detected via mandatory `term_effects[]`
  declaration.

The validator runs warning-level only; it never blocks merges. The validity
guarantee is built from frontmatter `reviewed_*` artifacts (verifiable) plus
generated coverage cross-checks — not from agent self-reports (unverifiable).

## Extraction tasks

When asked to prepare external knowledge-base extraction (e.g. for a personal
`second-brain`-style vault, team wiki, or other curated knowledge system):

1. Read the project's extraction template (path defined in `AGENTS.md`) — it is canonical.
2. Read the relevant retrospective / discovery / Q / DEC / ADR source.
3. Prepare an extraction candidate table with `Kind` and `Action` from the template's allowed values.
4. Distinguish candidate vs promoted — every row is a candidate. Do not claim a candidate has been promoted unless the target knowledge base has accepted it.
5. Do not promote raw transcript, stale drafts, rejected recommendations, or project-only implementation details. List them under `Do not promote` with rationale.
6. `Do not promote` must not be left blank. Use `None — reviewed` only after explicit review.
7. Preserve source anchors (repo / path / commit / PR / ADR / DEC / Q). If unknown, write `anchor missing`. Do not fabricate.
8. Report results as Created / Modified / Promoted / Dropped (omit empty groups).
9. Do not modify the external knowledge base unless explicitly asked. Boilerplate prepares the packet; the target knowledge base owns final placement, schema, and validation.
