#!/usr/bin/env bash
# Install repo-managed git hooks (AI-P1-12 / RUNBOOK setup hygiene).
#
# Uses `git config core.hooksPath = scripts/git-hooks` rather than per-file
# symlinks so future hooks added under `scripts/git-hooks/` activate
# automatically without re-running install.
#
# Operator override per-commit: `git commit --no-verify`.
# Operator-wide disable (NOT recommended): `git config --unset core.hooksPath`.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="${REPO_ROOT}/scripts/git-hooks"

if [ ! -d "${HOOKS_DIR}" ]; then
  echo "error: ${HOOKS_DIR} not found — are you running from the k-world-monitor repo root?" >&2
  exit 1
fi

# Ensure every hook is executable. Some operators clone with restrictive umask
# (e.g. corporate VPN sessions) and the +x bit is dropped.
chmod +x "${HOOKS_DIR}"/*

# Point git at the repo-managed hooks directory. Relative path so the
# config is portable across worktrees.
git -C "${REPO_ROOT}" config core.hooksPath scripts/git-hooks

echo "installed: core.hooksPath = scripts/git-hooks"
echo
echo "Active hooks:"
for hook in "${HOOKS_DIR}"/*; do
  name=$(basename "${hook}")
  echo "  - ${name}"
done
echo
echo "Test the hook (repo-relative path — /tmp/* is rejected by git add as outside repo):"
echo "  echo 'sk-proj-FAKE-TEST-KEY-PLACEHOLDER-1234567890123456' > .secret-scan-smoke.txt"
echo "  git add .secret-scan-smoke.txt && git commit -m secret-scan-smoke-test  # should fail"
echo "  git restore --staged .secret-scan-smoke.txt && rm -f .secret-scan-smoke.txt"
echo
echo "Or invoke scanner directly without git commit (safer for repeated checks):"
echo "  bun run check-secrets   # reads currently-staged content"
echo
echo "Bypass (operator override, document in commit body):"
echo "  git commit --no-verify"
