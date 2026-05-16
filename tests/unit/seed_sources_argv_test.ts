/**
 * Unit tests for seed-sources CLI argv allowlist (AI-P1-14 /
 * INFRA-1B.1.h3-seed-sources-argv-allowlist).
 *
 * Pre-AI-P1-14 the CLI used `process.argv.includes(...)` which silently
 * ignored typos. With `--neo4j` triggering real graph writes, a typoed
 * combination like `--dryrun --neo4j` would silently proceed with full
 * DB/Neo4j mutations instead of the dry-run preview the operator expected.
 *
 * AI-P1-14 applies the parseArgs allowlist + UnknownArgumentError pattern
 * from PR #45 (src/discovery/worker/run-process-queue.ts) so any unknown
 * argument fails fast with the offending tokens + known-flag list + usage
 * line.
 */

import { describe, it, expect } from "bun:test";
import {
  parseArgs,
  UnknownArgumentError,
  KNOWN_FLAGS,
  USAGE_LINE,
} from "../../scripts/seed-sources";

describe("seed-sources parseArgs — fail-fast argv handling", () => {
  it("accepts empty argv (default = SQLite seed only)", () => {
    expect(parseArgs([])).toEqual({
      dryRun: false,
      neo4j: false,
      preflight: false,
    });
  });

  it("accepts --dry-run", () => {
    expect(parseArgs(["--dry-run"])).toEqual({
      dryRun: true,
      neo4j: false,
      preflight: false,
    });
  });

  it("accepts --neo4j", () => {
    expect(parseArgs(["--neo4j"])).toEqual({
      dryRun: false,
      neo4j: true,
      preflight: false,
    });
  });

  it("accepts --preflight", () => {
    expect(parseArgs(["--preflight"])).toEqual({
      dryRun: false,
      neo4j: false,
      preflight: true,
    });
  });

  it("accepts all 3 flags combined (--dry-run --neo4j --preflight)", () => {
    expect(parseArgs(["--dry-run", "--neo4j", "--preflight"])).toEqual({
      dryRun: true,
      neo4j: true,
      preflight: true,
    });
  });

  it("rejects --dryrun typo (no hyphen) with UnknownArgumentError", () => {
    let caught: unknown;
    try {
      parseArgs(["--dryrun"]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnknownArgumentError);
    const err = caught as UnknownArgumentError;
    expect(err.unknown).toEqual(["--dryrun"]);
    expect(err.message).toContain("Unknown argument(s): --dryrun");
    expect(err.message).toContain("Known flags: --dry-run, --neo4j, --preflight");
    expect(err.message).toContain(USAGE_LINE);
  });

  it("rejects --dry_run typo (underscore) with UnknownArgumentError", () => {
    expect(() => parseArgs(["--dry_run"])).toThrow(UnknownArgumentError);
  });

  it("rejects --Neo4j typo (capitalization) with UnknownArgumentError", () => {
    let caught: unknown;
    try {
      parseArgs(["--Neo4j"]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnknownArgumentError);
    expect((caught as UnknownArgumentError).unknown).toEqual(["--Neo4j"]);
  });

  it("rejects --dryrun mixed with valid --neo4j (critical: silent write risk)", () => {
    // This is the exact scenario AI-P1-14 protects against — typoed dry-run
    // combined with --neo4j would silently proceed to real graph writes
    // under the pre-AI-P1-14 process.argv.includes() pattern.
    let caught: unknown;
    try {
      parseArgs(["--dryrun", "--neo4j"]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnknownArgumentError);
    expect((caught as UnknownArgumentError).unknown).toEqual(["--dryrun"]);
  });

  it("rejects multiple unknown args (reports all in message)", () => {
    let caught: unknown;
    try {
      parseArgs(["--foo", "--bar", "--baz"]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnknownArgumentError);
    expect((caught as UnknownArgumentError).unknown).toEqual([
      "--foo",
      "--bar",
      "--baz",
    ]);
    expect((caught as Error).message).toContain("--foo, --bar, --baz");
  });

  it("rejects positional arguments (no positional flags supported)", () => {
    expect(() => parseArgs(["source_id_x"])).toThrow(UnknownArgumentError);
  });

  it("KNOWN_FLAGS export contains exactly --dry-run, --neo4j, --preflight", () => {
    expect([...KNOWN_FLAGS].sort()).toEqual([
      "--dry-run",
      "--neo4j",
      "--preflight",
    ]);
  });
});
