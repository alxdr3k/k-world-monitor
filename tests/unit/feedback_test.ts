/**
 * Unit tests for manual feedback (INFRA-1B.6).
 * Tests: manual-claim-entry.ts (validation + Neo4j mocked),
 *        intervention-review.ts (ignore / manual_claim / temp_text — Neo4j + SQLite mocked).
 * AC-025.
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";

process.env["SQLITE_PATH"] = ":memory:";

// ---------------------------------------------------------------------------
// Mock Neo4j withSession.
// ---------------------------------------------------------------------------

const neo4jRuns: Array<{ query: string; params: Record<string, unknown> }> = [];
let neo4jShouldThrow = false;

mock.module("../../src/storage/neo4j/connection", () => ({
  withSession: async <T>(fn: (session: unknown) => Promise<T>): Promise<T> => {
    // Returns matched=1 for existence-check queries (RETURN count(i) AS matched)
    // so the node-exists guard in resolveIntervention passes in unit tests.
    const mockRun = async (query: string, params: Record<string, unknown>) => {
      if (neo4jShouldThrow) throw new Error("Neo4j error");
      neo4jRuns.push({ query, params });
      if (query.includes("RETURN count(i) AS matched")) {
        return { records: [{ get: (_k: string) => 1 }] };
      }
      return { records: [] };
    };
    const tx = {
      run: mockRun,
      commit: async () => {},
      rollback: async () => {},
    };
    const session = {
      beginTransaction: () => tx,
      run: mockRun,
    };
    return fn(session);
  },
}));

import {
  createManualClaimEntry,
  ManualClaimValidationError,
  type ManualClaimInput,
} from "../../src/pipeline/feedback/manual-claim-entry";
import { reviewIntervention } from "../../src/pipeline/feedback/intervention-review";
import { closeDb } from "../../src/storage/sqlite/connection";

// ---------------------------------------------------------------------------
// SQLite setup for raw_cache_items.
// ---------------------------------------------------------------------------

function setupDb() {
  closeDb();
  const { getDb } = require("../../src/storage/sqlite/connection");
  const db = getDb();
  // Use real v1_schema.sql raw_cache_items columns (codex P1 fix).
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT NOT NULL PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      description TEXT
    );
    CREATE TABLE IF NOT EXISTS research_session (
      session_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS raw_cache_items (
      cache_id     TEXT NOT NULL PRIMARY KEY,
      session_id   TEXT NOT NULL REFERENCES research_session(session_id),
      url          TEXT NOT NULL,
      content_hash TEXT,
      indexed      INTEGER NOT NULL DEFAULT 0,
      embedded     INTEGER NOT NULL DEFAULT 0,
      expires_at   TEXT NOT NULL,
      deleted_at   TEXT
    );
  `);
  // Seed a research_session so FK constraint is satisfied in temp_text tests.
  db.prepare(`INSERT OR IGNORE INTO research_session (session_id, status) VALUES (?, 'active')`)
    .run("sess_TMP");
  return db;
}

beforeEach(() => {
  neo4jRuns.length = 0;
  neo4jShouldThrow = false;
  setupDb();
});

// ---------------------------------------------------------------------------
// createManualClaimEntry — validation (INV-0018-1/2).
// ---------------------------------------------------------------------------

function baseInput(): ManualClaimInput {
  return {
    sessionId: "sess_TEST",
    sourceId: "src_TEST",
    url: "https://example.com/article",
    sourceAccessedAt: "2026-01-01T12:00:00.000Z",
    sourceAccessedVia: "manual_browser",
    selfAssessedConfidence: 0.8,
    userWrittenClaim: "The inflation rate is rising.",
  };
}

describe("createManualClaimEntry — 3-way validation (INV-0018-1)", () => {
  it("accepts user_written_claim alone", async () => {
    const result = await createManualClaimEntry(baseInput());
    expect(result.kind).toBe("user_written_claim");
    expect(result.manualClaimId).toMatch(/^mcl_/);
  });

  it("accepts user_opinion alone", async () => {
    const input = { ...baseInput(), userWrittenClaim: undefined, userOpinion: "This seems risky." };
    const result = await createManualClaimEntry(input);
    expect(result.kind).toBe("user_opinion");
  });

  it("accepts referenced_quote with quoteReason + attribution", async () => {
    const input: ManualClaimInput = {
      ...baseInput(),
      userWrittenClaim: undefined,
      referencedQuote: '"Inflation reached 5.2%" — BoK report',
      quoteReason: "direct_publication_quote",
      attribution: { url: "https://bok.or.kr/report", publisher: "Bank of Korea" },
    };
    const result = await createManualClaimEntry(input);
    expect(result.kind).toBe("referenced_quote");
  });

  it("rejects when none of the 3 fields provided", async () => {
    const input = { ...baseInput(), userWrittenClaim: undefined };
    await expect(createManualClaimEntry(input)).rejects.toThrow(ManualClaimValidationError);
    await expect(createManualClaimEntry(input)).rejects.toThrow("Exactly one");
  });

  it("rejects when multiple fields provided", async () => {
    const input = { ...baseInput(), userOpinion: "My opinion too." };
    await expect(createManualClaimEntry(input)).rejects.toThrow(ManualClaimValidationError);
  });

  it("rejects referenced_quote without quoteReason", async () => {
    const input: ManualClaimInput = {
      ...baseInput(),
      userWrittenClaim: undefined,
      referencedQuote: "Some quote",
      attribution: { url: "https://example.com" },
    };
    await expect(createManualClaimEntry(input)).rejects.toThrow("quoteReason is required");
  });

  it("rejects referenced_quote without attribution.url", async () => {
    const input: ManualClaimInput = {
      ...baseInput(),
      userWrittenClaim: undefined,
      referencedQuote: "Some quote",
      quoteReason: "exact_wording_matters",
    };
    await expect(createManualClaimEntry(input)).rejects.toThrow("attribution.url is required");
  });

  it("rejects empty string as a set field (INV-0018-1 — empty string bypass)", async () => {
    // Empty string must not count as "set"; this would previously pass filter(Boolean)
    // and leave the non-empty field as the only one, but empty string paired with another
    // set field must still be caught as multiple or rejected as none.
    const inputNone = { ...baseInput(), userWrittenClaim: "" };
    await expect(createManualClaimEntry(inputNone)).rejects.toThrow(ManualClaimValidationError);
    await expect(createManualClaimEntry(inputNone)).rejects.toThrow("Exactly one");
  });

  it("rejects invalid selfAssessedConfidence on referenced_quote path (INV-0018-6)", async () => {
    const input: ManualClaimInput = {
      ...baseInput(),
      userWrittenClaim: undefined,
      referencedQuote: "Some quote",
      quoteReason: "exact_wording_matters",
      attribution: { url: "https://example.com" },
      selfAssessedConfidence: -0.5,  // invalid
    };
    await expect(createManualClaimEntry(input)).rejects.toThrow(ManualClaimValidationError);
    await expect(createManualClaimEntry(input)).rejects.toThrow("selfAssessedConfidence");
  });

  it("rejects NaN selfAssessedConfidence (INV-0018-6)", async () => {
    const input = { ...baseInput(), selfAssessedConfidence: NaN };
    await expect(createManualClaimEntry(input)).rejects.toThrow("selfAssessedConfidence");
  });
});

describe("createManualClaimEntry — Neo4j write", () => {
  it("always writes raw_text_stored=false (INV-0018-3)", async () => {
    await createManualClaimEntry(baseInput());
    const createQ = neo4jRuns.find((r) => r.query.includes("CREATE (m:ManualClaimEntry"))!;
    expect(createQ.query).toContain("raw_text_stored:         false");
  });

  it("stores attribution as JSON string", async () => {
    const input: ManualClaimInput = {
      ...baseInput(),
      userWrittenClaim: undefined,
      referencedQuote: "Quote text",
      quoteReason: "policy_language_analysis",
      attribution: { url: "https://example.com/policy", publisher: "Ministry" },
    };
    await createManualClaimEntry(input);
    const createQ = neo4jRuns.find((r) => r.query.includes("CREATE (m:ManualClaimEntry"))!;
    const attr = JSON.parse(createQ.params["attributionJson"] as string);
    expect(attr.url).toBe("https://example.com/policy");
    expect(attr.publisher).toBe("Ministry");
  });

  it("stores null for the two unfilled 3-way fields", async () => {
    await createManualClaimEntry(baseInput());
    const createQ = neo4jRuns.find((r) => r.query.includes("CREATE (m:ManualClaimEntry"))!;
    expect(createQ.params["userOpinion"]).toBeNull();
    expect(createQ.params["referencedQuote"]).toBeNull();
  });

  it("propagates Neo4j error and rolls back", async () => {
    neo4jShouldThrow = true;
    await expect(createManualClaimEntry(baseInput())).rejects.toThrow("Neo4j error");
  });

  it("creates :RESOLVES edge when interventionId is provided (ADR-0018)", async () => {
    const input = { ...baseInput(), interventionId: "aci_LINK001" };
    await createManualClaimEntry(input);
    const resolveQ = neo4jRuns.find((r) => r.query.includes("[:RESOLVES]->"));
    expect(resolveQ).toBeTruthy();
    expect(resolveQ!.params["interventionId"]).toBe("aci_LINK001");
  });

  it("does NOT create :RESOLVES edge when interventionId is absent", async () => {
    await createManualClaimEntry(baseInput()); // no interventionId
    const resolveQ = neo4jRuns.find((r) => r.query.includes("[:RESOLVES]->"));
    expect(resolveQ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// reviewIntervention — 3-option actions.
// ---------------------------------------------------------------------------

describe("reviewIntervention — ignore", () => {
  it("marks status=resolved_ignore and returns correct action", async () => {
    const result = await reviewIntervention("aci_TEST001", "ignore");
    expect(result.action).toBe("ignore");
    expect(result.interventionId).toBe("aci_TEST001");
    expect(result.resolvedAt).toBeTruthy();

    const updateQ = neo4jRuns.find((r) => r.params["status"] === "resolved_ignore")!;
    expect(updateQ).toBeTruthy();
    expect(updateQ.params["interventionId"]).toBe("aci_TEST001");
  });

  it("passes negative importance adjustment for ignore", async () => {
    await reviewIntervention("aci_TEST002", "ignore");
    const updateQ = neo4jRuns.find((r) => r.params["status"] === "resolved_ignore")!;
    expect(updateQ.params["adjust"]).toBe(-0.2);
  });
});

describe("reviewIntervention — manual_claim", () => {
  it("creates ManualClaimEntry and marks resolved_manual_claim", async () => {
    const result = await reviewIntervention("aci_TEST003", "manual_claim", {
      manualClaimInput: baseInput(),
    });
    expect(result.action).toBe("manual_claim");
    expect(result.manualClaimRecord?.kind).toBe("user_written_claim");
    expect(result.manualClaimRecord?.manualClaimId).toMatch(/^mcl_/);

    const resolveQ = neo4jRuns.find((r) => r.params["status"] === "resolved_manual_claim")!;
    expect(resolveQ).toBeTruthy();
  });

  it("throws when manualClaimInput is missing", async () => {
    await expect(
      reviewIntervention("aci_TEST004", "manual_claim")
    ).rejects.toThrow("manualClaimInput is required");
  });
});

describe("reviewIntervention — temp_text", () => {
  it("registers URL in raw_cache_items and marks resolved_temp_text", async () => {
    const result = await reviewIntervention("aci_TEST005", "temp_text", {
      interventionUrl: "https://example.com/blocked-article",
      sessionId: "sess_TMP",
    });
    expect(result.action).toBe("temp_text");
    expect(result.rawCacheItemId).toMatch(/^rcache_/);

    const resolveQ = neo4jRuns.find((r) => r.params["status"] === "resolved_temp_text")!;
    expect(resolveQ).toBeTruthy();

    // Verify SQLite row uses real v1 schema columns (no raw text stored — INV-0018-3).
    const { getDb } = require("../../src/storage/sqlite/connection");
    const row = getDb()
      .prepare("SELECT * FROM raw_cache_items WHERE cache_id = ?")
      .get(result.rawCacheItemId) as Record<string, unknown> | null;
    expect(row).toBeTruthy();
    expect(row!["url"]).toBe("https://example.com/blocked-article");
    expect(row!["session_id"]).toBe("sess_TMP");
    expect(row!["indexed"]).toBe(0);
    expect(row!["embedded"]).toBe(0);
  });

  it("throws when interventionUrl is missing", async () => {
    await expect(
      reviewIntervention("aci_TEST006", "temp_text", { sessionId: "sess_TMP" })
    ).rejects.toThrow("interventionUrl is required");
  });

  it("throws when sessionId is missing", async () => {
    await expect(
      reviewIntervention("aci_TEST007", "temp_text", {
        interventionUrl: "https://example.com/blocked",
      })
    ).rejects.toThrow("sessionId is required");
  });
});

describe("reviewIntervention — unknown action guard", () => {
  it("throws for unknown action values instead of falling through", async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      reviewIntervention("aci_TEST008", "bad_action" as ReviewAction)
    ).rejects.toThrow("unknown action");
  });
});

// Import type for the cast above.
import type { ReviewAction } from "../../src/pipeline/feedback/intervention-review";
