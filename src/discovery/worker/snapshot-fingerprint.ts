// Snapshot fingerprint creation (INFRA-1B.3).
// Takes a fetched document body and creates Document + Snapshot nodes in Neo4j,
// with content_hash deduplication and conditional R2 upload for permitted artifacts.
//
// ADR-0012 INV-0012-3: raw third-party text → r2_key = NULL always.
// ADR-0012 INV-0012-4: only full_snapshot_allowed + allowed_public_data_only → R2 upload.

import { ulid } from "ulid";
import { createHash } from "crypto";
import { withSession } from "../../storage/neo4j/connection";
import { r2Put } from "../../storage/r2/client";
import { getDb } from "../../storage/sqlite/connection";
import type { ContentKind } from "../fetch/safe-fetch";

export type ArchivePolicy =
  | "metadata_only"
  | "excerpt_only"
  | "full_snapshot_allowed"
  | "do_not_collect";

export type RawCloudPolicy = "always_prohibited" | "allowed_public_data_only";

export interface SnapshotInput {
  sourceId: string;
  queueId: string;
  url: string;
  title?: string;
  publishedAt?: string;
  accessedAt: string;
  body: Uint8Array;
  contentKind: ContentKind;
  mimeType: string;
  archivePolicy: ArchivePolicy;
  rawCloudPolicy: RawCloudPolicy;
}

export interface SnapshotResult {
  snapId: string;
  docId: string;
  contentHash: string;
  r2Key: string | null;
  deduplicated: boolean;
}

// ---------------------------------------------------------------------------
// P2-13: Hash raw bytes directly to avoid memory overhead of hex-encoding body.
// ---------------------------------------------------------------------------

