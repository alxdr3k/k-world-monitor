#!/usr/bin/env bun
/**
 * Pre-commit secret scanner (AI-P1-12 / RUNBOOK setup hygiene).
 *
 * Two defense layers:
 *   1. Filename guard — reject any staged file whose path matches `.env`
 *      (not `.env.example` / `.env.sample` / `.env.template`). The
 *      `.gitignore` already excludes `.env`, but operators using
 *      `git add -f` or working in a fresh clone where `.gitignore` was
 *      not yet effective can slip through.
 *   2. Pattern guard — scan every staged file's content for known API key
 *      formats (OpenAI / Anthropic / Google / AWS / GitHub PAT / Doppler).
 *      Catches secrets accidentally pasted into source / docs / commit
 *      message templates / config files unrelated to `.env`.
 *
 * Operator override: `git commit --no-verify` bypasses the hook. Document
 * the exemption in the commit message body if used.
 *
 * Wired via `git config core.hooksPath = scripts/git-hooks` (run
 * `bun run hooks:install` once per fresh clone). The `pre-commit` shim
 * in that directory invokes this script.
 *
 * Pure function `scanForSecrets()` is exported for unit testing — the
 * git-diff-based `main()` is the CLI entrypoint only and is not
 * invoked when this module is imported.
 */

import { execFileSync } from "child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StagedFile {
  path: string;
  content: string;
}

export interface SecretViolation {
  filePath: string;
  reason: "env_file_staged" | "secret_pattern_match";
  /** Pattern name (only set for reason = "secret_pattern_match"). */
  pattern?: string;
  /** Redacted preview of the matched token (only set for pattern match). */
  match?: string;
}

// ---------------------------------------------------------------------------
// Pattern catalog — operator-known secret formats.
//
// Conservative side: false positives are the lesser evil for a pre-commit
// hook (operator runs `--no-verify` if certain). Each pattern is anchored to
// a vendor-specific prefix so generic alphanumeric strings do not trigger.
// ---------------------------------------------------------------------------

const SECRET_PATTERNS: ReadonlyArray<readonly [name: string, regex: RegExp]> = [
  // OpenAI: sk-... (project keys: sk-proj-...). 40+ payload chars.
  ["openai_api_key", /sk-(?:proj-)?[A-Za-z0-9_-]{32,}/g],
  // Anthropic: sk-ant-...
  ["anthropic_api_key", /sk-ant-[A-Za-z0-9_-]{20,}/g],
  // Google AI Studio (Gemini): AIza + 35 url-safe chars.
  ["google_api_key", /AIza[A-Za-z0-9_-]{35}/g],
  // AWS access key id.
  ["aws_access_key_id", /AKIA[0-9A-Z]{16}/g],
  // GitHub PAT (classic 36 / fine-grained 82 / oauth/server/refresh variants).
  ["github_pat_classic", /ghp_[A-Za-z0-9]{36}/g],
  ["github_pat_fine_grained", /github_pat_[A-Za-z0-9_]{82}/g],
  ["github_oauth_token", /gh[osru]_[A-Za-z0-9]{36}/g],
  // Doppler service token format `dp.st.<config>.<payload>`.
  ["doppler_service_token", /dp\.st\.[a-z0-9_-]+\.[A-Za-z0-9_-]{32,}/g],
];

// ---------------------------------------------------------------------------
// Filename guard
// ---------------------------------------------------------------------------

const ENV_FILE_PATTERN = /(?:^|\/)\.env(?:\.[^/]+)?$/;
const ENV_FILE_EXEMPT_SUFFIXES = ["example", "sample", "template"];

export function isEnvFileExempt(path: string): boolean {
  const match = /\.env\.([^/]+)$/.exec(path);
  if (!match) return false;
  return ENV_FILE_EXEMPT_SUFFIXES.includes(match[1]!);
}

export function isStagedEnvFile(path: string): boolean {
  return ENV_FILE_PATTERN.test(path) && !isEnvFileExempt(path);
}

// ---------------------------------------------------------------------------
// Redaction — show enough of a match for operator confirmation without
// re-leaking the secret into stdout / CI logs / process accounting.
// ---------------------------------------------------------------------------

