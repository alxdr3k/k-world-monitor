#!/usr/bin/env bash
set -euo pipefail

ROOT="${ROOT:-$HOME/ws}"
MY_SKILL="${MY_SKILL:-$ROOT/my-skill}"
BOILERPLATE="${BOILERPLATE:-$ROOT/boilerplate}"
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_TARGETS="$SKILL_DIR/targets.tsv"
BRANCH="chore/boilerplate-doc-sync"
COMMIT_MSG="${COMMIT_MSG:-docs: sync boilerplate policy files}"

# Coverage — what this script automatically syncs (overwrite, no surgical patching):
#
#   Tier 1 (universal — any repo with CLAUDE.md or AGENTS.md):
#     AGENTS.policy.md          boilerplate-owned cross-cutting agent behaviour rules
#     CLAUDE.md                 ensure @AGENTS.md (when present) + @AGENTS.policy.md imports
#
#   Tier 2 (boilerplate-structure — repos with numbered docs):
#     docs/04_IMPLEMENTATION_PLAN.policy.md
#     docs/DOCUMENTATION.policy.md
#
# Out of scope (intentionally never mutated by sync):
#   AGENTS.md     — project-owned; add AGENTS.policy.md ref via /boilerplate-migrate
#   TESTING.md, CI/CD docs, ADRs, source code

usage() {
  cat <<'USAGE'
Usage:
  boilerplate-sync-docs.sh discover
  boilerplate-sync-docs.sh plan   [targets.tsv | -]
  boilerplate-sync-docs.sh apply  [targets.tsv | -]
  boilerplate-sync-docs.sh sync   [targets.tsv]
  boilerplate-sync-docs.sh refs            [repo-path]          # add AGENTS.policy.md ref to AGENTS.md
  boilerplate-sync-docs.sh targets-update <repo-path> <profile> # add/update repo in targets.tsv
  boilerplate-sync-docs.sh discover | boilerplate-sync-docs.sh plan -

targets.tsv columns:
  name<TAB>path<TAB>base<TAB>profile

profile:
  auto | universal | boilerplate | custom
USAGE
}

die() { echo "error: $*" >&2; exit 1; }

default_branch() {
  local repo="$1" branch
  branch="$(git -C "$repo" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##' || true)"
  echo "${branch:-main}"
}

is_direct_repo() {
  local name="$1"
  [[ -f "$MY_SKILL/direct-push-repos.txt" ]] && grep -qxF "$name" "$MY_SKILL/direct-push-repos.txt"
}

base_branch() {
  local repo="$1" name="$2"
  if is_direct_repo "$name"; then
    echo "main"
  elif git -C "$repo" show-ref --verify --quiet refs/remotes/origin/dev ||
       git -C "$repo" show-ref --verify --quiet refs/heads/dev; then
    echo "dev"
  else
    default_branch "$repo"
  fi
}

profile_for() {
  local repo="$1"
  if [[ -f "$repo/docs/04_IMPLEMENTATION_PLAN.md" && -f "$repo/docs/DOCUMENTATION.md" ]]; then
    echo "boilerplate"
  elif [[ -f "$repo/CLAUDE.md" || -f "$repo/AGENTS.md" ]]; then
    echo "universal"
  else
    echo "auto"
  fi
}

