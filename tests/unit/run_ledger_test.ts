/**
 * Unit tests for OPS-1A.1 run-ledger (AC-019).
 * SQLite in-memory; no Neo4j dependency.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";

const _originalSqlitePath = process.env["SQLITE_PATH"];

import { closeDb } from "../../src/storage/sqlite/connection";
import {
  startRun,
  completeRun,
  failRun,
  getDailyCostUsd,
  getDailyCostBreakdown,
} from "../../src/ops/run-ledger";

function setupDb() {
  closeDb();
  const { getDb } = require("../../src/storage/sqlite/connection");
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT NOT NULL PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      description TEXT
    );
    CREATE TABLE IF NOT EXISTS run_ledger (
      run_id          TEXT PRIMARY KEY,
      started_at      TEXT NOT NULL,
      completed_at    TEXT,
      status          TEXT NOT NULL DEFAULT 'running',
      stage           TEXT NOT NULL,
      vendor          TEXT NOT NULL,
      tier            INTEGER NOT NULL,
      model_id        TEXT NOT NULL,
      prompt_version  TEXT,
      system_prompt_sha256 TEXT,
      input_tokens    INTEGER,
      output_tokens   INTEGER,
      cached_tokens   INTEGER,
      total_cost_usd  REAL,
      batch_id        TEXT,
      cross_vendor_review_of TEXT,
      spec_sha256     TEXT,
      dataset_vintage_id TEXT,
      library_version_lock_sha256 TEXT,
      domain_override_reason TEXT,
      session_id      TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

beforeEach(() => {
  process.env["SQLITE_PATH"] = ":memory:";
  setupDb();
});

afterEach(() => {
  if (_originalSqlitePath === undefined) {
    delete process.env["SQLITE_PATH"];
  } else {
    process.env["SQLITE_PATH"] = _originalSqlitePath;
  }
});

describe("startRun", () => {
  it("returns a run_ prefixed ID", () => {
    const id = startRun({ stage: "extract", vendor: "openai", tier: 2, modelId: "gpt-5-mini" });
    expect(id).toMatch(/^run_/);
  });

  it("inserts a running row", () => {
    const id = startRun({
      stage: "discover",
      vendor: "anthropic",
      tier: 1,
      modelId: "claude-sonnet-4-6",
      domainOverrideReason: "korean-long-context",
    });
    const { getDb } = require("../../src/storage/sqlite/connection");
    const row = getDb().prepare("SELECT * FROM run_ledger WHERE run_id = ?").get(id) as Record<string, unknown>;
    expect(row["status"]).toBe("running");
    expect(row["stage"]).toBe("discover");
    expect(row["vendor"]).toBe("anthropic");
    expect(row["tier"]).toBe(1);
    expect(row["model_id"]).toBe("claude-sonnet-4-6");
  });

  it("stores optional fields", () => {
    const id = startRun({
      stage: "thesis",
      vendor: "google",
      tier: 0,
      modelId: "gemini-2.5-pro",
      domainOverrideReason: "korean-long-context",
      sessionId: "sess_TEST",
    });
    const { getDb } = require("../../src/storage/sqlite/connection");
    const row = getDb().prepare("SELECT * FROM run_ledger WHERE run_id = ?").get(id) as Record<string, unknown>;
    expect(row["domain_override_reason"]).toBe("korean-long-context");
    expect(row["session_id"]).toBe("sess_TEST");
  });

  it("throws when tier is out of range", () => {
    expect(() =>
      startRun({ stage: "extract", vendor: "openai", tier: 99 as 0, modelId: "gpt-5-mini" })
    ).toThrow("tier must be 0–3");
    expect(() =>
      startRun({ stage: "extract", vendor: "openai", tier: -1 as 0, modelId: "gpt-5-mini" })
    ).toThrow("tier must be 0–3");
  });

  it("throws when non-openai vendor has no domainOverrideReason", () => {
    expect(() =>
      startRun({ stage: "extract", vendor: "anthropic", tier: 1, modelId: "claude-sonnet-4-6" })
    ).toThrow("domainOverrideReason is required");
    expect(() =>
      startRun({ stage: "extract", vendor: "google", tier: 0, modelId: "gemini-2.5-pro" })
    ).toThrow("domainOverrideReason is required");
  });

  it("allows openai without domainOverrideReason", () => {
    expect(() =>
      startRun({ stage: "extract", vendor: "openai", tier: 2, modelId: "gpt-5-mini" })
    ).not.toThrow();
  });

  it("throws when non-openai domainOverrideReason is whitespace-only", () => {
    expect(() =>
      startRun({ stage: "extract", vendor: "anthropic", tier: 1, modelId: "claude-sonnet-4-6", domainOverrideReason: "   " })
    ).toThrow("domainOverrideReason is required");
    expect(() =>
      startRun({ stage: "extract", vendor: "google", tier: 0, modelId: "gemini-2.5-pro", domainOverrideReason: "\t" })
    ).toThrow("domainOverrideReason is required");
  });

  it("throws when modelId is empty or whitespace-only", () => {
    expect(() =>
      startRun({ stage: "extract", vendor: "openai", tier: 2, modelId: "" })
    ).toThrow("modelId must be a non-empty string");
    expect(() =>
      startRun({ stage: "extract", vendor: "openai", tier: 2, modelId: "   " })
    ).toThrow("modelId must be a non-empty string");
  });

  it("throws when stage is not a valid RunStage (JS-caller guard)", () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      startRun({ stage: "unknown_stage" as any, vendor: "openai", tier: 2, modelId: "gpt-5-mini" })
    ).toThrow("unknown stage");
  });

  it("throws when vendor is not a valid RunVendor (JS-caller guard)", () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      startRun({ stage: "extract", vendor: "cohere" as any, tier: 2, modelId: "command-r" })
    ).toThrow("unknown vendor");
  });
});

describe("completeRun", () => {
  it("marks status completed with token/cost data", () => {
    const id = startRun({ stage: "extract", vendor: "openai", tier: 2, modelId: "gpt-5-mini" });
    completeRun(id, { inputTokens: 1000, outputTokens: 200, cachedTokens: 100, totalCostUsd: 0.005 });
    const { getDb } = require("../../src/storage/sqlite/connection");
    const row = getDb().prepare("SELECT * FROM run_ledger WHERE run_id = ?").get(id) as Record<string, unknown>;
    expect(row["status"]).toBe("completed");
    expect(row["input_tokens"]).toBe(1000);
    expect(row["output_tokens"]).toBe(200);
    expect(row["cached_tokens"]).toBe(100);
    expect(row["total_cost_usd"]).toBeCloseTo(0.005, 6);
    expect(row["completed_at"]).toBeTruthy();
  });

  it("throws when totalCostUsd is not provided (JS-caller guard)", () => {
    const id = startRun({ stage: "dossier", vendor: "openai", tier: 1, modelId: "gpt-5-mini" });
    // Cast to any to simulate untyped JS callers bypassing the TS interface.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => (completeRun as any)(id)).toThrow("totalCostUsd is required");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => (completeRun as any)(id, {})).toThrow("totalCostUsd is required");
    // null payload must also be rejected (not just undefined).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => (completeRun as any)(id, null)).toThrow("totalCostUsd is required");
  });

  it("accepts zero cost (free runs)", () => {
    const id = startRun({ stage: "dossier", vendor: "openai", tier: 1, modelId: "gpt-5-mini" });
    completeRun(id, { totalCostUsd: 0 });
    const { getDb } = require("../../src/storage/sqlite/connection");
    const row = getDb().prepare("SELECT * FROM run_ledger WHERE run_id = ?").get(id) as Record<string, unknown>;
    expect(row["status"]).toBe("completed");
    expect(row["total_cost_usd"]).toBe(0);
  });
});

describe("failRun", () => {
  it("marks status failed", () => {
    const id = startRun({ stage: "cite_check", vendor: "openai", tier: 3, modelId: "gpt-5-5-pro" });
    failRun(id);
    const { getDb } = require("../../src/storage/sqlite/connection");
    const row = getDb().prepare("SELECT * FROM run_ledger WHERE run_id = ?").get(id) as Record<string, unknown>;
    expect(row["status"]).toBe("failed");
    expect(row["completed_at"]).toBeTruthy();
  });

  it("throws when run_id does not exist", () => {
    expect(() => failRun("run_NONEXISTENT")).toThrow("no running row");
  });

  it("throws when run is already completed (no terminal overwrite)", () => {
    const id = startRun({ stage: "extract", vendor: "openai", tier: 2, modelId: "gpt-5-mini" });
    completeRun(id, { totalCostUsd: 0.01 });
    expect(() => failRun(id)).toThrow("no running row");
  });
});

describe("completeRun terminal-state guard", () => {
  it("throws when run_id does not exist", () => {
    expect(() => completeRun("run_NONEXISTENT", { totalCostUsd: 0.01 })).toThrow("no running row");
  });

  it("throws when totalCostUsd is negative", () => {
    const id = startRun({ stage: "extract", vendor: "openai", tier: 2, modelId: "gpt-5-mini" });
    expect(() => completeRun(id, { totalCostUsd: -0.01 })).toThrow("must be a finite non-negative number");
  });

  it("throws when totalCostUsd is NaN", () => {
    const id = startRun({ stage: "extract", vendor: "openai", tier: 2, modelId: "gpt-5-mini" });
    expect(() => completeRun(id, { totalCostUsd: NaN })).toThrow("must be a finite non-negative number");
  });

  it("throws when totalCostUsd is Infinity", () => {
    const id = startRun({ stage: "extract", vendor: "openai", tier: 2, modelId: "gpt-5-mini" });
    expect(() => completeRun(id, { totalCostUsd: Infinity })).toThrow("must be a finite non-negative number");
  });

  it("throws when inputTokens is negative", () => {
    const id = startRun({ stage: "extract", vendor: "openai", tier: 2, modelId: "gpt-5-mini" });
    expect(() => completeRun(id, { totalCostUsd: 0.01, inputTokens: -1 })).toThrow("inputTokens must be a non-negative integer");
  });

  it("throws when inputTokens is fractional", () => {
    const id = startRun({ stage: "extract", vendor: "openai", tier: 2, modelId: "gpt-5-mini" });
    expect(() => completeRun(id, { totalCostUsd: 0.01, inputTokens: 1.5 })).toThrow("inputTokens must be a non-negative integer");
  });

  it("throws when outputTokens is fractional", () => {
    const id = startRun({ stage: "extract", vendor: "openai", tier: 2, modelId: "gpt-5-mini" });
    expect(() => completeRun(id, { totalCostUsd: 0.01, outputTokens: 2.7 })).toThrow("outputTokens must be a non-negative integer");
  });

  it("throws when run is already failed (no terminal overwrite)", () => {
    const id = startRun({ stage: "extract", vendor: "openai", tier: 2, modelId: "gpt-5-mini" });
    failRun(id);
    expect(() => completeRun(id, { totalCostUsd: 0.01 })).toThrow("no running row");
  });
});

describe("getDailyCostUsd", () => {
  it("returns 0 for a date with no runs", () => {
    expect(getDailyCostUsd("2026-01-01")).toBe(0);
  });

  it("throws for invalid date format", () => {
    expect(() => getDailyCostUsd("2026-01")).toThrow("date must be YYYY-MM-DD");
    expect(() => getDailyCostUsd("not-a-date")).toThrow("date must be YYYY-MM-DD");
  });

  it("throws for impossible calendar dates (e.g. month 99)", () => {
    expect(() => getDailyCostUsd("2026-99-99")).toThrow("not a valid calendar date");
    expect(() => getDailyCostUsd("2026-02-30")).toThrow("not a valid calendar date");
  });

  it("sums completed runs for the date", () => {
    const today = new Date().toISOString().slice(0, 10);
    const id1 = startRun({ stage: "extract", vendor: "openai", tier: 2, modelId: "gpt-5-mini" });
    const id2 = startRun({
      stage: "extract",
      vendor: "anthropic",
      tier: 1,
      modelId: "claude-sonnet-4-6",
      domainOverrideReason: "test",
    });
    completeRun(id1, { totalCostUsd: 0.01 });
    completeRun(id2, { totalCostUsd: 0.02 });
    expect(getDailyCostUsd(today)).toBeCloseTo(0.03, 6);
  });

  it("excludes running and failed runs", () => {
    const today = new Date().toISOString().slice(0, 10);
    const id1 = startRun({ stage: "extract", vendor: "openai", tier: 2, modelId: "gpt-5-mini" });
    const id2 = startRun({ stage: "extract", vendor: "openai", tier: 2, modelId: "gpt-5-mini" });
    completeRun(id1, { totalCostUsd: 0.05 });
    failRun(id2);
    expect(getDailyCostUsd(today)).toBeCloseTo(0.05, 6);
  });

  it("throws for unknown vendor filter", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => getDailyCostUsd("2026-01-01", "cohere" as any)).toThrow("unknown vendor");
  });

  it("filters by vendor when specified", () => {
    const today = new Date().toISOString().slice(0, 10);
    const id1 = startRun({ stage: "extract", vendor: "openai", tier: 2, modelId: "gpt-5-mini" });
    const id2 = startRun({
      stage: "extract",
      vendor: "anthropic",
      tier: 1,
      modelId: "claude-sonnet-4-6",
      domainOverrideReason: "test",
    });
    completeRun(id1, { totalCostUsd: 0.01 });
    completeRun(id2, { totalCostUsd: 0.02 });
    expect(getDailyCostUsd(today, "openai")).toBeCloseTo(0.01, 6);
    expect(getDailyCostUsd(today, "anthropic")).toBeCloseTo(0.02, 6);
  });

  it("excludes runs from other dates", () => {
    const today = new Date().toISOString().slice(0, 10);
    const id = startRun({
      stage: "scenario",
      vendor: "google",
      tier: 0,
      modelId: "gemini-2.5-pro",
      domainOverrideReason: "test",
    });
    completeRun(id, { totalCostUsd: 0.10 });
    expect(getDailyCostUsd("2020-01-01")).toBe(0);
    expect(getDailyCostUsd(today)).toBeCloseTo(0.10, 6);
  });
});

describe("getDailyCostBreakdown", () => {
  it("returns per-vendor breakdown", () => {
    const today = new Date().toISOString().slice(0, 10);
    const id1 = startRun({ stage: "extract", vendor: "openai", tier: 2, modelId: "gpt-5-mini" });
    const id2 = startRun({ stage: "extract", vendor: "openai", tier: 2, modelId: "gpt-5-mini" });
    const id3 = startRun({
      stage: "extract",
      vendor: "anthropic",
      tier: 1,
      modelId: "claude-sonnet-4-6",
      domainOverrideReason: "test",
    });
    completeRun(id1, { totalCostUsd: 0.01 });
    completeRun(id2, { totalCostUsd: 0.02 });
    completeRun(id3, { totalCostUsd: 0.03 });
    const breakdown = getDailyCostBreakdown(today);
    const openai = breakdown.find((r) => r.vendor === "openai");
    const anthropic = breakdown.find((r) => r.vendor === "anthropic");
    expect(openai?.totalCostUsd).toBeCloseTo(0.03, 6);
    expect(openai?.runCount).toBe(2);
    expect(anthropic?.totalCostUsd).toBeCloseTo(0.03, 6);
    expect(anthropic?.runCount).toBe(1);
  });

  it("returns empty array for date with no runs", () => {
    expect(getDailyCostBreakdown("2020-01-01")).toEqual([]);
  });

  it("throws for invalid date format", () => {
    expect(() => getDailyCostBreakdown("2026-01")).toThrow("date must be YYYY-MM-DD");
  });

  it("throws for impossible calendar dates", () => {
    expect(() => getDailyCostBreakdown("2026-13-01")).toThrow("not a valid calendar date");
  });
});