export function redactMatch(s: string): string {
  if (s.length <= 8) return "***";
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Pure scanner — testable, no IO.
// ---------------------------------------------------------------------------

export function scanForSecrets(files: ReadonlyArray<StagedFile>): SecretViolation[] {
  const violations: SecretViolation[] = [];
  for (const file of files) {
    if (isStagedEnvFile(file.path)) {
      violations.push({ filePath: file.path, reason: "env_file_staged" });
    }
    for (const [name, regex] of SECRET_PATTERNS) {
      // Reset regex.lastIndex because the patterns carry the `g` flag and
      // share state across invocations otherwise — would silently miss
      // matches on alternating files.
      regex.lastIndex = 0;
      const match = regex.exec(file.content);
      if (match) {
        violations.push({
          filePath: file.path,
          reason: "secret_pattern_match",
          pattern: name,
          match: redactMatch(match[0]),
        });
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// CLI entry — invoked by scripts/git-hooks/pre-commit shim.
// ---------------------------------------------------------------------------

/**
 * Parse NUL-separated paths from `git diff --cached --name-only -z` output.
 * Codex PR #48 P1 fix: without `-z`, unusual filenames (containing
 * newlines, quotes, special chars) get C-style escaped — the parsed name
 * is then NOT the literal path and downstream `git show` lookups fail,
 * silently dropping the file from the scan. Exported for direct unit
 * testing of the parser.
 */
export function parseNulSeparatedPaths(raw: string): string[] {
  return raw.split("\0").filter(Boolean);
}

function getStagedFiles(): StagedFile[] {
  // --diff-filter=ACM = Added / Copied / Modified. Excludes deletions
  // (no content to scan) and pure renames (content already scanned at
  // the source path in a prior commit).
  //
  // Codex PR #48 P1 fix #1: execFileSync with argv array — NOT execSync
  // with a string template. The previous `execSync(`git show ":${path}"`)`
  // treated `path` as shell input — a staged filename containing quotes
  // or `;` / `&&` / `$(...)` could break out of the quoted argument and
  // execute arbitrary commands during `git commit` (local code-exec
  // vector in the pre-commit hook). With execFileSync(file, [...args])
  // the args are passed directly to the spawned process — no shell, no
  // interpolation, filenames are pure data.
  //
  // Codex PR #48 P1 fix #2: -z (NUL separator) avoids `git diff`'s
  // default quoted-escaping of unusual paths.
  const raw = execFileSync(
    "git",
    ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACM"],
    { encoding: "utf-8" }
  );
  const paths = parseNulSeparatedPaths(raw);
  const files: StagedFile[] = [];
  for (const path of paths) {
    try {
      // `git show :<path>` reads the STAGED content (index version) — this
      // is what will be committed if the hook returns 0, not what's on disk.
      // execFileSync with argv array — no shell interpolation.
      const content = execFileSync("git", ["show", `:${path}`], {
        encoding: "utf-8",
      });
      files.push({ path, content });
    } catch (err) {
      // Codex PR #48 P1 fix #3: fail-CLOSED on read error. The previous
      // best-effort skip + console.warn allowed a commit through even when
      // the unread file contained secrets — the scanner advertised
      // protection but silently let leaks pass. A read failure on a
      // staged file (submodule / transient git error / unreadable blob)
      // is now a hard hook failure. Operators with a legitimate binary
      // fixture or known-safe unreadable file use `git commit --no-verify`
      // with a justification line in the commit body.
      //
      // Note on binary files: `git show` with `encoding: "utf-8"` does NOT
      // throw on invalid UTF-8 — it returns the string with U+FFFD
      // replacement characters. So a typical PNG / PDF binary scans
      // cleanly through scanForSecrets (the secret patterns are ASCII).
      // This catch fires only for true read failures, not for binary
      // content.
      const msg = (err as Error).message;
      throw new Error(
        `[pre-commit] failed to read staged content for ${JSON.stringify(path)}: ${msg}\n` +
          `Cannot fail-open — a secret could be hidden in the unread bytes. ` +
          `If this is a legitimate binary / submodule / known-safe file, run ` +
          "`git commit --no-verify` with a justification line in the commit body."
      );
    }
  }
  return files;
}

function formatViolation(v: SecretViolation): string {
  if (v.reason === "env_file_staged") {
    return `  [${v.filePath}] .env-family file staged — these are gitignored secret containers. Use .env.example / .env.sample / .env.template for committed references.`;
  }
  return `  [${v.filePath}] secret pattern '${v.pattern}' matched: ${v.match}`;
}

async function main(): Promise<number> {
  const files = getStagedFiles();
  const violations = scanForSecrets(files);
  if (violations.length === 0) return 0;
  console.error(
    `[pre-commit] secret scan detected ${violations.length} violation(s):`
  );
  for (const v of violations) console.error(formatViolation(v));
  console.error(
    "\nIf this is a false positive (e.g. test fixture, .env.example reference), " +
      "run `git commit --no-verify` to bypass and add a justification line in the " +
      "commit body. Otherwise: unstage the file (`git restore --staged <path>`), " +
      "rotate the secret immediately, and commit only after redaction."
  );
  return 1;
}

if (import.meta.main) {
  process.exit(await main());
}
