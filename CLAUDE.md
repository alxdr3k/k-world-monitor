@AGENTS.md
@AGENTS.policy.md

# CLAUDE.md

Claude Code reads this file at session start. `AGENTS.md` is the canonical
agent policy; the import above keeps Claude Code aligned with other coding
agents without duplicating the rules.

Claude-specific additions belong below this line only when they cannot live in
`AGENTS.md`.

## Git merge policy

- **PR merge (feature → main via GitHub)**: always squash merge (`gh pr merge --squash --delete-branch`). This is the repo standard for all PR merges.
- Direct-push repo: commit directly on main (no PR). Squash policy applies only to PR-based merges.
