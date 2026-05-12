/**
 * Unit tests for crawl_state CRUD (ADR-0030 INV-0030-5).
 * INFRA-1B.2b.
 *
 * Uses an in-memory SQLite database isolated per test via SQLITE_PATH=:memory:
 * and module-level connection reset via closeDb().
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";

// We need to swap the getDb() singleton to an in-memory DB for each test.
// The cleanest approach: set SQLITE_PATH=:memory: and reset the connection.

// Save original value so we can restore it in afterAll and avoid leaking
// the override into other test suites that run after this file.
const _origSqlitePath = process.env["SQLITE_PATH"];

// Patch env before importing crawl-state so getDb() uses :memory:.
process.env["SQLITE_PATH"] = ":memory:";

import { closeDb } from "../../src/storage/sqlite/connection";
import {
  getEligibleSources,
  getCrawlState,
  recordFetchOutcome,
  type FetchOutcome,
} from "../../src/discovery/scheduler/crawl-state";

function setupDb() {
  // Close any existing connection so the next getDb() call opens a fresh :memory: DB.
  closeDb();

  // Import getDb after close to get a fresh instance.
  const { getDb } = require("../../src/storage/sqlite/connection");
  const db: Database = getDb();

  // Minimal schema for tests: schema_migrations + crawl_state.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT NOT NULL PRIMARY KEY,
      applied_at  TEXT NOT NULL DEFAULT (datetime('now')),
      description TEXT
    );
    CREATE TABLE IF NOT EXISTS crawl_state (
      source_id             TEXT    NOT NULL PRIMARY KEY,
      last_polled_at        TEXT,
      last_etag             TEXT,
      last_modified_header  TEXT,
      last_status           TEXT    NOT NULL DEFAULT 'pending',
      consecutive_failures  INTEGER NOT NULL DEFAULT 0,
      next_eligible_at      TEXT
    );
  `);
}

beforeAll(() => {
  // SQLITE_PATH is already set at module load time; nothing additional needed.
});

afterAll(() => {
  // Restore SQLITE_PATH to its original value so subsequent test files are not
  // affected by the :memory: override.
  if (_origSqlitePath === undefined) {
    delete process.env["SQLITE_PATH"];
  } else {
    process.env["SQLITE_PATH"] = _origSqlitePath;
  }
  closeDb();
});

beforeEach(() => {
  setupDb();
});

afterEach(() => {
  closeDb();
});

// ---------------------------------------------------------------------------
// getCrawlState
// ---------------------------------------------------------------------------

describe("getCrawlState", () => {
  it("returns null for unknown source", () => {
    expect(getCrawlState("unknown-source")).toBeNull();
  });

  it("returns existing crawl state after recordFetchOutcome", () => {
    recordFetchOutcome("src-1", { status: "ok", etag: `"abc"`, lastModified: "Thu, 01 Jan 2026 00:00:00 GMT" });
    const state = getCrawlState("src-1");
    expect(state).not.toBeNull();
    expect(state!.source_id).toBe("src-1");
    expect(state!.last_status).toBe("ok");
    expect(state!.last_etag).toBe(`"abc"`);
    expect(state!.last_modified_header).toBe("Thu, 01 Jan 2026 00:00:00 GMT");
    expect(state!.consecutive_failures).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// recordFetchOutcome — status tracking
// ---------------------------------------------------------------------------

describe("recordFetchOutcome — ok/not_modified", () => {
  it("stores ok status and resets consecutive_failures", () => {
    // prime with two errors first
    recordFetchOutcome("src-ok", { status: "error" });
    recordFetchOutcome("src-ok", { status: "error" });
    recordFetchOutcome("src-ok", { status: "ok", etag: `"v1"` });
    const state = getCrawlState("src-ok")!;
    expect(state.last_status).toBe("ok");
    expect(state.consecutive_failures).toBe(0);
    expect(state.next_eligible_at).toBeNull();
  });

  it("stores not_modified status and resets consecutive_failures", () => {
    recordFetchOutcome("src-nm", { status: "error" });
    recordFetchOutcome("src-nm", { status: "not_modified" });
    const state = getCrawlState("src-nm")!;
    expect(state.last_status).toBe("not_modified");
    expect(state.consecutive_failures).toBe(0);
  });
});

describe("recordFetchOutcome — validator preservation", () => {
  it("preserves last_etag across error outcomes", () => {
    recordFetchOutcome("etag-src", { status: "ok", etag: `"abc"` });
    expect(getCrawlState("etag-src")!.last_etag).toBe(`"abc"`);
    recordFetchOutcome("etag-src", { status: "error" });
    // Etag must survive the error — COALESCE keeps prior value
    expect(getCrawlState("etag-src")!.last_etag).toBe(`"abc"`);
  });

  it("preserves last_modified_header across timeout outcomes", () => {
    const mod = "Thu, 01 Jan 2026 00:00:00 GMT";
    recordFetchOutcome("lm-src", { status: "ok", lastModified: mod });
    expect(getCrawlState("lm-src")!.last_modified_header).toBe(mod);
    recordFetchOutcome("lm-src", { status: "timeout" });
    expect(getCrawlState("lm-src")!.last_modified_header).toBe(mod);
  });

  it("updates etag when a new value is provided", () => {
    recordFetchOutcome("update-etag-src", { status: "ok", etag: `"v1"` });
    recordFetchOutcome("update-etag-src", { status: "ok", etag: `"v2"` });
    expect(getCrawlState("update-etag-src")!.last_etag).toBe(`"v2"`);
  });
});

describe("recordFetchOutcome — error/timeout increments failures", () => {
  it("increments consecutive_failures on error", () => {
    recordFetchOutcome("src-err", { status: "error" });
    expect(getCrawlState("src-err")!.consecutive_failures).toBe(1);
    recordFetchOutcome("src-err", { status: "error" });
    expect(getCrawlState("src-err")!.consecutive_failures).toBe(2);
  });

  it("increments consecutive_failures on timeout", () => {
    recordFetchOutcome("src-to", { status: "timeout" });
    expect(getCrawlState("src-to")!.consecutive_failures).toBe(1);
  });

  it("sets next_eligible_at after 5 consecutive failures", () => {
    for (let i = 0; i < 5; i++) {
      recordFetchOutcome("src-backoff", { status: "error" });
    }
    const state = getCrawlState("src-backoff")!;
    expect(state.consecutive_failures).toBe(5);
    expect(state.next_eligible_at).not.toBeNull();
    // Should be ~24h from now
    const eligibleMs = new Date(state.next_eligible_at!).getTime();
    const nowMs = Date.now();
    expect(eligibleMs - nowMs).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(eligibleMs - nowMs).toBeLessThan(25 * 60 * 60 * 1000);
  });

  it("clears next_eligible_at on successful fetch after backoff", () => {
    for (let i = 0; i < 5; i++) {
      recordFetchOutcome("src-recover", { status: "error" });
    }
    expect(getCrawlState("src-recover")!.next_eligible_at).not.toBeNull();
    recordFetchOutcome("src-recover", { status: "ok" });
    expect(getCrawlState("src-recover")!.next_eligible_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getEligibleSources
// ---------------------------------------------------------------------------

describe("getEligibleSources", () => {
  it("returns empty array for empty input", () => {
    expect(getEligibleSources([])).toEqual([]);
  });

  it("includes sources that exist in crawl_state with NULL next_eligible_at", () => {
    // A source with a prior ok outcome has next_eligible_at = null and is eligible.
    recordFetchOutcome("fresh-src", { status: "ok" });
    const eligible = getEligibleSources(["fresh-src"]);
    expect(eligible.map((s) => s.source_id)).toContain("fresh-src");
  });

  it("includes brand-new sources with no crawl_state row at all", () => {
    // A source that has never been polled (no row in crawl_state) must be returned
    // as eligible so first-time sources are not silently skipped.
    const eligible = getEligibleSources(["never-seen-src"]);
    expect(eligible.map((s) => s.source_id)).toContain("never-seen-src");
    // The synthesised record must reflect initial state.
    const rec = eligible.find((s) => s.source_id === "never-seen-src")!;
    expect(rec.last_polled_at).toBeNull();
    expect(rec.last_etag).toBeNull();
    expect(rec.consecutive_failures).toBe(0);
    expect(rec.next_eligible_at).toBeNull();
  });

  it("excludes sources with next_eligible_at in the future", () => {
    for (let i = 0; i < 5; i++) {
      recordFetchOutcome("backed-off-src", { status: "error" });
    }
    const state = getCrawlState("backed-off-src")!;
    expect(state.next_eligible_at).not.toBeNull(); // backoff set

    const eligible = getEligibleSources(["backed-off-src"]);
    expect(eligible.map((s) => s.source_id)).not.toContain("backed-off-src");
  });

  it("includes sources with next_eligible_at in the past", () => {
    // Manually insert a row with a past next_eligible_at.
    const { getDb } = require("../../src/storage/sqlite/connection");
    const db: Database = getDb();
    const past = new Date(Date.now() - 1000).toISOString();
    db.prepare(
      `INSERT INTO crawl_state (source_id, last_status, consecutive_failures, next_eligible_at)
       VALUES (?, 'error', 5, ?)`
    ).run("past-eligible-src", past);

    const eligible = getEligibleSources(["past-eligible-src"]);
    expect(eligible.map((s) => s.source_id)).toContain("past-eligible-src");
  });

  it("only returns requested source IDs from the provided list", () => {
    recordFetchOutcome("wanted-src", { status: "ok" });
    recordFetchOutcome("unwanted-src", { status: "ok" });
    const eligible = getEligibleSources(["wanted-src"]);
    expect(eligible.map((s) => s.source_id)).toContain("wanted-src");
    expect(eligible.map((s) => s.source_id)).not.toContain("unwanted-src");
  });
});
