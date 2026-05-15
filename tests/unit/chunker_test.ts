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
  ChunkRejected,
  type TextChunk,
  type ChunkInput,
} from "../../src/discovery/worker/chunker";

// AI-P1-1 (INFRA-1B.4.h1-chunker-policy-gate): chunkSnapshot now requires
// sourceId + archivePolicy. Most existing tests exercise the
// `full_snapshot_allowed` path — wrap the base input shape here so every
// call site needs minimal edits and the test bodies stay focused on what
// they're asserting (Neo4j tx behavior, stale-chunk cleanup, etc.).
function baseInput(
  overrides: Partial<ChunkInput> & Pick<ChunkInput, "snapId" | "text">
): ChunkInput {
  return {
    sourceId: "src_TEST",
    archivePolicy: "full_snapshot_allowed",
    ...overrides,
  };
}

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
  // AI-P1-1 (INFRA-1B.4.h1-chunker-policy-gate): the previous contract
  // (empty text → chunkCount=0 + stale cleanup wipes prior chunks) was
  // changed because a transient empty re-extraction must not destroy a
  // prior successful run's chunks. Empty text now throws ChunkRejected
  // BEFORE the Neo4j tx is opened.
  it("throws ChunkRejected('empty_text') for empty text + does NOT touch Neo4j (prior chunks preserved)", async () => {
    resetNeo4jState();
    let caught: unknown;
    try {
      await chunkSnapshot(baseInput({ snapId: "snap_TEST001", text: "" }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ChunkRejected);
    expect((caught as ChunkRejected).reason).toBe("empty_text");
    expect((caught as ChunkRejected).snapId).toBe("snap_TEST001");
    // No guard query, no cleanup, no Chunk MERGE — gate fires fast.
    expect(neo4jRuns).toHaveLength(0);
  });

  it("throws ChunkRejected('empty_text') BEFORE Snapshot guard (Snapshot existence irrelevant on empty)", async () => {
    resetNeo4jState();
    snapshotMissing = true;
    try {
      let caught: unknown;
      try {
        await chunkSnapshot(baseInput({ snapId: "snap_EMPTYNOTEXIST", text: "" }));
      } catch (err) {
        caught = err;
      }
      // Empty-text rejection now fires BEFORE the snapshot guard would run,
      // so the error is ChunkRejected (not "Snapshot not found").
      expect(caught).toBeInstanceOf(ChunkRejected);
      expect((caught as ChunkRejected).reason).toBe("empty_text");
    } finally {
      snapshotMissing = false;
    }
  });

  it("writes CREATE Chunk + HAS_CHUNK for each chunk", async () => {
    resetNeo4jState();
    const words = Array.from({ length: 10 }, (_, i) => `word${i}`);
    const result = await chunkSnapshot(baseInput({
      snapId: "snap_TEST002",
      text: words.join(" "),
    }));
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
    const result = await chunkSnapshot(baseInput({
      snapId: "snap_TEST003",
      text: words.join(" "),
    }));
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
    const result = await chunkSnapshot(baseInput({
      snapId: "snap_MYSNAP",
      text: "some text to chunk",
    }));
    expect(result.snapId).toBe("snap_MYSNAP");
  });

  it("propagates Neo4j errors", async () => {
    txShouldThrow = true;
    try {
      await expect(
        chunkSnapshot(baseInput({ snapId: "snap_ERR001", text: "some text" }))
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
        chunkSnapshot(baseInput({ snapId: "snap_NOTEXIST", text: "some text to chunk" }))
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
    await chunkSnapshot(baseInput({
      snapId: "snap_IDEM001",
      text: "idempotent text check",
    }));
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
    await chunkSnapshot(baseInput({
      snapId: "snap_IDEM002",
      text: "some text for relationship test",
    }));
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
    await chunkSnapshot(baseInput({ snapId: "snap_STALE01", text: words.join(" ") }));
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

    const result = await chunkSnapshot(baseInput({ snapId: "snap_COMMIT01", text: "commit test" }));

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
      await chunkSnapshot(baseInput({ snapId: "snap_COMMITFAIL", text: "commit fail test" }));
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("simulated commit failure");
    expect(neo4j.tx.commitCount).toBe(1);
    expect(neo4j.tx.rollbackCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AI-P1-1 (INFRA-1B.4.h1-chunker-policy-gate, Q-053 D2 / DEC-024 D2):
// archive_policy enforcement at chunkSnapshot entry. Each rejecting policy
// must throw ChunkRejected BEFORE any Neo4j tx is opened so prior chunks
// are preserved (no DETACH DELETE fired).
// ---------------------------------------------------------------------------

describe("chunkSnapshot — archive_policy gate (AI-P1-1)", () => {
  it("rejects metadata_only — throws ChunkRejected + no Neo4j tx opened", async () => {
    resetNeo4jState();
    let caught: unknown;
    try {
      await chunkSnapshot({
        snapId: "snap_META",
        sourceId: "src_META",
        archivePolicy: "metadata_only",
        text: "this text has full content but the policy forbids chunking",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ChunkRejected);
    const err = caught as ChunkRejected;
    expect(err.reason).toBe("metadata_only");
    expect(err.snapId).toBe("snap_META");
    expect(err.sourceId).toBe("src_META");
    expect(err.message).toContain("snap_id=snap_META");
    expect(err.message).toContain("source_id=src_META");
    expect(err.message).toContain("reason=metadata_only");
    // No Neo4j tx — no guard, no cleanup, no MERGE.
    expect(neo4jRuns).toHaveLength(0);
    expect(neo4j.tx.commitCount).toBe(0);
    expect(neo4j.tx.rollbackCount).toBe(0);
  });

  it("rejects excerpt_only — throws ChunkRejected + no Neo4j tx opened (full-text chunking forbidden, excerpt-limited 미설계)", async () => {
    resetNeo4jState();
    let caught: unknown;
    try {
      await chunkSnapshot({
        snapId: "snap_EXCERPT",
        sourceId: "src_EXCERPT",
        archivePolicy: "excerpt_only",
        text: "full body text — but policy only allows excerpt-level quoting",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ChunkRejected);
    expect((caught as ChunkRejected).reason).toBe("excerpt_only");
    expect(neo4jRuns).toHaveLength(0);
  });

  it("rejects do_not_collect — throws ChunkRejected + no Neo4j tx opened (source-wide collection prohibition)", async () => {
    resetNeo4jState();
    let caught: unknown;
    try {
      await chunkSnapshot({
        snapId: "snap_DNC",
        sourceId: "src_DNC",
        archivePolicy: "do_not_collect",
        text: "this should have been blocked upstream but defense in depth",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ChunkRejected);
    expect((caught as ChunkRejected).reason).toBe("do_not_collect");
    expect(neo4jRuns).toHaveLength(0);
  });

  it("allows full_snapshot_allowed — proceeds to chunk creation", async () => {
    resetNeo4jState();
    const result = await chunkSnapshot({
      snapId: "snap_ALLOW",
      sourceId: "src_ALLOW",
      archivePolicy: "full_snapshot_allowed",
      text: "this body is allowed full chunking under the source policy",
    });
    expect(result.chunkCount).toBeGreaterThanOrEqual(1);
    expect(result.chunkIds[0]).toMatch(/^chk_/);
    // Tx opened + commit + chunk MERGE executed.
    expect(neo4j.tx.commitCount).toBe(1);
    const chunkCreates = neo4jRuns.filter((r) => r.query.includes("MERGE (c:Chunk"));
    expect(chunkCreates.length).toBeGreaterThanOrEqual(1);
  });

  it("policy reject does NOT trigger stale-chunk cleanup — prior chunks preserved", async () => {
    // Critical: a source that gets re-policied (e.g. operator tightens
    // archive_policy from full_snapshot_allowed → metadata_only after a
    // clean extraction) must not silently wipe the prior chunks via the
    // empty-result DETACH DELETE path. Gate fires BEFORE writeChunks().
    resetNeo4jState();
    await expect(
      chunkSnapshot({
        snapId: "snap_PRESERVE",
        sourceId: "src_PRESERVE",
        archivePolicy: "metadata_only",
        text: "some text",
      })
    ).rejects.toThrow(ChunkRejected);
    // The crucial assertion: no DETACH DELETE … chunk_index >= 0 query.
    const deleteQueries = neo4jRuns.filter(
      (r) => r.query.includes("DETACH DELETE") && r.query.includes("chunk_index")
    );
    expect(deleteQueries).toHaveLength(0);
  });

  it("empty text reject does NOT trigger stale-chunk cleanup — prior chunks preserved (action-items 'empty text 가 chunk 삭제 안 하게')", async () => {
    resetNeo4jState();
    // Three empty / whitespace variants — all must reject + preserve.
    for (const text of ["", "   ", "\n\t  \n"]) {
      await expect(
        chunkSnapshot({
          snapId: "snap_EMPTY_PRESERVE",
          sourceId: "src_EMPTY_PRESERVE",
          archivePolicy: "full_snapshot_allowed",
          text,
        })
      ).rejects.toThrow(ChunkRejected);
    }
    // No DETACH DELETE was ever issued — prior chunks intact.
    const deleteQueries = neo4jRuns.filter(
      (r) => r.query.includes("DETACH DELETE") && r.query.includes("chunk_index")
    );
    expect(deleteQueries).toHaveLength(0);
  });

  it("policy gate fires BEFORE empty-text check — metadata_only with empty text reports metadata_only reason", async () => {
    // Layering order matters: a policy reject is more semantically specific
    // than the empty-text guard, so the policy reason wins. This makes
    // operator alerts attribute the rejection to the policy (correctable
    // via source_material_policy update) rather than misleading them into
    // chasing an extraction bug.
    resetNeo4jState();
    let caught: unknown;
    try {
      await chunkSnapshot({
        snapId: "snap_BOTH",
        sourceId: "src_BOTH",
        archivePolicy: "metadata_only",
        text: "", // empty AND policy-rejected
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ChunkRejected);
    expect((caught as ChunkRejected).reason).toBe("metadata_only");
  });
});