function sha256HexBytes(body: Uint8Array, url: string): string {
  return createHash("sha256").update(body).update(url, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Deduplication: check Neo4j for existing Snapshot with same content_hash.
// ---------------------------------------------------------------------------

async function findExistingSnapshot(contentHash: string): Promise<string | null> {
  return withSession(async (session) => {
    const result = await session.run(
      "MATCH (s:Snapshot {content_hash: $hash}) RETURN s.snap_id AS snap_id LIMIT 1",
      { hash: contentHash }
    );
    const record = result.records[0];
    return record ? (record.get("snap_id") as string) : null;
  });
}

// ---------------------------------------------------------------------------
// Neo4j writes: Document + Snapshot nodes with Source→Document→Snapshot chain.
//
// P1-1: MERGE Document and RETURN d.doc_id so the actual stored doc_id is used
//        for Snapshot.doc_id, not a freshly generated UUID.
// P1-3: Guard that Source exists before committing; throw if missing.
// P1-4: MERGE on content_hash instead of CREATE for idempotent concurrent writes.
//
// Returns the actual { docId, snapId } stored in Neo4j (MERGE may match existing nodes).
// ---------------------------------------------------------------------------

async function createDocumentAndSnapshot(
  input: SnapshotInput,
  snapId: string,
  docId: string,
  contentHash: string
): Promise<{ docId: string; snapId: string }> {
  const now = new Date().toISOString();

  return withSession(async (session) => {
    const tx = session.beginTransaction();
    try {
      // Upsert Document (idempotent on url+source_id).
      // RETURN d.doc_id so ON MATCH case returns the existing stored value.
      const docResult = await tx.run(
        `MERGE (d:Document {url: $url, source_id: $sourceId})
         ON CREATE SET
           d.doc_id       = $docId,
           d.source_id    = $sourceId,
           d.url          = $url,
           d.canonical_url = $url,
           d.title        = $title,
           d.published_at = $publishedAt,
           d.created_at   = $createdAt
         ON MATCH SET
           d.title        = COALESCE($title, d.title),
           d.published_at = COALESCE($publishedAt, d.published_at)
         RETURN d.doc_id AS doc_id`,
        {
          docId,
          sourceId: input.sourceId,
          url: input.url,
          title: input.title ?? null,
          publishedAt: input.publishedAt ?? null,
          createdAt: now,
        }
      );

      // Use the doc_id returned from the MERGE (not the pre-generated local var).
      const actualDocId: string =
        docResult.records.length > 0
          ? (docResult.records[0]!.get("doc_id") as string)
          : docId;

      // P1-3: Guard — Source must exist before linking.
      // If missing, roll back so Document+Snapshot are never committed without a Source.
      const sourceCheck = await tx.run(
        `MATCH (src:Source {source_id: $sourceId}) RETURN count(src) AS matched`,
        { sourceId: input.sourceId }
      );
      const matched =
        sourceCheck.records.length > 0
          ? Number(sourceCheck.records[0]!.get("matched"))
          : 0;
      if (matched === 0) {
        throw new Error(`Source not found in graph: ${input.sourceId}`);
      }

      // P1-4: MERGE on content_hash makes Snapshot creation idempotent.
      // RETURN s.snap_id so the caller uses the actual persisted ID even when MERGE
      // matches an existing node (race: two workers with the same contentHash).
      const snapResult = await tx.run(
        `MERGE (s:Snapshot {content_hash: $contentHash})
         ON CREATE SET
           s.snap_id     = $snapId,
           s.doc_id      = $actualDocId,
           s.url         = $url,
           s.accessed_at = $accessedAt,
           s.locator     = '',
           s.mime        = $mime,
           s.byte_size   = $byteSize,
           s.r2_key      = null,
           s.created_at  = $createdAt
         RETURN s.snap_id AS snap_id`,
        {
          snapId,
          actualDocId,
          url: input.url,
          accessedAt: input.accessedAt,
          contentHash,
          mime: input.mimeType,
          byteSize: input.body.byteLength,
          createdAt: now,
        }
      );
      const actualSnapId: string =
        snapResult.records.length > 0
          ? (snapResult.records[0]!.get("snap_id") as string)
          : snapId;

      // Link Source→Document (MERGE to avoid duplicate edges).
      await tx.run(
        `MATCH (src:Source {source_id: $sourceId}), (d:Document {url: $url, source_id: $sourceId})
         MERGE (src)-[:HAS_DOCUMENT]->(d)`,
        { sourceId: input.sourceId, url: input.url }
      );

      // Link Document→Snapshot (MERGE to avoid duplicate edges).
      await tx.run(
        `MATCH (d:Document {url: $url, source_id: $sourceId}), (s:Snapshot {content_hash: $contentHash})
         MERGE (d)-[:HAS_SNAPSHOT]->(s)`,
        { url: input.url, sourceId: input.sourceId, contentHash }
      );

      await tx.commit();
      return { docId: actualDocId, snapId: actualSnapId };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  });
}

// ---------------------------------------------------------------------------
// P1-6: Source linkage on dedup path.
// When a snapshot is deduplicated, still ensure Source→Document→Snapshot edges
// exist for the current source_id (content may have been first seen from a
// different source).
// ---------------------------------------------------------------------------

async function ensureSourceLinkage(
  input: SnapshotInput,
  contentHash: string
): Promise<void> {
  await withSession(async (session) => {
    const tx = session.beginTransaction();
    try {
      // On the dedup path tolerate a missing Source (do not throw).
      const sourceCheck = await tx.run(
        `MATCH (src:Source {source_id: $sourceId}) RETURN count(src) AS matched`,
        { sourceId: input.sourceId }
      );
      const matched =
        sourceCheck.records.length > 0
          ? Number(sourceCheck.records[0]!.get("matched"))
          : 0;
      if (matched === 0) {
        await tx.rollback();
        return;
      }

      const now = new Date().toISOString();

      // Upsert Document for this source (may not exist if this is a new source).
      await tx.run(
        `MERGE (d:Document {url: $url, source_id: $sourceId})
         ON CREATE SET
           d.doc_id       = $docId,
           d.source_id    = $sourceId,
           d.url          = $url,
           d.canonical_url = $url,
           d.title        = $title,
           d.published_at = $publishedAt,
           d.created_at   = $createdAt
         ON MATCH SET
           d.title        = COALESCE($title, d.title),
           d.published_at = COALESCE($publishedAt, d.published_at)`,
        {
          docId: `doc_${ulid()}`,
          sourceId: input.sourceId,
          url: input.url,
          title: input.title ?? null,
          publishedAt: input.publishedAt ?? null,
          createdAt: now,
        }
      );

      await tx.run(
        `MATCH (src:Source {source_id: $sourceId}), (d:Document {url: $url, source_id: $sourceId})
         MERGE (src)-[:HAS_DOCUMENT]->(d)`,
        { sourceId: input.sourceId, url: input.url }
      );

      await tx.run(
        `MATCH (d:Document {url: $url, source_id: $sourceId}), (s:Snapshot {content_hash: $contentHash})
         MERGE (d)-[:HAS_SNAPSHOT]->(s)`,
        { url: input.url, sourceId: input.sourceId, contentHash }
      );

      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  });
}

// ---------------------------------------------------------------------------
// discovery_queue status update (serial SQLite, INV-0030-2).
// ---------------------------------------------------------------------------

// P2-8: Pass computed contentHash directly — the old code was a self-copy no-op
//        (SELECT content_hash FROM discovery_queue WHERE queue_id = ?).
// Single UPDATE to ensure status, content_hash, and error_detail are written atomically.
// error_detail stores snap_id as result metadata; a dedicated snap_id column will be
// added in a later migration if needed.
function markQueueItemDone(queueId: string, snapId: string, contentHash: string): void {
  getDb()
    .prepare(
      `UPDATE discovery_queue
       SET status = 'done', content_hash = ?, error_detail = ?
       WHERE queue_id = ?`
    )
    .run(contentHash, `snap_id:${snapId}`, queueId);
}

function markQueueItemError(queueId: string, detail: string): void {
  getDb()
    .prepare(
      `UPDATE discovery_queue SET status = 'error', error_detail = ? WHERE queue_id = ?`
    )
    .run(detail.slice(0, 500), queueId);
}

// ---------------------------------------------------------------------------
// Main public function.
// ---------------------------------------------------------------------------

export async function createSnapshotFingerprint(
  input: SnapshotInput
): Promise<SnapshotResult> {
  // P2-13: Hash raw Uint8Array bytes — no hex-stringify to avoid doubling memory.
  const contentHash = sha256HexBytes(input.body, input.url);

  // Deduplication: if identical content already snapped, skip Neo4j write.
  const existing = await findExistingSnapshot(contentHash);
  if (existing) {
    // P1-6: Ensure Source→Document→Snapshot edges for current source_id even on dedup.
    await ensureSourceLinkage(input, contentHash);
    markQueueItemDone(input.queueId, existing, contentHash);
    return {
      snapId: existing,
      docId: "",
      contentHash,
      r2Key: null,
      deduplicated: true,
    };
  }

  const snapId = `snap_${ulid()}`;
  const docId = `doc_${ulid()}`;

  // P2-9: Neo4j write FIRST, R2 upload after — prevents orphaned R2 objects on Neo4j failure.
  const { docId: actualDocId, snapId: actualSnapId } = await createDocumentAndSnapshot(
    input,
    snapId,
    docId,
    contentHash
  );

  // R2 upload: only for explicitly permitted artifacts (ADR-0012 INV-0012-3/4).
  // P2-9 addendum: After Neo4j write, upload to R2 and then back-patch the
  // Snapshot node's r2_key so the stored graph reflects the actual R2 locator.
  let r2Key: string | null = null;
  if (
    input.archivePolicy === "full_snapshot_allowed" &&
    input.rawCloudPolicy === "allowed_public_data_only"
  ) {
    const key = `permitted_artifact/derived/snapshot/${actualSnapId}`;
    const bodyBuf = input.body.buffer.slice(
      input.body.byteOffset,
      input.body.byteOffset + input.body.byteLength
    ) as ArrayBuffer;
    await r2Put(key, bodyBuf);
    r2Key = key;
    // Back-patch r2_key on the Snapshot node now that upload succeeded.
    await withSession(async (session) => {
      await session.run(
        `MATCH (s:Snapshot {snap_id: $snapId}) SET s.r2_key = $r2Key`,
        { snapId: actualSnapId, r2Key: key }
      );
    });
  }

  markQueueItemDone(input.queueId, actualSnapId, contentHash);

  return { snapId: actualSnapId, docId: actualDocId, contentHash, r2Key, deduplicated: false };
}

export async function processDiscoveryQueue(
  archivePolicyFn: (sourceId: string) => Promise<{
    archivePolicy: ArchivePolicy;
    rawCloudPolicy: RawCloudPolicy;
  }>
): Promise<{ processed: number; deduplicated: number; errors: number }> {
  const db = getDb();

  // P2-10: Reset stale processing rows from crashed workers (older than 1 hour).
  // Uses updated_at column (added in v6 migration). Gracefully skips on pre-v6 schemas.
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    db.prepare(
      `UPDATE discovery_queue SET status = 'pending'
       WHERE status = 'processing' AND updated_at < ?`
    ).run(oneHourAgo);
  } catch {
    // updated_at column absent (pre-v6 schema) — stale reclaim skipped.
  }

  // P1-5: Atomic row claiming using a SQLite transaction so two concurrent workers
  // cannot claim the same rows.
  const batchSize = 100;
  const pending = db.transaction(() => {
    const rows = db
      .prepare(
        `SELECT queue_id, source_id, url, title, published_at
         FROM discovery_queue
         WHERE status = 'pending'
         ORDER BY discovered_at ASC
         LIMIT ?`
      )
      .all(batchSize) as Array<{
        queue_id: string;
        source_id: string;
        url: string;
        title: string | null;
        published_at: string | null;
      }>;

    if (rows.length > 0) {
      const ids = rows.map((r) => r.queue_id);
      db.prepare(
        `UPDATE discovery_queue SET status = 'processing'
         WHERE queue_id IN (${ids.map(() => "?").join(",")})`
      ).run(...ids);
    }

    return rows;
  })();

  let processed = 0;
  let deduplicated = 0;
  let errors = 0;

  for (const row of pending) {
    try {
      const { archivePolicy, rawCloudPolicy } = await archivePolicyFn(row.source_id);

      // P1-7: Enforce do_not_collect before any outbound fetch.
      if (archivePolicy === "do_not_collect") {
        markQueueItemError(row.queue_id, "skipped: do_not_collect policy");
        errors++;
        continue;
      }

      const { safeFetch, MAX_BYTES } = await import("../fetch/safe-fetch");

      // P1-2: Use MAX_BYTES.html for document URLs — larger cap than rss (10MB vs 5MB).
      const res = await safeFetch(row.url, { maxBytes: MAX_BYTES.html });

      // P2-12: Require 2xx with body; treat 204 (no body), 3xx, 4xx, 5xx as errors.
      if (!(res.status >= 200 && res.status < 300) || res.status === 204) {
        markQueueItemError(row.queue_id, `HTTP ${res.status}`);
        errors++;
        continue;
      }

      const mimeType =
        res.headers.get("Content-Type")?.split(";")[0]?.trim() ?? "application/octet-stream";

      // P2-11: Use finalUrl (after redirects) as the canonical URL for snapshot identity.
      const result = await createSnapshotFingerprint({
        sourceId: row.source_id,
        queueId: row.queue_id,
        url: res.finalUrl,
        title: row.title ?? undefined,
        publishedAt: row.published_at ?? undefined,
        accessedAt: new Date().toISOString(),
        body: res.body,
        contentKind: res.contentKind,
        mimeType,
        archivePolicy,
        rawCloudPolicy,
      });

      if (result.deduplicated) deduplicated++;
      else processed++;
    } catch (err) {
      markQueueItemError(
        row.queue_id,
        err instanceof Error ? err.message : String(err)
      );
      errors++;
    }
  }

  return { processed, deduplicated, errors };
}
