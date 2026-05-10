---
name: codex-version
description: Show installed Codex CLI plugin version(s), check latest available version, and optionally upgrade with --upgrade
argument-hint: [--upgrade]
---

# Codex Version

Show what version of the OpenAI Codex Claude Code plugin is installed, check the latest available version, and optionally upgrade it.

## Arguments

- No argument: report installed version(s) and latest available version.
- `--upgrade`: report installed version(s), check the latest available version, run the plugin update command, then report the result.

## Procedure

1. List cached Codex plugin version directories:

   ```bash
   CODEX_PLUGIN_CACHE="/Users/yngn/.claude/plugins/cache/openai-codex/codex"
   [ -d "$CODEX_PLUGIN_CACHE" ] || { echo "Missing Codex plugin cache: $CODEX_PLUGIN_CACHE"; exit 1; }
   find "$CODEX_PLUGIN_CACHE" -maxdepth 1 -mindepth 1 -type d -exec basename {} \; | sort -V
   ```

2. Show the installed plugin entry from Claude Code:

   ```bash
   claude plugin list | sed -n '/codex@openai-codex/,+3p'
   ```

3. Check the latest available version. Prefer the package registry when available:

   ```bash
   npm view @openai/codex version
   ```

   If npm is unavailable, blocked, or clearly not authoritative for this plugin install, use Claude Code's plugin mechanism as the source of truth and explain that latest-version lookup is limited to the installed marketplace metadata.

4. If `$ARGUMENTS` is exactly `--upgrade`, run:

   ```bash
   claude plugin update codex@openai-codex
   ```

   Then repeat steps 1 and 2 to show the post-update cached version directories and installed plugin entry.

5. Display results clearly:

   - Cached version directories under `/Users/yngn/.claude/plugins/cache/openai-codex/codex/`
   - Claude Code installed plugin version/status
   - Latest available version check result, including any lookup failure
   - Upgrade action and output when `--upgrade` was provided

## Constraints

- Only run the update command when `$ARGUMENTS` is exactly `--upgrade`.
- Do not delete old cached version directories.
- If a command fails, report the command, exit status, and stderr summary instead of hiding the failure.