project_candidates() {
  find "$ROOT" -maxdepth 3 -name ".claude" -type d -exec dirname {} \; 2>/dev/null || true

  [[ -f "$MY_SKILL/deploy-projects.txt" ]] || return 0
  while IFS= read -r line; do
    line="${line%%#*}"
    line="$(printf '%s' "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [[ -n "$line" ]] || continue
    if [[ "$line" == /* ]]; then echo "$line"
    else echo "$ROOT/$line"
    fi
  done < "$MY_SKILL/deploy-projects.txt"
}

discover() {
  project_candidates | sort -u | while IFS= read -r repo; do
    [[ -d "$repo/.git" ]] || continue
    [[ -f "$repo/CLAUDE.md" || -f "$repo/AGENTS.md" ]] || continue
    local name base profile
    name="$(basename "$repo")"
    base="$(base_branch "$repo" "$name")"
    profile="$(profile_for "$repo")"
    printf '%s\t%s\t%s\t%s\n' "$name" "$repo" "$base" "$profile"
  done
}

# ── file list per profile ────────────────────────────────────────────────────

policy_files_for() {
  local profile="$1"
  echo "AGENTS.policy.md"
  if [[ "$profile" == "boilerplate" ]]; then
    echo "docs/04_IMPLEMENTATION_PLAN.policy.md"
    echo "docs/DOCUMENTATION.policy.md"
  fi
}

# ── plan ─────────────────────────────────────────────────────────────────────

file_up_to_date() {
  local src="$BOILERPLATE/$1" dst="$2/$1"
  [[ -f "$src" ]] || return 0       # boilerplate doesn't have it yet → skip
  [[ -f "$dst" ]] || return 1       # missing in target
  diff -q "$src" "$dst" >/dev/null 2>&1
}

claude_ok() {
  local repo="$1"
  [[ -f "$repo/CLAUDE.md" ]] || return 0   # no CLAUDE.md → nothing to check
  # Exact-line match: @-import lines must be at start of line with no trailing content
  grep -qx '@AGENTS.policy.md' "$repo/CLAUDE.md" || return 1
  # Only require @AGENTS.md import when AGENTS.md actually exists
  if [[ -f "$repo/AGENTS.md" ]]; then
    grep -qx '@AGENTS.md' "$repo/CLAUDE.md" || return 1
  fi
}

plan_one() {
  local name="$1" repo="$2" base="$3" profile="$4"
  if [[ ! -d "$repo/.git" && ! -f "$repo/.git" ]]; then
    printf '%s\tmissing-repo\t%s\t%s\n' "$name" "$base" "$repo"; return
  fi
  if [[ "$profile" == "custom" ]]; then
    printf '%s\tskip-custom\t%s\t%s\n' "$name" "$base" "$repo"; return
  fi

  local needs=()
  while IFS= read -r f; do
    file_up_to_date "$f" "$repo" || needs+=("$f")
  done < <(policy_files_for "$profile")
  claude_ok "$repo" || needs+=("CLAUDE.md:imports")
  # AGENTS.md:ref: non-mutating drift detection only.
  # Sync never edits AGENTS.md; run /boilerplate-migrate to resolve.
  if [[ -f "$repo/AGENTS.md" ]] && ! grep -q "AGENTS\.policy\.md" "$repo/AGENTS.md"; then
    needs+=("AGENTS.md:ref[migrate]")
  fi

  if [[ ${#needs[@]} -eq 0 ]]; then
    printf '%s\tup-to-date\t%s\t%s\n' "$name" "$base" "$repo"
  else
    printf '%s\tneeds:%s\t%s\t%s\n' "$name" "$(IFS=,; echo "${needs[*]}")" "$base" "$repo"
  fi
}

# ── apply ────────────────────────────────────────────────────────────────────

ensure_claude_imports() {
  local claude="$1"
  local repo_root
  repo_root="$(dirname "$claude")"
  # Use exact-line checks (grep -qx) to match claude_ok predicate exactly
  # Only add @AGENTS.md when AGENTS.md exists in the same repo
  if [[ -f "$repo_root/AGENTS.md" ]] && ! grep -qx '@AGENTS.md' "$claude"; then
    printf '@AGENTS.md\n' | cat - "$claude" > "$claude.tmp" && mv "$claude.tmp" "$claude"
  fi
  # Ensure exact @AGENTS.policy.md line; insert after @AGENTS.md or prepend
  if ! grep -qx '@AGENTS.policy.md' "$claude"; then
    if grep -qx '@AGENTS.md' "$claude"; then
      awk '/^@AGENTS\.md$/{print; print "@AGENTS.policy.md"; next}1' "$claude" > "$claude.tmp" && mv "$claude.tmp" "$claude"
    else
      printf '@AGENTS.policy.md\n' | cat - "$claude" > "$claude.tmp" && mv "$claude.tmp" "$claude"
    fi
  fi
}

ensure_agents_ref() {
  local agents="$1"
  grep -q "AGENTS.policy.md" "$agents" && return 0
  # Write ref to tmpfile — avoids shell backtick/quoting pitfalls entirely
  local tmpref
  tmpref="$(mktemp)"
  printf '%s\n' 'See also: `AGENTS.policy.md` — boilerplate-owned cross-cutting agent behaviour rules.' > "$tmpref"
  if grep -q "^## " "$agents"; then
    # awk reads ref from file; inserts before first ## heading only
    awk -v rfile="$tmpref" \
      'BEGIN{while((getline line < rfile)>0) ref=ref line "\n"}
       !done && /^## /{printf "%s", ref; done=1} {print}' \
      "$agents" > "$agents.tmp" && mv "$agents.tmp" "$agents"
  else
    cat "$tmpref" "$agents" > "$agents.tmp" && mv "$agents.tmp" "$agents"
  fi
  rm -f "$tmpref"
  grep -q "AGENTS.policy.md" "$agents" || { echo "ensure_agents_ref: insertion failed in $agents" >&2; return 1; }
}

apply_one() {
  local name="$1" repo="$2" base="$3" profile="$4"
  [[ -d "$repo/.git" || -f "$repo/.git" ]] || { echo "$name missing-repo"; return 0; }
  [[ "$profile" == "custom" ]] && { echo "$name skip-custom"; return 0; }

  local wt
  wt="$(mktemp -d "/tmp/boilerplate-sync-${name}.XXXXXX")"
  rmdir "$wt"

  git -C "$repo" fetch origin "$base" -q
  git -C "$repo" worktree add --detach "$wt" "origin/$base" -q
  git -C "$wt" checkout -b "$BRANCH" -q

  # Copy policy files
  while IFS= read -r f; do
    local src="$BOILERPLATE/$f"
    [[ -f "$src" ]] || continue
    mkdir -p "$wt/$(dirname "$f")"
    cp "$src" "$wt/$f"
  done < <(policy_files_for "$profile")

  # Ensure CLAUDE.md has @AGENTS.md (when AGENTS.md exists) + @AGENTS.policy.md
  if [[ -f "$wt/CLAUDE.md" ]]; then
    ensure_claude_imports "$wt/CLAUDE.md"
  fi
  # AGENTS.md is project-owned — mutations are handled by /boilerplate-migrate, not sync

  git -C "$wt" diff --check
  git -C "$wt" add -A
  if git -C "$wt" diff --cached --quiet; then
    echo "$name unchanged"
  else
    git -C "$wt" commit -m "$COMMIT_MSG" -q
    git -C "$wt" push origin HEAD:"$base" -q
    echo "$name pushed $(git -C "$wt" rev-parse --short HEAD) -> $base"
  fi

  git -C "$repo" worktree remove "$wt" --force >/dev/null
  git -C "$repo" branch -D "$BRANCH" >/dev/null 2>&1 || true
}

# ── sync ─────────────────────────────────────────────────────────────────────

with_targets() {
  local targets="$1" fn="$2"
  local input="$targets"
  [[ "$targets" == "-" ]] && input="/dev/stdin"
  [[ "$targets" != "-" && ! -f "$targets" ]] && die "target file not found: $targets"
  while IFS=$'\t' read -r name repo base profile rest; do
    [[ -n "${name:-}" && "$name" != \#* ]] || continue
    [[ -n "${repo:-}" && -n "${base:-}" ]] || die "bad target row for $name"
    profile="${profile:-auto}"
    "$fn" "$name" "$repo" "$base" "$profile"
  done < "$input"
}

sync_targets() {
  local targets="${1:-$DEFAULT_TARGETS}"
  [[ -f "$targets" ]] || die "target file not found: $targets"

  # Print plan (informational) then always run apply.
  # plan_one uses the local checkout; apply_one fetches origin/$base and is the
  # ground-truth check. Suppressing apply based on local plan state would hide
  # remote drift when the local checkout is stale. apply_one reports "unchanged"
  # when nothing needs pushing, so the extra fetch+diff cost is accepted for
  # correctness.
  with_targets "$targets" plan_one
  with_targets "$targets" apply_one
}

# ── dispatch ─────────────────────────────────────────────────────────────────

cmd="${1:-}"
case "$cmd" in
  discover) discover ;;
  plan)
    shift
    input="${1:--}"
    if [[ "$input" == "-" ]]; then
      with_targets "-" plan_one
    else
      with_targets "$input" plan_one
    fi
    ;;
  apply)
    shift
    input="${1:-$DEFAULT_TARGETS}"
    with_targets "$input" apply_one
    ;;
  sync)
    shift
    sync_targets "${1:-$DEFAULT_TARGETS}"
    ;;
  refs)
    # Add AGENTS.policy.md reference to AGENTS.md in the given repo (or CWD).
    # Used by /boilerplate when onboarding a specific repo. Does not commit.
    shift
    target="${1:-.}"
    agents="$target/AGENTS.md"
    [[ -f "$agents" ]] || die "AGENTS.md not found in $target"
    ensure_agents_ref "$agents" && echo "AGENTS.md updated: $agents" || echo "AGENTS.md already has reference: $agents"
    ;;
  targets-update)
    # Add or update a repo entry in targets.tsv.
    # Usage: targets-update <repo-path> <profile>
    shift
    [[ $# -eq 2 ]] || die "usage: targets-update <repo-path> <profile>"
    t_repo="$(cd "$1" && pwd)"
    t_profile="$2"
    [[ "$t_profile" =~ ^(universal|boilerplate|custom)$ ]] || die "profile must be universal|boilerplate|custom"
    t_name="$(basename "$t_repo")"
    t_base="$(git -C "$t_repo" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##' || git -C "$t_repo" symbolic-ref --short HEAD 2>/dev/null || echo main)"
    t_line="${t_name}	${t_repo}	${t_base}	${t_profile}"
    if grep -q "^${t_name}	" "$DEFAULT_TARGETS" 2>/dev/null; then
      # Update existing entry (macOS-compatible in-place sed)
      sed -i '' "s|^${t_name}	.*|${t_line}|" "$DEFAULT_TARGETS"
      echo "updated: $t_line"
    else
      printf '%s\n' "$t_line" >> "$DEFAULT_TARGETS"
      echo "added: $t_line"
    fi
    ;;
  -h|--help|help|"") usage ;;
  *) usage; exit 2 ;;
esac
