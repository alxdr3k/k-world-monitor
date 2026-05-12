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
    const tx = {
      run: async (query: string, params: Record<string, unknown>) => {
        if (neo4jShouldThrow) throw new Error("Neo4j error");
        neo4jRuns.push({ query, params });
        return { records: [] };
      },
      commit: async () => {},
      rollback: async () => {},
    };
    const session = {
      beginTransaction: () => tx,
      run: async (query: string, params: Record<string, unknown>) => {
        if (neo4jShouldThrow) throw new Error("Neo4j error");
        neo4jRuns.push({ query, params });
        return { records: [] };
      },
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT NOT NULL PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      description TEXT
    );
    CREATE TABLE IF NOT EXISTS raw_cache_items (
      item_id      TEXT NOT NULL PRIMARY KEY,
      session_id   TEXT NOT NULL,
      source_id    TEXT NOT NULL,
      content_type TEXT NOT NULL,
      content_text TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at   TEXT
    );
  `);
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
  it("stores in raw_cache_items and marks resolved_temp_text", async () => {
    const result = await reviewIntervention("aci_TEST005", "temp_text", {
      tempText: "This is a temporary cached text snippet.",
      sessionId: "sess_TMP",
    });
    expect(result.action).toBe("temp_text");
    expect(result.rawCacheItemId).toMatch(/^rcache_/);

    const resolveQ = neo4jRuns.find((r) => r.params["status"] === "resolved_temp_text")!;
    expect(resolveQ).toBeTruthy();

    // Verify SQLite row was written.
    const { getDb } = require("../../src/storage/sqlite/connection");
    const row = getDb()
      .prepare("SELECT * FROM raw_cache_items WHERE item_id = ?")
      .get(result.rawCacheItemId) as Record<string, unknown> | null;
    expect(row?.["content_text"]).toBe("This is a temporary cached text snippet.");
    expect(row?.["content_type"]).toBe("temp_text");
    expect(row?.["session_id"]).toBe("sess_TMP");
  });

  it("throws when tempText is missing", async () => {
    await expect(
      reviewIntervention("aci_TEST006", "temp_text")
    ).rejects.toThrow("tempText is required");
  });
});
