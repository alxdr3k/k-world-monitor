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
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Split on whitespace boundaries, preserving positions.
  const wordMatches = [...trimmed.matchAll(/\S+/g)];
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
    const chunkText = trimmed.slice(charStart, charEnd);

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
  const chunkIds: string[] = chunks.map(() => `chk_${ulid()}`);

  await withSession(async (session) => {
    const tx = session.beginTransaction();
    try {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        const chunkId = chunkIds[i]!;

        await tx.run(
          `CREATE (c:Chunk {
             chunk_id:    $chunkId,
             snap_id:     $snapId,
             chunk_index: $chunkIndex,
             text:        $text,
             char_start:  $charStart,
             char_end:    $charEnd,
             created_at:  $createdAt
           })`,
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

        await tx.run(
          `MATCH (s:Snapshot {snap_id: $snapId}), (c:Chunk {chunk_id: $chunkId})
           CREATE (s)-[:HAS_CHUNK]->(c)`,
          { snapId, chunkId }
        );
      }
      await tx.commit();
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
