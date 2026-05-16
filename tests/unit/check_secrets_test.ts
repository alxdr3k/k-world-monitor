/**
 * Unit tests for the pre-commit secret scanner (AI-P1-12).
 *
 * Covers the pure scanForSecrets() function — the CLI entry that runs
 * `git diff --cached` is not tested directly (would require a real git
 * environment and add fragility). The pure function takes (path, content)
 * pairs and emits typed violations.
 */

import { describe, it, expect } from "bun:test";
import {
  scanForSecrets,
  isStagedEnvFile,
  isEnvFileExempt,
  redactMatch,
  parseNulSeparatedPaths,
  type StagedFile,
} from "../../scripts/check-secrets";

// ---------------------------------------------------------------------------
// isStagedEnvFile + isEnvFileExempt — filename guard
// ---------------------------------------------------------------------------

describe("isStagedEnvFile — filename guard", () => {
  it("matches plain .env at repo root", () => {
    expect(isStagedEnvFile(".env")).toBe(true);
  });

  it("matches nested .env in subdirectory", () => {
    expect(isStagedEnvFile("subdir/.env")).toBe(true);
    expect(isStagedEnvFile("packages/app/.env")).toBe(true);
  });

  it("matches .env.local / .env.production / .env.dev (environment-specific)", () => {
    expect(isStagedEnvFile(".env.local")).toBe(true);
    expect(isStagedEnvFile(".env.production")).toBe(true);
    expect(isStagedEnvFile(".env.dev")).toBe(true);
  });

  it("does NOT match exempt reference files (.env.example / .env.sample / .env.template)", () => {
    expect(isStagedEnvFile(".env.example")).toBe(false);
    expect(isStagedEnvFile(".env.sample")).toBe(false);
    expect(isStagedEnvFile(".env.template")).toBe(false);
  });

  it("does NOT match unrelated files containing 'env' substring", () => {
    expect(isStagedEnvFile("src/utils/enums.ts")).toBe(false);
    expect(isStagedEnvFile("docs/environment.md")).toBe(false);
    expect(isStagedEnvFile("env.config.js")).toBe(false);
  });

  it("isEnvFileExempt — direct test", () => {
    expect(isEnvFileExempt(".env.example")).toBe(true);
    expect(isEnvFileExempt(".env.sample")).toBe(true);
    expect(isEnvFileExempt(".env.template")).toBe(true);
    expect(isEnvFileExempt(".env.local")).toBe(false);
    expect(isEnvFileExempt(".env")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// redactMatch — preview without re-leaking the secret
// ---------------------------------------------------------------------------

describe("redactMatch", () => {
  it("returns *** for very short strings (≤ 8 chars)", () => {
    expect(redactMatch("a")).toBe("***");
    expect(redactMatch("abc")).toBe("***");
    expect(redactMatch("12345678")).toBe("***");
  });

  it("returns first-4...last-4 preview for typical key lengths", () => {
    expect(redactMatch("sk-proj-abcdefghijklmnop1234")).toBe("sk-p...1234");
    expect(redactMatch("AIzaSyAB1234567890qrstuvwxyz1234567890de")).toBe("AIza...90de");
  });
});

// ---------------------------------------------------------------------------
// scanForSecrets — empty / clean cases
// ---------------------------------------------------------------------------

describe("scanForSecrets — clean files", () => {
  it("returns empty array when no files are staged", () => {
    expect(scanForSecrets([])).toEqual([]);
  });

  it("returns empty array when content has no secrets and no .env files", () => {
    const files: StagedFile[] = [
      { path: "src/index.ts", content: "export const greeting = 'hello world';\n" },
      { path: "docs/README.md", content: "# Project\n\nSome documentation.\n" },
    ];
    expect(scanForSecrets(files)).toEqual([]);
  });

  it("does NOT flag .env.example even with placeholder values inside", () => {
    const files: StagedFile[] = [
      {
        path: ".env.example",
        content: "OPENAI_API_KEY=\nANTHROPIC_API_KEY=\nGOOGLE_API_KEY=\n",
      },
    ];
    expect(scanForSecrets(files)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// scanForSecrets — env file filename violations
// ---------------------------------------------------------------------------

describe("scanForSecrets — env file filename violations", () => {
  it("flags staged .env file with env_file_staged reason", () => {
    const violations = scanForSecrets([{ path: ".env", content: "PORT=3000\n" }]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      filePath: ".env",
      reason: "env_file_staged",
    });
  });

  it("flags .env.local + .env.production (environment-specific) as env_file_staged", () => {
    const violations = scanForSecrets([
      { path: ".env.local", content: "" },
      { path: ".env.production", content: "" },
    ]);
    expect(violations).toHaveLength(2);
    expect(violations.every((v) => v.reason === "env_file_staged")).toBe(true);
  });

  it("can flag both filename + pattern violations on a single file", () => {
    // .env with an actual OpenAI key inside — fires BOTH guards.
    const violations = scanForSecrets([
      {
        path: ".env",
        content: "OPENAI_API_KEY=sk-proj-ABCDEFGH1234567890qrstuvwxyzKLMN1234\n",
      },
    ]);
    expect(violations.length).toBeGreaterThanOrEqual(2);
    expect(violations.some((v) => v.reason === "env_file_staged")).toBe(true);
    expect(
      violations.some((v) => v.reason === "secret_pattern_match" && v.pattern === "openai_api_key")
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// scanForSecrets — pattern matching per vendor
// ---------------------------------------------------------------------------

describe("scanForSecrets — vendor secret patterns", () => {
  it("matches OpenAI sk-proj-... key in source file", () => {
    const violations = scanForSecrets([
      {
        path: "src/test.ts",
        content: `const key = "sk-proj-A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R8S9T0U1V2";`,
      },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.pattern).toBe("openai_api_key");
    expect(violations[0]!.match).toContain("sk-p");
    expect(violations[0]!.match).toContain("...");
  });

  it("matches Anthropic sk-ant-... key", () => {
    const violations = scanForSecrets([
      {
        path: "docs/note.md",
        content: "key=sk-ant-A1B2C3D4E5F6G7H8I9J0K1L2-_",
      },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.pattern).toBe("anthropic_api_key");
  });

  it("matches Google AIza... API key", () => {
    const violations = scanForSecrets([
      {
        path: "config.yaml",
        content: "google_key: AIzaSyAB1234567890qrstuvwxyz1234567890de",
      },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.pattern).toBe("google_api_key");
  });

  it("matches AWS access key id (AKIA prefix)", () => {
    const violations = scanForSecrets([
      {
        path: "deploy.yml",
        content: "AWS_ACCESS_KEY_ID: AKIAIOSFODNN7EXAMPLE",
      },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.pattern).toBe("aws_access_key_id");
  });

  it("matches GitHub PAT (ghp_ classic 36-char)", () => {
    const violations = scanForSecrets([
      {
        path: "ci.yml",
        content: "GH_TOKEN: ghp_abcdefghijklmnopqrstuvwxyz1234567890",
      },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.pattern).toBe("github_pat_classic");
  });

  it("matches GitHub fine-grained PAT (github_pat_ + 82 chars)", () => {
    const longPayload = "A".repeat(22) + "_" + "B".repeat(59);
    const violations = scanForSecrets([
      { path: "secret.txt", content: `token=github_pat_${longPayload}` },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.pattern).toBe("github_pat_fine_grained");
  });

  it("matches GitHub OAuth tokens (gho_ / ghu_ / ghs_ / ghr_)", () => {
    // GitHub OAuth/server/user/refresh tokens: `gh[osru]_` prefix + 36 chars.
    const variants = [
      "gho_abcdefghijklmnopqrstuvwxyz0123456789",
      "ghu_abcdefghijklmnopqrstuvwxyz0123456789",
      "ghs_abcdefghijklmnopqrstuvwxyz0123456789",
      "ghr_abcdefghijklmnopqrstuvwxyz0123456789",
    ];
    for (const v of variants) {
      const violations = scanForSecrets([{ path: "x", content: v }]);
      expect(violations).toHaveLength(1);
      expect(violations[0]!.pattern).toBe("github_oauth_token");
    }
  });

  it("matches Doppler service token (dp.st.<config>.<payload>)", () => {
    const violations = scanForSecrets([
      {
        path: "ci.yml",
        content: "DOPPLER_TOKEN: dp.st.prd.abcdefghijklmnopqrstuvwxyz1234567890",
      },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.pattern).toBe("doppler_service_token");
  });

  it("redacted match string never exposes more than first-4 + last-4 chars", () => {
    const violations = scanForSecrets([
      {
        path: "src/x.ts",
        content: "k=sk-proj-A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R8S9T0U1V2",
      },
    ]);
    expect(violations).toHaveLength(1);
    const match = violations[0]!.match!;
    // No full secret payload in the redacted preview.
    expect(match).not.toContain("M3N4O5P6Q7R8");
    expect(match).toMatch(/^.{1,4}\.\.\..{1,4}$/);
  });
});

// ---------------------------------------------------------------------------
// parseNulSeparatedPaths — git diff --name-only -z parser
// (Codex PR #48 P1 fix #2 regression coverage)
// ---------------------------------------------------------------------------

describe("parseNulSeparatedPaths — git diff -z output", () => {
  it("parses single path with trailing NUL", () => {
    expect(parseNulSeparatedPaths("src/foo.ts\0")).toEqual(["src/foo.ts"]);
  });

  it("parses multiple paths separated by NUL with trailing NUL", () => {
    expect(parseNulSeparatedPaths("a.ts\0b.ts\0c.ts\0")).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("returns empty array for empty input", () => {
    expect(parseNulSeparatedPaths("")).toEqual([]);
  });

  it("returns empty array when input is only a NUL byte", () => {
    expect(parseNulSeparatedPaths("\0")).toEqual([]);
  });

  it("preserves filenames containing newlines (the whole reason for -z)", () => {
    // `git diff --name-only` (without -z) would C-style quote-escape this
    // path; with -z, the newline is part of the literal filename and the
    // NUL separator unambiguously demarcates entries.
    const tricky = "weird\nname.ts";
    expect(parseNulSeparatedPaths(`${tricky}\0other.ts\0`)).toEqual([tricky, "other.ts"]);
  });

  it("preserves filenames containing quote characters", () => {
    // Without -z, paths with quote chars get C-quoted; with -z they pass
    // through verbatim. Critical for command-injection safety — these
    // chars would otherwise pollute downstream shell-interpolated calls.
    const tricky = `foo"bar';rm.ts`;
    expect(parseNulSeparatedPaths(`${tricky}\0`)).toEqual([tricky]);
  });
});

// ---------------------------------------------------------------------------
// scanForSecrets — regex state isolation (multiple files)
// ---------------------------------------------------------------------------

describe("scanForSecrets — regex state isolation across files", () => {
  it("detects pattern in every file even though regex is shared (g flag lastIndex reset)", () => {
    // The patterns are declared with the /g flag, which means a stateful
    // .lastIndex on the RegExp. If scanForSecrets does not reset it
    // between files, alternating matched / unmatched files would silently
    // miss the second match. This test would fail before the reset fix.
    const files: StagedFile[] = [
      { path: "a.ts", content: "sk-proj-A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R8S9T0U1V2" },
      { path: "b.ts", content: "sk-proj-Z9Y8X7W6V5U4T3S2R1Q0P9O8N7M6L5K4J3I2H1G0F9E8" },
      { path: "c.ts", content: "no secret here" },
      { path: "d.ts", content: "sk-proj-1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef" },
    ];
    const violations = scanForSecrets(files);
    const matched = violations.filter((v) => v.reason === "secret_pattern_match");
    expect(matched.map((v) => v.filePath).sort()).toEqual(["a.ts", "b.ts", "d.ts"]);
  });
});
