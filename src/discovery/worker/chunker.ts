// Snapshot chunker (INFRA-1B.4).
// Splits snapshot text into overlapping fixed-size chunks and writes Chunk
// nodes into Neo4j with a native FTS index for downstream search (SPIKE-001).
//
// Chunk strategy: word-boundary aligned, ~500-word window, 50-word overlap.
// Chunk node: {chunk_id, snap_id, chunk_index, text, char_start, char_end, created_at}
// Relationship: (Snapshot)-[:HAS_CHUNK]->(Chunk)
//
// INV-0030-2: no network I/O — caller provides pre-extracted text.

import { ulid } from "ulid";
import { withSession } from "../../storage/neo4j/connection";

export interface ChunkInput {
  snapId: string;
  text: string;
}

export interface ChunkResult {
  snapId: string;
  chunkCount: number;
  chunkIds: string[];
}

// ---------------------------------------------------------------------------
// Splitting logic — word-boundary aligned windows.
// ---------------------------------------------------------------------------

const CHUNK_WORDS = 500;
const OVERLAP_WORDS = 50;

export interface TextChunk {
  text: string;
  charStart: number;
  charEnd: number;
  chunkIndex: number;
}

export function splitIntoChunks(text: string): TextChunk[] {
  if (!text.trim()) return [];

  // Split on whitespace boundaries, preserving positions relative to original text.
  // Do NOT trim — offsets must be valid indices into the original `text` string.
  const wordMatches = [...text.matchAll(/\S+/g)];
  if (wordMatches.length === 0) return [];

  const chunks: TextChunk[] = [];
  let chunkIndex = 0;
  let wordStart = 0;

  while (wordStart < wordMatches.length) {
    const wordEnd = Math.min(wordStart + CHUNK_WORDS, wordMatches.length);
    const firstMatch = wordMatches[wordStart]!;
    const lastMatch = wordMatches[wordEnd - 1]!;

    const charStart = firstMatch.index!;
    const charEnd = lastMatch.index! + lastMatch[0].length;
    // Slice from original text so charStart/charEnd round-trip correctly.
    const chunkText = text.slice(charStart, charEnd);

    chunks.push({ text: chunkText, charStart, charEnd, chunkIndex });
    chunkIndex++;

    if (wordEnd >= wordMatches.length) break;
    wordStart += CHUNK_WORDS - OVERLAP_WORDS;
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Neo4j writes.
// ---------------------------------------------------------------------------

async function writeChunks(
  snapId: string,
  chunks: TextChunk[]
): Promise<string[]> {
  if (chunks.length === 0) return [];

  const now = new Date().toISOString();

  const chunkIds: string[] = await withSession(async (session) => {
    const tx = session.beginTransaction();

    // Guard: verify the Snapshot node exists before writing any Chunk nodes.
    // Checked outside the try/catch so a missing Snapshot throws cleanly
    // without triggering a second rollback in the catch handler.
    const guardResult = await tx.run(
      `MATCH (s:Snapshot {snap_id: $snapId}) RETURN count(s) AS matched`,
      { snapId }
    );
    const matched = (guardResult.records[0]?.get("matched") as number) ?? 0;
    if (matched === 0) {
      await tx.rollback();
      throw new Error(`Snapshot not found: ${snapId}`);
    }

    try {
      // Idempotent upsert via MERGE on (snap_id, chunk_index) — the composite
      // uniqueness key.  ON CREATE assigns a fresh ULID; ON MATCH updates
      // mutable fields so a re-run refreshes text/offsets without duplicating.
      // resolvedId is the chunk_id that actually lives in the DB (may differ
      // from the candidate ULID on MATCH path); we return it to the caller.
      const ids: string[] = [];
      for (const chunk of chunks) {
        const chunkId = `chk_${ulid()}`;

        const mergeResult = await tx.run(
          `MERGE (c:Chunk {snap_id: $snapId, chunk_index: $chunkIndex})
           ON CREATE SET
             c.chunk_id   = $chunkId,
             c.text       = $text,
             c.char_start = $charStart,
             c.char_end   = $charEnd,
             c.created_at = $createdAt
           ON MATCH SET
             c.text       = $text,
             c.char_start = $charStart,
             c.char_end   = $charEnd
           RETURN c.chunk_id AS resolvedId`,
          {
            chunkId,
            snapId,
            chunkIndex: chunk.chunkIndex,
            text: chunk.text,
            charStart: chunk.charStart,
            charEnd: chunk.charEnd,
            createdAt: now,
          }
        );
        // Use the chunk_id the DB reports — on MATCH this may be the existing id.
        const resolvedId =
          (mergeResult.records[0]?.get("resolvedId") as string | undefined) ??
          chunkId;
        ids.push(resolvedId);

        // Link Snapshot → Chunk (MERGE avoids duplicate relationships on re-run).
        await tx.run(
          `MATCH (s:Snapshot {snap_id: $snapId}), (c:Chunk {snap_id: $snapId, chunk_index: $chunkIndex})
           MERGE (s)-[:HAS_CHUNK]->(c)`,
          { snapId, chunkIndex: chunk.chunkIndex }
        );
      }

      await tx.commit();
      return ids;
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  });

  return chunkIds;
}

// ---------------------------------------------------------------------------
// Main public function.
// ---------------------------------------------------------------------------

export async function chunkSnapshot(input: ChunkInput): Promise<ChunkResult> {
  const chunks = splitIntoChunks(input.text);
  const chunkIds = await writeChunks(input.snapId, chunks);
  return { snapId: input.snapId, chunkCount: chunks.length, chunkIds };
}
