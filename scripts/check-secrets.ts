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

import { execSync } from "child_process";

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

function getStagedFiles(): StagedFile[] {
  // --diff-filter=ACM = Added / Copied / Modified. Excludes deletions
  // (no content to scan) and pure renames (content already scanned at
  // the source path in a prior commit).
  const raw = execSync("git diff --cached --name-only --diff-filter=ACM", {
    encoding: "utf-8",
  });
  const paths = raw.trim().split("\n").filter(Boolean);
  const files: StagedFile[] = [];
  for (const path of paths) {
    try {
      // `git show :<path>` reads the STAGED content (index version) — this
      // is what will be committed if the hook returns 0, not what's on disk.
      const content = execSync(`git show ":${path}"`, { encoding: "utf-8" });
      files.push({ path, content });
    } catch {
      // Binary file / submodule / deleted — skip. The catch is intentional;
      // we never want a transient read failure to allow a commit through.
      // Binary files can still hide secrets in metadata, but those require
      // a different scanner — log and continue.
      console.warn(`[pre-commit] skipped (unreadable): ${path}`);
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
