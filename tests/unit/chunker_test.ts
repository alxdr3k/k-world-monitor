/**
 * Unit tests for chunker (INFRA-1B.4).
 * Neo4j is mocked via the shared test-helpers/neo4j-mock builder.
 */

import { describe, it, expect, mock } from "bun:test";
import { createNeo4jMock, ok } from "../test-helpers/neo4j-mock";

// ---------------------------------------------------------------------------
// Shared Neo4j mock — one controller for the whole file, reset between tests
// where the test sets up new handlers. `chunker_test` exercises only the tx
// path (no session.run), so we only register tx handlers.
// ---------------------------------------------------------------------------

const neo4j = createNeo4jMock();
let snapshotMissing = false;
let txShouldThrow = false;

// Source-of-truth handlers. Tests can toggle the closures above to alter
// behavior without re-registering handlers.
neo4j.tx.on(/RETURN count\(s\) AS matched/, () => {
  if (txShouldThrow) throw new Error("Neo4j write failed");
  return ok({ matched: snapshotMissing ? 0 : 1 });
});
neo4j.tx.on(/MERGE \(c:Chunk/, ({ params }) => {
  if (txShouldThrow) throw new Error("Neo4j write failed");
  return ok({ resolvedId: params["chunkId"] });
});
neo4j.tx.on(/RETURN count\(s\) AS linked/, () => {
  if (txShouldThrow) throw new Error("Neo4j write failed");
  return ok({ linked: 1 });
});
// Catch-all that records the query (via dispatch returning none()) while
// honoring the global throw flag.
neo4j.tx.on(/.*/, () => {
  if (txShouldThrow) throw new Error("Neo4j write failed");
  return { records: [] };
});

mock.module("../../src/storage/neo4j/connection", () => neo4j.module);

// Backwards-compatible aliases so the existing test bodies need minimal edits.
const neo4jRuns = neo4j.runs as ReadonlyArray<{ query: string; params: Record<string, unknown> }>;
function resetNeo4jState() {
  neo4j.reset();
  snapshotMissing = false;
  txShouldThrow = false;
  // Re-register handlers since reset() cleared them.
  neo4j.tx.on(/RETURN count\(s\) AS matched/, () => {
    if (txShouldThrow) throw new Error("Neo4j write failed");
    return ok({ matched: snapshotMissing ? 0 : 1 });
  });
  neo4j.tx.on(/MERGE \(c:Chunk/, ({ params }) => {
    if (txShouldThrow) throw new Error("Neo4j write failed");
    return ok({ resolvedId: params["chunkId"] });
  });
  neo4j.tx.on(/RETURN count\(s\) AS linked/, () => {
    if (txShouldThrow) throw new Error("Neo4j write failed");
    return ok({ linked: 1 });
  });
  neo4j.tx.on(/.*/, () => {
    if (txShouldThrow) throw new Error("Neo4j write failed");
    return { records: [] };
  });
}

import {
  splitIntoChunks,
  chunkSnapshot,
  type TextChunk,
} from "../../src/discovery/worker/chunker";

// ---------------------------------------------------------------------------
// splitIntoChunks — pure function tests (no mocks needed).
// ---------------------------------------------------------------------------

describe("splitIntoChunks — basic splitting", () => {
  it("returns empty array for empty string", () => {
    expect(splitIntoChunks("")).toHaveLength(0);
    expect(splitIntoChunks("   ")).toHaveLength(0);
  });

  it("returns single chunk for text shorter than CHUNK_WORDS", () => {
    const text = "Hello world this is a short text.";
    const chunks = splitIntoChunks(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.chunkIndex).toBe(0);
    expect(chunks[0]!.text).toBe("Hello world this is a short text.");
    expect(chunks[0]!.charStart).toBe(0);
  });

  it("produces overlapping chunks for long text", () => {
    // Generate 600 unique words
    const words = Array.from({ length: 600 }, (_, i) => `word${i}`);
    const text = words.join(" ");
    const chunks = splitIntoChunks(text);

    // 600 words, chunk=500, overlap=50 → first chunk covers 0-499, second 450-599
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]!.chunkIndex).toBe(0);
    expect(chunks[1]!.chunkIndex).toBe(1);

    // Second chunk starts 450 words in (500 - 50 overlap)
    expect(chunks[1]!.text).toContain("word450");
  });

  it("charStart/charEnd correctly slice the original text", () => {
    const text = "alpha beta gamma delta";
    const chunks = splitIntoChunks(text);
    expect(chunks).toHaveLength(1);
    const c = chunks[0]!;
    expect(text.slice(c.charStart, c.charEnd)).toBe(c.text);
  });

  it("charStart/charEnd are correct for multi-chunk text", () => {
    const words = Array.from({ length: 600 }, (_, i) => `w${i}`);
    const text = words.join(" ");
    const chunks = splitIntoChunks(text);
    for (const c of chunks) {
      expect(text.slice(c.charStart, c.charEnd)).toBe(c.text);
    }
  });

  it("handles text with irregular whitespace", () => {
    const text = "  word1   word2\n\nword3\tword4  ";
    const chunks = splitIntoChunks(text);
    expect(chunks).toHaveLength(1);
    // Words should be present
    expect(chunks[0]!.text).toContain("word1");
    expect(chunks[0]!.text).toContain("word4");
    // charStart/charEnd must round-trip against the ORIGINAL text (not trimmed).
    const c = chunks[0]!;
    expect(text.slice(c.charStart, c.charEnd)).toBe(c.text);
  });

  it("charStart is correct when text has leading whitespace", () => {
    // This specifically guards against the trim()-offset bug:
    // if the implementation trims first and returns offsets into the trimmed
    // string, text.slice(charStart, charEnd) would be wrong.
    const text = "   hello world";
    const chunks = splitIntoChunks(text);
    expect(chunks).toHaveLength(1);
    const c = chunks[0]!;
    expect(c.charStart).toBe(3); // "hello" starts at index 3 in original
    expect(text.slice(c.charStart, c.charEnd)).toBe(c.text);
  });

  it("produces exactly 1 chunk for text of exactly CHUNK_WORDS words", () => {
    const words = Array.from({ length: 500 }, (_, i) => `w${i}`);
    expect(splitIntoChunks(words.join(" "))).toHaveLength(1);
  });

  it("produces 2 chunks for 501-word text", () => {
    const words = Array.from({ length: 501 }, (_, i) => `w${i}`);
    expect(splitIntoChunks(words.join(" "))).toHaveLength(2);
  });

  it("consecutive chunks overlap by OVERLAP_WORDS words", () => {
    const words = Array.from({ length: 600 }, (_, i) => `tok${i}`);
    const text = words.join(" ");
    const chunks = splitIntoChunks(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    // The last 50 words of chunk 0 should appear at the start of chunk 1.
    const chunk0Words = chunks[0]!.text.split(/\s+/);
    const chunk1Words = chunks[1]!.text.split(/\s+/);
    const overlapWord = chunk0Words[chunk0Words.length - 50]!;
    expect(chunk1Words[0]).toBe(overlapWord);
  });
});

// ---------------------------------------------------------------------------
// chunkSnapshot — Neo4j integration (mocked).
// ---------------------------------------------------------------------------

describe("chunkSnapshot", () => {
  it("returns chunkCount=0 and empty chunkIds for empty text, but still runs guard + stale cleanup", async () => {
    resetNeo4jState();
    const result = await chunkSnapshot({ snapId: "snap_TEST001", text: "" });
    expect(result.chunkCount).toBe(0);
    expect(result.chunkIds).toHaveLength(0);
    // Guard query must still run even for empty text (no silent success for invalid snapIds).
    const guardQueries = neo4jRuns.filter((r) => r.query.includes("RETURN count(s) AS matched"));
    expect(guardQueries).toHaveLength(1);
    // Stale-chunk cleanup must also run with chunkCount=0 so prior chunks are deleted.
    const cleanupQueries = neo4jRuns.filter(
      (r) => r.query.includes("DETACH DELETE") && r.query.includes("chunk_index")
    );
    expect(cleanupQueries).toHaveLength(1);
    expect(cleanupQueries[0]!.params["chunkCount"]).toBe(0);
    // No Chunk MERGE or HAS_CHUNK writes.
    const chunkCreates = neo4jRuns.filter((r) => r.query.includes("MERGE (c:Chunk"));
    expect(chunkCreates).toHaveLength(0);
  });

  it("throws when Snapshot not found even for empty text (orphan guard not bypassed)", async () => {
    resetNeo4jState();
    snapshotMissing = true;
    try {
      await expect(
        chunkSnapshot({ snapId: "snap_EMPTYNOTEXIST", text: "" })
      ).rejects.toThrow("Snapshot not found: snap_EMPTYNOTEXIST");
    } finally {
      snapshotMissing = false;
    }
  });

  it("writes CREATE Chunk + HAS_CHUNK for each chunk", async () => {
    resetNeo4jState();
    const words = Array.from({ length: 10 }, (_, i) => `word${i}`);
    const result = await chunkSnapshot({
      snapId: "snap_TEST002",
      text: words.join(" "),
    });
    expect(result.chunkCount).toBe(1);
    expect(result.chunkIds).toHaveLength(1);
    expect(result.chunkIds[0]).toMatch(/^chk_/);

    const mergeQueries = neo4jRuns.filter((r) => r.query.includes("MERGE (c:Chunk"));
    // Filter specifically for the edge-creation query (not the stale-chunk DETACH DELETE).
    const linkQueries = neo4jRuns.filter((r) => r.query.includes("MERGE (s)-[:HAS_CHUNK]->"));
    expect(mergeQueries).toHaveLength(1);
    expect(linkQueries).toHaveLength(1);
  });

  it("stores correct snap_id and chunk_index in the Chunk node params", async () => {
    resetNeo4jState();
    const words = Array.from({ length: 600 }, (_, i) => `w${i}`);
    const result = await chunkSnapshot({
      snapId: "snap_TEST003",
      text: words.join(" "),
    });
    expect(result.chunkCount).toBeGreaterThanOrEqual(2);

    const createParams = neo4jRuns
      .filter((r) => r.query.includes("MERGE (c:Chunk"))
      .map((r) => r.params);

    expect(createParams[0]!["snapId"]).toBe("snap_TEST003");
    expect(createParams[0]!["chunkIndex"]).toBe(0);
    expect(createParams[1]!["chunkIndex"]).toBe(1);
  });

  it("returns snapId matching the input", async () => {
    resetNeo4jState();
    const result = await chunkSnapshot({
      snapId: "snap_MYSNAP",
      text: "some text to chunk",
    });
    expect(result.snapId).toBe("snap_MYSNAP");
  });

  it("propagates Neo4j errors", async () => {
    txShouldThrow = true;
    try {
      await expect(
        chunkSnapshot({ snapId: "snap_ERR001", text: "some text" })
      ).rejects.toThrow("Neo4j write failed");
    } finally {
      txShouldThrow = false;
    }
  });

  it("throws when Snapshot node does not exist (orphan guard)", async () => {
    resetNeo4jState();
    snapshotMissing = true;
    try {
      await expect(
        chunkSnapshot({ snapId: "snap_NOTEXIST", text: "some text to chunk" })
      ).rejects.toThrow("Snapshot not found: snap_NOTEXIST");
      // Only the guard query should have been run — no Chunk CREATE.
      const chunkCreates = neo4jRuns.filter((r) => r.query.includes("MERGE (c:Chunk"));
      expect(chunkCreates).toHaveLength(0);
    } finally {
      snapshotMissing = false;
    }
  });

  it("uses MERGE (not CREATE) for Chunk nodes to support idempotent re-runs", async () => {
    resetNeo4jState();
    await chunkSnapshot({
      snapId: "snap_IDEM001",
      text: "idempotent text check",
    });
    const mergeQueries = neo4jRuns.filter((r) => r.query.includes("MERGE (c:Chunk"));
    expect(mergeQueries.length).toBeGreaterThanOrEqual(1);
    // Ensure no raw CREATE (c:Chunk …) without MERGE prefix.
    const rawCreates = neo4jRuns.filter(
      (r) => r.query.includes("CREATE (c:Chunk") && !r.query.includes("MERGE")
    );
    expect(rawCreates).toHaveLength(0);
  });

  it("uses MERGE for HAS_CHUNK relationship to avoid duplicates on re-run", async () => {
    resetNeo4jState();
    await chunkSnapshot({
      snapId: "snap_IDEM002",
      text: "some text for relationship test",
    });
    // Only the edge-creation queries (not the stale-chunk DETACH DELETE).
    const relQueries = neo4jRuns.filter(
      (r) => r.query.includes("HAS_CHUNK") && !r.query.includes("DETACH DELETE")
    );
    expect(relQueries.length).toBeGreaterThanOrEqual(1);
    // All HAS_CHUNK writes should use MERGE, not CREATE.
    for (const r of relQueries) {
      expect(r.query).toContain("MERGE (s)-[:HAS_CHUNK]->(c)");
    }
  });

  it("runs stale-chunk cleanup in same transaction (P2 stale chunks)", async () => {
    resetNeo4jState();
    const words = Array.from({ length: 10 }, (_, i) => `w${i}`);
    await chunkSnapshot({ snapId: "snap_STALE01", text: words.join(" ") });
    // The cleanup query uses DETACH DELETE with chunk_index >= chunkCount.
    const cleanupQueries = neo4jRuns.filter(
      (r) => r.query.includes("DETACH DELETE") && r.query.includes("chunk_index")
    );
    expect(cleanupQueries).toHaveLength(1);
    expect(cleanupQueries[0]!.params["chunkCount"]).toBe(1); // 10 words = 1 chunk
    expect(cleanupQueries[0]!.params["snapId"]).toBe("snap_STALE01");
  });

  it("does not rollback after commit succeeds (P1 no-double-rollback)", async () => {
    // Happy path: when commit() resolves, the catch handler must NEVER call
    // rollback. The mock tracks both calls so this assertion is grounded in
    // observable behavior (no tautology).
    resetNeo4jState();

    const result = await chunkSnapshot({ snapId: "snap_COMMIT01", text: "commit test" });

    expect(result.chunkCount).toBe(1);
    expect(neo4j.tx.commitCount).toBe(1);
    expect(neo4j.tx.rollbackCount).toBe(0);
    const mergeQ = neo4jRuns.filter((r) => r.query.includes("MERGE (c:Chunk"));
    expect(mergeQ.length).toBeGreaterThanOrEqual(1);
  });

  it("does not call rollback when commit throws (P1 commitAttempted guard)", async () => {
    // Failure path: commit() rejects after the writes have been issued.
    // The chunker sets commitAttempted = true BEFORE awaiting tx.commit(),
    // so the catch handler MUST NOT invoke rollback (which would error from
    // the Neo4j driver). Verify rollback count stays 0 even though commit
    // rejected and the call rethrew.
    resetNeo4jState();
    neo4j.tx.failNextCommit(new Error("simulated commit failure"));

    let caught: unknown;
    try {
      await chunkSnapshot({ snapId: "snap_COMMITFAIL", text: "commit fail test" });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("simulated commit failure");
    expect(neo4j.tx.commitCount).toBe(1);
    expect(neo4j.tx.rollbackCount).toBe(0);
  });
});
