---
name: boilerplate-sync
description: Sync boilerplate policy files into project repositories. Use when asked to deploy, roll out, propagate, or check boilerplate policy updates across repos.
---

# Boilerplate Sync

Syncs boilerplate-owned `.policy.md` files to target repos via simple overwrite.
No surgical text patching — file ownership determines what gets synced.

## Ownership model

| File | Owner | Tier |
|------|-------|------|
| `AGENTS.policy.md` | boilerplate | 1 (universal) |
| `docs/04_IMPLEMENTATION_PLAN.policy.md` | boilerplate | 2 (boilerplate-structure) |
| `docs/DOCUMENTATION.policy.md` | boilerplate | 2 (boilerplate-structure) |
| `AGENTS.md` | project | — |
| `docs/04_IMPLEMENTATION_PLAN.md` | project | — |
| `docs/DOCUMENTATION.md` | project | — |

## Profiles

- `universal`: repo has `CLAUDE.md` or `AGENTS.md` — syncs Tier 1 only
- `boilerplate`: repo has numbered docs (`docs/04_IMPLEMENTATION_PLAN.md`) — syncs Tier 1 + 2
- `custom`: skip (manual migration needed)

## Workflow

1. Confirm source state: `git log --oneline -5`
2. Discover targets: `discover`
3. Plan (dry-run): `plan <targets.tsv>`
4. Apply: `apply <targets.tsv>` or `sync` (plan + apply)

## Helper Script

```bash
# One-command sync
.codex/skills/boilerplate-sync/scripts/boilerplate-sync-docs.sh sync

# Individual steps
.codex/skills/boilerplate-sync/scripts/boilerplate-sync-docs.sh discover
.codex/skills/boilerplate-sync/scripts/boilerplate-sync-docs.sh plan <targets.tsv>
.codex/skills/boilerplate-sync/scripts/boilerplate-sync-docs.sh apply <targets.tsv>

# Pipe discover into plan
.codex/skills/boilerplate-sync/scripts/boilerplate-sync-docs.sh discover | \
  .codex/skills/boilerplate-sync/scripts/boilerplate-sync-docs.sh plan -
```

Target file format: `name<TAB>path<TAB>base<TAB>profile`

Cached target list: `targets.tsv`. Rerun `discover` when adding repos.

## Manual Checks

After apply:
```bash
git -C <repo> show origin/<base>:AGENTS.policy.md | head -5
git -C <repo> show origin/<base>:CLAUDE.md | grep "AGENTS.policy"
git -C <repo> worktree list | grep boilerplate-sync || true
```
