/**
 * Unit tests for chunker (INFRA-1B.4).
 * Neo4j is mocked; no network I/O.
 */

import { describe, it, expect, mock } from "bun:test";

// ---------------------------------------------------------------------------
// Mock Neo4j withSession.
// ---------------------------------------------------------------------------

const neo4jRuns: Array<{ query: string; params: Record<string, unknown> }> = [];
let neo4jShouldThrow = false;

mock.module("../../src/storage/neo4j/connection", () => ({
  withSession: async <T>(fn: (session: unknown) => Promise<T>): Promise<T> => {
    const tx = {
      run: async (query: string, params: Record<string, unknown>) => {
        if (neo4jShouldThrow) throw new Error("Neo4j write failed");
        neo4jRuns.push({ query, params });
        return { records: [] };
      },
      commit: async () => {},
      rollback: async () => {},
    };
    const session = { beginTransaction: () => tx };
    return fn(session);
  },
}));

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
  it("returns chunkCount=0 and empty chunkIds for empty text", async () => {
    neo4jRuns.length = 0;
    const result = await chunkSnapshot({ snapId: "snap_TEST001", text: "" });
    expect(result.chunkCount).toBe(0);
    expect(result.chunkIds).toHaveLength(0);
    // No Neo4j writes for empty text
    expect(neo4jRuns).toHaveLength(0);
  });

  it("writes CREATE Chunk + HAS_CHUNK for each chunk", async () => {
    neo4jRuns.length = 0;
    const words = Array.from({ length: 10 }, (_, i) => `word${i}`);
    const result = await chunkSnapshot({
      snapId: "snap_TEST002",
      text: words.join(" "),
    });
    expect(result.chunkCount).toBe(1);
    expect(result.chunkIds).toHaveLength(1);
    expect(result.chunkIds[0]).toMatch(/^chk_/);

    const createQueries = neo4jRuns.filter((r) => r.query.includes("CREATE (c:Chunk"));
    const linkQueries = neo4jRuns.filter((r) => r.query.includes("HAS_CHUNK"));
    expect(createQueries).toHaveLength(1);
    expect(linkQueries).toHaveLength(1);
  });

  it("stores correct snap_id and chunk_index in the Chunk node params", async () => {
    neo4jRuns.length = 0;
    const words = Array.from({ length: 600 }, (_, i) => `w${i}`);
    const result = await chunkSnapshot({
      snapId: "snap_TEST003",
      text: words.join(" "),
    });
    expect(result.chunkCount).toBeGreaterThanOrEqual(2);

    const createParams = neo4jRuns
      .filter((r) => r.query.includes("CREATE (c:Chunk"))
      .map((r) => r.params);

    expect(createParams[0]!["snapId"]).toBe("snap_TEST003");
    expect(createParams[0]!["chunkIndex"]).toBe(0);
    expect(createParams[1]!["chunkIndex"]).toBe(1);
  });

  it("returns snapId matching the input", async () => {
    neo4jRuns.length = 0;
    const result = await chunkSnapshot({
      snapId: "snap_MYSNAP",
      text: "some text to chunk",
    });
    expect(result.snapId).toBe("snap_MYSNAP");
  });

  it("propagates Neo4j errors", async () => {
    neo4jShouldThrow = true;
    try {
      await expect(
        chunkSnapshot({ snapId: "snap_ERR001", text: "some text" })
      ).rejects.toThrow("Neo4j write failed");
    } finally {
      neo4jShouldThrow = false;
    }
  });
});
