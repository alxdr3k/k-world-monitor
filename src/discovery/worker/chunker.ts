// Snapshot chunker (INFRA-1B.4).
// Splits snapshot text into overlapping fixed-size chunks and writes Chunk
// nodes into Neo4j with a native FTS index for downstream search (SPIKE-001).
//
// Chunk strategy: word-boundary aligned, ~500-word window, 50-word overlap.
// Chunk node: {chunk_id, snap_id, chunk_index, text, char_start, char_end, created_at}
// Relationship: (Snapshot)-[:HAS_CHUNK]->(Chunk)
//
// INV-0030-2: no network I/O — caller provides pre-extracted text.
//
// AI-P1-1 (INFRA-1B.4.h1-chunker-policy-gate, Q-053 D2 / DEC-024 D2):
// archive_policy gate at function entry. raw third-party text must NOT
// be written to Chunk nodes when the source's archive_policy forbids it,
// extending ADR-0012 INV-0012-3 (R2 raw text prohibition) spirit to the
// Neo4j chunk storage. Gate logic (DEC-024 D2 lock):
//   - full_snapshot_allowed → allow
//   - metadata_only         → reject (no full-text chunking)
//   - excerpt_only          → reject full-text chunking (excerpt-limited
//                              chunking deferred to a future design slice)
//   - do_not_collect        → reject (source-wide collection prohibition)
// Additionally, empty text triggers reject (NOT silent chunk deletion) per
// the AI-P1-1 action-items "empty text 가 chunk 삭제 안 하게" requirement —
// a re-extraction that produced no text must not wipe a prior successful
// run's chunks.

import { ulid } from "ulid";
import { withSession } from "../../storage/neo4j/connection";
import type { ArchivePolicy } from "./snapshot-fingerprint";

export interface ChunkInput {
  snapId: string;
  /** AI-P1-1: required for policy gate trace + error message attribution. */
  sourceId: string;
  /** AI-P1-1: archive_policy gate per Q-053 D2 / DEC-024 D2. */
  archivePolicy: ArchivePolicy;
  text: string;
}

export interface ChunkResult {
  snapId: string;
  chunkCount: number;
  chunkIds: string[];
}

/**
 * Reasons for chunkSnapshot rejection. Operator-observable typed error —
 * lets callers distinguish policy rejection from network / DB failures
 * in error reporting + metrics.
 *
 * `unknown_archive_policy` is the fail-closed default for any archivePolicy
 * value that is NOT one of the 4 known ArchivePolicy enum members. This
 * defends against runtime drift (DB corruption / deserialization mismatch /
 * JS callers bypassing TypeScript types) — the gate is allow-only-when-
 * explicit-full_snapshot_allowed (Codex PR #47 P1 fix).
 */
export type ChunkRejectReason =
  | "metadata_only"
  | "excerpt_only"
  | "do_not_collect"
  | "unknown_archive_policy"
  | "empty_text";

export class ChunkRejected extends Error {
  constructor(
    public readonly reason: ChunkRejectReason,
    public readonly snapId: string,
    public readonly sourceId: string
  ) {
    super(
      `Chunk rejected for snap_id=${snapId} source_id=${sourceId}: reason=${reason}`
    );
    this.name = "ChunkRejected";
  }
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
  // Gate 1: archive_policy enforcement (Q-053 D2 / DEC-024 D2, AI-P1-1).
  // The reject branches throw BEFORE any Neo4j tx is opened — no Snapshot
  // guard, no chunk MERGE, no stale-chunk DETACH DELETE. This makes the
  // gate observable + fast-fail, and preserves any existing chunks on the
  // Snapshot from a prior successful run (the operator may have manually
  // restricted the source policy after a clean extraction).
  //
  // Codex PR #47 P1 fix: gate is allow-only-when-explicit-full_snapshot_allowed
  // (NOT reject-only-when-explicit-restrictive). Defense in depth against
  // archivePolicy values that escape the TypeScript ArchivePolicy union
  // at runtime (DB corruption, JSON deserialization drift, JS callers
  // bypassing TS types). Any unrecognized value falls into
  // `unknown_archive_policy` instead of silently passing the gate.
  if (input.archivePolicy !== "full_snapshot_allowed") {
    const reason: ChunkRejectReason =
      input.archivePolicy === "metadata_only" ||
      input.archivePolicy === "excerpt_only" ||
      input.archivePolicy === "do_not_collect"
        ? input.archivePolicy
        : "unknown_archive_policy";
    throw new ChunkRejected(reason, input.snapId, input.sourceId);
  }

  // Gate 2: empty text guard (AI-P1-1 action-items "empty text 가 chunk
  // 삭제 안 하게"). The previous implementation called writeChunks([]) on
  // empty text, which triggered the stale-chunk DETACH DELETE WHERE
  // chunk_index >= 0 — i.e. wiped ALL chunks for the snap_id. A failed
  // re-extraction (network blip, parser change, transient policy block)
  // would silently destroy a prior successful run's chunks. Reject the
  // empty-text case here so the Snapshot's chunk state is preserved.
  if (!input.text.trim()) {
    throw new ChunkRejected("empty_text", input.snapId, input.sourceId);
  }

  const chunks = splitIntoChunks(input.text);
  // Defensive: splitIntoChunks should always return ≥ 1 chunk after the
  // trim() guard above, but if a whitespace-only edge case slips through
  // we still preserve existing chunks rather than wiping them.
  if (chunks.length === 0) {
    throw new ChunkRejected("empty_text", input.snapId, input.sourceId);
  }
  const chunkIds = await writeChunks(input.snapId, chunks);
  return { snapId: input.snapId, chunkCount: chunks.length, chunkIds };
}
