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

// For no-whitespace scripts (CJK, Thai, minified content) the word tokenizer
// produces too few tokens for very long text, yielding a single oversized chunk.
// The threshold: if token count is less than 10% of what we'd expect for the
// text length (i.e., average token > 50 chars), treat as no-whitespace input
// and fall back to a fixed-character window instead.
const CHAR_CHUNK_SIZE = 1000; // ~500-word equivalent for CJK
const CHAR_OVERLAP_SIZE = 100; // ~50-word equivalent
const NO_WS_TOKEN_RATIO_THRESHOLD = 0.02; // tokens < 2% of chars → no-whitespace

export interface TextChunk {
  text: string;
  charStart: number;
  charEnd: number;
  chunkIndex: number;
}

/**
 * Splits long text without whitespace (CJK, Thai, minified) into fixed-size
 * character windows with overlap, preserving charStart/charEnd into original text.
 */
function splitByCharWindow(text: string, trimmedStart: number): TextChunk[] {
  const chunks: TextChunk[] = [];
  // Walk over the non-whitespace span of the original text.
  const len = text.length;
  let pos = trimmedStart; // first non-whitespace character in original text
  let chunkIndex = 0;

  while (pos < len) {
    const charStart = pos;
    const charEnd = Math.min(pos + CHAR_CHUNK_SIZE, len);
    chunks.push({
      text: text.slice(charStart, charEnd),
      charStart,
      charEnd,
      chunkIndex,
    });
    chunkIndex++;
    if (charEnd >= len) break;
    pos += CHAR_CHUNK_SIZE - CHAR_OVERLAP_SIZE;
  }

  return chunks;
}

export function splitIntoChunks(text: string): TextChunk[] {
  if (!text.trim()) return [];

  // Split on whitespace boundaries, preserving positions relative to original text.
  // Do NOT trim — offsets must be valid indices into the original `text` string.
  const wordMatches = [...text.matchAll(/\S+/g)];
  if (wordMatches.length === 0) return [];

  // Fallback for no-whitespace scripts (CJK, Thai, minified JS, etc.):
  // if word tokens are far fewer than text length, the text has very few (or
  // no) whitespace separators. A single token covering the whole text would
  // produce one oversized chunk — use a character-window split instead.
  const trimmedLen = text.trim().length;
  if (
    trimmedLen > CHAR_CHUNK_SIZE &&
    wordMatches.length / trimmedLen < NO_WS_TOKEN_RATIO_THRESHOLD
  ) {
    // Find the index of the first non-whitespace character for charStart alignment.
    const firstNonWsIdx = wordMatches[0]!.index!;
    return splitByCharWindow(text, firstNonWsIdx);
  }

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
  // NOTE: do NOT short-circuit on chunks.length === 0 here.
  // Even with empty chunks we must: (1) verify the Snapshot exists, and
  // (2) delete any stale Chunk nodes from a prior run that produced more chunks.
  // Returning early would leave orphaned Chunk nodes and silently succeed for
  // invalid snapIds.

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
    // Neo4j driver returns a custom Integer object for count(); Number() normalises
    // it so `=== 0` works correctly regardless of whether the driver is in
    // native-number or Integer-object mode.
    const matchedRaw = guardResult.records[0]?.get("matched");
    const matched = matchedRaw != null ? Number(matchedRaw) : 0;
    if (matched === 0) {
      await tx.rollback();
      throw new Error(`Snapshot not found: ${snapId}`);
    }

    // Track commit attempts so the catch handler never rolls back after a
    // commit is in-flight (Neo4j driver throws on rollback-after-commit).
    let commitAttempted = false;
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
        // RETURN row count so we can detect a missing Snapshot at link time.
        const linkResult = await tx.run(
          `MATCH (s:Snapshot {snap_id: $snapId}), (c:Chunk {snap_id: $snapId, chunk_index: $chunkIndex})
           MERGE (s)-[:HAS_CHUNK]->(c)
           RETURN count(s) AS linked`,
          { snapId, chunkIndex: chunk.chunkIndex }
        );
        const linked = linkResult.records[0]?.get("linked");
        if (linked != null && Number(linked) === 0) {
          throw new Error(`HAS_CHUNK link failed for chunk_index ${chunk.chunkIndex}: Snapshot not matched`);
        }
      }

      // P2: remove stale chunks from a previous run that had more chunks than
      // the current one (chunk_index >= current length are now orphaned).
      await tx.run(
        `MATCH (s:Snapshot {snap_id: $snapId})-[:HAS_CHUNK]->(c:Chunk {snap_id: $snapId})
         WHERE c.chunk_index >= $chunkCount
         DETACH DELETE c`,
        { snapId, chunkCount: chunks.length }
      );

      commitAttempted = true;
      await tx.commit();
      return ids;
    } catch (err) {
      if (!commitAttempted) {
        await tx.rollback();
      }
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
